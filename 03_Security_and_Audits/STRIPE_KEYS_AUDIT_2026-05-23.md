# Stripe Restricted Keys Audit

**Date**: 2026-05-23 · **Auditor**: ISKO · **Scope**: la chiave LIVE `STRIPE_SECRET_KEY` usata dalle 10 Supabase Edge Functions deve essere `rk_live_...` (restricted) e non `sk_live_...` (secret/full-access). Scope minimo richiesto.

**Result**: 🟡 **CODE REVIEW COMPLETO + Dashboard verification pending** (1 reveal). Lo scope reale richiesto dalle edge function è **più ampio** di quanto suggerito dalla task spec (`charges + payouts + webhooks`) perché il marketplace usa Stripe Connect destination charges — serve anche `Connect: write`. Lista completa sotto. La verifica del prefisso `rk_` vs `sk_` non è possibile da remoto (Supabase secrets storage ritorna solo il digest SHA256, mai il valore plaintext). 1 step manuale di reveal su Dashboard documentato sotto.

---

## Stripe API surface usata dalle Edge Functions (catalogo completo)

Tutte le 10 Edge Functions che usano `STRIPE_SECRET_KEY` autenticano via header `Authorization: Bearer ${STRIPE_SECRET_KEY}` (no SDK npm:stripe — fetch diretto). Endpoint usati:

| Edge Function | Stripe Endpoint | Method | Resource @ Permission |
|---------------|-----------------|--------|------------------------|
| [`create-connect-account`](../08_Codebases/iOS_App/supabase/functions/create-connect-account/index.ts) | `/v1/accounts` | POST | **Connect:write** |
| `create-connect-account` | `/v1/accounts/{id}` | POST | **Connect:write** |
| `create-connect-account` | `/v1/account_links` | POST | **Connect:write** |
| [`connect-dashboard`](../08_Codebases/iOS_App/supabase/functions/connect-dashboard/index.ts) | `/v1/accounts/{id}/login_links` | POST | **Connect:write** |
| [`create-payment-intent`](../08_Codebases/iOS_App/supabase/functions/create-payment-intent/index.ts) | `/v1/customers` | GET, POST | **Customers:write** |
| `create-payment-intent` | `/v1/ephemeral_keys` | POST | **(no specific scope — required for mobile SDK)** |
| `create-payment-intent` | `/v1/customer_sessions` | POST | **(no specific scope — required for mobile SDK)** |
| `create-payment-intent` | `/v1/payment_intents` | POST | **PaymentIntents:write** |
| [`create-booking-with-payment`](../08_Codebases/iOS_App/supabase/functions/create-booking-with-payment/index.ts) | (same 4 endpoints as create-payment-intent) | — | (same) |
| [`detach-payment-method`](../08_Codebases/iOS_App/supabase/functions/detach-payment-method/index.ts) | `/v1/payment_methods/{id}/detach` | POST | **PaymentMethods:write** |
| [`stripe-webhook`](../08_Codebases/iOS_App/supabase/functions/stripe-webhook/index.ts) | `/v1/payment_methods/{id}` | GET | **PaymentMethods:read** |
| [`request-refund`](../08_Codebases/iOS_App/supabase/functions/request-refund/index.ts) | `/v1/refunds` | POST | **Refunds:write** |
| [`delete-user-account`](../08_Codebases/iOS_App/supabase/functions/delete-user-account/index.ts) | `/v1/customers/{id}` | DELETE | **Customers:write** |

**Stripe-Version**: `2023-10-16` (locked in [`create-payment-intent/index.ts:325`](../08_Codebases/iOS_App/supabase/functions/create-payment-intent/index.ts) e gemello). Restricted keys ereditano la versione API del progetto Stripe.

**`process-pending-payouts`**: NON chiama Stripe API direttamente — i payout sono già gestiti via Stripe destination charges (transfer automatico al payment intent capture). Comment esplicito in [`process-pending-payouts/index.ts:10`](../08_Codebases/iOS_App/supabase/functions/process-pending-payouts/index.ts): _"a separate Stripe Transfer — doing so would pay the therapist twice"_. Questa function aggiorna solo `transactions.payout_status` localmente. **Conseguenza**: la chiave NON ha bisogno di `Transfers:write` o `Payouts:write`.

