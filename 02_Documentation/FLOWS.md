# Holistic Unity — Mappa dei flussi end-to-end

Documento di riferimento operativo. Riassume cosa succede dietro ogni azione utente nelle due web app (terapista + cliente), con path al codice, scritture DB, side effect e bug identificati.

Aggiornato 2026-04-27. Vedi anche `therapist-webapp/memory.md` per architettura, costanti, env vars e cron schedule.

---

## Indice

- [Architettura](#architettura)
- [Therapist webapp — 12 flussi](#therapist-webapp--12-flussi)
- [Client webapp — 13 flussi](#client-webapp--13-flussi)
- [Bug identificati](#bug-identificati)

---

## Architettura

| Componente | Dove | Ruolo |
|---|---|---|
| **iOS app** (Swift) | `iOS App/` | App nativa cliente: browse, booking, video, messaging |
| **client-webapp** | `client-webapp/` | Web cliente: equivalente iOS |
| **therapist-webapp** | `therapist-webapp/` | Dashboard terapista: gestione professionale |
| **admin-dashboard** | `admin-dashboard/` | Pannello admin: approvazioni, FIC, payouts |
| **Edge Functions** | Supabase (NON in repo) | Logica server-side critica: `create-booking-with-payment`, `stripe-webhook`, `request-refund`, `livekit-token`, `stream-token`, ecc. |
| **Stripe Connect** | Express accounts | Destination charge marketplace |
| **LiveKit Cloud** | wss://holistic-unity-7cj033ty.livekit.cloud | Video chiamate |
| **Stream Chat** | SaaS | Messaggistica 1:1 |
| **FattureInCloud** | API + SDI | Fatturazione mensile commissione 20% |

---

# Therapist webapp — 12 flussi

## 1. Onboarding & registrazione

**Trigger**: `/register` → submit
**Path**: [register/page.tsx:55](therapist-webapp/src/app/register/page.tsx) → `signUp()` con `role:"therapist"` in metadata, `emailRedirectTo:/auth/callback?next=/dashboard`. Se sessione presente (no email-confirm): upsert `public.users` + `therapist_profiles` con `approval_status:"pending_review"` + `signOut()`. Altrimenti: banner "controlla email".

**Login**: [login/page.tsx:27](therapist-webapp/src/app/login/page.tsx) → `signInWithPassword` → check `users.role="therapist"` → check `therapist_profiles.approval_status="approved"` → redirect a `/verify-mfa` o `/dashboard`.

**Dashboard gate** ([layout.tsx](therapist-webapp/src/app/dashboard/layout.tsx)): role + approval_status + MFA factors + AAL2.

**DB writes**: `users`, `therapist_profiles`

---

## 2. MFA Enroll/Verify

**Trigger**: layout redirect a `/enroll-mfa` se nessun factor verificato
**Path**: [enroll-mfa/page.tsx](therapist-webapp/src/app/enroll-mfa/page.tsx) — wizard 4-step (scan QR → verify TOTP → backup codes → done). [api/security/backup-codes/route.ts](therapist-webapp/src/app/api/security/backup-codes/route.ts) genera 8 codici bcrypt-hashed (insert-then-delete dopo fix recente).

**Recovery**: PUT `/api/security/backup-codes` verifica codice, disabilita TOTP, rate limit 5/15min.

**DB writes**: `auth.mfa_factors`, `therapist_profiles.has_mfa`, `mfa_backup_codes`, `mfa_audit_log`

---

## 3. Profilo & specializzazioni

**Trigger**: `/dashboard/profile` → salva
**Path**: [dashboard/profile/page.tsx](therapist-webapp/src/app/dashboard/profile/page.tsx) — update diretto `therapist_profiles` (display_name, bio, categories, languages, helps_with, photo_url, gallery_image_urls, certifications). Foto su Supabase Storage bucket `therapist-photos`, max 6 gallery × 5MB.

**DB writes**: `therapist_profiles`, `certifications`

---

## 4. Servizi (CRUD)

**Trigger**: `/dashboard/services` → form
**Path**: [dashboard/services/page.tsx](therapist-webapp/src/app/dashboard/services/page.tsx) — fetch `therapist_services` per `therapist_id`. Idempotent seed della "Free Introductory Call" (15min, €0) al mount se assente. Pack 4/6/8/10 sessioni con `pack_price` separato.

**DB writes**: `therapist_services`

---

## 5. Disponibilità + Calendar Sync

**Trigger**: `/dashboard/availability` → salva schedule + connect Google/Microsoft
**Path**:
- Schedule: update JSONB `therapist_profiles.availability` ({recurring, exceptions, timezone, minNoticeHours, bufferMinutes})
- OAuth Google: [api/calendar/google/authorize](therapist-webapp/src/app/api/calendar/google/authorize/route.ts) → state HMAC-signed (15min TTL). Callback ([calendar/google/callback/route.ts:40](therapist-webapp/src/app/api/calendar/google/callback/route.ts)) verifica state + currentUser.id, exchange code, upsert `therapist_calendar_integrations`.
- Microsoft analoga
- Freebusy: [calendar/google/freebusy/route.ts](therapist-webapp/src/app/api/calendar/google/freebusy/route.ts) → token refresh se <5min, GET Google FreeBusy
- iCal feed pubblico: [api/ical/[therapistId]/[token]](therapist-webapp/src/app/api/ical/[therapistId]/[token]/route.ts) — token HMAC-SHA256 deterministico

**DB writes**: `therapist_profiles.availability`, `therapist_calendar_integrations`

---

## 6. Bookings management

**Stati**: `pending → confirmed → in_progress → completed` con rami `cancelled`, `no_show`, `reschedule_pending`.

**Cancel terapista** ([api/bookings/[id]/cancel/route.ts](therapist-webapp/src/app/api/bookings/[id]/cancel/route.ts)): lookup + ownership → status check → reliability gate (block se cancel rate >20% in 30gg) → atomic UPDATE → Stripe refund 100% (`reverse_transfer + refund_application_fee`) → flag `requires_manual_refund` se >14gg post-charge → revert helper su fallimento Stripe (eccetto "already refunded").

**Reschedule terapista** ([api/bookings/[id]/reschedule/route.ts](therapist-webapp/src/app/api/bookings/[id]/reschedule/route.ts)): confirmed → `reschedule_pending` con `proposed_scheduled_at`. Vincoli: min 1h futuro, max 3 reschedules, reliability gate.

**DB writes**: `bookings` (status, audit), `transactions` (refund_amount, status="refunded")

---

## 7. Sessione video

**Trigger**: terapista apre `/call/[bookingId]`
**Path**: [call/[bookingId]/page.tsx](therapist-webapp/src/app/call/[bookingId]/page.tsx) — pre-flight `getUserMedia` probe, fetch booking + `user_display_info` view. POST [api/livekit/token](therapist-webapp/src/app/api/livekit/token/route.ts) usa `getUser()` (no `getSession()` dopo fix #3) → join window check (15min prima → 3h dopo) → proxy a Edge Function `livekit-token`. End: POST `/api/bookings/[id]/complete` (solo therapist autorizzato dopo fix #2).

**Stati**: confirmed → in_progress → completed; disconnect involontario non flippa.

---

## 8. Messaggi (Stream Chat)

**Trigger**: `/dashboard/messages`
**Path**: [dashboard/messages/page.tsx](therapist-webapp/src/app/dashboard/messages/page.tsx) — fetch profilo, POST `/api/stream/token` (rate limit 30/5min, role gate), `connectUser`. Componenti Stream Chat React con custom header. ChannelList filtra `members: { $in: [userId] }`.

---

## 9. Earnings

**Path**: [dashboard/earnings/page.tsx:115](therapist-webapp/src/app/dashboard/earnings/page.tsx) — dual-source:
- DB: query `transactions` per `therapist_id` (max 200), KPI calcolati lato client
- Stripe live: polling 60s/120s su [api/stripe/balance](therapist-webapp/src/app/api/stripe/balance/route.ts) e `/transactions` (saldo, in transito, ultimi 30 movimenti)
- CSV export client-side

---

## 10. Fatturazione

**Trigger**: `/dashboard/billing` → salva (form country-aware)
**Path**: [api/billing/profile/route.ts](therapist-webapp/src/app/api/billing/profile/route.ts) — validazione per regione (IT_BUSINESS, IT_PRIVATE, EU, UK, ROW). VAT change → azzera `vat_validated_at` (cron admin ri-valida via VIES/HMRC).

**Cron mensile FIC** (admin-dashboard, 1° del mese 03:00 UTC): `resolveTaxMode()` → `createCommissionInvoice()` → submit SDI per IT → INSERT `therapist_invoices`.

**Visualizzazione**: [dashboard/invoices/page.tsx](therapist-webapp/src/app/dashboard/invoices/page.tsx) RLS-scoped per `therapist_id`.

**DB writes**: `therapist_profiles` (billing fields), `therapist_invoices`, `therapist_invoice_credits`

---

## 11. Stripe Connect — race workaround

**Path**:
- [api/stripe/sync-status/route.ts](therapist-webapp/src/app/api/stripe/sync-status/route.ts): on-demand al mount settings page, fetch live Stripe account, ricalcola status, update DB se cambiato
- [api/cron/sync-stripe-status/route.ts](therapist-webapp/src/app/api/cron/sync-stripe-status/route.ts): backup ogni 15min via Vercel Cron, max 30 therapist `onboarding_pending` aggiornati >5min fa

---

## 12. Notifiche

**In-app**: [dashboard/notifications/page.tsx](therapist-webapp/src/app/dashboard/notifications/page.tsx) — query `notifications`, max 100. Tipi: booking_request, booking_confirmed, booking_cancelled, reschedule_*, new_message, payment_processed, refund_issued, profile_approved, review_received. Mark-as-read client-side.

**Email**: gestita da Edge Functions Supabase via Brevo.

---

# Client webapp — 13 flussi

## 1. Registrazione & onboarding

**Trigger**: `/register` → submit
**Path**: [register/page.tsx:105](client-webapp/src/app/register/page.tsx) — Cloudflare Turnstile anti-bot (skip-safe), HIBP password check, `signUp()` con `tos_pending_*` in metadata + `emailRedirectTo:/auth/callback?next=/welcome`. Callback ([auth/callback/route.ts:35](client-webapp/src/app/auth/callback/route.ts)) → `/welcome`.

**Onboarding** [welcome/page.tsx](client-webapp/src/app/welcome/page.tsx): 7-step wizard (intent, focus_areas, familiar_practices, approaches, timing, notes, summary). Step config in [lib/onboarding/steps.ts](client-webapp/src/lib/onboarding/steps.ts). Promotion TOS al mount → POST `/api/tos/accept` (idempotente). Submit finale → `client_preferences.completed_at = now` → `/dashboard`.

**Side effects**: Meta Pixel `Lead`+`CompleteRegistration`, GA4 `sign_up` (Enhanced Conversions).

**DB writes**: `users`, `tos_acceptances`, `client_preferences`

---

## 2. Browse terapisti

**Trigger**: `/dashboard/therapists`
**Path**: [dashboard/therapists/page.tsx:33-72](client-webapp/src/app/dashboard/therapists/page.tsx) — query `therapist_profiles_public` view (filtri approved+active baked in) + query parallela `therapist_services` per intro gratuita (price=0+is_intro_call=true) → Set IDs. Filtri client-side su `[query, activeCategory]`.

---

## 3. Profilo terapista

**Trigger**: `/dashboard/therapists/[id]`
**Path**: [dashboard/therapists/[id]/page.tsx:139-207](client-webapp/src/app/dashboard/therapists/[id]/page.tsx) — 4 query in `Promise.all`:
1. `/api/therapists/[id]/profile` (server route con service-role bookability filter)
2. `therapist_services`
3. `certifications`
4. `/api/therapists/[id]/freebusy?start=&end=` (21gg, merge DB bookings + Google/Microsoft external_busy)

**UI**: hero photo+name+tagline+helps_with badges+free intro badge → bio → media (video click → modal portrait-aware) → gallery → formazione → recensioni → sticky booking sidebar desktop / sticky bottom CTA mobile.

**Side effects**: Meta Pixel `InitiateCheckout` al click "Paga".

---

## 4. Booking flow — slot picker

**Path**: [components/booking/SlotPicker.tsx](client-webapp/src/components/booking/SlotPicker.tsx) → [lib/booking/slots.ts](client-webapp/src/lib/booking/slots.ts) `computeSlots()` su finestra 14gg con `external_busy` status incluso. Locale prop opzionale (default it-IT) per time formatting.

---

## 5. Pagamento (Stripe Checkout)

**Trigger**: click "Paga e Conferma"
**Path**: [api/checkout/create/route.ts](client-webapp/src/app/api/checkout/create/route.ts):
1. Auth + `stripe_connected_account_id` lookup admin
2. Verifica `approval_status='approved' && stripe_account_status='active'`
3. INSERT `bookings status='pending_payment'`
4. `stripe.checkout.sessions.create()` con `idempotencyKey: checkout-${booking.id}` + `application_fee_amount` + `transfer_data.destination` + metadata cross-checkable

**Webhook** ([api/webhooks/stripe/route.ts](client-webapp/src/app/api/webhooks/stripe/route.ts)):
- `checkout.session.completed` → cross-check metadata vs DB → optimistic lock UPDATE confirmed → backfill `video_room_id` → UPSERT `transactions` → `notifyBookingConfirmed()` (Brevo tpl 3+4)
- `payment_intent.payment_failed` → status='cancelled'

**Polling success** ([checkout/success/page.tsx](client-webapp/src/app/checkout/success/page.tsx)): poll 1.5s × 8 attempts. Dopo timeout: messaggio "pagamento ricevuto, conferma in elaborazione" (no falso positivo).

**DB writes**: `bookings`, `transactions`, `notifications`

---

## 6. Free intro call (price=0)

**Path**: [api/checkout/create/route.ts:119-171](client-webapp/src/app/api/checkout/create/route.ts) — bypassa Stripe, INSERT `bookings status='confirmed'` direttamente, genera `video_room_id`, fire-and-forget `notifyFreeBookingConfirmed()`. Response: `{free:true, redirectUrl:/checkout/success?free=1&...}`.

---

## 7. Bookings dashboard

**Path**: [dashboard/bookings/page.tsx](client-webapp/src/app/dashboard/bookings/page.tsx) — query bookings + reviews. Join window calcolato per ogni row.

**Cancel** ([api/bookings/[id]/cancel/route.ts](client-webapp/src/app/api/bookings/[id]/cancel/route.ts)) **dopo fix race condition**: atomic UPDATE prima → poi Stripe refund tiered (≥48h: 100%, 24-48h: 50% via `amount_received` retrieve, <24h: 0%). Revert su Stripe failure (eccetto "already refunded").

**Reschedule respond** ([api/bookings/[id]/reschedule/respond/route.ts](client-webapp/src/app/api/bookings/[id]/reschedule/respond/route.ts)): accept → UPDATE scheduled_at + `reschedule_count++`; reject → refund 100% + cancelled.

**Review**: INSERT `reviews` via RLS, validato da trigger `validate_review_booking`.

---

## 8. Sessione video

**Path**: [call/[bookingId]/page.tsx](client-webapp/src/app/call/[bookingId]/page.tsx) — `probeMediaPermissions()` → fetch booking + `user_display_info` view (no PII) → POST `/api/livekit/token` con join window check → `<LiveKitRoom>`. End: POST `/api/bookings/[id]/complete`.

---

## 9. Messaggi

**Path**: [dashboard/messages/page.tsx](client-webapp/src/app/dashboard/messages/page.tsx) — token Stream Chat con timeout 10s → `connectUser()` → ChannelList. Deep-link `?to=<id>`: `AutoOpenChannel` crea/trova canale `dm-${sortA[0..8]}-${sortB[0..8]}` → `setActiveChannel`. Custom header con CTA "Prenota".

---

## 10. Pratiche

**Path**: [dashboard/pratiche/page.tsx:28-53](client-webapp/src/app/dashboard/pratiche/page.tsx) — query parallela `practices` (published) + `therapist_profiles_public.categories` per count. Split active/comingSoon. Dettaglio in `[slug]/page.tsx`. Mappatura category→slug in [profile page](client-webapp/src/app/dashboard/therapists/[id]/page.tsx).

---

## 11. Notifiche in-app

**Path**: [dashboard/notifications/page.tsx](client-webapp/src/app/dashboard/notifications/page.tsx) — query RLS-scoped, max 100. Mark-read client-side.

---

## 12. Account

**Path**: [dashboard/account/page.tsx](client-webapp/src/app/dashboard/account/page.tsx) — edit profilo, change password (HIBP), language toggle, recent logins, **delete account** → POST Edge Function `delete-user-account` (orchestratore: Stripe customer delete + Stream Chat anonymize + DB cleanup + auth.users delete).

---

## 13. Auto-cancel reschedule (cron)

**Path**: [api/cron/auto-cancel-reschedule/route.ts](client-webapp/src/app/api/cron/auto-cancel-reschedule/route.ts) — Vercel cron orario con `CRON_SECRET`. Trova `reschedule_pending` con `reschedule_proposed_at < now-24h` (max 50). Per ogni: Stripe full refund + atomic UPDATE cancelled. Gestisce `already_refunded` come success (dopo fix recente).

---

# Bug identificati

Bug nuovi trovati durante questa analisi (non già fixati nei round precedenti).

## 🔴 Critici

### B1 — Therapist accept/decline/approveReschedule sono client-side direct DB writes

**File**: [therapist-webapp/src/app/dashboard/bookings/page.tsx:170,203,240](therapist-webapp/src/app/dashboard/bookings/page.tsx)

`acceptBooking()`, `declineBooking()`, `approveReschedule()` fanno `supabase.from("bookings").update(...)` direttamente lato client. Conseguenze:
- **Nessuna notifica** al cliente quando il terapista accetta/rifiuta
- **Nessun refund Stripe** in caso di decline su booking già pagato (soldi bloccati)
- **Nessuna validazione server-side** del nuovo `scheduled_at` su approveReschedule (bypass conflitti slot, vincoli min-notice, reliability)
- **Nessun audit log** delle azioni
- **RLS permette l'UPDATE** ma non applica le regole business

**Fix**: tre route API server (`/api/bookings/[id]/accept`, `/decline`, `/approve-reschedule`) con validazione e side effects (Brevo + notifications).

### B2 — Reschedule respond (client) — refund prima del lock DB

**File**: [client-webapp/src/app/api/bookings/[id]/reschedule/respond/route.ts:100-133](client-webapp/src/app/api/bookings/[id]/reschedule/respond/route.ts)

Stesso pattern del cancel (già fixato): refund Stripe eseguito **prima** dell'UPDATE atomico `bookings`. Se due reject paralleli arrivano contemporaneamente o se UPDATE fallisce dopo refund, il denaro è già rimborsato ma il booking resta `reschedule_pending` → la cron può tentare un secondo refund (per fortuna ora la cron gestisce `already_refunded`, ma è fragile).

**Fix**: invertire l'ordine come fatto per `/api/bookings/[id]/cancel` (UPDATE atomico → poi Stripe → revert su fallimento).

## 🟡 Importanti

### B3 — Email confirm + DB trigger gap

**File**: [therapist-webapp/src/app/register/page.tsx](therapist-webapp/src/app/register/page.tsx)

Se l'env Supabase ha email-confirm **ON**, le righe `users` e `therapist_profiles` non vengono create al signup. Il commento dice "DB trigger if present", ma se manca il trigger, al primo login il dashboard gate legge `users.role=null` → redirect `/login?error=not_therapist`.

**Fix**: provisioning lazy in `/auth/callback` per role therapist, simile a quanto già fatto in client-webapp/dashboard/layout.tsx.

### B4 — Bookings dashboard "isCancellable" non include `pending_payment`

**File**: [client-webapp/src/app/dashboard/bookings/page.tsx:287](client-webapp/src/app/dashboard/bookings/page.tsx)

UI non mostra il bottone "Annulla" su bookings in `pending_payment` (checkout aperto, non ancora pagato). L'API cancel li accetta, ma il cliente non può triggerare la cancel da dashboard. Risultato: bookings orfani in pending_payment finché un altro flusso (timeout Stripe Checkout? cron?) li chiude.

**Fix**: aggiungere `pending_payment` a `isCancellable` set.

### B5 — Webhook upsert silent failure

**File**: [client-webapp/src/app/api/webhooks/stripe/route.ts:213-217](client-webapp/src/app/api/webhooks/stripe/route.ts)

Se l'UPSERT su `transactions` fallisce dopo `checkout.session.completed`, c'è solo un `console.error` — il booking è confermato ma il terapista non vedrà il payout in earnings finché qualcuno non backfilla manualmente.

**Fix**: ritry strategy o alert (Sentry breadcrumb già esiste; aggiungere `Sentry.captureException` esplicito).

## 🟢 Minor / UX

### B6 — Notifiche: nessun realtime

Nessun Supabase Realtime / WebSocket → la pagina notifiche non aggiorna senza refresh manuale. Stesso problema su entrambe le app.

**Fix**: subscribe a `notifications` table con Realtime channel.

### B7 — Therapists list: filtraggio interamente client-side

**File**: [client-webapp/src/app/dashboard/therapists/page.tsx](client-webapp/src/app/dashboard/therapists/page.tsx)

Tutto il dataset caricato in memoria. Funziona per pochi terapisti; con >500 inizia a essere lento e usa banda inutilmente.

**Fix** quando scala: server-side filtering + pagination (Supabase `.range()`).

### B8 — Call page commento fuorviante (non bug funzionale)

**File**: [client-webapp/src/app/call/[bookingId]/page.tsx:157-163](client-webapp/src/app/call/[bookingId]/page.tsx)

Il commento dice "Get therapist name" ma in realtà fetcha il `display_name` del **caller** (cliente o terapista). La logica è corretta in entrambe le app, ma il commento confonde chi legge. Da aggiornare.

---

## Riepilogo priorità fix

| # | Severità | Effort | Bug |
|---|---|---|---|
| B1 | 🔴 Critico | 4-5h | Therapist accept/decline/approve client-side → API routes |
| B2 | 🔴 Critico | 30 min | Reschedule respond race condition |
| B3 | 🟡 Importante | 1h | Lazy provisioning therapist users post email-confirm |
| B4 | 🟡 Importante | 5 min | Aggiungere pending_payment a isCancellable UI |
| B5 | 🟡 Importante | 30 min | Sentry capture su webhook upsert failure |
| B6 | 🟢 UX | 2h | Realtime notifications |
| B7 | 🟢 Perf | 2h | Server-side pagination |
| B8 | 🟢 Doc | 5 min | Aggiornare commento call page |

**Totale critici**: ~5h. Gli altri sono distribuibili nel tempo.

---

## File chiave (cross-reference)

### Therapist webapp
- [`src/app/dashboard/layout.tsx`](therapist-webapp/src/app/dashboard/layout.tsx) — gate auth/MFA
- [`src/app/dashboard/bookings/page.tsx`](therapist-webapp/src/app/dashboard/bookings/page.tsx) — gestione bookings (vedi B1)
- [`src/app/api/bookings/[id]/cancel/route.ts`](therapist-webapp/src/app/api/bookings/[id]/cancel/route.ts) — cancel + reliability + refund
- [`src/app/api/livekit/token/route.ts`](therapist-webapp/src/app/api/livekit/token/route.ts) — token videocall
- [`src/lib/calendar/tokens.ts`](therapist-webapp/src/lib/calendar/tokens.ts) — OAuth state, iCal HMAC, refresh token
- [`src/app/api/billing/profile/route.ts`](therapist-webapp/src/app/api/billing/profile/route.ts) — billing country-aware

### Client webapp
- [`src/app/api/checkout/create/route.ts`](client-webapp/src/app/api/checkout/create/route.ts) — Stripe Checkout
- [`src/app/api/webhooks/stripe/route.ts`](client-webapp/src/app/api/webhooks/stripe/route.ts) — webhook (vedi B5)
- [`src/app/api/bookings/[id]/cancel/route.ts`](client-webapp/src/app/api/bookings/[id]/cancel/route.ts) — cancel tiered refund
- [`src/app/api/bookings/[id]/reschedule/respond/route.ts`](client-webapp/src/app/api/bookings/[id]/reschedule/respond/route.ts) — vedi B2
- [`src/components/booking/SlotPicker.tsx`](client-webapp/src/components/booking/SlotPicker.tsx) — slot picker (locale-aware)
- [`src/app/dashboard/therapists/[id]/page.tsx`](client-webapp/src/app/dashboard/therapists/[id]/page.tsx) — pagina booking (sticky sidebar, video modal, helps_with)
- [`src/lib/booking/join-window.ts`](client-webapp/src/lib/booking/join-window.ts) — finestra join (single source of truth)

### Cross-cutting
- [`therapist-webapp/memory.md`](therapist-webapp/memory.md) — architettura, costanti, env vars, cron
- [`therapist-webapp/docs/flows/07-payment.md`](therapist-webapp/docs/flows/07-payment.md) — spec pagamento
- [`therapist-webapp/docs/flows/08-refund-cancellation.md`](therapist-webapp/docs/flows/08-refund-cancellation.md) — spec refund 3-tier
