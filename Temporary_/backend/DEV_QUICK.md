# Meta CAPI — Versione corta, 10 minuti

## TL;DR

**Cosa devi fare**: aggiungere **1 riga di codice** in 3 punti del backend FastAPI, in modo che ogni volta che un utente fa una di queste 3 azioni, il backend mandi una notifica a Meta:

| Quando l'utente fa… | …il backend manda a Meta… |
|---|---|
| crea un account (POST `/auth/register`) | `CompleteRegistration` |
| prenota la call gratuita | `Lead` |
| paga (Stripe webhook `checkout.session.completed`) | `Purchase` |

Tutto il resto (HTTP a Meta, hashing email, retry, logging) è **già scritto** nel file `app/services/meta_capi.py`. Tu importi una funzione e la chiami.

---

## Perché serve

Il pixel JS sul sito traccia `PageView`. Su **iOS 14+, Safari ITP, e con ad blocker installati**, il pixel perde il 30-40% degli eventi importanti (chi paga, chi si registra). **CAPI = stesso evento ma inviato dal nostro server direttamente al server Meta**, immune a tutto questo.

```
PRIMA:  Browser utente → Pixel JS → Meta   (perdiamo 30-40%)
ADESSO: Browser → ok                       (continua, PageView)
        FastAPI backend → CAPI → Meta      (server-side, sempre arrivano)
```

---

## I 3 cambiamenti al codice

### File 1: `app/services/meta_capi.py` (NUOVO, già pronto nello zip)
Copialo dentro al progetto. Non devi modificarlo.

### File 2: il tuo router dell'auth (es. `app/routers/auth.py`)

**PRIMA**
```python
@router.post("/auth/register")
async def register_user(user_data: UserCreate, request: Request):
    new_user = await create_user(user_data)
    return new_user
```

**DOPO** (aggiungi le 2 righe `from ...` in alto e il blocco `await send_capi_event(...)`)
```python
from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

@router.post("/auth/register")
async def register_user(user_data: UserCreate, request: Request):
    new_user = await create_user(user_data)

    await send_capi_event(
        event_name="CompleteRegistration",
        event_id=build_event_id("registration", new_user.id),
        email=new_user.email,
        external_id=new_user.id,
        client_ip=extract_client_ip(request),
        client_user_agent=request.headers.get("user-agent"),
        action_source="website",
    )

    return new_user
```

### File 3: il tuo router dei pratici (es. `app/routers/practitioners.py`)

```python
from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

@router.post("/practitioners/register")
async def register_practitioner(data: PractitionerCreate, request: Request):
    practitioner = await create_practitioner(data)

    await send_capi_event(
        event_name="Lead",
        event_id=build_event_id("lead", practitioner.id),
        email=practitioner.email,
        external_id=practitioner.id,
        client_ip=extract_client_ip(request),
        client_user_agent=request.headers.get("user-agent"),
        action_source="website",
    )

    return practitioner
```

⚠️ **In realtà l'evento "Lead" più importante è quando il CLIENTE prenota la call gratuita** (non quando il pratico si iscrive). Se hai un endpoint tipo `POST /bookings/free-call`, aggiungilo anche lì:

```python
from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

@router.post("/bookings/free-call")
async def book_free_call(data: BookingCreate, request: Request, current_user: User = Depends(...)):
    booking = await create_booking(data, current_user)

    await send_capi_event(
        event_name="Lead",
        event_id=build_event_id("freecall", booking.id),
        email=current_user.email,
        external_id=current_user.id,
        client_ip=extract_client_ip(request),
        client_user_agent=request.headers.get("user-agent"),
        action_source="website",
        custom_data={
            "content_name": "free_call",
            "discipline": data.discipline,        # se ce l'hai
            "therapist_id": data.therapist_id,    # se ce l'hai
        },
    )

    return booking
```

### File 4: il tuo Stripe webhook handler

```python
from app.services.meta_capi import send_capi_event, build_event_id

@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    # ... codice esistente di verifica firma Stripe ...

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        amount = (session["amount_total"] or 0) / 100      # centesimi → euro
        currency = (session.get("currency") or "eur").upper()
        customer_email = (session.get("customer_details") or {}).get("email")
        metadata = session.get("metadata") or {}

        await send_capi_event(
            event_name="Purchase",
            event_id=build_event_id("purchase", session["id"]),   # ID Stripe = no duplicati
            email=customer_email,
            value=amount,
            currency=currency,
            action_source="app" if metadata.get("source") == "ios" else "website",
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

---

## Setup .env

Aggiungi queste 3 righe al `.env` del backend (sul VPS `srv1479321.hstgr.cloud`, nel `.env` del progetto FastAPI):

```bash
META_PIXEL_ID=1445760663897743
META_ACCESS_TOKEN=EAAXXvnZBIJygBRihs1gyelGqKYZB8xFuXUTSOPwXHhhH6ixR28vjZCeMAWS0Wp9MFMfuIL1kZCou5DMpTFWN31UWpz2r9EJ39VmG1qJ9jOvZCamGZCMWrBLwzxQwROy8ZCebC4pACY73vSZArDyP6j3HwmvDePk27QdmYPVFiKM2FiF7zJ8wdhMxmn5c9ZCp2v6qG7AZDZD
META_API_VERSION=v22.0
```

Il token è un System User Token di Meta — non scade, già validato.

---

## Installa httpx

```bash
cd <progetto-backend>
source .venv/bin/activate   # se usate venv
pip install 'httpx>=0.27'
echo "httpx>=0.27" >> requirements.txt
```

(probabile che ce l'abbiate già, comunque)

---

## Restart

```bash
# se usate PM2
pm2 restart holistic-unity && pm2 logs --lines 30

