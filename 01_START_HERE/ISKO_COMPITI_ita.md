# Isko Compiti - Holistic Unity Pre-lancio

**Stima totale: 95-129 ore**

---

## 1. Sicurezza (8-12 ore)
- [ ] Eseguire `2026-05-18_critical_security_fixes.sql` in Supabase Dashboard (Leak GDPR PII terapeuti)
  → ref: `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §11.5, §13.1
- [ ] Eseguire `2026-05-18_db_migrations.sql` (tabelle `reports` + `blocked_users` + 2 trigger)
  → ref: `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §6.1, §13.1
- [ ] Rotazione di tutte le credenziali (Stripe, Supabase, Brevo, LiveKit, Stream Chat, FattureInCloud)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Audit RLS completo su ogni tabella `public.*` - nessun dato deve essere visibile tramite anon key
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Verifica policy degli storage bucket (profile-photos, chat-media, video-intros, certificates)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Pen test rapido (5 attacchi: XSS email, booking cross-user, prezzo negativo, rate limit reports, lettura `auth.users`)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Verifica e aggiunta security headers in tutte le webapp - target securityheaders.com = A
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §2
- [ ] Decisione TrustKit certificate pinning: `reporting mode` → `enforce mode` (sì/no con motivazione)
  → ref: `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §11.3

---

## 2. QA - Testing di tutti i flow (10-15 ore)
- [ ] F1-F20: tutti i flow cliente (sign-up email/Apple/Google, booking, pagamento, cancellazione, video, chat, review, report, blocco, eliminazione account)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4
- [ ] F21-F35: tutti i flow terapeuta (onboarding, Stripe Connect, profilo, disponibilità, FattureInCloud, payout, video)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4
- [ ] F36-F42: cron jobs e webhook Stripe (payment_intent.succeeded, charge.refunded, reminder 24h/1h, invoice FIC)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4
- [ ] Compilare `QA_MATRIX_2026-XX-XX.md` - 42 righe con stato ❓/✅ + screenshot
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §4

---

## 3. Performance (15-20 ore)
- [ ] Audit di ogni `AsyncImage` in app iOS - applicare `.supabaseThumbnail(size:)` con dimensioni corrette per ogni utilizzo
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Misurare cold start iOS con Instruments prima e dopo (target < 1.5s)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Sostituire tutte le query `select("*")` in Supabase con select esplicite dei soli campi usati
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Lighthouse audit su 4 pagine chiave della client-webapp (target Performance = 85, Accessibility = 90)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Verificare uso di `next/image` ovunque (zero `<img>` in src/)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Audit query lente in Supabase (Dashboard → Reports → Slow queries) - verificare Index Scan su `getNearbyTherapists`, `getBookingsForUser`, `searchTherapists`
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3
- [ ] Produrre `PERFORMANCE_REPORT_2026-XX-XX.md` con tabella prima/dopo
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §3

---

## 4. Setup Sentry (6-8 ore)
- [ ] Creare 4 progetti Sentry: iOS, client-web, therapist-web, admin-web
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Configurare DSN in Vercel env (3 webapp) e `Secrets.xcconfig` (iOS)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Configurare upload automatico source maps ad ogni deploy
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Impostare Alert: email a Marcello per ogni nuovo errore severity Error e se frequenza > 50/ora
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Configurare PII scrubbing in `beforeSend` (no email, no payment intent ID, no JWT)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5
- [ ] Produrre `SENTRY_RUNBOOK.md` con screenshot di almeno 1 test event per progetto
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §5

---

## 5. Routine Mattutina Errori (4-6 ore setup, poi 15m/giorno)
- [ ] Creare script per aggregare: Sentry, Vercel logs, Supabase logs, Stripe API, App Store Connect
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §6
- [ ] Schedulare invio automatico alle 08:00 AM via GitHub Actions (o Vercel Cron)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §6
- [ ] Produrre `MONITORING_RUNBOOK.md` con il primo report di esempio
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §6

---

## 6. Audit Email (8-12 ore)
- [ ] Verificare 15 email cliente (C1-C15): arrivano entro 60s, HTML corretto, link funzionanti
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] Verificare 17 email terapeuta (T1-T17): arrivano entro 60s, HTML corretto, link funzionanti
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] Verificare 4 email admin (A1-A4)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] Verifica DNS: SPF, DKIM (`brevo._domainkey.holisticunity.app`), DMARC - tutti devono essere in pass
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] Test su mail-tester.com - target score = 9/10
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] Creare/aggiustare template Brevo mancanti o errati
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7
- [ ] Produrre `EMAIL_AUDIT_2026-XX-XX.md` - matrice di 36 righe con lo stato di ogni email
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §7

---

## 7. Code review e bug iOS (12-16 ore)
- [ ] iOS: Verifica gestione errori in tutti i Repository (niente `try?` su operazioni critiche)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] iOS: Verifica corretto `@MainActor` su tutto ciò che tocca la UI
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] iOS: Verifica logica di reconnection `LiveKitService` (se cade la rete durante la sessione)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] iOS: Verifica memory leak `StreamChatService` (controller non rilasciati)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] Edge Functions: Ogni function eccetto `stripe-webhook` deve avere `verify_jwt: true`
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1, `01_START_HERE/00_LEGGI_PRIMA_QUESTO.md` §6.2
- [ ] Webapp: Verifica che `SUPABASE_SERVICE_ROLE_KEY` non sia mai referenziata nel codice client
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] Webapp: Presenza di `requireAuth()` come prima riga nelle Server Actions
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] Produrre `CODE_REVIEW_2026-XX-XX.md` con bug divisi per categoria (Critical / High / Medium / Low)
  → ref: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` §1
