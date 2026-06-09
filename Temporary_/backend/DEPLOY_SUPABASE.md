# Deploy Meta CAPI — Supabase Edge Functions

Implementazione di Meta Conversions API come da PDF `DEV_SUPABASE_CAPI`: tutto in Supabase Edge Functions, no Next.js routes, no VPS. Sostituisce completamente la versione Next.js precedente (rollback già fatto).

## Stato del codice (già scritto in repo)

| File | Cosa fa |
|---|---|
| `08_Codebases/iOS_App/supabase/functions/_shared/meta_capi.ts` | Modulo CAPI condiviso (Deno) — SHA-256 via Web Crypto, fail-silent, timeout 5s, `buildEventId`, `extractClientIp`, `sendCapiEvent` |
| `08_Codebases/iOS_App/supabase/functions/auth-hook/index.ts` | `CompleteRegistration` — chiamato dal frontend dopo signup (Opzione B del PDF) |
| `08_Codebases/iOS_App/supabase/functions/meta-capi-event/index.ts` | Relay generico — chiamato dai DB Webhooks (auth via `x-capi-secret`) o da browser (CORS allowlist + rate-limit) |
| `08_Codebases/iOS_App/supabase/functions/stripe-webhook/index.ts` | Modificato in-place: aggiunto `Purchase` nel branch `payment_intent.succeeded` (copre web + iOS) |
| `08_Codebases/iOS_App/supabase/functions/save-early-access-lead/index.ts` | Modificato in-place: aggiunto `Lead` mirror gated su `meta_consent` (pre-launch funnel) |

Frontend wiring:

| File | Cosa fa |
|---|---|
| `client-webapp/src/lib/analytics/meta-pixel.ts` | Helper estesi per accettare `eventID` + `readMetaCookies()` (invariato dalla versione precedente — utile anche con CAPI Supabase) |
| `client-webapp/src/app/register/page.tsx` | Dopo signup, POST a `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/auth-hook` con `{user_id, email, fbp, fbc, source_url}` |
| `client-webapp/src/app/welcome/page.tsx` | Stesso pattern per email-confirm flow (produzione) |
| `client-webapp/src/app/checkout/success/page.tsx` | `trackPurchase` riceve `eventID = purchase_<bookingId>` per match col webhook Stripe |
| `holistic-unity-website/early_access.html` | `saveLead` ora forwarda `fbp/fbc/meta_consent` al `save-early-access-lead` (che fa CAPI server-side) |

Webhook Next.js Stripe (`/api/webhooks/stripe`) è tornato com'era prima della modifica — il CAPI Purchase ora vive solo lato Supabase.

## 1. Secrets Supabase (5 min)

Dal root del progetto (dove `supabase config.toml` vive — probabilmente `08_Codebases/iOS_App/`):

```bash
cd 08_Codebases/iOS_App

supabase secrets set META_PIXEL_ID=1445760663897743
supabase secrets set META_ACCESS_TOKEN=EAAXXvnZBIJygBRihs1gyelGqKYZB8xFuXUTSOPwXHhhH6ixR28vjZCeMAWS0Wp9MFMfuIL1kZCou5DMpTFWN31UWpz2r9EJ39VmG1qJ9jOvZCamGZCMWrBLwzxQwROy8ZCebC4pACY73vSZArDyP6j3HwmvDePk27QdmYPVFiKM2FiF7zJ8wdhMxmn5c9ZCp2v6qG7AZDZD
supabase secrets set META_API_VERSION=v22.0

# Genera un secret random per autenticare il relay generic:
supabase secrets set CAPI_RELAY_SECRET=$(openssl rand -hex 32)
```

`STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` sono già configurati per la function `stripe-webhook` esistente. Verifica:

```bash
supabase secrets list | grep -E "STRIPE_|META_|CAPI_"
# Devi vedere: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, META_PIXEL_ID,
# META_ACCESS_TOKEN, META_API_VERSION, CAPI_RELAY_SECRET
```

> ⚠️ **IMPORTANTE**: se hai aggiunto `META_*` come Vercel env vars (la versione precedente li chiedeva lì), **eliminale da Vercel** — non servono più, e tenerli sparpagliati confonde i futuri dev.

## 2. Deploy delle Edge Functions (3 min)

Le 3 nuove + le 2 modificate:

```bash
# 2 nuove server-side (chiamate da browser o DB, niente JWT)
supabase functions deploy auth-hook --no-verify-jwt
supabase functions deploy meta-capi-event --no-verify-jwt

# 2 esistenti modificate
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy save-early-access-lead --no-verify-jwt
```

## 3. Database Webhook per Lead post-launch (10 min)

Quando un utente prenota una free-call (`price=0` in HU) si crea una riga in `bookings`. Configura un Database Webhook che invochi `meta-capi-event` su INSERT.

> 🆕 **La UI Supabase recente NON ha più il "Custom payload editor"** per i Database Webhooks. Il body è auto-generato in formato `{type, table, schema, record, old_record}`. La function `meta-capi-event` accetta questo formato nativo e mappa internamente `record.price=0 → Lead event` (vedi `normalizeDbWebhook` in `meta-capi-event/index.ts`). Non devi configurare niente di particolare nel body — basta default.

Supabase Dashboard → **Database → Webhooks → Create a new hook**:

| Campo | Valore |
|---|---|
| Name | `booking-to-meta-lead` |
| Table | `bookings` |
| Events | ☑ Insert (solo) |
| Type | `HTTP Request` |
| HTTP Method | `POST` |
| URL | `https://<project-ref>.supabase.co/functions/v1/meta-capi-event` |
| HTTP Headers | `Content-Type: application/json`<br>`x-capi-secret: <CAPI_RELAY_SECRET>` |
| HTTP Params | (vuoto) |
| Body | (NON c'è il campo nella UI moderna — skip. La function legge il payload auto-generato) |

> 💡 **Conditions / Filter** è opzionale: la function già scarta le INSERT con `record.price !== 0` (le tratta come "unsupported" e ritorna `{ ignored: true }` con 200 OK — il webhook non riprova). Se la tua UI Supabase ha un campo Conditions, puoi opzionalmente metterci `price = 0` per ridurre rumore nei log della function. Se non lo trovi, va bene comunque.

Salva.

## 4. Stripe webhook (verifica)

Il Stripe webhook esistente già delivera `payment_intent.succeeded` alla Supabase function. **Non serve toccare niente in Stripe Dashboard** — la modifica è solo nel codice della function (aggiunto `sendCapiEvent` nel branch `payment_intent.succeeded`). Conferma:

```bash
supabase functions list  # vedi stripe-webhook come Active
```

In `https://dashboard.stripe.com/webhooks` verifica che esista un endpoint che punta a `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` e che includa `payment_intent.succeeded` nei "Events to send".

## 5. Test con META_TEST_EVENT_CODE (15 min)

### 5.1 Genera codice

[Events Manager](https://business.facebook.com/events_manager2/list/pixel/1445760663897743/test_events) → tab **Test Events** → "Test Events" → copia codice (es. `TEST73891`).

### 5.2 Attiva test mode

```bash
supabase secrets set META_TEST_EVENT_CODE=TEST73891
# I deploy non ri-pushano in automatico dopo il secret change.
# Re-deploya le 4 functions per forzare il pickup del nuovo env:
supabase functions deploy auth-hook --no-verify-jwt
supabase functions deploy meta-capi-event --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy save-early-access-lead --no-verify-jwt
```

### 5.3 Esegui 3 scenari di test

In incognito, con cookie banner ACCETTATO:

1. **Lead (pre-launch)** — `https://holisticunity.app/early_access` → submit con email `test+capi-lead@holisticunity.app`. Function log: `[META CAPI] Lead OK (id=lead_<short>_<bucket>, received=1, ...)`
2. **Lead (post-launch)** — Prenota una free-call (se il flow è già attivo). Function log: `[META CAPI] Lead OK (id=freecall_<bookingId>, received=1, ...)`
3. **CompleteRegistration** — Signup su `app.holisticunity.app/register` + click email confirm → atterri su `/welcome`. Function log: `[META CAPI] CompleteRegistration OK (id=registration_<uuid>, received=1, ...)`
4. **Purchase** — Booking + pagamento test Stripe `4242 4242 4242 4242`. Function log: `[META CAPI] Purchase OK (id=purchase_<bookingId>, received=1, ...)`

### 5.4 Verifica in Events Manager

Entro 60 sec in https://business.facebook.com/events_manager2/list/pixel/1445760663897743/test_events:

| Evento | Source atteso | Match Quality target |
|---|---|---|
| `Lead` | `Server` | > 6.0 |
| `CompleteRegistration` | `Server` | > 6.0 |
| `Purchase` | `Server` | > 6.5 |

**Debug:**
- Supabase Dashboard → Edge Functions → `<function-name>` → **Logs** — cerca `[META CAPI]`
- Se vedi `[META CAPI] HTTP 401 Invalid OAuth 2.0` → token sbagliato in `META_ACCESS_TOKEN`
- Se vedi `[META CAPI] META_ACCESS_TOKEN not configured` → secret non picked up (re-deploy della function)
- Se Events Manager mostra `Browser` invece di `Server` → la function non è stata chiamata (controlla i log)

### 5.5 Go-live

```bash
supabase secrets unset META_TEST_EVENT_CODE
# Re-deploy come sopra per propagare la rimozione
supabase functions deploy auth-hook --no-verify-jwt
supabase functions deploy meta-capi-event --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy save-early-access-lead --no-verify-jwt
```

Manda screenshot Events Manager → Test Events ad Armand + URL dei 3 endpoint:

```
https://<project-ref>.supabase.co/functions/v1/auth-hook
https://<project-ref>.supabase.co/functions/v1/meta-capi-event
https://<project-ref>.supabase.co/functions/v1/stripe-webhook
```

## Cosa NON serve fare

| ❌ | Perché |
|---|---|
| Modificare `_shared/meta_capi.ts` | È testato e validato — importi solo |
| Tenere env vars META_* in Vercel | Non servono più, vanno **eliminate** da Vercel UI |
| Mantenere routes `/api/capi/*` in Next.js | Rollback già fatto, file eliminati |
| Toccare il webhook Stripe in Next.js | Tornato com'era prima — il Purchase CAPI ora vive solo in Supabase |
| Generare un nuovo Meta access token | System User Token a vita |
| Esporre `META_ACCESS_TOKEN` o `CAPI_RELAY_SECRET` nel frontend | Server-side only, vivono solo in Supabase secrets |

## Mapping eventi → trigger reale

| Evento Meta | Trigger | Function | Quando fired |
|---|---|---|---|
| `Lead` (pre-launch) | Form `early_access.html` submit | `save-early-access-lead` | Mentre le campagne TOFU puntano a `/early_access` |
| `Lead` (post-launch) | DB INSERT su `bookings WHERE type='free_call'` | DB Webhook → `meta-capi-event` | Quando l'utente prenota la free-call |
| `CompleteRegistration` | Frontend `register/welcome` page | `auth-hook` | Account creato (sia immediato sia post email-confirm) |
| `Purchase` | Stripe `payment_intent.succeeded` | `stripe-webhook` | Pagamento sessione completato (web + iOS) |
