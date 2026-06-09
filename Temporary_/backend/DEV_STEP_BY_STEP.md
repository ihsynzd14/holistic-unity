# Meta Conversions API per Holistic Unity — Istruzioni operative

> **A:** dev backend Holistic Unity
> **Da:** Armand · StormXDigital
> **Tempo totale:** ~2h (1h lettura + 1h esecuzione)
> **Cosa otterrai:** che Meta Ads veda tutti gli utenti che si registrano, prenotano una call, pagano — anche quelli su iOS o con ad blocker

Se non hai mai lavorato con Meta Ads, **leggi prima la PARTE 0**. Spiega concetti base in 10 minuti. Poi vai alle parti operative A e B.

---

# PARTE 0 — Concetti base (10 minuti)

## 0.1 Il problema

Holistic Unity fa pubblicità su Facebook e Instagram. Meta (la società che li possiede) per ottimizzare le pubblicità ha bisogno di **sapere chi, dopo aver visto un'ad, fa qualcosa di importante**:

- Si registra al sito
- Prenota la call gratuita
- Paga una sessione

Senza questa informazione, Meta sparge le pubblicità a caso e il rendimento crolla.

## 0.2 Il "Meta Pixel" — Il tracciamento via browser

Il **Meta Pixel** è un pezzo di codice JavaScript che già è inserito nel sito `holisticunity.app`. Quando un utente visita una pagina o fa un'azione, il pixel manda un messaggio a Meta dicendo *"l'utente X ha fatto Y"*.

I messaggi del pixel si chiamano **eventi**. Ogni evento ha un nome standard, ad esempio:

| Nome evento | Cosa significa | Quando il pixel lo dovrebbe firare |
|---|---|---|
| `PageView` | Pagina caricata | Sempre, automaticamente |
| `ViewContent` | Visualizzato contenuto specifico | Pagina di una disciplina (es. `/naturopatia`) |
| `InitiateCheckout` | Iniziato il signup | L'utente apre il form di registrazione |
| `CompleteRegistration` | Account creato | Signup completato con successo |
| `Lead` | Lead generato | L'utente prenota la call gratuita |
| `Purchase` | Acquisto completato | L'utente paga una sessione |

Il pixel manda l'evento dal **browser dell'utente** verso i server di Meta.

```
[Browser utente] --evento--> [Meta]
```

## 0.3 Il problema del pixel browser

Negli ultimi anni Meta perde sempre più eventi via pixel browser, per 3 motivi:

1. **iOS 14+** (App Tracking Transparency, ATT): se l'utente nega il consenso al tracking, Apple blocca le chiamate Meta. **Perdiamo il ~40% degli utenti iOS.**

2. **Ad blocker** (uBlock Origin, AdGuard, ecc.): installati da ~25% degli utenti web. Bloccano completamente il pixel.

3. **Browser privacy-first** (Safari ITP, Firefox ETP): cancellano i cookie Meta dopo 7 giorni, perdiamo continuità di tracciamento.

Risultato: su 100 utenti che fanno una conversione (es. pagano), Meta ne vede solo ~60-65. Le pubblicità vengono ottimizzate su una vista parziale e male.

## 0.4 La soluzione: Conversions API (CAPI)

La **Conversions API** (CAPI) è la versione server-side dello stesso tracciamento. Invece che il browser dell'utente, è il **tuo backend FastAPI** che manda l'evento direttamente a Meta:

```
[Backend FastAPI] --evento via HTTPS--> [Meta]
```

I server di Meta accettano gli eventi via API REST. Non c'è browser di mezzo, quindi:
- iOS 14+ ATT: non vede niente, non blocca
- Ad blocker: non c'è niente da bloccare
- Cookie cleanup: irrilevante

Il backend sa esattamente quando un utente paga (perché ha appena scritto la riga di pagamento nel DB) → invia l'evento a Meta in modo affidabile.

## 0.5 Pixel + CAPI insieme — il setup completo

In produzione si tengono **entrambi attivi**:

| Canale | Da dove | Vantaggi |
|---|---|---|
| Pixel JS browser | Sito web | Cattura comportamenti che il backend non vede (es. scroll, click su menu) |
| CAPI server | Backend FastAPI | Affidabile, immune a iOS/blocker, ha dati che il browser non ha (es. email reale) |

Meta riceve 2 versioni dello stesso evento (browser + server) e li **deduplica automaticamente** se hanno lo stesso `event_id`. Risultato finale: visibilità completa.

## 0.6 Match Quality — il voto di Meta

Per ogni evento che invii, Meta ti dà un voto da 0 a 10 chiamato **Match Quality**. Misura quanto Meta riesce a collegare l'evento al profilo Facebook/Instagram dell'utente che ha fatto l'azione.

