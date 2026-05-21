# Holistic Unity — Pacchetto Handover Developer

**Generato il 2026-05-18 · per il developer che subentra a Marcello**

Benvenuto. Questa cartella contiene tutto ciò che serve per prendere in mano lo sviluppo di **Holistic Unity** (marketplace italiano di operatori olistici): iOS app, 3 web app, sito marketing, backend Supabase, integrazioni terze parti, audit di sicurezza, schermate per App Store, e guide operative.

---

## ⚡ Inizia da qui (5 minuti)

1. Apri **`01_START_HERE/00_LEGGI_PRIMA_QUESTO.md`** — è il documento master di 1014 righe che spiega tutta l'architettura, gli stack, le credenziali, i flussi business e i bug noti.
2. Poi apri **`01_START_HERE/01_TASK_LIST_PRELANCIO.md`** — è la tua **lista di lavoro per le prime 3 settimane** (7 macro-aree con deliverable concreti, criteri di accettazione, tempi stimati).
3. Poi vai a **`02_Documentation/06_DEVELOPER_ONBOARDING.md`** per i passi `git clone → npm install → bun run dev` di ogni progetto.
4. Quando sei pronto a sbloccare la submission App Store, leggi **`04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md`**.

---

## 📁 Struttura della cartella

```
_DEVELOPER_HANDOVER/                    (~191 MB totali)
├── README.md                           ← questo file
│
├── 01_START_HERE/                      Documenti master da leggere per primi
│   ├── 00_LEGGI_PRIMA_QUESTO.md       (55 KB · panoramica completa del progetto)
│   └── 01_TASK_LIST_PRELANCIO.md      ★ Lista lavoro 7 aree per le prime 3 settimane
│
├── 02_Documentation/                   Tutta la documentazione tecnica esistente
│   ├── 01_ARCHITECTURE.md             Schema architetturale dettagliato
│   ├── 02_DEPLOYMENT_GUIDE.md         Come fare deploy su Vercel/App Store
│   ├── 03_CREDENTIALS.md              Inventario credenziali (chi ha cosa)
│   ├── 04_DATABASE_SCHEMA.md          Schema Postgres dettagliato
│   ├── 05_STATUS_TRACKER.md           Stato avanzamento features
│   ├── 06_DEVELOPER_ONBOARDING.md     ★ Setup ambiente di sviluppo
│   ├── FLOWS.md                       Flussi business (booking, payment, payout)
│   ├── HANDOVER_2026-05-18.md         Copia del doc master (per riferimento)
│   ├── HOLISTIC_UNITY_KNOWLEDGE_BASE.md
│   ├── IMPROVEMENTS.md                Roadmap miglioramenti suggeriti
│   ├── PAYMENT_MODEL.md               Modello Stripe Connect + IVA + commissioni
│   ├── PRE_DEPLOYMENT_QA.md           Checklist QA prima di ogni release
│   ├── Pre_Submission_Checklist.md    Checklist App Store
│   ├── SECURITY_AUDIT.md              Audit storici
│   ├── SECURITY_RULES.md              RLS policies + best practices
│   ├── STRIPE_LIVE_MIGRATION.md       Procedura migrazione test → live
│   ├── THERAPIST_PROFILE_MAPPING.md   Mapping campi profilo operatore
│   └── legacy_docs_folder/             Documentazione archiviata
│
├── 03_Security_and_Audits/             Audit eseguiti 2026-05-18 + fix SQL pending
│   ├── AUDIT_REPORT_2026-05-18.md     Report dettagliato con 8 fix + 9 bug
│   ├── FINAL_REPORT_2026-05-18.md     Report finale post-fix
│   ├── 2026-05-18_critical_security_fixes.sql   ⚠️ DA ESEGUIRE IN SUPABASE
│   └── 2026-05-18_db_migrations.sql              ⚠️ DA ESEGUIRE IN SUPABASE
│
├── 04_App_Store_Submission/            Materiali per submission App Store
│   ├── APP_STORE_SUBMISSION_WALKTHROUGH.md   Procedura step-by-step
│   ├── App_Review_Notes.md            Note per il reviewer Apple (credenziali test)
│   ├── App_Store_Metadata.md          Descrizione, keywords, categorie
│   ├── MICROSOFT_OUTLOOK_SECRET_REGEN.md   Procedura rotazione client secret
│   └── privacy-policy.html             Privacy policy versione HTML
│
├── 05_IG_Guide_Screenshots/            Screenshot per guida Instagram clienti
│   └── IG_Onboarding_Guide/           29 MB di screenshot dell'onboarding
│
├── 06_App_Store_Screenshots/           Screenshot 6.9" per App Store Connect
│   ├── AppStore_Screenshots_6_9inch/   4 PNG a 1320×2868 (iPhone 17 Pro Max)
│   │   ├── 01_home.png                Schermata home con saluto "Ciao Apple"
│   │   ├── 02_explore.png             Esplora operatori con filtri
│   │   ├── 03_marcello_profile.png    Profilo operatore con bio
│   │   └── 04_account.png             Schermata account
│   └── AppIcon/                        Icona 1024×1024 master
│
├── 07_Database_Migrations/             Snapshot dello schema Postgres
│   ├── supabase_schema.sql            Schema completo current
│   ├── all_migrations_pg/              Cronologia migrations applicate
│   ├── legacy_initial_schema.sql       Schema iniziale (riferimento storico)
│   └── supabase_push_notification_migration.sql
│
└── 08_Codebases/                       I 5 codebases pronti per git clone   (135 MB)
    ├── iOS_App/                        SwiftUI iOS 17.6+ · "Backup 6 Aprile"
    │                                   Bundle: Holistic-Unity-Healing       (28 MB)
    ├── client-webapp/                  Next.js 16 · clienti web             (17 MB)
    ├── therapist-webapp/               Next.js 16 · operatori web           (14 MB)
    ├── admin-dashboard/                Next.js 16 · dashboard interna       (4.7 MB)
    └── holistic-unity-website/         Next.js 16 · sito marketing          (72 MB)
```