- [ ] BUG #2 iOS: In `SupabaseAuthRepository.swift` (`fetchUserProfile`), sovrascrivere `isEmailVerified` leggendo `client.auth.currentSession?.user.emailConfirmedAt != nil` come singola fonte di verità (il `public.users.is_email_verified` a db potrebbe essere desincronizzato per i vecchi utenti)
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-2
- [ ] BUG #4 Free booking (€0): In `create-booking-with-payment/index.ts`, gestire il caso `sessionPriceCents === 0`: fare lo skip della logica Stripe e inserire direttamente il booking con `status='confirmed'` (evitando che resti `pending_payment`)
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-4

---

## 8. Sicurezza - fix extra audit (4-6 ore)
- [ ] Fix Price tampering: `create-booking-with-payment` non valida il prezzo lato server contro il db - il client può inviare qualsiasi importo nel payload
  → ref: `02_Documentation/SECURITY_AUDIT.md` §price-tampering
- [ ] Randomizzare in modo crittografico lo state OAuth: sostituire la generazione di `OAUTH_STATE_SECRET` con `crypto.getRandomValues` (attualmente non abbastanza random)
  → ref: `02_Documentation/SECURITY_AUDIT.md` §oauth-state, `02_Documentation/legacy_docs_folder/INCIDENT_RESPONSE.md` §2.6
- [ ] Aggiungere validazione MIME lato server per upload file (attualmente solo lato client) - edge in `Storage` per scartare i file con content-type non consentiti
  → ref: `02_Documentation/SECURITY_AUDIT.md` §file-upload
- [ ] Restringere INSERT policy su `conversation_participants`, `notifications`, `conversations` - attualmente troppo permissive per ruolo `anon`
  → ref: `02_Documentation/SECURITY_RULES.md`
