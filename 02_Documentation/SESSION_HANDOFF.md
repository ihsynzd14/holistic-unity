# Holistic Unity — Session Handoff

**Data:** 16 Aprile 2026
**Progetto:** Holistic Unity — Therapist Marketplace (iOS + Web + Supabase)

---

## Struttura progetto

| Componente | Path |
|-----------|------|
| **iOS App (attivo)** | `/Users/marcello/Desktop/Holistic Unity/iOS App/untitled folder/Backup 6 Aprile/` |
| **Therapist Webapp** | `/Users/marcello/Desktop/Holistic Unity/therapist-webapp/` |
| **Admin Dashboard** | `/Users/marcello/Desktop/Holistic Unity/admin-dashboard/` |
| **Website** | `/Users/marcello/Desktop/Holistic Unity/holistic-unity-website/` |
| **Supabase Edge Functions** | `...Backup 6 Aprile/supabase/functions/` |
| **Supabase Migrations** | `...Backup 6 Aprile/supabase/migrations/` |

### Credenziali

| Servizio | Dettaglio |
|----------|-----------|
| Supabase Project Ref | `bqyqkvkzkemiwyqjkbna` |
| Supabase Access Token | `sbp_08304c4c32a5c45b60a101b03a98897e8476e003` |
| Supabase Anon Key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxeXFrdmt6a2VtaXd5cWprYm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODU3NjksImV4cCI6MjA4ODU2MTc2OX0.q6c0KgCzoQFSXjsi26TCkjB-pLlxLcItXnQbRLubL7M` |
| Supabase Service Role | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxeXFrdmt6a2VtaXd5cWprYm5hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjk4NTc2OSwiZXhwIjoyMDg4NTYxNzY5fQ.3iYVvKCPTcSBf4546yEPOHee-sk5TDn7efw3bSdmpNU` |
| Therapist Portal URL | `https://therapistportal.holisticunity.app` |
| Vercel (webapp) | `therapist-webapp-tau.vercel.app` |
| Stream Chat API Key | `dx6gpjra45gt` |
| LiveKit URL | `wss://holistic-unity-7cj033ty.livekit.cloud` |

### Test Users

| User | Email | Role | ID |
|------|-------|------|----|
| Client Marcello | `marcellodipierro@outlook.com` | client | `c8d2ba81-3d92-4a13-9fca-4520d6f8cb64` |
| Therapist Marcello | `marcello@b2bstormxdigital.com` | therapist | `5879f194-dfbb-4a75-8b9c-810c1d717443` |
| Dr. Rossi (test) | `dr.rossi.test@holisticunity.app` | therapist | `37ac8607-4017-42af-ae15-6a6ed1c03954` |
| Therapist Marcello password | `HolisticUnity2026!` | — | — |

---

## Cosa è stato completato in questa sessione

### Security
- ✅ Security audit completo (45 controlli) → `SECURITY_AUDIT.md`
- ✅ Security rules file → `SECURITY_RULES.md`
- ✅ 3 INSERT policy permissive droppate (conversation_participants, notifications, conversations)
- ✅ CHECK constraint `price >= 0` su bookings e therapist_services
- ✅ Verifica prezzo server-side in `create-booking-with-payment` (anti price-tampering)
- ✅ CORS whitelist su tutte le 18 edge functions (incluso `therapistportal.holisticunity.app`)
- ✅ CSP aggiornata: aggiunto `*.stream-io-api.com` per far funzionare la chat

### Payment Model (v3.0)
- ✅ Documento completo → `PAYMENT_MODEL.md`
- ✅ Processing fee: 2.5% + €0.25 (UK rate) addebitata al cliente
- ✅ Commissione piattaforma: 20% IVA inclusa
- ✅ IVA quota calcolata nei metadata (commissione/1.22 per terapisti IT)
- ✅ Refund policy: 100% se ≥48h, 0% se <48h
- ✅ Costanti legacy (2.9% + €0.30) rimosse
- ✅ Supporto single session + pack nella stessa edge function (price verification accepts both)

### Video Call (4 fix)
- ✅ Sessione visibile tutto il giorno per rejoin (iOS + webapp + edge function)
- ✅ Screen share: iOS client mostra lo schermo del terapista
- ✅ Controlli espliciti nella webapp (mic, camera, screen share, end session)
- ✅ Call in nuova tab (non si interrompe navigando nella webapp)
- ✅ Rejoin 3h per sessioni accidentalmente completate
- ✅ `onDisconnected` non marca più come completed — mostra "Reconnect?"

### Calendar Sync
- ✅ Google Calendar collegato (redirect URI aggiornato + client secret rinnovato)
- ✅ Scrittura automatica eventi su Google Calendar quando booking confermato (webhook)
- ✅ Supporto Microsoft Outlook (stesso pattern nel webhook)
- ⚠️ Microsoft Outlook: errore 401 al fetch profilo — client secret potrebbe essere scaduto su Azure

