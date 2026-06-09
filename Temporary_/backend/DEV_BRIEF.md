# Brief tecnico — Meta Conversions API (CAPI) per Holistic Unity

**A:** Dev Holistic Unity
**Da:** Armand (StormXDigital) · canale Slack/Email
**Stima impegno:** 1-2 ore (deploy + test)
**Priorità:** alta (gating del lancio Meta Ads del 7 giugno)

---

## 1. Contesto e obiettivo

Holistic Unity ha attive campagne Meta Ads dal 27 maggio (campagne TOFU General + Naturopatia in pre-launch verso `/early_access`). Il pixel web (`1445760663897743` — "Holistic Unity_Dataset") attualmente traccia solo `PageView` lato browser.

Per ottimizzare le campagne Meta dobbiamo inviare anche **eventi di conversione server-side** via **Meta Conversions API (CAPI)**. Motivazioni:

- **Match rate iOS**: il pixel JS perde ~40% degli eventi su iOS 14+ per l'ATT (App Tracking Transparency). Il CAPI server-side è immune.
- **Ad blocker**: ~25% degli utenti li ha installati. CAPI bypassa.
- **Affidabilità**: il backend conosce esattamente quando l'utente completa un'azione, niente race condition col pixel.

### Eventi da inviare

| Evento Meta | Trigger nel backend | `action_source` |
|---|---|---|
| `CompleteRegistration` | Cliente crea account (`/auth/register` o equivalente) | `website` (o `app` se da iOS) |
| `Lead` | Pratico completa onboarding (`/practitioners/register`) | `website` |
| `Purchase` | Stripe webhook `checkout.session.completed` | dipende da metadata sessione |

---

## 2. Credenziali Meta

⚠️ **Trattare come segreti, NON committare in repo pubblico.**

```env
META_PIXEL_ID=1445760663897743
META_ACCESS_TOKEN=EAAXXvnZBIJygBRihs1gyelGqKYZB8xFuXUTSOPwXHhhH6ixR28vjZCeMAWS0Wp9MFMfuIL1kZCou5DMpTFWN31UWpz2r9EJ39VmG1qJ9jOvZCamGZCMWrBLwzxQwROy8ZCebC4pACY73vSZArDyP6j3HwmvDePk27QdmYPVFiKM2FiF7zJ8wdhMxmn5c9ZCp2v6qG7AZDZD
META_API_VERSION=v22.0
```

Note sul token:
- Tipo: **System User Token**, non scade (`expires_at: 0`), già **validato lato Meta** — chiamata test del 1 giugno ha restituito `events_received: 1`.
- Scope inclusi: `ads_management`, `ads_read`, `business_management`, `pages_*`, `instagram_*`, `leads_retrieval`, `catalog_management` — più che sufficienti per CAPI.
- Se Meta ti chiede di generare un token CAPI dedicato (Events Manager → CAPI → Generate access token), puoi farlo: funziona allo stesso modo. Ma il token sopra è OK per produzione.

---

## 3. File pronti

Trovi nel pacchetto inoltrato da Armand (cartella `backend/` zip o Drive link):

```
backend/
├── app/services/
│   ├── __init__.py
│   └── meta_capi.py          ← drop-in module, ~200 righe Python
├── .env.addon                ← env vars da appendere al .env del backend
├── test_capi_local.py        ← validatore locale, opzionale
└── DEV_BRIEF.md              ← questo file
```

`meta_capi.py` è una versione raffinata rispetto al template tipico:
- Logging strutturato (no `print`)
- `httpx.AsyncClient` con connection pool condiviso
- `extract_client_ip()` con supporto reverse-proxy (`X-Forwarded-For`, `X-Real-IP`)
- `build_event_id()` per deduplicazione deterministica pixel↔CAPI
- Supporta `external_id`, `fbp`, `fbc` (alza match rate ~+10-15%)
- Phone normalization E.164
- Test event code via env (no hardcoding)
- **Fail-silent**: errori loggati, mai bloccano il chiamante

---

## 4. Sequenza esecuzione sul VPS

### 4.1. SSH + ispezione struttura

```bash
ssh root@srv1479321.hstgr.cloud

# Trova il path del progetto FastAPI
find / -name "main.py" -path "*holistic*" 2>/dev/null
# fallback
ls /var/www/ /home/

# Identifica il process manager attivo
ps aux | grep -E "uvicorn|gunicorn|pm2"
systemctl list-units | grep -i holistic
pm2 list 2>/dev/null
```

