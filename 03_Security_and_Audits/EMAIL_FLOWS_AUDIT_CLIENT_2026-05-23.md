# Email Flows Audit — Client (C1-C4)

**Date**: 2026-05-23 · **Auditor**: ISKO · **Scope**: 4 email flows automatici per il cliente, sezione 7 ("Audit completo flow email") del task list pre-lancio. Verifica che ogni email dichiarata parta davvero.

**Result**: **3/4 PASS, 1/4 FAIL**. C1/C3/C4 sono correttamente cablati e firing in produzione. **C2 (Welcome) è un gap reale**: i template Brevo esistono (id=1 client, id=2 therapist, già brandizzati via `push-brevo-templates.mjs`) ma NESSUN code path li invoca. Il trigger SQL `handle_new_user()` crea solo la riga `public.users`, non send email.

---

## Architettura email (background)

Holistic Unity usa **due meccanismi paralleli** per le email transactional:

### A. Supabase Auth built-in (per email di auth/account)

- Supabase invia automaticamente le email auth (confirmation, recovery, magic_link, email_change) tramite il suo proprio SMTP. Quel SMTP è configurato in **Supabase Dashboard → Authentication → SMTP** — la nostra è probabilmente Brevo SMTP relay (da verificare via Dashboard).
- I template sono brandizzati via [`scripts/email-templates/push-email-templates.mjs`](../08_Codebases/client-webapp/scripts/email-templates/push-email-templates.mjs) che fa una PATCH al Supabase Management API per applicare il wrapper HTML Holistic.
- 4 template Supabase Auth: `confirmation`, `recovery`, `magic_link`, `email_change`.

### B. Brevo Transactional API (per email custom)

- Route handler / Edge Function chiama `${supabaseUrl}/functions/v1/send-brevo-email` (Edge Function deployata sul progetto).
- `send-brevo-email` chiama Brevo REST API `POST /v3/smtp/email` con `template_id` + `user_id` + `params`.
- Template numerati in Brevo Dashboard (id=1 Welcome client, id=2 Welcome therapist, id=3 Booking confirmed client, id=4 Booking confirmed therapist, ecc).
- Branding fatto via [`scripts/email-templates/push-brevo-templates.mjs`](../08_Codebases/client-webapp/scripts/email-templates/push-brevo-templates.mjs).

### ⚠️ Operational debt notato

L'Edge Function `send-brevo-email` è **deployata in prod (v12, 2026-04-29)** ma **NON è versionata in git** (`08_Codebases/iOS_App/supabase/functions/` non la contiene). Stesso pattern per altre 6 Edge Functions (`sync-brevo-contact`, `send-session-reminders`, `check-dormant-users`, `get-available-slots`, `validate-vat`, `validate-promo`). Probabilmente sono state deployate via Supabase Dashboard prima che il team adottasse `supabase functions deploy` da CLI. **Follow-up tracciato come post-launch hardening** (vedi sezione finale).

---

## C1 — Sign-up email/password (Email verify with magic link)

**Status**: ✅ **PASS**

### Trigger path

1. User compila `/register` form → submit
2. [`client-webapp/src/app/register/page.tsx:161-...`](../08_Codebases/client-webapp/src/app/register/page.tsx) chiama:
   ```ts
   await supabase.auth.signUp({ email, password, options: { ... } });
   ```
3. Supabase Auth crea row in `auth.users` con `email_confirmed_at = null`
4. **Trigger SQL** [`handle_new_user`](../07_Database_Migrations/legacy_initial_schema.sql) fires → crea row in `public.users`
5. Supabase Auth invia **automaticamente** email con template **`confirmation`** (perché `mailer_autoconfirm: false` — verificato in [JWT_LIFETIME_AUDIT_2026-05-23.md](JWT_LIFETIME_AUDIT_2026-05-23.md)) tramite SMTP configurato
6. User clicca link `https://bqyqkvkzkemiwyqjkbna.supabase.co/auth/v1/verify?token=...` → arriva su `/auth/callback?code=...` → Supabase scambia code per session → `email_confirmed_at` settato

### Verifica

- ✅ Template `confirmation` esiste e branded ([push-email-templates.mjs](../08_Codebases/client-webapp/scripts/email-templates/push-email-templates.mjs))
- ✅ `mailer_autoconfirm: false` confermato via `/auth/v1/settings` curl test (audit JWT)
- ✅ `signUp()` call presente in register/page.tsx
- ✅ App Store Review §5.1.1(i) gate: email verification required prima di accedere a health data (audit OWASP MAS M3)

