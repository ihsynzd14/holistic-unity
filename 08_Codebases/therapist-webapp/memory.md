# Holistic Unity — Memory

Riferimento operativo della piattaforma. Da leggere all'inizio di ogni sessione di lavoro: copre architettura, flusso pagamenti, fatturazione, costanti chiave e gap noti. Aggiornato 2026-04-27.

---

## 1. Architettura

La piattaforma vive in **4 codebase**, tutti collegati allo stesso DB Supabase:

| Codebase | Path | Cosa fa |
|---|---|---|
| **iOS app** (Swift) | `iOS App/` | Cliente finale: browse, booking, pagamento, video call, messaging |
| **client-webapp** (Next.js 16) | `client-webapp/` | Web equivalente dell'iOS: marketplace, booking, dashboard cliente |
| **therapist-webapp** (Next.js 16) | `therapist-webapp/` ← *questo repo* | Dashboard terapista: services, availability, bookings, earnings, fatture |
| **admin-dashboard** (Next.js) | `admin-dashboard/` | Pannello admin: approvazione terapisti, FattureInCloud OAuth, audit |
| **Edge Functions** (Deno) | `supabase/functions/` (NON in questi repo) | Logica server-side critica: `create-booking-with-payment`, `stripe-webhook`, `request-refund`, ecc. |

⚠️ **Importante**: gli Edge Functions sono deployati direttamente su Supabase e NON sono presenti in nessuno dei repo Next.js. Per modificarli serve accesso al progetto Supabase (`bqyqkvkzkemiwyqjkbna` — "Holistic New").

**Domini produzione**:
- App cliente: `https://app.holisticunity.app`
- Portal terapista: `https://therapistportal.holisticunity.app`
- Admin: `https://admin.holisticunity.app`

---

## 2. Stack tecnico

- **Frontend**: Next.js 16 con Turbopack, Tailwind v4, React 19
- **Backend**: Supabase (Postgres + Edge Functions Deno)
- **Auth**: Supabase Auth (email/password + OAuth) + MFA TOTP obbligatoria per terapisti
- **Pagamenti**: Stripe Connect Express (destination charge)
- **Video**: LiveKit Cloud (`wss://holistic-unity-7cj033ty.livekit.cloud`)
- **Chat**: Stream Chat (1:1 client-therapist DM)
- **Fatturazione**: FattureInCloud API (in arrivo, schema DB pronto)
- **Calendar**: Google Calendar + Microsoft Graph (OAuth, freebusy bidirezionale)
- **Hosting**: Vercel
- **Mobile**: SwiftUI nativo (Stripe Payment Sheet)

---

## 3. Flusso Pagamento — End-to-End

### Modello: **Stripe Connect Destination Charge**

Significa: la piattaforma cattura il pagamento, trattiene `application_fee_amount`, gira il resto al Connect account del terapista.

NON è un Direct Charge (terapista come merchant) né un Separate Transfer (due API call).

### Costanti finanziarie (FISSE — non cambiare senza approvazione)

```
PLATFORM_COMMISSION = 20%          // della service price, IVA inclusa per IT
STRIPE_FEE_PERCENT  = 2.9%         // pass-through al cliente, uniforme tutti mercati
STRIPE_FEE_FIXED    = €0.30        // pass-through al cliente
PAYOUT_HOLD_DAYS    = 14           // delay_days su Connect account
IT_IVA              = 22%          // inclusa nella commission per terapisti italiani
```

Codice in `src/lib/payments/fee-config.ts` (therapist-webapp + client-webapp). **Sempre coerente con `docs/flows/07-payment.md`** — se si aggiorna uno, aggiornare anche l'altro.

### Esempio pratico — Sessione €80 con terapista IT

