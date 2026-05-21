# Task list per il developer — pre-lancio Holistic Unity

**Generato il 2026-05-18 · obiettivo: togliere a Marcello il mal di testa dell'app così può dedicarsi al marketing del lancio**

> Questo è il "tuo lavoro nelle prime 3 settimane". Sette macro-aree, ognuna con: scope, deliverable concreto da consegnare a Marcello, criteri di accettazione, tempo stimato realistico. Sequenza pensata per metterti subito a regime senza buchi.

---

## 🎯 Definizione di "successo"

Marcello considera questo lavoro completato quando:
- ✅ Può fare marketing/social/PR senza più dovermi/chiederti "ma funziona X?"
- ✅ Ogni mattina riceve da te un report di 5 righe: "errori notturni N, severità, fix in corso/risolti"
- ✅ Ogni email automatica che dovrebbe partire, parte
- ✅ Ogni flow critico (booking + paga + video) ha una verifica documentata che funziona end-to-end in produzione
- ✅ Sentry è impostato e gli alert arrivano a un canale che vede

Tempo totale stimato: **75-100 ore** distribuite su 3 settimane (~5h/giorno). Riducibile se ci si concentra sui top-3 task.

---

## 📋 Le 7 macro-aree

| # | Area | Tempo | Priorità lancio |
|---|------|-------|-----------------|
| 1 | Code review iOS + web | 12-16h | Media |
| 2 | Security review approfondita | 8-12h | **ALTA** |
| 3 | Performance — velocizzare load app | 15-20h | **ALTA** |
| 4 | QA: verificare TUTTI i flow funzionanti | 10-15h | **ALTA** |
| 5 | Setup Sentry concreto (iOS + 3 webapp) | 6-8h | **ALTA** |
| 6 | Routine controllo errori giornaliero | 4-6h setup + 15min/giorno | **ALTA** |
| 7 | Audit completo flow email (cliente + terapeuta) | 8-12h | **ALTA** |

**Da fare prima del lancio**: 2, 3, 4, 5, 6, 7. La 1 (code review) può sovrapporsi a fix scoperti nelle altre.

---

# 1. Code review iOS + web (12-16h)

## Cosa controllare

**iOS app** (`08_Codebases/iOS_App/`):
- [x] Tutti i `Repository` Swift hanno gestione errore consistente (`Result<T, Error>` o throwing)
- [x] Nessun forced unwrap (`!`) o `as!` non documentato
- [ ] `@MainActor` correttamente applicato a tutto ciò che tocca UI
- [x] `AuthManager.swift` — verifica che i Gate 1/2/3 nel `resolveAuthState()` siano logicamente esaustivi
- [ ] `PaymentRepository` / `BookingRepository` — verifica che gli errori Stripe siano mappati a messaggi user-friendly italiani
- [ ] `LiveKitService` — verifica reconnection logic (rete che cade durante la sessione)
- [ ] `StreamChatService` — verifica memory leak (controller non rilasciati)
- [ ] Tutti gli `await` non hanno `try?` che maschera errori critici (paymentIntent, booking confirm, signOut)
- [ ] `URLCache` policy — già impostata a 16MB ram / 200MB disk in `Holistic_UnityApp.swift`, conferma che non sia stata regredita

**Webapp Next.js × 3** (`client-webapp`, `therapist-webapp`, `admin-dashboard`):
- [ ] `'use client'` solo dove davvero serve (ogni componente client trasferisce JS al browser)
- [ ] Server Actions hanno `requireAuth()` o equivalente come prima riga
- [ ] Nessun `process.env.SUPABASE_SERVICE_ROLE_KEY` referenziato in codice client
- [ ] Tutte le `cookies()` / `headers()` chiamate sono in route handler o server component (mai in client)
- [ ] Tailwind: niente classi inline arbitrarie ripetute > 3 volte → estrarre componente
- [ ] React Hook Form / Zod validation su ogni form pubblico
- [ ] `next/image` usato ovunque (non `<img>`) per Vercel image optimization
- [ ] `dynamic()` con `ssr: false` per componenti pesanti client-only (chart, video player, mappe)