Annotati:
- `PROJECT_PATH` (es. `/var/www/holistic-unity-backend`)
- Process manager (PM2 / systemctl / supervisord)
- Path del `.env`
- Path del `requirements.txt`

### 4.2. Copia il modulo nel progetto

Dal local (o tramite git pull):

```bash
# Esempio via scp dal local:
scp backend/app/services/meta_capi.py \
    root@srv1479321.hstgr.cloud:$PROJECT_PATH/app/services/

# Se il progetto non ha la cartella app/services, creala:
ssh root@srv1479321.hstgr.cloud "mkdir -p $PROJECT_PATH/app/services && touch $PROJECT_PATH/app/services/__init__.py"
```

Adatta il path se la struttura del progetto è diversa (es. `src/services/`, `holistic_unity/services/`, ecc.).

### 4.3. Append env vars

```bash
ssh root@srv1479321.hstgr.cloud
cd $PROJECT_PATH
cat >> .env <<'EOF'

# Meta Conversions API
META_PIXEL_ID=1445760663897743
META_ACCESS_TOKEN=EAAXXvnZBIJygBRihs1gyelGqKYZB8xFuXUTSOPwXHhhH6ixR28vjZCeMAWS0Wp9MFMfuIL1kZCou5DMpTFWN31UWpz2r9EJ39VmG1qJ9jOvZCamGZCMWrBLwzxQwROy8ZCebC4pACY73vSZArDyP6j3HwmvDePk27QdmYPVFiKM2FiF7zJ8wdhMxmn5c9ZCp2v6qG7AZDZD
META_API_VERSION=v22.0
# Test mode: setta solo durante test, rimuovi prima del live
# META_TEST_EVENT_CODE=TESTxxxxx
EOF
```

### 4.4. Dipendenze

```bash
source .venv/bin/activate   # se usa virtualenv
pip install 'httpx>=0.27'
# aggiorna requirements.txt
echo "httpx>=0.27" >> requirements.txt
```

### 4.5. Integra le 3 chiamate negli endpoint reali

⚠️ **Adatta i path dei router ai nomi reali del progetto.** Sotto trovi gli **esempi pattern**.

#### Registrazione cliente — `CompleteRegistration`

```python
from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

@router.post("/auth/register")
async def register_user(user_data: UserCreate, request: Request):
    # ... logica esistente ...
    new_user = await create_user(user_data)

    # Meta CAPI — fire-and-forget, non blocca la response
    await send_capi_event(
        event_name="CompleteRegistration",
        event_id=build_event_id("registration", new_user.id),
        email=new_user.email,
        external_id=new_user.id,
        client_ip=extract_client_ip(request),
        client_user_agent=request.headers.get("user-agent"),
        # cookie Meta browser, se il frontend li forwarda nel body:
        fbp=user_data.fbp if hasattr(user_data, "fbp") else None,
        fbc=user_data.fbc if hasattr(user_data, "fbc") else None,
        action_source="website",  # "app" se chiamato da SwiftUI iOS
        event_source_url=str(request.url),
        custom_data={"content_name": "user_signup"},
    )
    return new_user
```

#### Onboarding pratico — `Lead`

```python
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
        custom_data={"content_name": "practitioner_onboarding"},
    )
    return practitioner
```

#### Stripe webhook — `Purchase`

```python
@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    # ... verifica firma Stripe esistente con stripe.Webhook.construct_event(...) ...

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        amount = (session["amount_total"] or 0) / 100   # Stripe: centesimi → EUR
        currency = (session.get("currency") or "eur").upper()
        customer_email = (session.get("customer_details") or {}).get("email")
        metadata = session.get("metadata") or {}

        # Action source: idealmente passato in session.metadata.source al checkout creation
        # ("web" o "ios"). Default conservativo: "website".
        source = "app" if metadata.get("source") == "ios" else "website"

        await send_capi_event(
            event_name="Purchase",
            event_id=build_event_id("purchase", session["id"]),  # deterministico → dedup
            email=customer_email,
            value=amount,
            currency=currency,
            action_source=source,
            custom_data={
                "content_name": "holistic_session",
                "content_type": "product",
                "content_ids": [metadata.get("session_type") or metadata.get("practitioner_id") or "session"],
                "num_items": 1,
            },
        )

    return {"status": "ok"}
```

### 4.6. Chiusura graceful del client httpx (best practice)

In `main.py`:

```python
from app.services.meta_capi import close_capi_client

@app.on_event("shutdown")
async def shutdown_meta_capi():
    await close_capi_client()
```