`node_modules/`, `.next/`, `build/`, `DerivedData/` sono stati esclusi durante la copia. Esegui `npm install` (o `bun install`) in ogni codebase prima del primo `dev`.

---

## 🚨 AZIONI URGENTI PRIMA DELLA SUBMISSION APP STORE

Due cose **devono essere fatte da Marcello** (richiedono accesso owner Supabase) prima che la nuova versione possa essere submitted:

### 1. Eseguire il fix GDPR sul database Supabase
File: `03_Security_and_Audits/2026-05-18_critical_security_fixes.sql`

Risolve una **fuga GDPR critica**: la tabella `public.therapist_profiles` era leggibile da `anon` e esponeva codice fiscale + P.IVA + Stripe Connect IDs di tutti gli operatori a chiunque avesse la `anon_key` (visibile nel binario iOS e nel bundle web).

**Come eseguirla:**
1. Login su `https://supabase.com/dashboard` (account Marcello)
2. Seleziona il progetto `bqyqkvkzkemiwyqjkbna` ("Holistic New")
3. SQL Editor → New Query → incolla il contenuto del file → Run
4. Verifica con `curl 'https://bqyqkvkzkemiwyqjkbna.supabase.co/rest/v1/therapist_profiles?select=codice_fiscale' -H "apikey: <anon_key>"` — deve restituire `[]` o errore di permessi

### 2. Eseguire le migrations per Report + Block users + trigger
File: `03_Security_and_Audits/2026-05-18_db_migrations.sql`

Crea le tabelle `reports` e `blocked_users` (richieste da Apple guideline 1.2 per UGC), più 2 trigger:
- `sync_email_verification_to_users` — sincronizza `auth.users.email_confirmed_at` → `public.users.is_email_verified`
- `auto_confirm_free_bookings` — conferma automaticamente le sessioni conoscitive gratuite (€0) invece di lasciarle in `pending_payment`

Stessa procedura del punto 1 (SQL Editor → Run).

---

## 📦 Come consegnare questa cartella al developer

Opzioni in ordine consigliato:

| Opzione | Quando usarla | Comando / azione |
|---------|---------------|------------------|
| **ZIP + Google Drive / WeTransfer** | Default — più semplice | Tasto destro sulla cartella `_DEVELOPER_HANDOVER` → Comprimi → upload del .zip |
| **Cartella condivisa Google Drive / Dropbox** | Se il developer è già nel tuo workspace | Trascina la cartella, condividi con il developer (sola lettura per ora) |
| **USB / SSD esterno** | Consegna in persona | Copia con Finder (~191 MB, ci sta su qualsiasi pennetta) |
| **Repository Git privato** | Se vuoi audit trail di chi accede a cosa | Crea repo privato su GitHub, push iniziale, invita il developer |

⚠️ **Prima di condividere**: questa cartella contiene **credenziali sensibili** (Supabase URLs, project IDs, e riferimenti a chiavi service_role nei docs di onboarding). Condividi solo con il developer che hai effettivamente assunto, tramite canale privato. Non caricare su un Drive pubblico. Considera di:
- Rimuovere `03_CREDENTIALS.md` da `02_Documentation/` e consegnarlo separatamente via 1Password/Bitwarden
- Far firmare un NDA prima della consegna

---

## 🔑 Cosa NON è in questa cartella (e dove trovarlo)

| Cosa | Dove | Note |
|------|------|------|
| Chiave service_role Supabase | `/Users/marcello/Desktop/Holistic Unity/admin-dashboard/.env.local` | Mai committare. Trasferire via password manager |
| Chiavi Stripe LIVE secret | Dashboard Stripe → Developers → API keys | `sk_live_...` — solo persone autorizzate |
| APNs auth key (.p8) | Apple Developer Portal → Keys | Già scaricato? Verifica file `~/Downloads/AuthKey_*.p8` |
| Brevo API key | https://app.brevo.com → SMTP & API | Per email transazionali |
| Sentry DSN | https://sentry.io → Settings → Client Keys | Già committato come `SENTRY_DSN` in `.env` |
| FattureInCloud OAuth client_secret | https://developers.fattureincloud.it | Per generazione fatture operatori |
| LiveKit API secret | https://cloud.livekit.io | API key + secret per video sessions |
| GitHub access ai repo Vercel | Inviti devono essere mandati uno per uno | I 4 progetti Next.js sono già su Vercel team `team_6BCebq1X0b1Ogw2VnMWrVZkM` |

→ Vedi `02_Documentation/03_CREDENTIALS.md` per l'inventario completo + le procedure di rotazione.

---

## 📞 Contatti

- **Marcello** — owner, product, fondatore
- **Marketplace live** — `https://holisticunity.app`
- **App iOS** — Bundle ID `Holistic-Unity-Healing`, team Apple Developer di Marcello
- **Supabase project** — `bqyqkvkzkemiwyqjkbna` ("Holistic New")
- **Vercel team** — `team_6BCebq1X0b1Ogw2VnMWrVZkM`

---

## ✅ Checklist prima di iniziare lo sviluppo

Per il developer, primi 3 giorni:

- [ ] Leggi `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` completo (1-2 ore)
- [ ] Setup ambiente: vedi `02_Documentation/06_DEVELOPER_ONBOARDING.md`
- [ ] `git clone` di tutti i 5 codebase (oppure copia da `08_Codebases/` se preferisci partire da snapshot)
- [ ] Esegui `npm install` (o `bun install`) in ogni codebase Next.js
- [ ] Apri `iOS_App/Holistic Unity.xcodeproj` in Xcode 16.4+, fai un build di test sul simulatore iPhone 17 Pro Max
- [ ] Ottieni da Marcello: invito Supabase, invito Vercel, invito Apple Developer team, invito Stripe Connect, chiave service_role via password manager
- [ ] Verifica accesso a tutti i servizi terzi (Brevo, LiveKit, Stream Chat, Sentry, FattureInCloud, Google Analytics)
- [ ] Leggi `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` per capire i bug aperti
- [ ] Conferma con Marcello che i 2 file SQL sono stati eseguiti su Supabase
- [ ] Submission App Store: segui `04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md`

---

**Buon lavoro 🌱**