**Edge functions Supabase** (`08_Codebases/iOS_App/supabase/functions/` se presente, altrimenti dashboard):
- [ ] Ogni function ha `verify_jwt: true` SALVO `stripe-webhook` (deve essere `false` perché autenticato via signature)
- [ ] Stripe webhook verifica signature con `stripe.webhooks.constructEvent`
- [ ] CORS headers presenti su tutte le function chiamate dal browser
- [ ] Niente console.log con dati PII (email, payment intent, user ID) — usa `console.log("[redacted]")`

## Deliverable

📄 **`CODE_REVIEW_2026-XX-XX.md`** con:
- Lista issue trovati per categoria (Critical / High / Medium / Low)
- Per ogni Critical/High: file + riga + suggerimento di fix
- PR/commit links se hai già fixato
- Sezione "Decisioni di design discutibili" — non bug, ma cose che secondo te dovrebbero essere ripensate

## Criteri di accettazione

- Zero issue Critical aperti
- Tutti gli High hanno o un fix in produzione o un task tracciato per essere risolti entro 1 settimana

---

# 2. Security review approfondita (8-12h)

## Base di partenza

Un audit è stato fatto il 2026-05-18 (vedi `03_Security_and_Audits/AUDIT_REPORT_2026-05-18.md`). Sono stati applicati 8 fix e 9 bug aperti documentati. Tu **estendi**.

## Cosa fare

- [ ] **Rotazione credenziali**: rigenera tutti i secret almeno una volta (PAT Supabase, Stripe restricted keys, Brevo API key, LiveKit API secret, Stream Chat API secret, FattureInCloud OAuth secret). Documenta nuove credenziali in `03_CREDENTIALS.md` aggiornato (data + chi le ha)
- [ ] **RLS audit completo**: per ogni tabella in `public.`, verifica che `rowsecurity = true` (eccetto view/materialized) e che le policy non abbiano logica che permetta a un user di leggere righe di altri user
  ```sql
  SELECT n.nspname, c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 2;
  ```