- [ ] Decidere su `JailbreakDetector.swift`: integrare `IOSSecuritySuite` (SPM) o rimuovere il file - al momento ritorna sempre `false` (fuorviante per l'Apple reviewer)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §9
- [ ] Deploy Edge Function `validate-promo` o rimuovere il campo promo dal flow di booking iOS - attualmente `BookingFlowView.swift:142` la chiama e fallisce silenziosamente
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9

---

## 9. Submission App Store (4-6 ore)
- [ ] Risolvere problema Dual `Info.plist`: `GENERATE_INFOPLIST_FILE = YES` e file `Holistic-Unity-Info.plist` coesistono - Apple potrebbe leggere i weak usage description dal pbxproj anziché dal plist corretto
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §7
- [ ] Aggiornare supabase-swift SDK all'ultima versione (le ultime includono la `PrivacyInfo.xcprivacy` - Apple flagga le versioni vecchie)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §12
- [ ] Refactor `SupabaseTherapistRepository.swift`: sostituire 5 `SELECT` dirette su `therapist_profiles` con la view `therapist_profiles_public` (righe 21, 53, 102, 214, 362)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §6
- [ ] Tradurre in italiano App Store Description + Keywords (attualmente `knownRegions` include `it`, ma metadata su App Store Connect è solo EN)
  → ref: `03_Security_and_Audits/FINAL_REPORT_2026-05-18.md` §U5
- [ ] Testare funzionamento account reviewer su device reale: login `reviewer@holisticunity.app` / `AppleReviewer2026!` → Home → booking €0 → Tab Prenotazioni
  → ref: `03_Security_and_Audits/FINAL_REPORT_2026-05-18.md` §U3, `04_App_Store_Submission/App_Review_Notes.md`
- [ ] Deploy file statici `privacy-policy.html` e `support.html` per avere URL pubblici richiesti per la submission (es. tramite Netlify Drop o Vercel)
  → ref: `04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md` §1
- [ ] Compilare App Store Connect: caricare 4 screenshot 1320x2868 (`06_App_Store_Screenshots/`), icona 1024x1024, metadata IT+EN, Pricing Free, privacy questionnaire, build selection
  → ref: `04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md` §4
- [ ] Xcode: Archive → Distribute → Upload to App Store Connect → Submit for Review
  → ref: `04_App_Store_Submission/APP_STORE_SUBMISSION_WALKTHROUGH.md` §3, §5
- [ ] Verificare che il flusso Apple/Google sign-in passi per i 4 checkbox di consenso Art. 9 (attualmente bypassato - presente solo su sign-up email)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9

---

## 10. Migrazione Stripe TEST → LIVE (1-2 ore, one-off)
- [ ] Seguire intero runbook `STRIPE_LIVE_MIGRATION.md`: creare 2 webhook endpoint LIVE (client-webapp + Edge Function), scambiare tutte le chiavi Stripe in Vercel env, aggiornare `whsec_*` in Supabase secrets
  → ref: `02_Documentation/STRIPE_LIVE_MIGRATION.md`
- [ ] Testare end-to-end il primo pagamento reale post migrazione (booking reale da €1, webhook `payment_intent.succeeded` ricevuto, booking confermato, payout schedulato)
  → ref: `02_Documentation/STRIPE_LIVE_MIGRATION.md` §verifica-finale
- [ ] Verificare supporto `country` in Edge Function `create-connect-account`: Brasile / Malesia / Thailandia / India richiedono payout automatico a parte - controllare se `STRIPE_CONNECT_COUNTRIES` include le country necessarie
  → ref: `02_Documentation/05_STATUS_TRACKER.md`

---

## 11. Debito tecnico GDPR / legale (8-12 ore)
- [ ] Redigere DPIA (Data Protection Impact Assessment) (obbligatorio GDPR Art. 35 per dati salute Art. 9) - usare template ICO o CNIL, ~1gg lavoro
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Richiedere e firmare DPA (Data Processing Agreement) con Stream Chat, LiveKit, Brevo, Sentry (Stripe + Supabase + Vercel si accettano automaticamente)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Creare matrice di retention dati per tabelle: messaggi chat, sessioni, transazioni (10 anni per fisco), prenotazioni completate
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Verifica abilitazione double opt-in Brevo su dashboard Brevo
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Gestire `charge.dispute.created`: chargeback in periodo escrow 14gg, Stripe mantiene `payout_status='paid'` a DB se `disputed` - handler webhook + aggiungere stato `'disputed'` in tabella `transactions`
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Aggiungere cron di cleanup per `stripe_webhook_events`: la tabella cresce ~3.600 righe/mese senza limiti - inserire cron `DELETE WHERE created_at < now() - interval '7 days'` giornaliero
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] Costruire UI re-consent per `health_data_accept`: modal che appare al 412 dal server per far acconsentire l'utente senza fargli fare re-signup (necessario prima del push volume)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9

