# Microsoft Outlook OAuth — Rigenerazione Client Secret

**Problema:** GAP 8 dal `THERAPIST_PROFILE_MAPPING.md` — connessione Outlook restituisce `401 Failed to fetch Microsoft profile` perché il client secret su Azure è scaduto.

**Questa operazione richiede un'azione manuale** sul portale Azure — non può essere fatta da codice. Segui i passi qui sotto.

---

## 1. Rigenerare il secret su Azure Portal

1. Vai su https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
2. Apri la registrazione app usata per Holistic Unity Outlook integration (nome tipico: `Holistic Unity Calendar`)
3. Menu sinistro → **Certificates & secrets**
4. Sezione **Client secrets** → **+ New client secret**
5. Description: `holistic-unity-prod-2026`
6. Expires: **24 months** (massimo consigliato)
7. **Copia subito il valore `Value`** (non `Secret ID`) — non sarà più visibile dopo aver chiuso la pagina

---

## 2. Aggiornare i secrets locali e su Vercel

### File locale
Aggiorna `.env.local` nella cartella `therapist-webapp`:

```bash
MICROSOFT_CLIENT_SECRET=<il-nuovo-valore-copiato>
```

### Vercel (production)

```bash
cd "/Users/marcello/Desktop/Holistic Unity/therapist-webapp"

# Rimuovi il vecchio secret
vercel env rm MICROSOFT_CLIENT_SECRET production

# Aggiungi il nuovo (incolla quando richiesto)
vercel env add MICROSOFT_CLIENT_SECRET production
```

Ripeti anche per `preview` e `development` se vuoi testare in staging.

---

## 3. Redeploy

```bash
vercel --prod
```

---

## 4. Verifica

1. Login nella dashboard come terapista di test
2. Apri `https://therapistportal.holisticunity.app/dashboard/settings`
3. Click su "Collega Outlook"
4. Completa il flow OAuth Microsoft
5. Redirect deve essere `?calendar=microsoft&status=connected` — non `status=error`

Se ancora errore 401: controlla che nella app registration Azure, i **Redirect URIs** includano:
- `https://therapistportal.holisticunity.app/api/calendar/microsoft/callback`
- `http://localhost:3000/api/calendar/microsoft/callback` (solo dev)

E che i **API Permissions** abbiano consenso admin per:
- `Calendars.ReadWrite` (Microsoft Graph, delegato)
- `offline_access`
- `User.Read`

---

## 5. Promemoria scadenza

I client secret Azure scadono max 24 mesi. Imposta un reminder nel calendario 30 giorni prima della scadenza per rigenerare.

Data prossima scadenza: **Aprile 2028** (se hai scelto 24 mesi oggi).