**Webhook signature verification**: usa `STRIPE_WEBHOOK_SECRET` (separato), non `STRIPE_SECRET_KEY`. Verificata in audit precedente — vedi task #72 della 01_TASK_LIST_PRELANCIO.md (signature verification con HMAC-SHA256 hand-rolled, crypto-equivalent a `stripe.webhooks.constructEvent`).

---

## Scope minimo richiesto da una restricted key (`rk_live_...`)

Da Stripe Dashboard → Developers → API keys → "Create restricted key" → set permissions:

| Resource | Permission | Justification |
|----------|-----------|---------------|
| **Connect** | **Write** | Create/update Express accounts, account links, login links (marketplace onboarding + dashboard) |
| **Customers** | **Write** | Create per-user customer at first payment; DELETE on GDPR account erasure |
| **PaymentIntents** | **Write** | Core charge creation flow |
| **PaymentMethods** | **Write** | Detach (user removes card); webhook reads PM details after success |
| **Refunds** | **Write** | Process refunds via request-refund function |
| **Webhook Endpoints** | (no API call — config-only) | Webhook secret is separate; no key permission needed |
| **(everything else)** | **None** | No `/v1/balance`, `/v1/transfers`, `/v1/payouts`, `/v1/topups`, `/v1/products`, `/v1/prices`, `/v1/invoices` usage. Lock down by default. |

**Task spec confronto**: la spec dice "minimum: charges + payouts + webhooks".
- "charges" ✓ mapped a `PaymentIntents:write + PaymentMethods:write + Customers:write` (modern Stripe non ha più `charges` come permission separata — è split tra questi 3).
- "payouts" ❌ NON necessario per noi (vedi note process-pending-payouts sopra). Lasciare a `None` riduce ulteriormente il blast radius.
- "webhooks" ⚠️ il webhook secret non è la stessa cosa della key — la key non ha bisogno di `Webhook Endpoints:write` (gestiamo webhook config via Dashboard manualmente, non programmaticamente).

**Conclusione scope reale**: `Connect:write + Customers:write + PaymentIntents:write + PaymentMethods:write + Refunds:write` (5 resources, write-level). Più stretto di una `sk_live_` (che ha tutto), in linea con principle of least privilege.

---

## Step manuali da fare (~2 min)

### Step A — Identifica la chiave in uso

**Supabase Dashboard** → progetto `Holistic New` → **Project Settings** → **Edge Functions** → **Secrets** → trova `STRIPE_SECRET_KEY` → click **Reveal** (richiede password admin):

- **Pass criteria**: il valore inizia con `rk_live_` (8 caratteri).
- **Fail criteria**: il valore inizia con `sk_live_` → migration necessaria (sotto).

> ⚠️ Non incollare il valore in nessun file/log/messaggio. Basta guardare i primi 8 caratteri.

### Step B — Verifica scope (se restricted key)

Se Step A è `rk_live_...`:

**Stripe Dashboard** → **Developers** → **API keys** → sezione **Restricted keys** → trova la chiave usata da Holistic → click "Edit" → controlla le permission attive.

- **Pass**: tutte e 5 le resource (`Connect`, `Customers`, `PaymentIntents`, `PaymentMethods`, `Refunds`) sono su **Write**. Tutto il resto su **None** (o **Read-only** dove acceptable).
- **Fail (missing scope)**: chiave restricted con permission mancanti → in produzione la function corrispondente fallirà con `403 This key does not have permission`. Aggiungi le permission mancanti (modifica in place, no rotation richiesta).
- **Fail (excessive scope)**: chiave restricted con permission extra (es. `Balance`, `Transfers`, `Payouts`, `Topups`) → restringi a quelle realmente usate. Riduce blast radius.

---

## Migration plan se Step A ritorna `sk_live_...`