- [ ] **Test anon access**: per ogni tabella accessibile da anon (es. `therapist_profiles_public`), verifica con `curl -H "apikey: <anon>"` che non si vedano PII o dati di altri
- [ ] **Storage bucket policies**: verifica che `gallery_images`, `profile_photos`, `intro_videos`, `documents` abbiano policy che non permettano a user A di leggere/scrivere oggetti di user B
- [ ] **JWT lifetime**: in Supabase Dashboard → Settings → Auth, verifica JWT expiry < 1h. Refresh token rotation enabled
- [ ] **App Transport Security (ATS)**: nell'iOS Info.plist, conferma `NSAllowsArbitraryLoads = false` (NON true)
- [ ] **Penetration test rapido**:
  - Tenta sign-up con email malformato `<script>alert(1)</script>@x.com` — l'app deve sanitizzare
  - Tenta booking POST con `client_id` di un altro utente (RLS deve bloccare)
  - Tenta booking POST con price negativo (trigger di protezione deve bloccare)
  - Tenta report POST 11 volte in 1 minuto (rate limit `report_rate_ok` deve bloccare l'11°)
  - Tenta lettura via REST di `auth.users` (deve essere `permission denied`)
- [ ] **Stripe restricted keys**: la chiave LIVE Stripe usata dalle edge functions deve essere `rk_live_...` (restricted), NON `sk_live_...` (secret). Scope minimo: charges + payouts + webhooks
- [ ] **Cert pinning**: TrustKit è in `reporting mode` (non blocca). Decidi se passare a `enforce mode` ora o post-lancio (rischio: se Supabase ruota cert intermedio, app smette di funzionare)
- [ ] **OWASP MAS Top 10 iOS**: scorri rapidamente — `M1: Improper Credential Usage`, `M3: Insecure Authentication`, `M4: Insufficient Input Validation` sono i più rilevanti per noi
- [ ] **Header sicurezza webapp**: aggiungi `next.config.js` headers `Content-Security-Policy`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Permissions-Policy`. Test su https://securityheaders.com → target rating A

## Deliverable

📄 **`SECURITY_REVIEW_2026-XX-XX.md`** con: 
- Risultati di ogni controllo (✅ pass / ❌ fail con dettaglio)
- Lista credenziali ruotate + data
- Score securityheaders.com prima/dopo
- Risultati pen test (5 attacchi sopra) con screenshot/log

## Criteri di accettazione

- Tutti gli attacchi del pen test rapido vengono bloccati
- securityheaders.com score ≥ A su tutti e 4 i siti production
- 0 PII visibili tramite anon key
- Tutti i secret originali (quelli che esistevano al 2026-05-18) sono stati ruotati

---

# 3. Performance — velocizzare load app (15-20h)

Il problema riportato da Marcello: *"le immagini caricano lente, qualche secondo"*. La causa root è già stata identificata (`HUAvatar` scaricava l'originale invece della thumbnail). Fix base già applicato in `URL+SupabaseStorage.swift` + `HUAvatar.swift`. **Tu estendi a copertura totale.**

## Cosa fare

**iOS**:
- [ ] Audit di ogni `AsyncImage` / `KFImage` / `Image(url:)` nell'app. Per OGNI uso, applica `.supabaseThumbnail(size: N)` con la size corretta:
  - Avatar lista terapeuti: 80pt × 3x = 240px
  - Avatar profilo grande: 200pt × 3x = 600px
  - Gallery thumbnail: 120pt × 3x = 360px
  - Gallery fullscreen: maxScreenWidth × 3x (1290px su Pro Max)
- [ ] Misura prima/dopo con **Instruments → Network**: latency p50 e p95 della home + Explore + un profilo
- [ ] **Cold start time**: usa `os_signpost` per misurare da `applicationDidFinishLaunching` al primo render della home. Target: < 1.5s su iPhone 14 (vecchio device tipico)
- [ ] Lazy load: i 4 tab della tab bar caricano i loro VM solo on-tab-switch (non al boot)
- [ ] `URLCache` size: già 16MB ram / 200MB disk. Verifica che basti per ~100 thumbnail (320×320 JPEG ≈ 50KB → 200MB = 4000 immagini cached, plenty)
- [ ] Supabase queries: ogni `select("*")` deve essere sostituito con select esplicito dei soli campi usati dalla UI. Riduce response size 50-80%
- [ ] Bundle size app: misura con Xcode Organizer → archive size. Target < 50MB

**Client-webapp Next.js**:
- [ ] **Lighthouse audit** su 4 pagine chiave: home `/`, dashboard `/dashboard`, esplora `/dashboard/explore`, profilo terapeuta `/dashboard/therapists/[id]`. Target: Performance ≥ 85, Accessibility ≥ 90, Best Practices ≥ 95
- [ ] Verifica che `next/image` sia usato ovunque (zero `<img>` in src/)
- [ ] Verifica `loading="lazy"` su immagini below the fold
- [ ] Verifica `next/font` per Google Fonts (no `<link>` esterni che bloccano render)
- [ ] `Suspense` boundary intorno a componenti che fetchano (skeleton mentre carica vs blank screen)
- [ ] React Server Components dove possibile (es. lista terapeuti su `/dashboard/explore` non ha bisogno di essere client)
- [ ] Bundle analyzer (`@next/bundle-analyzer`) — identifica i top 3 package più pesanti, valuta alternative leggere

**Therapist-webapp**: identico al client-webapp. Particolare attenzione al calendario (`react-big-calendar` o equivalente — è pesante)

**Admin-dashboard**: meno critico (uso interno), ma comunque Lighthouse > 70

**Backend Supabase**:
- [ ] Verifica indici su tutte le foreign key + tutte le colonne usate in WHERE/ORDER BY frequenti. Query lente in `Supabase Dashboard → Reports → Slow queries`
- [ ] Verifica che `EXPLAIN ANALYZE` su `getNearbyTherapists`, `getBookingsForUser`, `searchTherapists` ritorni `Index Scan`, non `Seq Scan`
- [ ] Connection pooling: PgBouncer abilitato (default su Supabase)

## Deliverable

📄 **`PERFORMANCE_REPORT_2026-XX-XX.md`** con:
- Tabella prima/dopo per: cold start iOS, Lighthouse score 4 pagine, top 5 slow queries Supabase
- Screenshot Instruments Network prima/dopo (latency reduction in %)
- Lista di tutti i file modificati per le ottimizzazioni
- Bottleneck residui che richiedono refactor più grandi (non risolti, documentati per dopo)

## Criteri di accettazione

- Cold start iOS < 1.5s (target stretch < 1.0s)
- Lighthouse Performance ≥ 85 su tutte le pagine client-facing
- Latency p95 lista terapeuti < 800ms (era ~2.5s)
- Avatar caricano in < 200ms su rete 4G simulata

---

# 4. QA: verificare TUTTI i flow funzionanti (10-15h)

L'obiettivo è una **matrice testata** che Marcello possa consultare per sapere "il flow X funziona davvero". Tutti i test su **production** (non staging — non c'è).

## Flow da testare (uno per uno, documentato con screenshot)

### Cliente (iOS + client-webapp)

- [ ] **F1 — Onboarding sign-up email** → email verify → TOS accept → preferences setup → home
- [ ] **F2 — Onboarding sign-up Apple Sign-In** → TOS → preferences → home
- [ ] **F3 — Onboarding sign-up Google Sign-In** → TOS → preferences → home
- [ ] **F4 — Sign-in esistente** → home (skip onboarding)
- [ ] **F5 — Password reset** → email arriva → link cliccabile → nuova password
- [ ] **F6 — Esplora terapeuti** → filtri (categoria, città, lingua, prezzo) → risultati filtrati
- [ ] **F7 — Visualizza profilo terapeuta** → bio, gallery, video, recensioni, servizi visibili
- [ ] **F8 — Booking conoscitiva gratuita** (€0) → conferma immediata (no Stripe) → email conferma a entrambi
- [ ] **F9 — Booking servizio a pagamento** → Stripe PaymentSheet → Apple Pay (su iOS) o carta → conferma → email conferma
- [ ] **F10 — Booking pacchetto N sessioni** → pagamento unico → N booking row create
- [ ] **F11 — Cancellazione client > 48h** → rimborso 100% → email refund
- [ ] **F12 — Cancellazione client < 48h** → no rimborso → conferma client + notifica terapeuta
- [ ] **F13 — Reschedule client** → terapeuta vede notifica → accetta/rifiuta → email a client
- [ ] **F14 — Join video session** → LiveKit token rilasciato → audio/video funzionano → reconnect dopo network drop
- [ ] **F15 — Chat con terapeuta** (Stream Chat) → invia messaggio → terapeuta vede push → risponde
- [ ] **F16 — Recensione post-sessione** → stelle + testo → visibile su profilo terapeuta
- [ ] **F17 — Report user** (nuovo, post 2026-05-18 migration) → form aperto, 6 reason, 500ch details → submit → riga in `reports`
- [ ] **F18 — Block user** (nuovo) → conferma → riga in `blocked_users` → chat con quel user nascosta
- [ ] **F19 — Aggiornamento profilo** (nome, foto, città, lingue, intention)
- [ ] **F20 — Cancellazione account** → soft delete (anonymized_at set) → tutti i dati personali tolti, ma booking storici restano

### Terapeuta (therapist-webapp)

- [ ] **F21 — Sign-up terapeuta** → email verify → Stripe Connect Express onboarding → invio docs → wait for approval
- [ ] **F22 — Stripe Connect onboarding complete** → notification email → profilo "in attesa di approvazione"
- [ ] **F23 — Admin approve therapist** → notification email → profilo visibile pubblicamente
- [ ] **F24 — Admin reject therapist** → notification email con motivo
- [ ] **F25 — Setup profilo**: bio, photo, gallery (max 5), video intro, categorie, lingue, helps_with, città, lat/lng
- [ ] **F26 — Setup servizi**: nome, descrizione, durata, prezzo, currency (EUR), cancellation policy
- [ ] **F27 — Setup disponibilità**: weekly recurring slots + one-off + blocked dates
- [ ] **F28 — Setup FattureInCloud**: OAuth flow → token salvato → primo invoice di test generato
- [ ] **F29 — Vedere booking dashboard**: lista upcoming, completed, cancelled
- [ ] **F30 — Cancellare booking** (con motivazione) → client riceve email + rimborso 100%
- [ ] **F31 — Join video session** lato terapeuta
- [ ] **F32 — Mark session as no_show** → no payout, no rimborso, dispute path
- [ ] **F33 — Vedere payout dashboard**: storico pagamenti, balance Stripe, payout schedule
- [ ] **F34 — Vedere fatture FIC**: lista, download PDF
- [ ] **F35 — Statistiche**: rating medio, total earnings, conversion rate

### Cron + webhook

- [ ] **F36 — Stripe webhook `payment_intent.succeeded`** → booking passa a `confirmed`
- [ ] **F37 — Stripe webhook `charge.refunded`** → `requires_manual_refund=false`
- [ ] **F38 — Stripe webhook `account.updated`** → `stripe_account_status` aggiornato
- [ ] **F39 — Cron reminder 24h prima** → email a entrambi
- [ ] **F40 — Cron reminder 1h prima** → push iOS + email
- [ ] **F41 — Cron review request post-sessione** → email cliente
- [ ] **F42 — Cron FIC invoice generation** post-sessione completata

## Deliverable

📄 **`QA_MATRIX_2026-XX-XX.md`** — tabella di 42 righe con:
- Flow # | Descrizione | Tested? ✅/❌ | Note | Screenshot link

Per ogni ❌: ticket aperto in qualunque tracker stai usando (anche un file `BUGS_FOUND.md` se non avete tracker)

## Criteri di accettazione

- 100% dei flow taggati ✅ o con bug noto + workaround documentato
- Marcello può aprire la matrice e in 30 secondi sapere lo stato del sistema

---

# 5. Setup Sentry concreto (6-8h)

Sentry è **referenziato nel codice iOS** (vedi `Holistic_UnityApp.swift`) ma il DSN potrebbe non essere configurato in production, e i 3 webapp Next.js verosimilmente non lo hanno.

## Cosa fare

- [ ] Login su https://sentry.io account Marcello → verifica organization + projects esistenti
- [ ] Se mancano, crea **4 progetti**:
  - `holistic-unity-ios` (platform: Apple iOS)
  - `holistic-unity-client-web` (platform: Next.js)
  - `holistic-unity-therapist-web` (platform: Next.js)
  - `holistic-unity-admin-web` (platform: Next.js)
- [ ] Per ogni progetto: copia DSN → mettilo in env vars Vercel (per i 3 webapp) e in `Info.plist` (per iOS)
- [ ] iOS: verifica che `SentrySDK.start()` sia il primo statement in `applicationDidFinishLaunching`. Configura:
  ```swift
  options.tracesSampleRate = 0.2 // 20% APM
  options.profilesSampleRate = 0.1 // 10% profiling
  options.attachScreenshot = true
  options.attachViewHierarchy = true
  options.enableAutoPerformanceTracing = true
  ```
- [ ] Next.js: `npm install @sentry/nextjs && npx @sentry/wizard@latest -i nextjs`. Configura:
  - `tracesSampleRate: 0.2`
  - `replaysSessionSampleRate: 0.1`
  - `replaysOnErrorSampleRate: 1.0`
- [ ] **Source maps upload**: configura `sentry.properties` + build hook per upload automatico ad ogni deploy (Vercel: `sentry-cli releases new`, iOS: Run Script Phase con sentry-cli)
- [ ] **Release tagging**: ogni deploy/build deve creare una Release in Sentry con version = commit SHA (così sai quale versione ha causato l'errore)
- [ ] **Alert rules**:
  - Email Marcello quando `new issue` con severity ≥ Error
  - Email quando `error frequency > 50 / hour` (potenziale incident)
  - Slack webhook (se Marcello usa Slack) per high-severity issue
- [ ] **PII scrubbing**: configura `beforeSend` per rimuovere email, payment intent IDs, JWT tokens dagli errori. Mai inviare dati sensibili a Sentry
- [ ] **User context**: dopo login, chiama `Sentry.setUser({ id: user.id })` (solo ID, no email). In iOS: `SentrySDK.setUser(...)`
- [ ] Test: trigger errori volutamente (un bottone nascosto in debug build che chiama `fatalError("test sentry")`) → verifica che arrivino in dashboard
- [ ] **Performance budget**: imposta soglie in Sentry Performance — alert se p95 di una transaction > 2s

## Deliverable

📄 **`SENTRY_RUNBOOK.md`** con:
- 4 DSN documentati (in password manager separato, NON nel file)
- Screenshot dashboard Sentry con almeno 1 evento di test ricevuto per progetto
- Alert rules attive (screenshot)
- Procedura "come triagiare un errore in Sentry" (5 step)

## Criteri di accettazione

- 4 progetti Sentry attivi, ognuno con almeno 1 evento di test arrivato
- Marcello riceve alert email a un trigger di errore
- PII non visibili in nessuno screenshot di errore

---

# 6. Routine controllo errori giornaliero (4-6h setup, poi 15min/giorno)

L'obiettivo: ogni mattina Marcello riceve un report di 5 righe e sa cosa è successo nelle 24h prima.

## Cosa fare

### Setup (una volta)

- [ ] Crea uno script Node/Bash che ogni mattina alle 8:00 aggreghi da 5 fonti:
  - **Sentry**: numero issue nuovi (last 24h), top 3 per frequenza, breakdown iOS/web
  - **Vercel runtime logs**: numero errori 4xx/5xx, top 3 endpoint che hanno failato
  - **Supabase logs** (via API): query lente (> 1s), errori RLS, errori auth
  - **Stripe dashboard** (via API): failed payments, disputes, refunds pending
  - **App Store Connect** (via API): crash reports last 24h
- [ ] Output formato Markdown/email, mandato a `marcellodipierro@outlook.com` + a te
- [ ] Pianifica via **GitHub Actions cron** (gratis) o **Vercel Cron** o **Supabase pg_cron + edge function**. Personalmente raccomando GitHub Actions per semplicità
- [ ] Template del report:
  ```markdown
  # Daily report Holistic Unity — 2026-XX-XX
  ## 📊 Numeri
  - Sentry: 3 new issues (1 high, 2 medium)
  - Vercel: 12 errori 5xx (su 8.4k req → 0.14%)
  - Supabase: 2 slow queries (>1s)
  - Stripe: 0 failed payments, 0 dispute
  - iOS crash: 1 (deobfuscato: NetworkManager.swift:142)
  ## 🚨 Da Triare (Marcello, leggi prima)
  - [ISSUE-123] NullPointer in TherapistProfileView → assigned to me, fixing oggi
  ## ✅ Risolti ieri
  - [ISSUE-119] FIC OAuth timeout — fixed nel deploy 14:22
  ## 📈 Trend
  - error rate 0.14% (▼ 0.05% rispetto ieri)
  ```

### Routine quotidiana (15min)

- [ ] Apri report email alle 8:30
- [ ] Per ogni Critical/High: apri Sentry/Vercel, fai triage, assegnati il fix se è bug, escala a Marcello se è prodotto
- [ ] Aggiorna `STATUS_TRACKER.md` (in `02_Documentation/`) con eventuali decisioni
- [ ] Lunedì: report settimanale aggregato (trend, top issues, MTTR medio)

## Deliverable

📄 **`MONITORING_RUNBOOK.md`** con:
- Script aggregator + posizione (repo)
- Cron schedule + dove gira
- Esempio del primo report inviato (screenshot email)
- Procedura escalation: chi chiama Marcello e quando

## Criteri di accettazione

- Marcello ha ricevuto almeno 7 report consecutivi senza skip
- Tempo medio dall'apparizione errore in Sentry a triage < 4h durante orario lavoro
- Tempo medio fix High severity < 24h

---

# 7. Audit completo flow email (cliente + terapeuta) (8-12h)

Tutte le email partono da **Brevo** (transactional). Devi verificare che ogni email che il sistema dichiara di inviare, parta davvero.

## Inventario email da verificare

### Cliente (autoclient)

| # | Trigger | Quando | Template |
|---|---------|--------|----------|
| C1 | Sign-up email/password | Subito dopo sign-up | Email verify with magic link |
| C2 | Welcome | Dopo email verify | Welcome to Holistic Unity |
| C3 | Reset password | Click "Password dimenticata" | Reset link |
| C4 | Booking confirmed (gratuita) | Conferma immediata | Conferma sessione + ICS attachment |
| C5 | Booking confirmed (pagamento) | Webhook Stripe success | Conferma sessione + ricevuta + ICS |
| C6 | Reminder T-24h | Cron giornaliero | Promemoria 24h |
| C7 | Reminder T-1h | Cron orario | Promemoria 1h con link join |
| C8 | Cancellation by self > 48h | Subito | Conferma cancellazione + rimborso 100% |
| C9 | Cancellation by self < 48h | Subito | Conferma cancellazione no rimborso |
| C10 | Cancellation by therapist | Subito dopo terapeuta cancella | Notifica + rimborso 100% |
| C11 | Reschedule proposed by therapist | Subito | Accetta/rifiuta nuovo orario |
| C12 | Refund issued | Webhook Stripe refund | Notifica accredito 5-10gg |
| C13 | Review request | T+24h dopo sessione completed | Link recensione (1-click magic) |
| C14 | Account deletion confirmation | Subito | "Account eliminato con successo" |
| C15 | Marketing consent given | Subito (opt-in) | Conferma iscrizione newsletter |

### Terapeuta (autoterapista)

| # | Trigger | Quando | Template |
|---|---------|--------|----------|
| T1 | Sign-up | Subito | Email verify |
| T2 | Welcome therapist | Dopo email verify | Benvenuto + prossimi step (Stripe + profilo) |
| T3 | Stripe Connect onboarding complete | Webhook `account.updated` con `details_submitted=true` | "In attesa di approvazione admin" |
| T4 | Profile approved | Admin clicca approve | "Sei live!" + link al profilo pubblico |
| T5 | Profile rejected | Admin clicca reject | Motivo + come correggere |
| T6 | Profile changes requested | Admin set status=`changes_requested` | Lista cose da sistemare |
| T7 | New booking received | Webhook Stripe success | "Hai una nuova prenotazione" + dettagli cliente |
| T8 | Reminder T-24h | Cron | Promemoria sessione |
| T9 | Reminder T-1h | Cron | Link join |
| T10 | Client cancelled > 48h | Subito | Notifica + payout annullato |
| T11 | Client cancelled < 48h | Subito | Notifica + payout intatto |
| T12 | Client requested reschedule | Subito | Notifica con bottone accetta/rifiuta |
| T13 | Payout sent | Webhook Stripe `payout.paid` | Conferma accredito su IBAN |
| T14 | Payout failed | Webhook Stripe `payout.failed` | Allerta + istruzioni |
| T15 | Review received | Subito dopo review | "Hai una nuova recensione" + testo |
| T16 | Monthly statement | Cron 1° di ogni mese | Riepilogo guadagni + sessioni mese precedente |
| T17 | Document expiring (P.IVA scaduta, etc.) | Cron settimanale | Allerta documenti |

### Admin

| # | Trigger | Quando |
|---|---------|--------|
| A1 | New therapist sign-up pending review | Subito | (a Marcello) |
| A2 | New report submitted | Subito (rate-limit aware) | (a Marcello) |
| A3 | Stripe dispute opened | Webhook | (a Marcello) |
| A4 | Failed payout (qualunque terapeuta) | Webhook | (a Marcello) |

## Cosa fare

- [ ] Per ognuna delle 36 email sopra: trigger via QA in production con un account di test, verifica:
  - Arriva entro 60 secondi? → ✅ / ❌
  - Subject sensato e in italiano corretto? → ✅ / ❌
  - Corpo HTML renderizza bene su Gmail / Outlook / Apple Mail? (test su almeno 2 client)
  - Link cliccabili funzionano (login, accept, etc.)?
  - Tracking pixel Brevo presente? Mittente `info@holisticunity.app` autenticato (SPF/DKIM/DMARC)?
- [ ] Verifica record DNS: `dig TXT holisticunity.app | grep -E "(spf|dmarc)"` + DKIM `dig TXT brevo._domainkey.holisticunity.app`. Tutti devono passare. Test su https://mail-tester.com → score ≥ 9/10
- [ ] Per ogni email mancante: crea il template in Brevo, wire al trigger nel codice
- [ ] Per ogni email con bug: fix copy/HTML/link

## Deliverable

📄 **`EMAIL_AUDIT_2026-XX-XX.md`** con:
- Matrice 36 righe con status per ogni email
- Screenshot test rendering su Gmail desktop, Apple Mail iOS
- Mail-tester.com score
- Lista template Brevo creati/modificati

## Criteri di accettazione

- 100% delle 36 email arrivano e renderizzano bene
- mail-tester score ≥ 9/10
- SPF + DKIM + DMARC tutti pass
- Niente email in spam folder Gmail/Outlook (test con 3 account diversi)

---

# 🚀 Sequenza consigliata (3 settimane)

## Settimana 1 — Stabilità lancio (le cose che bloccano se non fatte)

| Giorno | Task |
|--------|------|
| Lun | Setup ambiente locale, leggere `00_LEGGI_PRIMA_QUESTO.md`, eseguire i 2 SQL files se non già fatti |
| Mar | Setup Sentry (#5) iOS + 3 webapp |
| Mer | Setup routine errori (#6) — script aggregator + primo report |
| Gio | Email audit (#7) — primi 18 trigger (client) |
| Ven | Email audit (#7) — restanti 18 trigger (therapist + admin) |

## Settimana 2 — Sicurezza + funzionamento

| Giorno | Task |
|--------|------|
| Lun | Security review (#2) — RLS + pen test + storage policies |
| Mar | Security review (#2) — rotazione credenziali + headers + cert pinning decision |
| Mer | QA matrice (#4) — flow cliente F1-F20 |
| Gio | QA matrice (#4) — flow terapeuta F21-F35 |
| Ven | QA matrice (#4) — cron+webhook F36-F42 + report finale |

## Settimana 3 — Performance + polish

| Giorno | Task |
|--------|------|
| Lun | Performance (#3) — iOS image transforms + cold start measure |
| Mar | Performance (#3) — Lighthouse audit 3 webapp + fix top issues |
| Mer | Performance (#3) — Supabase queries + indici |
| Gio | Code review (#1) — iOS + edge functions |
| Ven | Code review (#1) — 3 webapp + report finale + handover meeting con Marcello |

Da settimana 4 in poi: routine giornaliera report (15min) + fix bug giornalieri.

---

# 📞 Cosa Marcello vuole NON sentire da te

- "non riesco a riprodurre" → riproduci o documenta perché non riesci
- "fa così perché era così" → tu sei stato assunto per migliorare, non per mantenere lo status quo
- "non è prioritario" → prioritizza tu, motivando in 1 frase
- "lo devo testare di più" → spiega cosa specifico ti manca per dire ✅

# 📞 Cosa Marcello vuole sentire da te

- "ho trovato X, fixato Y, ora va così"
- "secondo me dovremmo prioritizzare Z perché [motivo concreto]"
- "non lo so, lo guardo entro fine giornata e ti rispondo"
- "il report di stamattina mostra 0 errori critici. Va tutto bene."

---

**Buon lavoro 🌱**