# se systemctl
systemctl restart holistic-unity-api && journalctl -u holistic-unity-api -f
```

Cerca `[META CAPI]` nei log → significa che il modulo si è caricato OK.

---

## Test (5 minuti)

1. Apri https://business.facebook.com/events_manager2/list/pixel/1445760663897743/test_events
2. In alto a destra → "**Test Events**" → ti dà un codice tipo `TEST73891`
3. Aggiungi temporaneamente al `.env`:
   ```bash
   META_TEST_EVENT_CODE=TEST73891
   ```
4. Restart del servizio
5. Fai 3 azioni di prova (sul sito o app dev):
   - registrazione cliente
   - prenotazione call gratuita
   - pagamento Stripe (carta test `4242 4242 4242 4242`)
6. Entro 60 secondi vedi i 3 eventi apparire in "Test Events" con Match Quality > 6.0
7. **Rimuovi** `META_TEST_EVENT_CODE` dal `.env` + restart → vai live
8. Manda screenshot ad Armand

---

## Domande frequenti

**Q: Dove sta `app/services/meta_capi.py`?**
Nello zip che ti ha mandato Armand. Lo copi nel progetto, dentro `app/services/` (o adatta al path reale che usate — es. se avete `src/services/`, va lì).

**Q: I path degli endpoint che mi hai dato sono `/auth/register` ecc. — i nostri si chiamano diversamente.**
Normale. Usa i path reali del progetto. La logica è la stessa: subito dopo `await create_user(...)` (o equivalente che salva l'utente nel DB), aggiungi `await send_capi_event(...)`.

**Q: Se Meta è giù il flow utente si blocca?**
No. Il modulo fa fail-silent: timeout 5s, logga l'errore, **non blocca mai la response al client**. L'utente vede sempre il signup andato a buon fine.

**Q: Devo gestire GDPR?**
Email e telefono vengono hashati con SHA-256 prima di partire (è già nel codice). Verifica che la Privacy Policy del sito menzioni la condivisione di dati pseudonimizzati con piattaforme pubblicitarie. Se l'utente nega consenso adv, salta la chiamata `send_capi_event`.

**Q: Per la call gratuita, l'evento si chiama "Lead" o "FreeCallScheduled"?**
Si chiama `Lead` (è l'evento Standard Meta). Il fatto che è una call gratuita lo passi in `custom_data.content_name = "free_call"`. Meta non ti chiede di inventare un nuovo nome evento.

**Q: action_source = "website" o "app"?**
- web checkout → `"website"`
- iOS app checkout → `"app"`
Per Stripe webhook: leggi `session.metadata.source` (se quando crei la Checkout Session metti `metadata={"source": "ios"}` o `"web"`, il webhook sa già la verità).

**Q: Stima impegno?**
1-2 ore se il codice è ben strutturato. Le modifiche reali sono ~15 righe in 3 file.

---

## Cosa NON devi fare

❌ Non devi creare un nuovo Meta Pixel (esiste già, ID `1445760663897743`)
❌ Non devi generare un nuovo access token (te lo passo già nel `.env`)
❌ Non devi configurare niente in Events Manager (è già configurato, mancano solo gli eventi server-side)
❌ Non devi modificare il pixel JS sul sito (continua a tracciare `PageView`)
❌ Non devi gestire retry/queue/Celery — fail-silent, basta così

---

## Quando hai finito

Mandi 1 screenshot a Armand:
- Events Manager → Test Events → 3 eventi verdi con Match Quality > 6.0

Da lì:
- Armand verifica via API che gli eventi arrivino server-side
- Attiva le Custom Conversions HU_Lead_FreeCallScheduled / HU_Purchase_Session / HU_Purchase_Bundle (già create)
- Configura attribution settings sulle campagne ads esistenti

Il go-live delle ads ottimizzate su Lead è atteso per il 7 giugno.

Per dubbi: scrivi ad Armand.