```
Cliente paga      = €80 + (80 × 2.9% + 0.30) = €82.62
Stripe trattiene  = €2.62 (processing fee, pass-through)
Platform fee      = €16   (20% di €80, IVA 22% inclusa)
                     ↳ imponibile per fattura: €13.11
                     ↳ IVA inclusa:            €2.89
Terapista riceve  = €64 sul Connect account
                     ↳ disponibile dopo 14 gg per payout su conto bancario
```

### Sequenza tecnica (passo-passo)

1. **Client (iOS o web)** → POST a Edge Function `create-booking-with-payment`
2. **Edge Function**:
   - Valida slot via DB trigger `bookings_overlap_guard`
   - Verifica `stripe_account_status = 'active'` su `therapist_profiles`
   - Calcola `processingFee`, `platformFee`, `therapistPayout`, `ivaAmount`
   - Crea `bookings` row con status `pending`
   - Chiama `stripe.paymentIntents.create({ ... })` con:
     - `amount: totalCharged` (in cents)
     - `application_fee_amount: platformFee + processingFee`
     - `transfer_data.destination: stripe_connected_account_id`
     - `idempotencyKey: pi-${bookingId}` ← evita double-charge se l'utente ritocca
3. **iOS**: presenta Stripe Payment Sheet, cliente paga
4. **Stripe webhook** `payment_intent.succeeded` → Edge Function `stripe-webhook`:
   - Verifica firma con `STRIPE_WEBHOOK_SECRET`
   - INSERT in `transactions` (UNIQUE su `stripe_payment_intent_id` → idempotente, nessun double-insert)
   - UPDATE `bookings.status = confirmed`
   - Se pack: crea N rows in `session_credits`
   - Sync calendar (Google/Outlook) via `syncBookingToCalendar`
5. **14 giorni dopo**: Stripe automaticamente trasferisce i fondi dal Connect account al conto bancario del terapista

### Status booking — transizioni

```
pending ──(webhook OK)──▶ confirmed ──(end session)──▶ completed
   │                          │
   │                          └──(reschedule)──▶ reschedule_pending ──▶ confirmed
   │
   └──(cancel)──▶ cancelled
                  │
                  └──(refund)──▶ refund processed in Stripe
```

Altri stati: `in_progress` (durante video call), `no_show` (terapista marca cliente assente).

---

## 4. Refund — Politica 3-tier

| Cancellazione | Da chi | Tempo | Refund |
|---|---|---|---|
| Cliente cancella | client-initiated | ≥ 48h prima | **100%** |
| Cliente cancella | client-initiated | 24-48h prima | **50%** |
| Cliente cancella | client-initiated | < 24h prima | **0%** |
| Terapista cancella | therapist-initiated | sempre | **100%** |

**Implementazione**: Edge Function `request-refund` calcola il tier server-side (NON tamperabile dal client). Esegue `stripe.refunds.create({ payment_intent, reverse_transfer: true, refund_application_fee: true })`.

**Therapist-initiated** vive in questo repo: `src/app/api/bookings/[id]/cancel/route.ts`. Bloccato se `reliability_tier IN ('high', 'critical')` (cancel rate >20% in 30gg).

⚠️ **Edge case post-payout**: se il refund avviene > 14 giorni dopo il pagamento, Stripe non può fare reverse_transfer (fondi già sul conto bancario). Gestione manuale richiesta. **Non c'è alerting automatico** — gap noto, vedi sezione 8.

---

## 5. Onboarding terapista (Stripe Connect)

1. Terapista apre `/dashboard/settings`
2. Clicca "Connect Stripe" → `POST /api/stripe/connect`
3. Edge Function `create-connect-account` crea Express account su Stripe
4. Terapista completa KYC su Stripe (upload documento, conto bancario, ecc.)
5. Stripe webhook `account.updated` → Edge Function aggiorna `therapist_profiles.stripe_account_status`

### Stati `stripe_account_status`