Voto alto = Meta riconosce l'utente → può ottimizzare bene le pubblicità per persone simili
Voto basso = Meta non sa chi è → le pubblicità diventano random

Per alzare il Match Quality, ad ogni evento mandi più dati identificativi dell'utente:
- **email** (hashata con SHA-256 per GDPR)
- **telefono** (hashato)
- **IP del client**
- **User Agent** (browser/dispositivo)
- **external_id** (l'id utente nel tuo DB Supabase, hashato)
- **fbp** e **fbc** (cookie del browser, vedi 0.7)

Target: Match Quality > 6.0 (verde). Sotto 5 (rosso) le pubblicità non funzionano bene.

## 0.7 I cookie `_fbp` e `_fbc`

Quando un utente visita il sito, il pixel JS mette 2 cookie nel browser:

- **`_fbp`** (= "Facebook Pixel"): identificatore della sessione browser. Sempre presente.
- **`_fbc`** (= "Facebook Click"): identificatore se l'utente è arrivato cliccando un'ad Meta. Contiene un parametro chiamato `fbclid` che Meta usa per dire "questo è MIO traffico".

Se nel CAPI passi anche `fbp` e `fbc`, Meta collega l'evento direttamente alla campagna pubblicitaria che ha portato l'utente sul sito → attribuzione precisa al 100%.

Il browser ha questi cookie. Il backend no. Quindi serve che il frontend (sito web) **li passi al backend** nelle richieste HTTP.

## 0.8 Deduplication via `event_id`

Se il pixel browser invia `Purchase` per il pagamento di Marco, e il backend invia anche `Purchase` per lo stesso pagamento di Marco, Meta conta 2 acquisti invece di 1.

Soluzione: usare lo stesso identificatore per entrambi.

Ogni evento ha un campo `event_id`. Se browser e CAPI mandano lo stesso `event_id`, Meta capisce che è lo stesso evento e mantiene solo una copia.

Esempio:
```
Pagamento di Marco = sessione Stripe id "cs_test_a1B2c3"
  ↓
  ├─ Pixel browser invia: Purchase con event_id = "purchase_cs_test_a1B2c3"
  └─ CAPI server invia: Purchase con event_id = "purchase_cs_test_a1B2c3"
  
Meta vede 2 messaggi → stessa event_id → conta 1 acquisto ✓
```

Per generare event_id consistenti, usa una funzione che data un'azione restituisce sempre lo stesso id. Il modulo `meta_capi.py` espone già `build_event_id(action, entity_id)`:

- `build_event_id("registration", 42)` → `"registration_42"`
- `build_event_id("purchase", "cs_test_a1B2c3")` → `"purchase_cs_test_a1B2c3"`

## 0.9 Events Manager — l'interfaccia di Meta

**Events Manager** è il pannello Meta dove vedi tutti gli eventi che arrivano. URL:

`https://business.facebook.com/events_manager2/list/pixel/1445760663897743`

Lì vedi:
- Quanti eventi sono arrivati per tipo
- Da dove (`Browser` o `Server`)
- Match Quality medio
- Quali utenti hanno fatto cosa (anonimizzato)

Ha anche una tab **Test Events** dove puoi inviare eventi di prova senza inquinare i dati reali. Per usarla, Meta ti dà un codice tipo `TEST73891` da includere nei payload degli eventi durante il test. Vedrai gli eventi apparire lì entro 60 secondi.

## 0.10 Cosa ti serve fare in pratica

Il tuo lavoro si riassume in 2 cose:

1. **PARTE A — Frontend (pixel JS)**: il sito già invia eventi al pixel, devi solo aggiungere `event_id` consistente e forwardare i cookie `fbp`/`fbc` al backend.

2. **PARTE B — Backend (CAPI)**: dentro 3 endpoint del backend (signup, free-call, Stripe webhook), aggiungi 6 righe di codice che chiamano `send_capi_event(...)`. La funzione è già scritta nel file `meta_capi.py` che ti ho mandato. Tu importi e usi.

Vediamo passo per passo.

---

# PARTE A — Sito web (frontend pixel JS) — 30 min

> Probabilmente il pixel JS sul sito sta già firando gli eventi base. Verifica e completa i 2 pezzi mancanti.

## A1 (10 min). Verifica eventi attualmente firati

### Cosa fare

Apri `https://holisticunity.app/` in Chrome → Cmd+Opt+I (DevTools) → tab **Network** → filtra `tr/?id=`. Naviga il sito, registrati, prenota una call. Per ogni azione devi vedere una nuova chiamata `tr/?id=1445760663897743&...&ev=NomeEvento`.

### Cosa devi vedere

| Azione utente | Chiamata di rete attesa |
|---|---|
| Carica una pagina qualsiasi | `tr/?id=1445760663897743&ev=PageView` |
| Apre `/naturopatia` o altra disciplina | `tr/?id=1445760663897743&ev=ViewContent&content_name=naturopatia` |
| Compila e invia il form signup | `tr/?id=1445760663897743&ev=CompleteRegistration` |
| Apre il form signup (mette email) | `tr/?id=1445760663897743&ev=InitiateCheckout` |
| Prenota la call gratuita | `tr/?id=1445760663897743&ev=Lead&content_name=free_call&value=0&currency=EUR` |
| Completa pagamento Stripe | `tr/?id=1445760663897743&ev=Purchase&value=50&currency=EUR` |

### Se manca qualcosa

Aggiungi nel codice JavaScript del frontend, **dopo** che l'azione è stata confermata dal backend:

```html
<!-- esempio: dopo signup -->
<script>
  // Quando la response del backend POST /auth/register torna 200:
  fbq('track', 'CompleteRegistration');
</script>
```

`fbq` è una funzione globale già definita dal pixel base (inserito nell'`<head>` del sito). Se non esiste, vuol dire che il pixel base non è installato — apri Events Manager e copia lo snippet "Pixel Base Code".

### Check A1

Tutti i 6 eventi del tabellone sopra appaiono in Network DevTools? → Vai ad A2.

---

## A2 (10 min). Aggiungi `event_id` consistente con il backend

### Perché

Vedi sezione 0.8. Senza `event_id` consistente, Meta conta gli eventi 2 volte (uno dal pixel browser, uno dal CAPI server).

### Cosa fare

Quando il backend ti risponde su `/auth/register`, `/bookings/free-call`, ecc., deve includere nel JSON di risposta un campo `event_id`. Il frontend lo usa quando chiama `fbq('track', ..., { eventID: '...' })`.

Conferma con Armand: il backend (te) genererà un `event_id` deterministico (es. `registration_<user_id>`), e lo includerà nella response. Pattern:

**Backend** (lo farai nella PARTE B, anticipo qui per chiarezza):
```python
# backend
@router.post("/auth/register")
async def register_user(...):
    new_user = await create_user(...)
    event_id = f"registration_{new_user.id}"
    # invia evento CAPI (PARTE B sotto)
    await send_capi_event(event_name="CompleteRegistration", event_id=event_id, ...)
    return {**new_user.dict(), "meta_event_id": event_id}  # ← include nella response
```

**Frontend** (questo lo fai tu adesso):
```js
// frontend, dopo POST /auth/register
const response = await fetch('/auth/register', { ... });
const data = await response.json();

// usa lo stesso event_id che il backend ha generato
fbq('track', 'CompleteRegistration', {}, { eventID: data.meta_event_id });
```

### Stesso pattern per gli altri eventi

```js
// Free call booked
const bookingResponse = await fetch('/bookings/free-call', { ... });
const booking = await bookingResponse.json();
fbq('track', 'Lead', {
  content_name: 'free_call',
  value: 0,
  currency: 'EUR',
}, { eventID: booking.meta_event_id });

// Purchase confermato (dopo Stripe checkout redirect)
fbq('track', 'Purchase', {
  value: paidAmount,
  currency: 'EUR',
}, { eventID: `purchase_${stripeSessionId}` });

// Initiate checkout (utente apre form signup)
fbq('track', 'InitiateCheckout', {}, { eventID: `checkout_${browserSessionId}` });
```

### Check A2

In DevTools → Network → la chiamata al pixel include `&eventID=...` (oltre a `&ev=NomeEvento`)? → Vai ad A3.

---

## A3 (10 min). Forwarda cookie `_fbp` e `_fbc` al backend

### Perché

Vedi sezione 0.7. Senza questi cookie nel CAPI server, Meta non sa che l'utente è arrivato cliccando un'ad e perde ~15% di Match Quality.

### Cosa fare

Quando il frontend chiama un endpoint del backend (signup, booking), aggiungi al payload JSON i 2 cookie.

```js
// utility: legge un cookie per nome
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}

// poi nei tuoi fetch:
await fetch('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: userEmail,
    password: userPassword,
    // ... altri campi esistenti ...
    fbp: getCookie('_fbp'),  // ← nuovo
    fbc: getCookie('_fbc'),  // ← nuovo (null se l'utente non è arrivato da un'ad)
  }),
});
```

Stesso pattern per `/bookings/free-call`. Per Stripe webhook NON serve (il webhook arriva da Stripe, non dal browser, quindi non ha cookie da forwardare).

### Check A3

Nella request POST `/auth/register` (vista in DevTools → Network), il body JSON contiene `fbp` e `fbc`? Anche se uno o entrambi sono `null`, va bene. → PARTE A completata. Vai alla PARTE B.

---

# PARTE B — Backend FastAPI (CAPI server-side) — 1h

> Questa è la parte principale. **Tutta da fare** — al momento il backend non manda nessun evento server-side a Meta.

## B1 (5 min). Scarica i file dal Drive

Apri il link Drive che Armand ti ha condiviso. Dentro la cartella `backend/` trovi:

```
backend/
├── app/
│   └── services/
│       ├── __init__.py        ← file vuoto, segna che la cartella è un package Python
│       └── meta_capi.py       ← modulo da copiare nel progetto (NON modificare)
├── .env.addon                 ← 3 righe da appendere al tuo .env
├── DEV_STEP_BY_STEP.md        ← questo file
└── test_capi_local.py         ← validatore opzionale per testare da local prima del deploy
```

### Cosa fa `meta_capi.py`

È un modulo Python che espone 3 funzioni che userai:

| Funzione | Cosa fa |
|---|---|
| `send_capi_event(...)` | Manda un evento a Meta via HTTPS. Async (non blocca il flusso) |
| `build_event_id(action, entity_id)` | Genera un event_id deterministico (es. `"registration_42"`) |
| `extract_client_ip(request)` | Estrae l'IP del client da una `Request` FastAPI, gestendo reverse-proxy |

Il modulo dentro:
- Legge le 3 env vars `META_PIXEL_ID`, `META_ACCESS_TOKEN`, `META_API_VERSION` dal `.env` del progetto
- Hasha email/telefono con SHA-256 (per GDPR)
- Usa un `httpx.AsyncClient` con connection pool (1 sola istanza condivisa, non crea nuove TCP a ogni call)
- Timeout 5 secondi, **fail-silent**: se Meta è giù logga warning ma NON blocca la response al client
- Logga ogni evento inviato con `[META CAPI]` come tag

### Check B1

Hai scaricato tutti i 5 file sul tuo Mac/PC?

---

## B2 (5 min). SSH al VPS e copia il modulo

```bash
ssh root@srv1479321.hstgr.cloud
```

Trova il path del progetto FastAPI sul VPS:

```bash
find / -name "main.py" -path "*holistic*" 2>/dev/null
# se non trovi:
ls /var/www/ /home/ /opt/
```

Annota il path. Esempio: `/var/www/holistic-unity-backend`. D'ora in poi lo chiamo `$PROJECT_PATH`.

Dalla tua macchina local, copia `meta_capi.py` dentro al progetto:

```bash
# su Mac/PC local, sostituisci con il path reale dove hai scaricato i file
scp ~/Downloads/backend/app/services/meta_capi.py \
    root@srv1479321.hstgr.cloud:$PROJECT_PATH/app/services/
```

Se nel progetto NON esiste già una cartella `app/services/`, crearla:

```bash
# sul VPS
mkdir -p $PROJECT_PATH/app/services
touch $PROJECT_PATH/app/services/__init__.py
```

Se la struttura del progetto FastAPI è diversa (es. `src/services/` o `holistic_unity/services/`), usa quella reale. Il file deve essere importabile come `from <path>.meta_capi import ...`.

### Check B2

```bash
ls -la $PROJECT_PATH/app/services/meta_capi.py
# Devi vedere il file, ~9 KB, ~200 righe
wc -l $PROJECT_PATH/app/services/meta_capi.py
# Risultato atteso: circa 200 righe
```

---

## B3 (3 min). Aggiungi le 3 env vars al `.env`

Le credenziali per parlare con Meta. **Trattale come password**: non committarle nel repo pubblico.

```bash
cd $PROJECT_PATH
nano .env
```

Aggiungi in fondo:

```env
# Meta Conversions API
META_PIXEL_ID=1445760663897743
META_ACCESS_TOKEN=EAAXXvnZBIJygBRihs1gyelGqKYZB8xFuXUTSOPwXHhhH6ixR28vjZCeMAWS0Wp9MFMfuIL1kZCou5DMpTFWN31UWpz2r9EJ39VmG1qJ9jOvZCamGZCMWrBLwzxQwROy8ZCebC4pACY73vSZArDyP6j3HwmvDePk27QdmYPVFiKM2FiF7zJ8wdhMxmn5c9ZCp2v6qG7AZDZD
META_API_VERSION=v22.0
```

### Cosa sono

- **META_PIXEL_ID**: identificatore univoco del pixel Meta di Holistic Unity (esiste già, non lo devi creare)
- **META_ACCESS_TOKEN**: token di autenticazione "System User" di Meta. Tipo le API key. È a vita (non scade), non serve refreshare
- **META_API_VERSION**: versione dell'API REST di Meta. `v22.0` è la corrente stabile al 2026

### Check B3

```bash
grep META_ $PROJECT_PATH/.env
# Devi vedere 3 righe non-commentate
```

---

## B4 (2 min). Installa la dipendenza Python

Il modulo `meta_capi.py` usa la libreria `httpx` per fare HTTPS verso Meta. Probabilmente già nel progetto, comunque verifica e installa.

```bash
cd $PROJECT_PATH
source .venv/bin/activate   # nome reale del virtualenv, controlla
pip install 'httpx>=0.27'
echo "httpx>=0.27" >> requirements.txt
```

### Check B4

```bash
pip show httpx
# Devi vedere "Version: 0.27.x" o superiore
python -c "import httpx; print(httpx.__version__)"
```

---

## B5 (40 min). Integra le 3 chiamate `send_capi_event(...)` negli endpoint

Questa è la parte sostanziale. Devi trovare 3 punti nel codice del backend e aggiungere ~6 righe ciascuno.

### Pattern generale

```python
from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

# DENTRO un endpoint esistente, DOPO aver fatto il salvataggio nel DB:
await send_capi_event(
    event_name="...",          # CompleteRegistration | Lead | Purchase
    event_id="...",            # generato con build_event_id(...)
    email="user@example.com",  # email reale dell'utente (verrà hashata dentro la funzione)
    external_id=user.id,        # id interno DB (verrà hashato)
    client_ip="...",            # IP del client (da request)
    client_user_agent="...",    # User-Agent header
    fbp=...,                    # cookie _fbp dal frontend
    fbc=...,                    # cookie _fbc dal frontend
    action_source="website",    # "website" o "app"
    ...
)
```

⚠️ Importante:
- **DOPO** aver fatto il save nel DB (non prima): se Meta è lento/giù non vuoi bloccare il flow
- **`await`**: la funzione è async, ma non blocca > 5 sec (timeout interno)
- **`extract_client_ip(request)`**: usa questa helper per gestire reverse proxy (Nginx); legge `X-Forwarded-For` poi `X-Real-IP` poi `request.client.host`

### B5.1 — Endpoint signup utente

**Step 1: aggiungi `fbp` e `fbc` allo schema Pydantic**

Trova il file che definisce `UserCreate` (probabilmente `app/schemas/user.py`):

PRIMA:
```python
from pydantic import BaseModel, EmailStr

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str | None = None
```

DOPO:
```python
from pydantic import BaseModel, EmailStr
from typing import Optional

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None
    # campi per Meta Conversions API (frontend forwarda i cookie del browser)
    fbp: Optional[str] = None
    fbc: Optional[str] = None
```

**Step 2: modifica l'endpoint del router**

Trova la funzione del router che gestisce `POST /auth/register` (cerca con `grep -r "auth/register" $PROJECT_PATH`).

PRIMA:
```python
@router.post("/auth/register")
async def register_user(user_data: UserCreate, request: Request):
    new_user = await create_user(user_data)
    return new_user
```

DOPO:
```python
from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

@router.post("/auth/register")
async def register_user(user_data: UserCreate, request: Request):
    # Logica esistente: salva l'utente nel DB
    new_user = await create_user(user_data)

    # NUOVO: invia evento CompleteRegistration a Meta via CAPI
    # event_id deterministico → permette deduplica con pixel browser
    event_id = build_event_id("registration", new_user.id)

    await send_capi_event(
        event_name="CompleteRegistration",
        event_id=event_id,
        email=new_user.email,
        external_id=new_user.id,
        client_ip=extract_client_ip(request),
        client_user_agent=request.headers.get("user-agent"),
        fbp=user_data.fbp,  # cookie forwardato dal frontend
        fbc=user_data.fbc,
        action_source="website",
        event_source_url=str(request.url),
    )

    # Aggiungi event_id alla response, il frontend lo usa per il pixel JS
    return {**new_user.dict(), "meta_event_id": event_id}
```

### B5.2 — Endpoint prenotazione call gratuita

Trova l'endpoint che gestisce `POST /bookings/free-call` (o equivalente).

PRIMA:
```python
@router.post("/bookings/free-call")
async def book_free_call(
    data: BookingCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    booking = await create_free_call_booking(data, current_user)
    return booking
```

DOPO:
```python
from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

@router.post("/bookings/free-call")
async def book_free_call(
    data: BookingCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    booking = await create_free_call_booking(data, current_user)

    # NUOVO: invia evento Lead a Meta (conversione PRINCIPALE di Holistic Unity)
    event_id = build_event_id("freecall", booking.id)

    await send_capi_event(
        event_name="Lead",
        event_id=event_id,
        email=current_user.email,
        external_id=current_user.id,
        client_ip=extract_client_ip(request),
        client_user_agent=request.headers.get("user-agent"),
        action_source="website",
        custom_data={
            "content_name": "free_call",
            "discipline": getattr(data, "discipline", None),
            "therapist_id": getattr(data, "therapist_id", None),
            "value": 0,
            "currency": "EUR",
        },
    )

    return {**booking.dict(), "meta_event_id": event_id}
```

### B5.3 — Stripe webhook (Purchase)

Il webhook di Stripe ti notifica quando un pagamento è completato. È un'unica route che gestisce diversi tipi di eventi Stripe. Ti interessa solo `checkout.session.completed` (utente ha finito il pagamento).

Trova il file (probabilmente `app/routers/webhooks.py` o `app/routers/stripe.py`).

PRIMA:
```python
@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        await mark_payment_as_completed(session)

    return {"status": "ok"}
```

DOPO:
```python
from app.services.meta_capi import send_capi_event, build_event_id

@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        await mark_payment_as_completed(session)

        # NUOVO: invia evento Purchase a Meta
        amount = (session["amount_total"] or 0) / 100  # Stripe usa centesimi
        currency = (session.get("currency") or "eur").upper()
        customer_email = (session.get("customer_details") or {}).get("email")
        metadata = session.get("metadata") or {}

        # Action source: "website" se è web checkout, "app" se è in-app
        # Per leggerlo, quando crei la Checkout Session lato backend includi
        # metadata={"source": "web"|"ios"} e qui lo leggi
        action_source = "app" if metadata.get("source") == "ios" else "website"

        await send_capi_event(
            event_name="Purchase",
            event_id=build_event_id("purchase", session["id"]),  # event_id = stripe session ID
            email=customer_email,
            value=amount,
            currency=currency,
            action_source=action_source,
            custom_data={
                "content_name": "holistic_session",
                "content_type": "product",
                "discipline": metadata.get("discipline"),
                "package": metadata.get("package", "single"),  # "single" o "4_sessions"
                "num_items": 1,
            },
        )

    return {"status": "ok"}
```

### B5.4 — (Opzionale ma consigliato) handler di shutdown

Il modulo `meta_capi.py` mantiene aperta una connessione HTTP verso Meta. In shutdown del servizio, è elegante chiuderla.

In `app/main.py` (o dove configuri l'app FastAPI):

```python
from app.services.meta_capi import close_capi_client

@app.on_event("shutdown")
async def shutdown_meta_capi():
    await close_capi_client()
```

### Check B5

I 3 endpoint sono modificati. Lancia il linter Python (`flake8` o `ruff`) per assicurarti che non ci siano errori di sintassi prima del restart.

---

## B6 (3 min). Restart del servizio

A seconda di cosa usa il VPS per gestire il processo Python:

```bash
# Se PM2 (verifica con: pm2 list)
pm2 restart holistic-unity && pm2 logs holistic-unity --lines 30

# Se systemctl (verifica con: systemctl status holistic-unity-api)
systemctl restart holistic-unity-api && journalctl -u holistic-unity-api -f

# Se supervisord (verifica con: supervisorctl status)
supervisorctl restart holistic-unity
```

### Check B6

Nei log dovresti vedere:
- ✓ il servizio FastAPI riparte senza errori (no `ImportError`, no `AttributeError`)
- ✓ alla prima registrazione test, una linea con `[META CAPI]` (è il logger del modulo)

Se vedi `ImportError: No module named 'app.services.meta_capi'`:
- Path sbagliato in B2 (file copiato in posto sbagliato)
- Oppure `__init__.py` mancante nella cartella `services/`

---

## B7 (15 min). Test in Events Manager

Adesso devi verificare che gli eventi arrivino davvero a Meta.

### B7.1 — Genera Test Event Code

1. Apri https://business.facebook.com/events_manager2/list/pixel/1445760663897743/test_events
2. Tab "**Test Events**" → click in alto a destra "**Test browser events**" (o "Test Events" in italiano)
3. Meta ti genera un codice tipo `TEST73891` (è un identificatore temporaneo, dura ~24h). **Copialo**.

### B7.2 — Attiva la modalità test sul backend

```bash
ssh root@srv1479321.hstgr.cloud
cd $PROJECT_PATH
echo "META_TEST_EVENT_CODE=TEST73891" >> .env
pm2 restart holistic-unity  # o equivalente
```

Quando questa env var è settata, ogni evento che il backend manda a Meta include un flag che dice "questo è un test". Meta li mostra nel pannello Test Events senza inquinare i dati reali.

### B7.3 — Esegui 3 azioni di test

Da un browser (dev mode, o staging, o anche prod con email fake):

1. **Registrazione cliente** — registra un nuovo account con email tipo `test+capi@holisticunity.app` (la tua email reale + tag, così la ricevi)
2. **Prenotazione call gratuita** — con lo stesso utente test, prenota una call
3. **Acquisto Stripe** — usa la carta test Stripe `4242 4242 4242 4242` (CVC qualsiasi, scadenza futura)

### B7.4 — Verifica in Events Manager

Torna su https://business.facebook.com/events_manager2/list/pixel/1445760663897743/test_events.

Entro **60 secondi** dovresti vedere 3 righe apparire:

| Evento | Source atteso | Match Quality target |
|---|---|---|
| CompleteRegistration | `Server` (non `Browser`) | > 6.0 (verde) |
| Lead | `Server` | > 6.0 (verde) |
| Purchase | `Server` | > 6.5 (verde) |

⚠️ Se vedi `Browser` invece di `Server`:
- O il modulo `meta_capi.py` non si è caricato
- O il branch di codice che chiama `send_capi_event(...)` non viene raggiunto

Per debuggare: aggiungi un `print(f"[DEBUG] CAPI {event_name} sent: id={event_id}")` prima/dopo la chiamata e controlla i log del servizio.

⚠️ Se Match Quality è < 5:
- Hai dimenticato di passare `email`, `client_ip`, o `client_user_agent`
- Oppure il `fbp`/`fbc` non arriva dal frontend (controlla nelle richieste)

### B7.5 — Vai live (rimuovi il test code)

Quando i 3 eventi server sono verdi:

```bash
ssh root@srv1479321.hstgr.cloud
cd $PROJECT_PATH
# rimuovi la riga META_TEST_EVENT_CODE (o commentala con #)
sed -i '/^META_TEST_EVENT_CODE=/d' .env
pm2 restart holistic-unity
```

A questo punto gli eventi vanno a finire nei dati reali di Meta, non più in Test Events. Sei in produzione.

### Check B7

Tutti e 3 gli eventi visibili in Events Manager → Test Events con source `Server` e Match Quality > 6.0?

---

# 📸 Deliverable

Quando hai finito **tutti** gli step (A1-A3, B1-B7), mandami **uno screenshot di Events Manager → Test Events** con i 3 eventi:

1. ✅ `CompleteRegistration` — source `Server` — MQ > 6.0
2. ✅ `Lead` — source `Server` — MQ > 6.0
3. ✅ `Purchase` — source `Server` — MQ > 6.5

Da quel momento ho il via libera per attivare le campagne Meta Ads (al momento PAUSED in attesa del CAPI).

---

# 📖 Glossario

| Termine | Definizione |
|---|---|
| **Meta Pixel** | Pezzo di codice JavaScript che traccia eventi dal browser dell'utente verso Meta. Ogni pixel ha un ID univoco (qui `1445760663897743`) |
| **CAPI** (Conversions API) | API REST di Meta per inviare eventi dal backend (server) invece che dal browser. Più affidabile |
| **Evento** | Notifica a Meta che un utente ha fatto un'azione (es. `Lead`, `Purchase`). Ha un nome standard e parametri |
| **Standard Event** | Evento con nome riconosciuto da Meta: `PageView`, `Lead`, `Purchase`, `CompleteRegistration`, `InitiateCheckout`, ecc. |
| **Custom Event** | Evento custom che inventi tu (es. `OnboardingStep`). Meno usato, richiede setup in Events Manager |
| **Custom Conversion** | Regola in Events Manager che dice "considera Lead come HU_Lead_FreeCallScheduled". Usato per ottimizzazione campagne |
| **Match Quality** | Voto 0-10 di Meta su quanto bene riesce a collegare evento ↔ utente Facebook. Target > 6 |
| **event_id** | ID univoco dell'evento, condiviso tra pixel browser e CAPI server, serve a deduplicare |
| **`_fbp`** | Cookie Meta del browser, identifica la sessione |
| **`_fbc`** | Cookie Meta del browser, identifica il click sull'ad (se l'utente è arrivato da una pubblicità Meta) |
| **`external_id`** | ID utente interno del tuo DB (Supabase), hashato prima di inviare a Meta |
| **action_source** | Dove avviene l'azione: `website` (web), `app` (iOS/Android), `physical_store` (POS), `system_generated` (cron/job) |
| **Test Event Code** | Codice temporaneo che dice a Meta "questi eventi sono di test, mostrali in Test Events e non in produzione" |
| **Events Manager** | Pannello Meta dove vedi gli eventi che arrivano. URL: business.facebook.com/events_manager2 |
| **System User Token** | Token di autenticazione di Meta a vita (non scade). Tipo API key. Per CAPI in produzione si usa questo |
| **SHA-256** | Algoritmo di hash a senso unico. Email/telefono vengono hashati prima di mandarli a Meta per essere conformi GDPR |
| **ATT** (App Tracking Transparency) | Sistema di iOS 14+ che chiede consenso all'utente per il tracking. Se negato, il pixel JS non funziona |
| **Match rate** | % di eventi che Meta riesce a collegare a un profilo utente. Target > 70% |
| **Fail-silent** | Pattern di programmazione: se l'operazione fallisce, logga ma non blocca il caller. Usato per CAPI così il signup non si rompe se Meta è giù |

---

# 🚨 Errori frequenti + fix

| Errore | Causa | Fix |
|---|---|---|
| `ImportError: No module named 'app.services.meta_capi'` | File copiato in posto sbagliato | Verifica che esista `$PROJECT_PATH/app/services/meta_capi.py` e che esista `__init__.py` nella stessa cartella |
| `ModuleNotFoundError: httpx` | Dipendenza mancante | `pip install httpx>=0.27` |
| HTTP 400 / "Invalid OAuth 2.0 Access Token" nei log | Token sbagliato/scaduto | Controlla che `META_ACCESS_TOKEN` nel `.env` sia esattamente la stringa lunga che ti ha passato Armand, senza spazi/newline |
| Events Manager mostra `Browser` invece di `Server` | Il branch CAPI non viene raggiunto | Aggiungi `print` prima/dopo `send_capi_event(...)` e controlla nei log se compare. Se non compare → il flusso non passa di lì (forse if-else errato) |
| Match Quality < 5 (rosso) | Dati utente insufficienti | Verifica che passi `email`, `client_ip`, `client_user_agent` in ogni chiamata. Aggiungi `external_id` e `fbp`/`fbc` dal frontend |
| Timeout 5s nei log | Rete VPS lenta verso Meta | OK, è tollerato. Il modulo logga warning ma non blocca utente. Sotto il 2% di eventi persi è normale |
| L'utente vede la registrazione "in attesa" troppo a lungo | Il `await send_capi_event` blocca | Verifica che `send_capi_event` sia chiamato DOPO `await create_user(...)`. Se Meta è lento è OK, max 5s |
| `pip install httpx` fail con "externally-managed-environment" | macOS con Python di sistema | Verifica di essere nel virtualenv del progetto (`source .venv/bin/activate`) prima di `pip install` |
| Stripe webhook firma non valida | `STRIPE_WEBHOOK_SECRET` mancante | Non c'entra con CAPI, è un problema preesistente. Sistemalo prima |

---

# ❌ Cosa NON devi fare

| ❌ | Perché |
|---|---|
| Cambiare il `meta_capi.py` | È già scritto e validato. Lo importi e usi, non lo modifichi |
| Generare un nuovo Meta access token | Te l'ho già passato io. È System User Token, non scade |
| Creare un nuovo Meta Pixel | Esiste già. ID `1445760663897743` |
| Implementare retry/queue (Celery, RQ, Redis) | Non serve. Fail-silent è OK per il volume attuale. Aggiungi solo se in futuro perdiamo > 5% eventi |
| Chiamare `send_capi_event(...)` PRIMA di salvare nel DB | Sempre DOPO. Se Meta fallisce, l'utente deve comunque vedere il signup riuscito |
| Esporre `META_ACCESS_TOKEN` nel frontend | È un secret server-side. Sta solo nel `.env` del backend, mai nel JavaScript del sito |
| Rimuovere il pixel JS dal sito | Lo lasci com'è. Browser e CAPI lavorano in parallelo, Meta dedupplica con `event_id` |
| Disabilitare il logger `[META CAPI]` | Serve per debug. Lascialo on |

---

# 🆘 Se ti blocchi

Scrivi a Armand su Slack con:

1. A quale step ti sei fermato (es. `B5.2`)
2. Cosa hai provato a fare prima di chiedere aiuto
3. Il messaggio di errore esatto (copia-incolla, non parafrasare)
4. Il file e la riga dove appare il problema

Risposta entro 2h.

Quando hai finito: scrivi "fatto" + screenshot. Tempo target totale: **2h** (incluso questo leggere). La parte di codice vera sono ~30 righe aggiunte in 3-4 file.