Procedura non-destructive, ~10 min:

1. **Stripe Dashboard** → **Developers** → **API keys** → click **+ Create restricted key**
2. Nome: `Holistic Unity Edge Functions (live)`
3. Set permissions: vedi tabella scope sopra (5 resources @ Write)
4. **Save** → copia il valore `rk_live_...` (visibile UNA volta)
5. **Supabase Dashboard** → progetto → **Project Settings** → **Edge Functions** → **Secrets**:
   - Crea nuovo secret `STRIPE_SECRET_KEY_RK` (o sovrascrivi `STRIPE_SECRET_KEY` se vuoi swap atomico — preferred)
   - Paste il valore `rk_live_...`
6. Se sovrascrivi `STRIPE_SECRET_KEY`: nessun redeploy richiesto, le Edge Functions leggono via `Deno.env.get()` ad ogni invocation
7. **Smoke test** in ordine:
   - Booking flow: client iOS → create-booking-with-payment → conferma payment_intent.succeeded webhook
   - Connect onboarding: nuovo terapeuta → create-connect-account → account_link funzionante
   - Refund: admin-dashboard refund su una transaction test → request-refund → status="refunded" sul row transactions
   - Account deletion: utente test GDPR → delete-user-account → DELETE customer su Stripe
8. **Verifica** Stripe Dashboard → la vecchia `sk_live_` può essere revocata (Roll key) — solo DOPO che il smoke test pass

**Rollback se qualcosa rompe**: ripristina la `sk_live_` vecchia su Supabase secrets. Le Edge Functions tornano operative entro 1-2 secondi (next cold start).

---

## Impact assessment

### Per l'AUDIT (read-only)

| Domanda | Risposta |
|---------|----------|
| Cambierà UI/UX? | **NO.** Lettura Dashboard. Zero modifiche. |
| Funzioni a rischio? | **NO.** Solo verifica visiva. |
| Performance? | **NO change.** |

### Per il FIX (solo se Step A ritorna `sk_live_`)

| Domanda | Risposta |
|---------|----------|
| Cambierà UI/UX? | **NO.** Le edge function continuano a comportarsi identicamente — l'utente vede lo stesso payment flow, le stesse error message. |
| Funzioni a rischio? | **MEDIO ma controllabile.** Una restricted key con scope MANCANTE fa fallire la function correspondente con 403. Mitigation: smoke test punto-per-punto subito dopo lo swap, con rollback in 1 click se anche un solo flow rompe. **L'unico modo concreto in cui può rompere**: dimenticare di abilitare una delle 5 permission elencate sopra. **L'unico modo in cui NON può rompere silenziosamente**: Stripe restituisce 403 con messaggio esplicito che dice quale permission manca — debug è banale. |
| Performance? | **NO change.** Stesso endpoint, stesso TLS, stessa key length. Stripe non fa rate-limit/throttle diverso per restricted vs secret. |

### Per il FIX (solo se key esistente è restricted MA scope mismatch)

| Domanda | Risposta |
|---------|----------|
| Cambierà UI/UX? | **NO.** |
| Funzioni a rischio? | **NO.** Edit della restricted key in place su Stripe Dashboard — propagation è istantanea. Le edge function continuano a usare la stessa key (stesso valore plaintext); cambiano solo i permission grants lato Stripe. |
| Performance? | **NO change.** |

---

## Deliverable

- 📄 [`03_Security_and_Audits/STRIPE_KEYS_AUDIT_2026-05-23.md`](STRIPE_KEYS_AUDIT_2026-05-23.md) — questo report
- ✏️ [`01_START_HERE/01_TASK_LIST_PRELANCIO.md`](../01_START_HERE/01_TASK_LIST_PRELANCIO.md) — checkbox `[-]` (parziale) con audit note, in attesa di Step A reveal

**Per chiudere `[x]`**: 1 reveal su Supabase Dashboard (Step A). Se atteso `rk_live_...` → confermi e checkbox flip a `[x]`. Se `sk_live_...` → migration plan sopra, ~10 min, e poi `[x]`.