- `not_connected` — terapista non ha ancora cliccato Connect
- `onboarding_pending` — KYC non completo o webhook race
- `active` — `charges_enabled = true && payouts_enabled = true` → può ricevere booking
- `restricted` — Stripe ha bloccato l'account (bisogno di documenti aggiuntivi)

### Race condition mitigata

Webhook `account.updated` può arrivare PRIMA che Stripe abbia aggiornato realmente `charges_enabled`. Mitigazione:
- `/api/stripe/sync-status` route — chiamata al mount di settings page se `onboarding_pending`
- `/api/cron/sync-stripe-status` — cron Vercel ogni 15min, richiama lo stesso codice per tutti i terapisti `onboarding_pending`

`accepts_bookings` è **derivato inline** in ogni check (non è una colonna materializzata): `stripe_account_status = 'active' AND is_approved = true AND approval_status = 'approved'`.

---

## 6. Fatturazione Terapisti

### Cosa, a chi, quando

- **Cosa**: una fattura **mensile aggregata** della commissione 20% trattenuta sulle sessioni del mese
- **A chi**: al terapista (NON al cliente — il cliente non riceve fattura B2B dalla piattaforma, riceve solo l'email di transazione di Stripe)
- **Quando**: il 1° del mese successivo, via cron job
- **Come**: via FattureInCloud API → emette fattura elettronica via SDI/PEC per terapisti IT

### Trattamento IVA per geografia (matrice completa, 9 modes)

| Caso | Mode | Documento | Dati richiesti |
|---|---|---|---|
| 🇮🇹 IT con P.IVA | `B2B_IT` | FE via SDI con IVA 22% | P.IVA + (cod. dest. OR PEC) + indirizzo |
| 🇮🇹 IT regime forfettario | `B2B_IT_FORF` | FE via SDI **senza IVA** (Art. 1 c.54-89 L. 190/2014) | come B2B_IT + flag `regime_forfettario` |
| 🇮🇹 IT privato/occasionale | `B2C_IT` | FE via SDI con `ei_code = "0000000"` (Cassetto Fiscale) | CF (16 char) + indirizzo |
| 🇪🇺 UE con VAT validato VIES | `B2B_EU_REVERSE` | PDF (no SDI) — reverse charge Art. 44 Dir. 2006/112 | VAT + indirizzo + email billing |
| 🇪🇺 UE privato | `B2C_EU_OSS` | Fattura con IVA italiana 22% (regime OSS) | indirizzo + email |
| 🇬🇧 UK con VAT validato HMRC | `B2B_UK_REVERSE` | PDF — reverse charge Art. 7-ter DPR 633/72 | VAT GB + indirizzo + email |
| 🇬🇧 UK privato | `B2C_UK_VAT` | Fattura con IVA italiana 22% | indirizzo + email |
| 🇺🇸 Extra-UE | `EXTRA_EU` | PDF — Fuori campo IVA | tax_id_foreign + indirizzo + email |
| Dati incompleti | `INCOMPLETE` | Skip + admin alert | — |

Resolver: `admin-dashboard/src/lib/integrations/fattureincloud/tax-mode.ts → resolveTaxMode()`.

### Schema DB (migrazioni applicate)

- `therapist_invoices` — riga per fattura mensile, con `fic_invoice_id`, `fic_invoice_number`, `fic_pdf_url`, `sdi_status`
- `therapist_invoice_credits` — note di credito per refund post-emissione fattura
- `therapist_profiles` campi billing:
  - **IT**: `p_iva`, `codice_fiscale`, `codice_destinatario` (7 char), `pec_email`, `regime_forfettario` (boolean)
  - **Cross-border**: `vat_number` (con prefisso paese), `vat_validated_at` (timestamp VIES/HMRC), `tax_id_foreign` (free-form per ROW)
  - **Comuni**: `billing_address` (JSON), `billing_email`, `country`
- `fattureincloud_credentials` — single-row OAuth token (RLS deny-all, solo service role)

### UI

- `/dashboard/billing` — form anagrafica fiscale (P.IVA validata, codice destinatario o PEC obbligatorio per IT)
- `/dashboard/invoices` — lista fatture mensili + note di credito + download PDF + badge stato SDI

### ⚠️ STATO: codice completo, manca solo OAuth credentials

⚠️ **Architettura importante**: il codice FIC vive nel repo **admin-dashboard**, NON in therapist-webapp. Il therapist-webapp legge solo le righe da `therapist_invoices` per mostrarle nel `/dashboard/invoices`.

**Codice già pronto** (admin-dashboard, 2026-04-25 + 2026-04-27):
- 🟢 `src/lib/integrations/fattureincloud/client.ts` — `ficFetch` con auto-refresh token
- 🟢 `src/lib/integrations/fattureincloud/oauth.ts` — PKCE + state CSRF
- 🟢 `src/lib/integrations/fattureincloud/invoice.ts` — `ensureFicClient` + `createCommissionInvoice` + `submitToSdi`
- 🟢 `src/app/api/integrations/fattureincloud/connect/route.ts` — admin OAuth start
- 🟢 `src/app/api/integrations/fattureincloud/callback/route.ts` — OAuth callback + company picker (Storm X Digital)
- 🟢 `src/app/api/cron/monthly-invoices/route.ts` — cron mensile completo (idempotency, billing gate, IT only V1, Art. 21 c.4 DPR 633/72 invoice_date logic)
- 🟢 `src/app/api/cron/daily-credit-notes/route.ts` — note di credito giornaliere
- 🟢 `src/app/dashboard/integrations/fattureincloud/page.tsx` — UI admin con stato connessione + connect button (creata 2026-04-27)
- 🟢 `vercel.json` — entrambe le cron registrate (`0 3 1 * *` invoices, `0 4 * * *` credit notes)

**Per attivare la fatturazione automatica**:
1. Registrare OAuth app su https://api-v2.fattureincloud.it (admin Storm X Digital)
2. Settare `FATTUREINCLOUD_CLIENT_ID` + `FATTUREINCLOUD_CLIENT_SECRET` in Vercel env (admin-dashboard project)
3. Login come admin → `/dashboard/integrations/fattureincloud` → click "Connetti FattureInCloud"
4. Autorizzare → callback salva token in `fattureincloud_credentials` table
5. Cron parte automaticamente il 1° del mese successivo

Senza step 1-3 la cron firma 200 con `{status: "skipped"}` ogni mese senza errori.

Spec: `docs/specs/2026-04-25-therapist-invoices-fattureincloud.md` (therapist-webapp).

---

## 7. Altre funzioni dashboard

| Modulo | Path | Stato | Note |
|---|---|---|---|
| Bookings | `/dashboard/bookings` | 🟢 | Cancel modal con tier affidabilità + reschedule 2-step |
| Services | `/dashboard/services` | 🟢 | Pack, intro call (gratis), toggle attivo |
| Availability | `/dashboard/availability` | 🟢 | TZ IANA, eccezioni, buffer/notice |
| Calendar Sync | tab in availability | 🟢 | Google + Microsoft OAuth, iCal feed, freebusy bidirezionale |
| Sessioni video | `/dashboard/sessions` | 🟢 | LiveKit Cloud, join window enforcement |
| Earnings | `/dashboard/earnings` | 🟢 | Dual-source (DB transactions + Stripe live API), CSV export |
| Invoices | `/dashboard/invoices` | 🟡 | UI pronta, cron generator MANCANTE |
| Billing | `/dashboard/billing` | 🟢 | Form P.IVA validato, integrato con invoices |
| Messaggi | `/dashboard/messages` | 🟢 | Stream Chat |
| Notifiche | `/dashboard/notifications` | 🟢 | |
| Profilo | `/dashboard/profile` | 🟢 | Foto, gallery, certifications, completeness % |
| Settings | `/dashboard/settings` | 🟢 | Stripe Connect status + sync-status workaround |
| MFA/Security | `/dashboard/settings/security` | 🟢 | TOTP obbligatorio + 8 backup codes |
| Reviews | `/dashboard/reviews` | 🟢 | |

---

## 8. Bug noti e gap (PRIORITÀ ORDINATE)

### 🔴 Critici aperti

(Nessun bug critico aperto al momento sulla fatturazione. Per UX/admin: vedi sezione 🟡 sotto.)

### 🟢 Recentemente fixati (2026-04-27)

- ✅ **Internazionalizzazione fatturazione completa** — supporto 9 modes (IT B2B/Forfettario/Privato, UE B2B reverse / B2C OSS, UK B2B reverse / B2C VAT, ROW, INCOMPLETE). Resolver in `tax-mode.ts`, validatore VIES/HMRC in `vies.ts`, `invoice.ts` rifattorizzato per emettere il documento corretto, cron `monthly-invoices` aggiornato. Form `/dashboard/billing` reso country-aware con campi dinamici per regione. DB migration aggiunge `vat_number`, `vat_validated_at`, `tax_id_foreign`, `regime_forfettario`, `billing_email`.
- ✅ **FIC OAuth connesso** — Storm X Digital S.R.L. (FIC company id 1294283), token salvati in `fattureincloud_credentials`. Cron mensile attiva il 1° del mese alle 03:00 UTC.
- ✅ **FIC admin UI** — pagina `/dashboard/integrations/fattureincloud` in admin-dashboard con stato connessione + Connect button. Voce "Integrations" nella sidebar admin.
- ✅ **`validate-promo` Edge Function** — deployato come stub V1 in `supabase/functions/validate-promo/index.ts`. Ritorna sempre `{ valid: false, reason: "promo_codes_not_supported_v1" }` per body con codice, `{ valid: false, reason: "code_required" }` per body vuoto. iOS ora vede risposta strutturata invece di network 404.
- ✅ **Refund post-payout alerting** — colonne `bookings.requires_manual_refund` (boolean) + `bookings.manual_refund_note` (text) + view `admin_pending_manual_refunds`. Il route `/api/bookings/[id]/cancel` ora retrieva il PaymentIntent, calcola `chargeAgeDays`, e flagga manual_refund se >14gg, se `refund.status !== 'succeeded'`, o se `refund.amount < expected`.
- ✅ **Fee allineato 2.9% + €0.30** in `docs/flows/07-payment.md` (era 2.5% + €0.25). Test checklist + esempio aggiornati.
- ✅ **Env vars dev** — STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY (da admin-dashboard), CRON_SECRET, OAUTH_STATE_SECRET (random), NEXT_PUBLIC_LIVEKIT_URL, NEXT_PUBLIC_SITE_URL aggiunte a `therapist-webapp/.env.local`.
- ✅ **`tsconfig.json`** therapist-webapp esclude ora `supabase/functions` (Deno code) per evitare type errors falsi.

### 🟡 Race conditions mitigate ma non risolte

2. **Stripe Connect `account.updated` race** — mitigata con polling (`sync-status` route + cron 15min). Push webhook handler in Edge Function manca un retry definitivo.

### 🟢 Già protetti (per riferimento)

- Double-booking → DB trigger `bookings_overlap_guard`
- Double-charge webhook → UNIQUE constraint su `stripe_payment_intent_id`
- Webhook signature → validata con `STRIPE_WEBHOOK_SECRET`
- Idempotency Stripe → key `pi-${bookingId}` su PaymentIntent

### 🟡 Limitazioni note (UX/business decision, non bug)

- Pack front-loaded: tutto il payout di un pack va al primo booking. Refund proporzionale = manuale.
- Refund policy globale (48/24/0h) — il campo `cancellation_policy` per-terapista esiste ma non è usato in V1.
- Nessuna fattura PDF per il cliente — riceve solo email Stripe.
- Solo Stripe fee uniforme 2.9% + €0.30 (rate Italia/EEA standard). Stripe addebita realmente meno per SEPA, di più per US — la differenza è assorbita dalla piattaforma.

---

## 9. Costanti e ID importanti

| Cosa | Valore |
|---|---|
| Supabase project ref | `bqyqkvkzkemiwyqjkbna` ("Holistic New") |
| Supabase URL | `https://bqyqkvkzkemiwyqjkbna.supabase.co` |
| LiveKit cloud | `wss://holistic-unity-7cj033ty.livekit.cloud` |
| Marcello (test account) UUID | `5879f194-dfbb-4a75-8b9c-810c1d717443` |
| Stripe PAYOUT_HOLD_DAYS | 14 |
| Pack max sessioni | 10 (4, 6, 8, 10) |
| Reschedule max | 3 volte |
| Reliability cancel threshold (high/critical) | >20% in 30gg |

---

## 10. Quick reference — cose che faccio spesso

### Eseguire SQL in produzione

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
cd <qualunque-app-Next.js-linkata>
supabase db query -f /path/to/script.sql --linked
```

Project già linkato: `bqyqkvkzkemiwyqjkbna`. Il PAT scade — generare nuovo da `https://supabase.com/dashboard/account/tokens` se il vecchio non funziona.

### Aggiornare un terapista test

```sql
UPDATE therapist_profiles SET tagline = '...', bio = '...'
WHERE id = '5879f194-dfbb-4a75-8b9c-810c1d717443';
```

### Avviare dev server

```bash
# In .claude/launch.json sono configurati:
# - client-dev (port 3001, hot reload)
# - client-prod (port 3001, prod build)
# Usare preview_start con il nome.
```

### Modificare le commissioni

**NON SI FA** senza approvazione. Le commissioni sono FISSE:
- Platform: 20% (IVA-inclusa per IT)
- Stripe pass-through: 2.9% + €0.30 (uniforme)

Se cambia: aggiornare in 2 posti contemporaneamente:
1. `src/lib/payments/fee-config.ts` (Next.js apps — display)
2. `supabase/functions/create-booking-with-payment/index.ts` (Edge Function — addebito reale)
3. `docs/flows/07-payment.md` (documentazione)

Disallineamento = bug critico (terapista vede un numero, paga un altro).

---

## 11. File chiave (link diretti)

- [`src/lib/payments/fee-config.ts`](src/lib/payments/fee-config.ts) — calcolo fee
- [`src/app/api/stripe/connect/route.ts`](src/app/api/stripe/connect/route.ts) — onboarding Connect
- [`src/app/api/stripe/sync-status/route.ts`](src/app/api/stripe/sync-status/route.ts) — workaround race condition
- [`src/app/api/bookings/[id]/cancel/route.ts`](src/app/api/bookings/[id]/cancel/route.ts) — therapist cancel + refund
- [`src/app/api/cron/sync-stripe-status/route.ts`](src/app/api/cron/sync-stripe-status/route.ts) — cron 15min
- [`src/app/api/billing/profile/route.ts`](src/app/api/billing/profile/route.ts) — anagrafica fiscale
- [`docs/flows/07-payment.md`](docs/flows/07-payment.md) — spec pagamento Edge Function
- [`docs/flows/08-refund-cancellation.md`](docs/flows/08-refund-cancellation.md) — spec refund 3-tier
- [`docs/specs/2026-04-25-therapist-invoices-fattureincloud.md`](docs/specs/2026-04-25-therapist-invoices-fattureincloud.md) — spec FIC (TODO)
- [`supabase/migrations/20260425110000_fattureincloud.sql`](supabase/migrations/20260425110000_fattureincloud.sql) — schema FIC
- [`supabase/migrations/20260425120000_credit_notes.sql`](supabase/migrations/20260425120000_credit_notes.sql) — schema note credito