### UI/UX
- ✅ Logo lotus impostato come app icon iOS (1024x1024, no alpha)
- ✅ Logo in-app per webapp/dashboard/website
- ✅ Colori unificati: `#7B2252` (berry) su tutte le piattaforme
- ✅ Favicon creato per webapp
- ✅ Chat UI migliorata (padding input, bubble radius, scrollbar, font bianco su messaggi uscita)
- ✅ Booking summary: mostra "60 min Session" per single, "Pack of 4" per pack
- ✅ Fee breakdown mantenuta dopo payment cancel (non si resetta)
- ✅ Opzione "Single Session" aggiunta per servizi pack

### Testing
- ✅ 48 unit test (SessionCredit, BookingPaymentRequest, PurchaseOption, BookingModel, FeeBreakdown, etc.)
- ✅ Test target Xcode creato con xcodeproj gem
- ✅ iOS build: BUILD SUCCEEDED
- ✅ Webapp build: Compiled successfully

### Deploy
- ✅ 18 edge functions deployate su Supabase
- ✅ Webapp deployata su Vercel (therapistportal.holisticunity.app)
- ✅ DB migrations applicate (UNIQUE constraint, RLS, credit RPC, security hardening)

---

## Problemi aperti da risolvere

### 1. Slot disponibilità — possibile bug buffer
Lo slot 15:00-16:00 (3 PM) appare come disponibile. Se nell'app iOS appare anche 16:00-17:00 (4 PM), è un bug perché sovrappone con il meeting Google Calendar delle 16:30-17:30. Verificare:
- Il file è `/Users/marcello/Desktop/Holistic Unity/iOS App/supabase/functions/get-available-slots/index.ts`
- La logica di overlap detection è nelle righe ~300-310 della funzione `generateSlots()`
- Il buffer di 15 min viene aggiunto sia prima che dopo ogni busy period
- Potrebbe esserci un mismatch nel deploy: `get-available-slots` è nel repo **principale** (`/iOS App/supabase/functions/`), NON nel Backup 6 Aprile

### 2. Microsoft Outlook Calendar — error 401
- Errore: `Failed to fetch Microsoft profile: 401`
- Il token exchange funziona ma l'access token ottenuto non è valido per Microsoft Graph
- Possibile causa: il client secret di Azure è scaduto (Azure secrets hanno scadenza)
- Da verificare nel portale Azure: App registrations → Holistic Unity Calendar → Certificates & secrets
- Se scaduto, creare un nuovo secret e aggiornarlo in `.env.local` + Vercel

### 3. Chat/Messaggi — Stream Chat
- La chat funziona ora (CSP fixata) ma il font bianco sui messaggi in uscita potrebbe necessitare verifica
- La pagina messaggi ha il pulsante "Riprova" se la connessione fallisce

### 4. Pagamento end-to-end
- Il flow di pagamento funziona (prezzo verificato server-side, processing fee 2.5%+€0.25)
- PaymentSheet si presenta correttamente
- Il webhook crea la transazione + crediti per pack + evento Google Calendar
- Da testare: completare un pagamento reale con test card e verificare che tutto si registri nel DB

### 5. TestFlight / App Store
- Build iOS compila con successo
- Privacy Policy URL necessaria per App Store
- App Store screenshots da creare
- Privacy label da configurare in App Store Connect

---

## File di documentazione

| File | Contenuto |
|------|-----------|
| `SECURITY_AUDIT.md` | Audit di sicurezza completo (45 controlli) |
| `SECURITY_RULES.md` | Regole security per il futuro (mandatory/forbidden patterns, grep checks) |
| `PAYMENT_MODEL.md` | Modello pagamenti v3.0 (fee, commissioni, IVA, refund, crediti) |

---

## Comandi utili

```bash
# Build iOS
cd "/Users/marcello/Desktop/Holistic Unity/iOS App/untitled folder/Backup 6 Aprile"
xcodebuild build -project "Holistic Unity.xcodeproj" -scheme "Holistic Unity" -destination "platform=iOS Simulator,name=iPhone 17 Pro"

# Build + deploy webapp
cd "/Users/marcello/Desktop/Holistic Unity/therapist-webapp"
npm run build && vercel --prod --yes

# Deploy edge function
cd "/Users/marcello/Desktop/Holistic Unity/iOS App/untitled folder/Backup 6 Aprile"
SUPABASE_ACCESS_TOKEN="sbp_08304c4c32a5c45b60a101b03a98897e8476e003" supabase functions deploy <function-name> --project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt

# Run unit tests
xcodebuild test -project "Holistic Unity.xcodeproj" -scheme "Holistic Unity" -destination "platform=iOS Simulator,name=iPhone 17 Pro" -only-testing:"Holistic UnityTests"

# Query Supabase DB
curl -s -X POST "https://api.supabase.com/v1/projects/bqyqkvkzkemiwyqjkbna/database/query" \
  -H "Authorization: Bearer sbp_08304c4c32a5c45b60a101b03a98897e8476e003" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT ..."}'
```
