# Stripe TEST → LIVE migration runbook

Operazione una-tantum per passare l'app da modalità test a modalità live (soldi veri). Stimato: 30-45 min totali.

---

## Pre-requisiti

- [ ] Account Stripe attivato (da Dashboard, completa "Activate account" se non già fatto: dati azienda Storm X Digital, IBAN aziendale, P.IVA `08789080721`)
- [ ] Marcello disponibile per ~10 min per fare onboarding live

---

## Step 1 — Stripe Dashboard (TU, 10 min)

### 1.1 Switch to Live mode
1. https://dashboard.stripe.com → toggle **arancione in alto a sinistra** da "Test mode" a "Live mode"
2. Se compare "Activate your account" → completalo

### 1.2 Get the LIVE secret key
1. Developers → API keys → "Reveal live key"
2. Copia la **Secret key** (`sk_live_xxxxx`)
3. Salvala temporaneamente — la passerai a me a fine processo

### 1.3 Crea i 2 webhook endpoint LIVE
Developers → Webhooks → "+ Add endpoint"

**Endpoint #1 — Web Next.js**
- URL: `https://app.holisticunity.app/api/webhooks/stripe`
- API version: lascia il default (latest)
- Events to send → "Select events" → seleziona SOLO:
  - `checkout.session.completed`
  - `payment_intent.payment_failed`
- Click "Add endpoint"
- Una volta creato, click su di esso → "Reveal" la **Signing secret** (`whsec_xxxxx`)
- Copia la signing secret

**Endpoint #2 — Edge Function (iOS + Connect lifecycle)**
- URL: `https://bqyqkvkzkemiwyqjkbna.supabase.co/functions/v1/stripe-webhook`
- Events to send:
  - `account.updated`
  - `payment_intent.succeeded`
  - `charge.refunded`
- Click "Add endpoint"
- Reveal e copia la **Signing secret**

### 1.4 Manda a me i 3 valori in chat

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET (Next.js)=whsec_...
STRIPE_WEBHOOK_SECRET (Edge Function)=whsec_...
```

---

## Step 2 — Marcello Stripe Connect onboarding LIVE (5 min)

1. Marcello logga su `therapistportal.holisticunity.app`
2. Sidebar → **Impostazioni** → sezione **Pagamenti**
3. Clicca **"Configura Stripe Connect"** o "Collega Stripe"
4. Stripe lo manda a un nuovo modulo onboarding LIVE — diverso dal test!
5. Compila:
   - Identità: nome, cognome, data di nascita, indirizzo
   - IBAN reale (per ricevere payout)
   - P.IVA / Codice Fiscale
6. Conferma
7. Status diventa `active` automaticamente (Stripe webhook `account.updated` → Edge Function → DB)

---

## Step 3 — IO aggiorno tutto via API (10 min)

Quando hai i 3 secret + Marcello mi conferma "live attivo", io eseguo:

### 3.1 Vercel env vars (3 progetti)
- `client-webapp`: aggiorno `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (Next.js)
- `therapist-webapp`: aggiorno `STRIPE_SECRET_KEY`
- (`admin-dashboard`: idem se usa Stripe — verifico)

### 3.2 Supabase Edge Function secrets
```bash
SUPABASE_ACCESS_TOKEN=... npx supabase secrets set \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  --project-ref bqyqkvkzkemiwyqjkbna
```

### 3.3 Redeploy 3 webapp + Edge Functions

### 3.4 Verify env via Vercel API + smoke test signature
- Confermo che secret è 39 char, no whitespace
- POST signed payload al webhook → 200 OK

---

## Step 4 — Smoke test reale (TU + Sali, 5 min)

1. Marcello crea un servizio test "consulenza pre-call" da €0,50 (o usa un servizio esistente con prezzo basso)
2. Sali (o tu da incognito) prenota e paga con la TUA carta vera
3. Verifica:
   - [ ] Stripe Dashboard → Payments → vedi pagamento €0,50 LIVE
   - [ ] Webhook endpoint #1 → Recent deliveries → 200 OK
   - [ ] DB: booking `confirmed`, ha `payment_intent_id` e `video_room_id`
   - [ ] Brevo: 2 email "Prenotazione confermata"
   - [ ] Sentry: nessun errore
   - [ ] Marcello vede su `/dashboard/earnings` il guadagno previsto (€0,40 dopo commissione 20%)

4. Test completato: rimborsa €0,50 da Stripe Dashboard (Payments → click pagamento → "Refund")

---

## Step 5 — Rollback plan

Se qualcosa va storto:

1. Su Vercel rimetti i secrets di test (li hai dal Project Handoff)
2. Disabilita i 2 webhook live su Stripe Dashboard (non eliminare — disabilita)
3. Ri-attiva il toggle "Test mode" su Stripe per non confondere
4. Dimmi cos'è andato storto e debugghiamo

L'app continua a funzionare in test mode mentre risolviamo.

---

## Note operative

- **Account Stripe Connect TEST e LIVE sono separati** — Marcello avrà un `acct_xxx` di test (`acct_1TEdMyKecH0zoJZL` attuale) e uno LIVE diverso. Il `stripe_connected_account_id` su `therapist_profiles` viene aggiornato dal webhook `account.updated` quando Marcello completa onboarding live.
- **I bookings di test rimangono in DB** — non li elimino. Distinguibili: `stripe_payment_intent_id` di test inizia per `pi_3TPxxx` con prefisso compatibile. Per pulizia post-launch puoi cancellarli con un SQL UPDATE.
- **Brevo template** rimangono uguali — la logica email è agnostica al test/live.
- **IVA italiana** continua a essere calcolata correttamente sulla commissione 20%.