### 4.7. Riavvia il servizio

Scegli in base al process manager:

```bash
# PM2
pm2 restart holistic-unity && pm2 logs --lines 50 holistic-unity

# systemctl
systemctl restart holistic-unity-api && journalctl -u holistic-unity-api -f

# supervisord
supervisorctl restart holistic-unity

# uvicorn standalone (raro in prod)
pkill -f uvicorn && nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 > /var/log/holistic.log 2>&1 &
```

Cerca nei log la riga `[META CAPI]` per confermare che il modulo si carica senza errori.

---

## 5. Test end-to-end

### 5.1. Genera Test Event Code

1. Apri https://business.facebook.com/events_manager2/list/pixel/1445760663897743/test_events
2. Tab **Test Events** → in alto a destra "**Test browser events**" → copia il codice (es. `TEST73891`)

### 5.2. Attiva test mode sul VPS

```bash
ssh root@srv1479321.hstgr.cloud
cd $PROJECT_PATH
# decommenta o aggiungi la riga
sed -i 's/^# META_TEST_EVENT_CODE=.*/META_TEST_EVENT_CODE=TEST73891/' .env
# restart del servizio
pm2 restart holistic-unity
```

### 5.3. Esegui scenari di test

In ordine, fai:
1. **Registrazione cliente** (sul sito o app iOS dev build)
2. **Registrazione pratico** (form pratico)
3. **Acquisto di test** (Stripe test mode → carta `4242 4242 4242 4242`)

Per ogni azione, entro 60 secondi vedi l'evento apparire in Events Manager → Test Events con:
- ✅ `Event name`: CompleteRegistration / Lead / Purchase
- ✅ `Match quality`: target > 6.0 (verde)
- ✅ `Server` come sorgente

### 5.4. Validation matchback

In Events Manager → Holistic Unity Pixel → Overview, dopo 24h vedi:
- **Match rate**: target > 70%
- **Event match quality**: target > 6.5
- **Customer Information Parameters (CIP)**: dovresti vedere `em` (email), `external_id`, `client_ip_address`, `client_user_agent` come "Connected"

### 5.5. Disattiva test mode → vai live

```bash
sed -i 's/^META_TEST_EVENT_CODE=.*/# META_TEST_EVENT_CODE=/' .env
pm2 restart holistic-unity
```

---

## 6. Lato frontend — opzionale, ma alza il match rate

Il PDF originale dice "pixel web traccia solo PageView". Quindi al momento gli eventi `CompleteRegistration` / `Lead` / `Purchase` vanno **solo via CAPI**, niente fratello pixel → **nessuna deduplicazione necessaria**.

Se vuoi alzare il match rate (~+15%), puoi opzionalmente:

### 6.1. Forwarda i cookie Meta dal frontend al backend

I cookie `_fbp` e `_fbc` sono settati dal pixel JS sul browser. Inviati con la registrazione, Meta riesce a collegare la conversione server-side al click pubblicitario originale.

**Frontend (JS web)**:

```js
function readCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? m[2] : null;
}

// Quando l'utente si registra:
fetch("/auth/register", {
  method: "POST",
  body: JSON.stringify({
    ...userPayload,
    fbp: readCookie("_fbp"),
    fbc: readCookie("_fbc"),
  }),
});
```

**Backend (Pydantic schema)**:

```python
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    # ... altri campi ...
    fbp: Optional[str] = None
    fbc: Optional[str] = None
```

Poi pass `fbp=user_data.fbp, fbc=user_data.fbc` a `send_capi_event(...)`.

### 6.2. Pixel JS sul sito — aggiungi tracking di PageView con event_id (no duplicati)

Se in futuro vuoi che il pixel web tracci anche `CompleteRegistration` lato browser, **usa lo stesso event_id** generato dal backend:

```js
// dopo signup, il backend ritorna anche un event_id nella response:
const eventId = response.event_id;  // "registration_42"

fbq('track', 'CompleteRegistration', {}, { eventID: eventId });
```

Meta vedrà 2 eventi (uno da pixel, uno da CAPI) con stesso event_id → dedupplica automaticamente. Vince la versione con più dati (di solito CAPI).

---

## 7. Lato iOS — opzionale

Per gli eventi che originano dall'app iOS (signup via SwiftUI, in-app purchase, ecc.):

- Usa `action_source="app"` quando chiami il backend dall'app
- Idealmente passa al backend un identifier device (IDFA con consenso ATT, o `idfv` come fallback) → mettilo in `external_id` o `madid` lato CAPI