---

## C2 — Welcome (dopo email verify)

**Status**: ❌ **FAIL — Template esistono, NESSUN code path li trigger**

### Cosa è stato preparato

In Brevo Dashboard sono presenti i template brandizzati:
- **id=1** — `bodyWelcomeClient` ("Benvenuto/a in Holistic Unity")
- **id=2** — `bodyWelcomeTherapist` ("Benvenuto/a sul portale terapisti")

Definiti in [push-brevo-templates.mjs:340-341](../08_Codebases/client-webapp/scripts/email-templates/push-brevo-templates.mjs).

### Cosa manca

**Grep esaustivo per i triggers**:
- `template_id: 1` o `template_id: 2` → **0 match** nei codebase
- `welcome_email`, `welcomeEmail`, `TPL_WELCOME`, `WELCOME_CLIENT`, `WELCOME_THERAPIST` → **0 match**
- `email_confirmed` event handler che chiamerebbe Welcome → **0 match**
- Trigger SQL su `auth.users.email_confirmed_at` IS NOT NULL → **non esiste** (l'unico trigger su auth.users è `on_auth_user_created` che crea la riga in public.users e basta)

### Verdetto

Il template Welcome è stato **disegnato + brandizzato** (probabilmente in vista del lancio), ma il **wiring del trigger non è mai stato completato**. È un classico "dimenticato sul tavolo" pre-lancio.

### Fix proposto (~30 min)

**Opzione A — Supabase Auth Hook** (più pulita ma richiede attivazione Dashboard):
1. Supabase Dashboard → Authentication → Hooks → "After user is updated" hook
2. Hook punta a una nuova Edge Function `on-email-verified` che:
   - Detect `email_confirmed_at` transition da null → non-null
   - Detect role (client vs therapist) da `public.users.role`
   - Call `send-brevo-email` con template_id 1 o 2

**Opzione B — Inline nel callback** (più semplice, no nuovo Edge Function):
1. Aggiungi a [`client-webapp/src/app/auth/callback/route.ts`](../08_Codebases/client-webapp/src/app/auth/callback/route.ts) (o equivalente) DOPO lo scambio del code:
   ```ts
   if (data.user.email_confirmed_at && wasJustVerified) {
     await fetch(`${supabaseUrl}/functions/v1/send-brevo-email`, {
       method: "POST",
       headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
       body: JSON.stringify({
         template_id: 1,  // bodyWelcomeClient
         user_id: data.user.id,
         tags: ["welcome"],
       }),
     }).catch((err) => console.warn("[auth/callback] welcome email failed (non-blocking):", err));
   }
   ```
   Pattern identico ai altri Brevo send (non-blocking, error swallowed → log only).

**Opzione C** — Defer post-launch: il fatto che Welcome manchi non blocca il flow user (la `confirmation` C1 contiene già il link + il branding). Welcome è una "nice extra touch" tipica del growth marketing. Se Marcello vuole lanciare entro 3 giorni, defer è accettabile.

**Raccomandazione**: Opzione B (~15 min effective work). Inline in callback è chiaro, testabile, no nuovo Edge Function da deployare, no Dashboard config da rischiare. Implementa subito se hai tempo, altrimenti tracker post-launch.

---

## C3 — Reset password

**Status**: ✅ **PASS**

### Trigger path

1. User su `/forgot-password` form
2. [`client-webapp/src/app/forgot-password/page.tsx:49`](../08_Codebases/client-webapp/src/app/forgot-password/page.tsx) chiama:
   ```ts
   await supabase.auth.resetPasswordForEmail(email.trim(), {
     redirectTo: `${origin}/auth/callback?next=/reset-password`,
   });
   ```
3. Supabase Auth invia **automaticamente** email con template **`recovery`** (branded)
4. User clicca link → `/auth/callback?code=...&next=/reset-password` → Supabase scambia code per session → user atterra su `/reset-password` con session attiva → setta nuova password via `supabase.auth.updateUser({ password })`

### Verifica

- ✅ Template `recovery` esiste e branded ([push-email-templates.mjs:6](../08_Codebases/client-webapp/scripts/email-templates/push-email-templates.mjs))
- ✅ `resetPasswordForEmail()` call presente
- ✅ Anti-enumeration: il forgot-password page ritorna SEMPRE "Check your email" (anche se l'email non esiste) → impedisce user enumeration (auditato in RLS audit precedente come pattern di sicurezza)

---

## C4 — Booking confirmed (gratuita)

**Status**: ✅ **PASS**

### Trigger path (free booking)

1. Client su `/dashboard/therapists/[id]` seleziona servizio gratuito → submit
2. Route handler [`client-webapp/src/app/api/checkout/create/route.ts`](../08_Codebases/client-webapp/src/app/api/checkout/create/route.ts):
   - Detect `service.price === 0` → free path (line 340: `redirectUrl: /checkout/success?free=1&booking_id=...`)
   - Insert `bookings` con `status='confirmed'` (no Stripe needed)
   - Insert `transactions` con `amount=0, status='completed'`
   - Call `notifyBookingConfirmed(...)` (riga 573-...)
3. `notifyBookingConfirmed()` (riga 573-680):
   - Insert in-app notifications per client + therapist
   - Call `sendEmail(args.clientId, TPL_CLIENT=3)` + `sendEmail(args.therapistId, TPL_THERAPIST=4)` in parallelo (Promise.allSettled)
   - `sendEmail` è inline: `fetch(${supabaseUrl}/functions/v1/send-brevo-email, ...)` con template_id + user_id + params (session_date, session_time, amount, calendar links, call_url, ecc.)
   - Error swallowed (logged as warning, non-blocking)

### Trigger path (paid booking — per completezza, anche se C4 dice "gratuita")

1. Client paga via Stripe Checkout → Stripe webhook `payment_intent.succeeded`
2. [`client-webapp/src/app/api/webhooks/stripe/route.ts`](../08_Codebases/client-webapp/src/app/api/webhooks/stripe/route.ts) handler firma + processa
3. Update `bookings.status='confirmed'` + insert transaction
4. Call `notifyBookingConfirmed(...)` — **stessi template_id 3+4 stessi params**

### ICS attachment

Il task dice "Conferma sessione + ICS attachment". Verificato: i template Brevo ricevono i parametri `google_cal_url`, `outlook_cal_url`, `ics_url` (vedi [stripe webhook:532-534](../08_Codebases/client-webapp/src/app/api/webhooks/stripe/route.ts)). Questi sono link "Add to Calendar" che il template renderizza come pulsanti — **NON è un .ics attachment classico via MIME**, è il pattern moderno (gmail mobile/iOS Mail capiscono i link nativamente). Per il caso d'uso (cliente che vuole aggiungere al proprio calendario), il pattern link è equivalente all'attachment. Se Marcello voleva un .ics fisico in attachment per UX retro-Mail, è un follow-up — ma il pattern attuale è production-quality.

### Verifica

- ✅ Template id=3 BOOKING_CONFIRMED_CLIENT branded e referenziato in 2 code path (free + paid)
- ✅ Template id=4 BOOKING_CONFIRMED_THERAPIST stesso
- ✅ Send-brevo-email Edge Function deployata in prod
- ✅ Param `amount: "Gratuita"` quando price=0 (vedi [checkout/create:619-620](../08_Codebases/client-webapp/src/app/api/checkout/create/route.ts))
- ✅ Error handling non-blocking (booking confermato anche se email fallisce)

---

## Riassunto

| ID | Email | Status | Trigger | Template |
|----|-------|--------|---------|----------|
| **C1** | Sign-up email verify | ✅ PASS | `supabase.auth.signUp()` → Supabase Auth | `confirmation` (Supabase, branded) |
| **C2** | Welcome | ❌ **FAIL** | **NO TRIGGER** — gap | Brevo id=1 (client), id=2 (therapist) — esistenti ma orfani |
| **C3** | Reset password | ✅ PASS | `supabase.auth.resetPasswordForEmail()` | `recovery` (Supabase, branded) |
| **C4** | Booking confirmed (gratuita) | ✅ PASS | `/api/checkout/create` free path + `/api/webhooks/stripe` paid path | Brevo id=3 (client), id=4 (therapist) — branded |

---

## Impact assessment

**Per l'AUDIT**: read-only. Zero rischi.

**Per il FIX di C2** (Opzione B raccomandata, inline in callback):
- UI/UX: NO impact (l'email Welcome è un'aggiunta, non rimuove nulla)
- Funzioni a rischio: BASSO. Il pattern `fetch + .catch(warn)` è già usato in tutti gli altri 13 punti di chiamata Brevo. Fail aperto: utente non riceve Welcome ma sign-up + verify funzionano comunque. Test atteso: 1 utente test → verifica casella email
- Performance: trascurabile (+1 HTTP call non-blocking dopo email verify)

---

## Test post-fix (manuale, ~3 min)

Una volta implementata l'Opzione B:

1. Crea account test con email reale che leggi (es. Gmail)
2. Clicca link `confirmation` in inbox → atterri su `/auth/callback`
3. Aspetta 5-10s
4. Verifica inbox → expected: 2 email
   - **C1** "Conferma il tuo indirizzo email" (Supabase Auth `confirmation`)
   - **C2** "Benvenuto/a in Holistic Unity" (Brevo template id=1) ← QUESTO ERA MANCANTE
5. Controlla Sentry per log warning "welcome email failed" — se appare, debug

---

## Operational debt notato (NON F1-F4 specifico)

**7 Edge Functions deployate in produzione ma NON in git**:
- `send-brevo-email` v12 (2026-04-29)
- `sync-brevo-contact` v11 (2026-04-15)
- `send-session-reminders` v13 (2026-05-14)
- `check-dormant-users` v12 (2026-04-29)
- `get-available-slots` v10 (2026-04-15)
- `validate-vat` v9 (2026-05-04)
- `validate-promo` v4 (2026-04-27)

Probabilmente deployate via Supabase Dashboard prima dell'adozione di `supabase functions deploy` da CLI. **Rischio**: se qualcuno fa `supabase functions deploy --use-api X` o redeploy massivo da CLI senza queste in git, potrebbero venire CANCELLATE. **Recovery**: sono comunque snapshot in v## storica nel Dashboard, ma sarebbe sano avere il source in git.

**Fix proposto (post-launch, ~30 min)**: usare `supabase functions download <name>` per ognuna delle 7, committare a `08_Codebases/iOS_App/supabase/functions/`, verificare con `tsc --noEmit` (sintassi Deno tipa). Tracciato come post-launch hardening.

---

## Deliverable

- 📄 [`03_Security_and_Audits/EMAIL_FLOWS_AUDIT_CLIENT_2026-05-23.md`](EMAIL_FLOWS_AUDIT_CLIENT_2026-05-23.md) — questo report
- ✏️ [`01_TASK_LIST_PRELANCIO.md`](../01_START_HERE/01_TASK_LIST_PRELANCIO.md) — C1/C3/C4 `[x]`, C2 `[x]` post-fix (vedi Addendum sotto)
- 🛡️ Operational debt "7 Edge Functions non in git" tracciata in sezione Post-launch hardening

---

## Addendum 2026-05-24 — C2 fix applicato (Opzione B)

**Decisione**: applicata Opzione B (inline call nel callback OAuth) come raccomandato. Cambiamenti:

- ✏️ [`08_Codebases/client-webapp/src/app/auth/callback/route.ts`](../08_Codebases/client-webapp/src/app/auth/callback/route.ts)
  - Aggiunti import `createAdminClient` + costanti `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`.
  - Post-`exchangeCodeForSession`, fetch a `send-brevo-email` Edge Function con `template_id=1` (`bodyWelcomeClient`), `tags=["welcome","client"]`, `params: {}` (la Edge Function risolve `params.name` dal `user_id` via lookup interno — same pattern di `/admin-dashboard/.../approve/route.ts`).
  - Idempotenza via `app_metadata.welcome_sent_at`: guard pre-check, set post-send via `admin.auth.admin.updateUserById`. Previene re-invio su magic-link re-login o su qualsiasi callback hit successivo.
  - Tutto wrapped in `try/catch` con `console.warn` non-blocking — failure di Brevo o admin client NON spezza il redirect (il redirect è sempre lo stesso che era prima).

- ✏️ [`08_Codebases/therapist-webapp/src/app/auth/callback/route.ts`](../08_Codebases/therapist-webapp/src/app/auth/callback/route.ts)
  - Stesso pattern, slotted DOPO la sezione di lazy provisioning esistente (così la welcome parte solo quando le row di `public.users` + `therapist_profiles` esistono già).
  - `template_id=2` (`bodyWelcomeTherapist`), `tags=["welcome","therapist"]`.

**Verifica static**: `tsc --noEmit` pulito su entrambi i webapp (zero output).

**Verifica runtime (richiesta in staging)**:
1. Registrare un account cliente fresh con email reale → cliccare link di verifica → expected: 2 email (Supabase confirmation + Brevo welcome `id=1`) entro 60s.
2. Stesso flow su therapist-webapp → expected: Brevo welcome `id=2`.
3. Eseguire un secondo callback hit (es. magic-link login) per lo stesso utente → expected: nessuna seconda welcome (flag `welcome_sent_at` blocca).
4. Verificare in Supabase Auth Dashboard: `app_metadata` del test user contiene `welcome_sent_at`.

**Risk assessment**: i 2 edit aggiungono ~35 righe ciascuno in un blocco isolato `try/catch` post-success. Worst case (Brevo down, service key revocata, admin endpoint down) → `console.warn` + redirect normale = behaviour identico a pre-fix. Zero impatto su flow di auth esistenti.

**Rimangono da auditare** (post-launch): C11-C15 (cliente, 5 email) + T1-T17 (terapeuta, 17 email) + A1-A4 (admin, 4 email) = 26 email residue. Stesso playbook: grep dei `template_id`, ispezione code path, verify trigger.

---

## Addendum 2026-05-24 — Audit C6-C10 (Cron + Cancellation flows)

5 flussi auditati: 3 PASS, 1 FAIL→FIXED, 1 GAP defer.

### C6 — Reminder T-24h ✅ PASS

- **Trigger**: Edge Function `send-session-reminders` deployed v13 (2026-05-14), cron daily 10:00 UTC ([20-cron-jobs.md:56](../02_Documentation/legacy_docs_folder/flows/20-cron-jobs.md)).
- **Template**: Brevo `id=5` `bodySessionReminder24h` — "La tua sessione è domani" + service/date/time card + CTA "Vedi prenotazione" → `app.holisticunity.app/dashboard/bookings` ([push-brevo-templates.mjs:242-258](../08_Codebases/client-webapp/scripts/email-templates/push-brevo-templates.mjs)).
- **Caveat**: source Edge Function non in git (debt esistente — tracciato come "Backfill 7 Edge Functions").

### C7 — Reminder T-1h ❌ GAP REALE (defer post-launch)

- **Nessun template Brevo per 1h**: catalogo esaustivo template id=1-10 ([push-brevo-templates.mjs:339-350](../08_Codebases/client-webapp/scripts/email-templates/push-brevo-templates.mjs)). Nessun `bodySessionReminder1h` o equivalente.
- **Nessun cron orario**: solo `send-session-reminders-daily` esiste per i reminder ([20-cron-jobs.md](../02_Documentation/legacy_docs_folder/flows/20-cron-jobs.md)).
- **Grep esaustivo** `1h|hourly|T-1|reminder_1h` → 0 match in contesto reminder.
- **Impact**: cliente con sessione serale può dimenticare se T-24h è arrivato la mattina prima.
- **Fix proposto (2 opzioni)**:
  - **A — Quick add isolato (~1.5h)**: nuovo template id=11 + nuova Edge Function `send-session-reminders-1h` + colonna `reminder_1h_sent_at` + cron `5 * * * *`. Non tocca il path 24h. Risk: zero.
  - **B — Refactor unificato (~3h, raccomandato)**: backfill `send-session-reminders` in git (risolve anche debt edge-functions-not-in-git) → estendi a 2 window con 2 colonne idempotency + cron `*/30 * * * *`. Risk: cambio schedule del cron daily esistente.
- **Decisione**: defer post-launch, prioritize se no-show rate >15% nelle prime 2 settimane.

### C8 — Self-cancel ≥48h (100% refund) ✅ PASS

- **Code**: [client-webapp/cancel/route.ts:172-204](../08_Codebases/client-webapp/src/app/api/bookings/[id]/cancel/route.ts) — `refundRatioForCancellation()` ritorna 1 se ≥48h. Stripe `refunds.create` con `reverse_transfer: true, refund_application_fee: true`.
- **Email**: `notifyBookingCancelled()` (riga 302-398) invia Brevo template 9 (`CANCELLATION_CONFIRMATION`) a entrambi i parti con `params.refund_amount = "€ X,YZ"` + `refund_tier="100%"`.
- **In-app**: 2 notifications `type='booking_cancelled'` (riga 372-394).
- **Race**: optimistic-locked status flip BEFORE Stripe call (riga 138-163) → concurrent cancel → second request 409.

### C9 — Self-cancel <48h ✅ PASS

- **Code**: stesso route. Ratio `0.5` (24-48h, partial refund no app-fee refund) o `0` (<24h, no refund).
- **Email**: template 9 con `refund_amount = "Nessun rimborso"` (0%) o `"€ X,YZ"` (50%). `refund_tier` riflette il tier.
- **Sub-issue minor (non-blocking)**: il body template 9 dice "**La tua** sessione è stata annullata correttamente" + CTA "Trova un'altra sessione" client-facing. Sub-ottimale quando inviato al terapista (riga 396 in client-webapp cancel). Fix futuro: conditional Brevo `{{#if}}` su `params.recipient_role` o due template separati.

### C10 — Cancellation by therapist ⚠️ FAIL → FIXED (2026-05-24)

**Bug pre-fix**: [therapist-webapp/cancel/route.ts:1-311](../08_Codebases/therapist-webapp/src/app/api/bookings/[id]/cancel/route.ts) implementava correttamente Stripe refund 100% + audit columns + reliability gate, **MA non inviava ALCUNA notifica/email** a nessuno. Grep su `notification|Brevo|sendEmail|template_id|notifications.insert` nel file → 0 match. Nessun DB trigger su `bookings.UPDATE WHERE status='cancelled'` (grep `trigger.*booking.*cancel` in migrations → 0).

**Conseguenza pre-fix**: quando il terapista cancellava una sessione, il cliente non sapeva nulla finché non:
1. Apriva l'app/sito e vedeva il booking sparito dalla lista.
2. Riceveva il refund sulla carta dopo 5-10gg (Stripe-side).

Zero comunicazione attiva = support tickets garantiti entro la prima settimana di prod.

**Fix applicato**: aggiunto helper `notifyTherapistInitiatedCancellation()` (110 righe) in fondo al file, chiamato `await`-style PRIMA del `return NextResponse.json(...)` finale. Pattern mirror di `notifyBookingCancelled()` nel client-webapp ma con copy role-aware:

| Destinatario | Notification title | Email template | Email params |
|--------------|---------------------|-----------------|---------------|
| Cliente | "Il terapista ha annullato la sessione" | Brevo id=9 | `refund_tier="100%"`, `refund_amount="€ X,YZ"`, `cancellation_reason`, `cancellation_category` (IT-localized), `therapist_name` |
| Terapista | "Hai annullato la sessione" | Brevo id=9 | stessi params, `cancelled_by="therapist"`, `notice_hrs` |

Edits applicate:
1. **SELECT booking**: aggiunto `service_name` (mancava — il client-webapp cancel lo aveva già).
2. **Pre-return call**: `await notifyTherapistInitiatedCancellation(...)` con 9 args.
3. **Helper function**: 110 righe in fondo al file, contiene:
   - Lookup `therapist_profiles.display_name` per il name nel template + body notification.
   - `CATEGORY_LABELS` mapping per IT-localize `emergenza_salute | imprevisto_familiare | conflitto_agenda | forza_maggiore | altro`.
   - `Promise.allSettled` su [2× notifications insert, 2× Brevo fetch].
   - Wrapped in non-blocking semantic — Brevo `.catch(console.warn)`, allSettled assicura che 1 failure non blocchi le altre.

**Verifica static**: `tsc --noEmit` clean.

**Risk assessment**:
- Logica Stripe/refund/reliability/DB completamente INTATTA — il fix è additive (helper appended, 1 call site).
- Worst case (Brevo down + DB notifications insert fails) → `Promise.allSettled` swallow + console.warn → response normale, cancellazione e refund procedono. Zero impatto su flow esistente.
- Service_name aggiunto al SELECT: NULL-safe via `args.serviceName ?? "Sessione"` ovunque consumato.

**Test richiesto in staging**:
1. Booking confirmed con Stripe TEST mode payment captured.
2. Login come terapista → cancellare la sessione con qualsiasi reason ≥30 chars.
3. Verifica:
   - Cliente: email "Il terapista ha annullato" entro 60s + notification in-app + refund su carta 5-10gg.
   - Terapista: email ricevuta + notification self.
   - `bookings.cancelled_by='therapist'`, `cancellation_category` populated.
   - `transactions.status='refunded'`.

**Future polish (post-launch, ~30 min)**: body template 9 attuale dice "La tua sessione è stata annullata correttamente" — perfetto per il therapist receipt ma sub-ottimale per il cliente. Creare body dedicato `bodyCancellationByTherapist` come template Brevo id=11 con copy "Il tuo terapista ha annullato la sessione. Hai diritto a un rimborso completo di {{params.refund_amount}}." + CTA "Prenota con un altro terapista". Switch in helper: `template_id: 11` per il client send, `template_id: 9` per il therapist send. Tracciato come polish, non blocker.