---

## 12. Performance - fix extra (3-5 ore)
- [ ] Fix bug N+1 query tab Prenotazioni (iOS): `ClientTabView.swift:2243-2247` fa `getProfile()` in serie per ogni terapeuta → sostituire con singola query `.in("id", values: [ids])` (30 query → 1, da ~3-5s a ~200ms)
  → ref: `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md` §11
- [ ] Spostare logica di filter e sort di `searchTherapists` lato server (attualmente fetch su server, ma filter "Highest Rated" + "Lingua" lato client - a scala 100x i top non verrebbero visti nelle prime pagine)
  → ref: `02_Documentation/legacy_docs_folder/PLATFORM_MAP.md` §9
- [ ] `Promise.all` su waterfall webapp dashboard: sostituire fetch in serie con fetch parallele dove non c'è dipendenza
  → ref: `02_Documentation/IMPROVEMENTS.md`

---

## 13. UX - quick wins e UI bug (4-5 ore)
- [ ] Sostituire `window.prompt()` e `window.confirm()` nativi con modal custom - sono instabili e bloccanti su mobile
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] Aggiungere tooltip refund policy visibile in checkout prima del pagamento (3 tier: 100% / 50% / 0%)
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] Aggiungere progress bar onboarding terapeuta (attualmente nessun feedback visivo dello step corrente)
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] CTA "Prenota sessione" sticky per mobile su pagina profilo terapeuta
  → ref: `02_Documentation/IMPROVEMENTS.md`
- [ ] BUG #5 iOS (Email Autocorrect): Aggiungere `.keyboardType(.emailAddress)`, `.textInputAutocapitalization(.never)` e `.autocorrectionDisabled(true)` ai form email in `AuthView.swift` e `EditProfileView.swift`
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-5
- [ ] BUG #6 iOS (Account Stats a zero): Cambiare Label in "SESSIONI COMPLETATE" anziché "SESSIONI", oppure includere i `confirmed` nella query per non spaventare i nuovi user che hanno prenotato ma non ancora svolto
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-6
- [ ] BUG #9 iOS (Tap area Explore): Aumentare padding verticale tra `quickFilterRow` e `therapistsListSection` in `AllTherapistsView` per evitare hit-test conflict con le card
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-9
- [ ] BUG #7 Matchmaker (RecommendPractices): Indagare perché l'SQL del matchmaker nasconde terapeuti in target pieno (verificare order by rating, limit, o bug sulle kebab-case)
  → ref: `05_IG_Guide_Screenshots/IG_Onboarding_Guide/GUIDA_IG.md` §BUG-7

---

## 14. Profilo Terapeuta & Credenziali - mapping gaps (3-4 ore)
- [ ] Aggiungere campo `country` in vista edit profile su webapp therapist dashboard (visibile su iOS ma non modificabile su web)
  → ref: `02_Documentation/THERAPIST_PROFILE_MAPPING.md`
- [ ] Verifica trigger di sync `display_name` tra `auth.users` e `therapist_profiles` - possibile desync all'aggiornamento profilo
  → ref: `02_Documentation/THERAPIST_PROFILE_MAPPING.md`
- [ ] Allineare i campi mostrati su iOS ma non editabili da dashboard: scansionare lista completa e aggiungere campi mancanti in form edit profile therapist webapp
  → ref: `02_Documentation/THERAPIST_PROFILE_MAPPING.md`
- [ ] Rigenerare `MICROSOFT_CLIENT_SECRET` per Outlook OAuth nel portale Azure, aggiornarlo in Vercel `therapist-webapp` e redeploy (GAP 8: risolve errore 401 Failed to fetch Microsoft profile)
  → ref: `04_App_Store_Submission/MICROSOFT_OUTLOOK_SECRET_REGEN.md`

---

**Stima totale aggiornata: ~95-129 ore ≈ 3-4 settimane**