Il backend già supporta `action_source="app"`. Verifica che le richieste dall'app iOS includano un header custom tipo `X-Source: ios` o passino `source: "ios"` nel body, così il backend distingue.

Esempio:

```python
source_header = request.headers.get("x-source", "").lower()
action_source = "app" if source_header == "ios" else "website"

await send_capi_event(
    event_name="CompleteRegistration",
    # ...
    action_source=action_source,
)
```

---

## 8. FAQ / Edge cases

### Q: Devo gestire retry su fail?
**A**: No, il modulo fallisce silenziosamente con log. Per Holistic Unity la perdita occasionale di un evento è accettabile (Meta tollera fino a ~5% di missing senza degrado attribution). Se in futuro vuoi retry, usa Celery/RQ con backoff esponenziale.

### Q: Cosa succede se Meta è down?
**A**: Timeout dopo 5s, log warning, response al client invariata. Nessun blocco utente.

### Q: Devo registrare gli event_id da qualche parte (Supabase)?
**A**: Non obbligatorio. Gli event_id sono deterministici (`build_event_id("registration", user.id)`) — se il sistema rigenera lo stesso evento, Meta dedupplica.

### Q: GDPR consent?
**A**: Gli hash SHA-256 di email/phone sono conformi GDPR (irreversibili). MA: assicurati che i T&C / Privacy Policy di Holistic Unity menzionino:
> "I dati di registrazione e acquisto possono essere condivisi in forma pseudonimizzata (hash) con piattaforme pubblicitarie (Meta) per misurare l'efficacia delle campagne marketing."

Se l'utente nega il consenso pubblicitario, **NON chiamare** `send_capi_event(...)` (o passa solo `external_id` senza email/phone).

### Q: Come gestisco utenti che richiedono cancellazione dati (GDPR Art. 17)?
**A**: Meta CAPI non consente di "richiamare" eventi passati direttamente. Devi:
1. Eliminare l'utente dal DB Supabase
2. Smettere di inviare eventi per quel `external_id`
3. (Opzionale) Inviare un evento `Custom` a Meta con `event_name=opt_out` + `external_id` dell'utente

### Q: Action_source per Stripe webhook è ambiguo
**A**: Stripe webhook arriva sempre dal server di Stripe, non dall'utente. L'`action_source` deve riflettere **dove l'utente ha fatto il checkout**, non da dove arriva la chiamata API:
- Web checkout (Stripe Checkout hosted page o Elements su sito) → `website`
- iOS in-app Stripe SDK → `app`

Soluzione pulita: nel momento della **creazione** della Checkout Session lato backend, includi `metadata={'source': 'ios'|'web'}`. Poi nel webhook leggi `session.metadata.source` e mappa.

### Q: Posso vedere se gli eventi arrivano davvero?
**A**: Sì, 3 modi:
1. **Realtime**: Events Manager → Test Events con `META_TEST_EVENT_CODE` settato
2. **Overview**: Events Manager → Overview, vedi i conteggi degli ultimi 7 giorni
3. **Logs**: cerca `[META CAPI]` nei log del backend, ogni evento ha `received=1` o `received=0`

---

## 9. Checklist deploy

- [ ] SSH al VPS funzionante
- [ ] `meta_capi.py` copiato in `app/services/`
- [ ] 3 env vars aggiunte a `.env`
- [ ] `httpx>=0.27` in `requirements.txt` + installato
- [ ] Integrazione in `/auth/register` (CompleteRegistration)
- [ ] Integrazione in `/practitioners/register` (Lead)
- [ ] Integrazione in `/webhooks/stripe` (Purchase)
- [ ] `close_capi_client()` registrato su shutdown
- [ ] Restart del servizio
- [ ] Test Event Code attivato + 3 scenari testati in Events Manager
- [ ] Match Quality > 6.0 per ogni evento
- [ ] Test Event Code rimosso dal `.env` → live

---

## 10. Contatti

Per chiarimenti tecnici sul codice o sul payload Meta:
- **Slack**: #holistic-unity-marketing
- **Email**: armand@stormxdigital.com
- **Doc Meta CAPI**: https://developers.facebook.com/docs/marketing-api/conversions-api/

Quando hai finito, mandami uno screenshot di Events Manager → Test Events con i 3 eventi verdi, così confermiamo che siamo pronti per il go-live del 7 giugno.

Buon deploy 🚀
