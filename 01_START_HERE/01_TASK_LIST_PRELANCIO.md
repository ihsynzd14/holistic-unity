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
- [x] `@MainActor` correttamente applicato a tutto ciò che tocca UI (audit 2026-05-21: 31 file rivisti, nessuna correzione necessaria — vedi note)
- [x] `AuthManager.swift` — verifica che i Gate 1/2/3 nel `resolveAuthState()` siano logicamente esaustivi
- [x] `PaymentRepository` / `BookingRepository` — verifica che gli errori Stripe siano mappati a messaggi user-friendly italiani
- [x] `LiveKitService` — verifica reconnection logic (rete che cade durante la sessione)
- [x] `StreamChatService` — verifica memory leak (controller non rilasciati)
- [x] Tutti gli `await` non hanno `try?` che maschera errori critici.
- [x] `URLCache` policy — già impostata a 16MB ram / 200MB disk in `Holistic_UnityApp.swift`, conferma che non sia stata regredita

**Webapp Next.js × 3** (`client-webapp`, `therapist-webapp`, `admin-dashboard`):
- [POST LAUNCH NON PRIORITY!] `'use client'` solo dove davvero serve (ogni componente client trasferisce JS al browser)
- [x] Server Actions hanno `requireAuth()` o equivalente come prima riga
       Audit 2026-05-22 (ISKO): Nessuna delle 3 webapp usa `'use server'` Server Actions — tutte le mutazioni sono Route Handler (`route.ts`). Pattern auth uniforme: `createClient()` → `getUser()` (JWT-verified, mai `getSession()`) → 401 se null. client-webapp: 16/16 ✅. therapist-webapp: 37/37 ✅. admin-dashboard: 12/13 con 1 violazione trovata e fixata — `POST /api/stream/token` usava solo Gate 1 (email whitelist env) invece di `requireAdmin()` (doppio gate: email + RPC `is_admin` DB). Fix applicato 2026-05-22: [src/app/api/stream/token/route.ts](../08_Codebases/admin-dashboard/src/app/api/stream/token/route.ts). Build `next build` clean post-fix.
- [x] Nessun `process.env.SUPABASE_SERVICE_ROLE_KEY` referenziato in codice client
       Audit 2026-05-22 (ISKO): Zero `NEXT_PUBLIC_*SERVICE*` aliases. Tutti i consumer di `SUPABASE_SERVICE_ROLE_KEY` sono server-only: factory `createAdminClient()` in `src/lib/supabase/admin.ts` (3 webapp), route handler `src/app/api/**/route.ts`, Server Components admin-dashboard (verificata assenza `"use client"`). Nessun `"use client"` importa `lib/supabase/admin`, `lib/auth/rateLimit` o `lib/auth/mfa-server`. Edge Functions iOS, build script `generate-hero-images.mjs`, worktree e docs fuori scope. Hardening opzionale (aggiungere `import "server-only"` ai moduli admin per build-time enforcement) tracciato come follow-up nel piano.
- [x] Tutte le `cookies()` / `headers()` chiamate sono in route handler o server component (mai in client)
       Audit 2026-05-22 (ISKO): Zero violazioni in tutti e 3 i codebase. Pattern corretto applicato uniformemente: `cookies()` / `headers()` isolati in `src/lib/supabase/server.ts` (server-only utility), consumato esclusivamente da route handler e server component. Tutti i client component (`'use client'`) usano `createBrowserClient` da `src/lib/supabase/client.ts` — mai il server client.
- [x] Tailwind: niente classi inline arbitrarie ripetute > 3 volte → estrarre componente
       Audit 2026-05-22 (ISKO): debito tecnico **reale** — su 3358 occorrenze `className=` in 93 file, identificate ~10 stringhe ripetute 14-31 volte ciascuna (worst case: input field con 22 copie da 207 char, label con 25 copie). Nessun layer `src/components/ui/` esiste in nessuno dei 3 webapp. Refactor non-trivial: ~1-2 giornate per estrarre ~10 primitive (`<Input>`, `<Label>`, `<Card>`, `<DisplayHeading>`, `<Spinner>`, `<LoadingContainer>`, `<Eyebrow>`, `<ErrorText>`) per webapp, +refactor ~205 call site. Non blocca il lancio (debito di maintainability, non di funzionalità). Piano dettagliato con motivazione, vantaggi, sequenza, stime, rischi: [TECH_DEBT.txt](TECH_DEBT.txt) — Debt #1.
       Implementato 2026-05-22 (ISKO, 4 round sequenziali): tutti gli 8 primitive estratti in `src/components/ui/` per ognuno dei 3 webapp (admin-dashboard senza `LoadingContainer` perché 0 occorrenze), totale 23 file primitive. 205 call site refactored verbatim — Input 22, Label 25, ErrorText 18, Card 17, Eyebrow 17 (solo client-webapp), DisplayHeading 56 (33 xl + 23 md, con `as` prop per preservare h1 vs h2), Spinner 29 (SVG hand-rolled), LoadingContainer 21. Tutti i variants gestiti via `className` pass-through (`mt-3`, `mt-6`, `mb-3`, `mb-4`, `mx-auto`, `sm:text-[34px]`, `animate-reveal`, ecc.). Zero cambio rendering: stesso DOM, stesse classi Tailwind, stessi prop. `tsc --noEmit` clean su client-webapp e admin-dashboard (therapist-webapp `node_modules` non installato localmente — è submodule, ma edits sono strutturalmente identici a client-webapp). Skip documentati: 1 `<Loader2>` lucide-react in welcome/page.tsx (icona diversa visivamente), 3 `<p>` tag stilizzati come heading-md (fuori spec h1/h2/h3) — refattorizzabili come follow-up estendendo `as` prop con `"p"`. A11y wiring (`htmlFor`/`id` tra Label e Input via `useId()`) non implementato per scelta — debt separato da fare con un `<Field>` wrapper centralizzato.
- [x] React Hook Form / Zod validation su ogni form pubblico
       Audit 2026-05-22 (ISKO): Zero `react-hook-form` / `zod` / `formik` / `yup` installati nei 3 webapp, ma **i form sono comunque validati** con pattern hand-rolled deliberato e ben ingegnerizzato: `validate(): string | null` inline + HTML5 attrs (`required`, `type="email"`) + helper condiviso [validatePasswordShape](../08_Codebases/client-webapp/src/lib/security/password.ts) (NIST SP 800-63B: min 8 char + letter+digit, con rationale documentato) + `isPasswordBreached` via HIBP k-anonymity API + abuse stack server-side su `/api/auth/check-signup` (honeypot, time-on-form, disposable-email blocklist, rate-limit per-IP — sostituisce Cloudflare Turnstile rimosso 2026-05-15 dopo blocchi da ad-blocker su utente Brasile). Pattern uniforme sui 9 form pubblici censiti (login×3, register×2, forgot-password×2, reset-password×2). i18n già integrato via `t.register.errorX`. Migrazione a RHF+Zod sarebbe **refactor DX, non security**: stessa postura difensiva, +25KB bundle, richiederebbe `zod-i18n-map` per error localization. Schema-reuse client↔server (vero vantaggio Zod) tracciabile come follow-up sui route handler API per defense-in-depth.
- [X] `next/image` usato ovunque (non `<img>`) per Vercel image optimization
       Audit 2026-05-22 (ISKO): convertite le 2 occorrenze locali sicure in [client-webapp/src/app/dashboard/cammino/page.tsx](../08_Codebases/client-webapp/src/app/dashboard/cammino/page.tsx) (sorgenti `/practices/heroes/*.jpg`), `tsc` + `eslint` clean. Restanti 15 `<img>` lasciate per scelta: Supabase Storage già CDN-ottimizzato (doppia trasformazione = costo Vercel metered senza guadagno), thumbnail YouTube/Vimeo richiederebbero `images.remotePatterns`, hero `/onboarding/heroes/*` da convertire quando arriveranno le immagini FAL.
- [x] `dynamic()` con `ssr: false` per componenti pesanti client-only (chart, video player, mappe)
       Audit 2026-05-22 (ISKO): Zero `next/dynamic` usage nei 3 webapp, ma nessun problema reale. Nel codebase i libs pesanti sono solo LiveKit (5 file: call pages + `CustomVideoLayout` + therapist sessions) e Stream Chat (3 file: messages pages + admin `stream-provider`); no chart/mappe/PDF. Tutti i consumer sono già `"use client"` con rendering gated da `useEffect` → nessun crash SSR oggi. Next.js 16 App Router fa già route-level code splitting automatico (`/dashboard`, `/`, ecc. NON scaricano LiveKit/Stream Chat; solo `/call/[bookingId]`, `/dashboard/messages`, `/dashboard/sessions` li shippano). `dynamic({ssr:false})` qui sarebbe solo polish UX (loading skeleton invece di blank durante parse del bundle) senza riduzione bytes shipped — tracciato come follow-up se servirà ottimizzare slow-connection UX.

**Edge functions Supabase** (`08_Codebases/iOS_App/supabase/functions/` se presente, altrimenti dashboard):
- [x] Ogni function ha `verify_jwt: true` SALVO `stripe-webhook` (deve essere `false` perché autenticato via signature) (audit 2026-05-22: 13 function rivisti. Deviazione documentata dalla spec: tutte hanno `verify_jwt = false`. Motivi: (a) `stripe-webhook` per signature HMAC ✓ come da spec; (b) `send-push-notification` + `process-pending-payouts` chiamate da DB webhook / pg_cron con service-role key, non da utenti; (c) le 10 user-facing fanno verifica JWT internamente via `supabaseAdmin.auth.getUser(jwt)` — equivalente crittografico a gateway-level. config.toml completato con i 5 entry mancanti. Flip strict→true rimandato a QA device perché richiederebbe refactor di SupabasePaymentRepository:296-301. Dettaglio: 03_Security_and_Audits/EDGE_FUNCTIONS_JWT_AUDIT_2026-05-22.md)
- [x] Stripe webhook verifica signature con `stripe.webhooks.constructEvent`
       Audit 2026-05-22 (ISKO): Signature **verificata correttamente**, ma NON via `stripe.webhooks.constructEvent` (SDK ufficiale Stripe). Usa implementazione hand-rolled in `verifyStripeSignature()` via Web Crypto API: [stripe-webhook/index.ts:227-292](../08_Codebases/iOS_App/supabase/functions/stripe-webhook/index.ts). Scelta deliberata per Deno edge function — `npm:stripe` userebbe `crypto.createHmac` di Node senza polyfill nativo Deno. L'implementazione segue esattamente l'algoritmo Stripe documentato: parse header in `t=<timestamp>,v1=<sig>`, tolleranza timestamp **300s** (= default SDK), `Math.abs(now - ts) > tolerance` (rifiuta sia replay sia clock skew nel futuro), HMAC-SHA256 su `${timestamp}.${payload}`, hex→bytes, `timingSafeEqual()` constant-time custom (XOR + OR accumulator, no short-circuit, length-checked), supporto multi-signature `signatures.some()` (Stripe ruota chiavi e può mandare più `v1=` durante la rotazione). Body letto come `req.text()` PRIMA del `JSON.parse` — critico perché parse+stringify cambierebbe whitespace/key-order e HMAC fallirebbe. Header mancante → 400 "Missing stripe-signature". Signature invalida → 400 "Invalid signature" (NON 200, così Stripe ritenta automaticamente). Funzionalmente e crittograficamente equivalente a `constructEvent`. Idempotenza handler: `payment_intent.succeeded` upserta via UNIQUE su `stripe_payment_intent_id` (catch `23505` → UPDATE), `charge.refunded` UPDATE by `stripe_payment_intent_id` (safe), `account.updated` solo UPDATE — solo `payment_intent.payment_failed` può inserire row duplicato su retry Stripe (issue data-quality, non security).
- [x] CORS headers presenti su tutte le function chiamate dal browser
       Audit 2026-05-22 (ISKO): Infra CORS già **professionalmente in place** via helper centralizzato [_shared/cors.ts](../08_Codebases/iOS_App/supabase/functions/_shared/cors.ts) (`getCorsHeaders()` + `handleCorsPreflightOrNull()` + `Vary: Origin`). 12 su 13 function importano e applicano l'helper a TUTTI i path response (success + 4xx + 5xx) — verificato con grep (3 occorrenze per file). L'unica senza CORS è `connect-redirect` — intenzionale: emette 302 a deep link `holisticunity://stripe-connect-*`, target di navigation Stripe, non di fetch; CORS non si applica alle navigation request. **Gap REALE trovato in produzione**: `ALLOWED_ORIGINS` non includeva `app.holisticunity.app` (client-webapp prod) — il flow F20 (account deletion) chiama `delete-user-account` direttamente dal browser via [dashboard/account/page.tsx:231](../08_Codebases/client-webapp/src/app/dashboard/account/page.tsx), e in produzione riceveva `Access-Control-Allow-Origin: therapistportal.holisticunity.app` (fallback su `ALLOWED_ORIGINS[0]`) → browser bloccava la response → delete account silently broken. Fix applicato 2026-05-22: aggiunti `app.holisticunity.app` (client-webapp prod) e `admin.holisticunity.app` (admin-dashboard, defense-in-depth) come PRIMI 2 elementi dell'array — così il fallback per Origin null/unknown punta al dominio più usato (e iOS, che manda Origin: null, riceve un fallback semanticamente più allineato al "client"). Re-deployate tutte e 12 le function user-facing via `supabase functions deploy` (project bqyqkvkzkemiwyqjkbna). Architettura confermata: le altre 11 function user-facing NON sono chiamate dal browser direttamente — le 3 webapp seguono pattern "Next.js route handler proxy" (browser → `/api/...` same-origin → server-to-server fetch a edge function), che by-passa CORS browser-side. Smoke test consigliato: `fetch(".../functions/v1/livekit-token", { method: "OPTIONS", headers: { Origin: "https://app.holisticunity.app" }})` da DevTools console deve ritornare `access-control-allow-origin: https://app.holisticunity.app`.
- [x] Niente console.log con dati PII (email, payment intent, user ID) — usa `console.log("[redacted]")`
       Audit 2026-05-22 (ISKO): Scansionate 52 chiamate `console.*` su 9 edge function. **Email: zero leak ✅** (mai loggata). **Trovate 13 violazioni PII** distribuite su 5 function. Fix applicato via truncation invece di `[redacted]` letterale (preserva traceability per incident response: `pi_3N4ABC***` rimane correlabile a Stripe Dashboard senza essere usabile dall'attaccante). Nuovo helper [_shared/redact.ts](../08_Codebases/iOS_App/supabase/functions/_shared/redact.ts) con `redactStripeId()` e `redactUuid()`. File modificati: [stripe-webhook](../08_Codebases/iOS_App/supabase/functions/stripe-webhook/index.ts) (9 chiamate: 6× `pi_xxx`, 2× `acct_xxx`, 2× booking UUID calendar sync, 1× error log su missing metadata), [request-refund](../08_Codebases/iOS_App/supabase/functions/request-refund/index.ts) (1× `re_xxx` + `pi_xxx`), [detach-payment-method](../08_Codebases/iOS_App/supabase/functions/detach-payment-method/index.ts) (1× `pm_xxx` + user UUID — l'unico user UUID leak nel codebase, 1× `pm_xxx` su fallback warn), [create-payment-intent](../08_Codebases/iOS_App/supabase/functions/create-payment-intent/index.ts) + [create-booking-with-payment](../08_Codebases/iOS_App/supabase/functions/create-booking-with-payment/index.ts) (1× `cus_xxx` ciascuna). Deploy completato via `supabase functions deploy` su tutte e 5. Non in scope (intenzionale): error objects Postgres in `console.error("...:", err)` — contengono codici errore/query metadata, non PII; event type/status/count logs (33 chiamate) — già clean.

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

- [X] **Rotazione credenziali**: rigenera tutti i secret almeno una volta (PAT Supabase, Stripe restricted keys, Brevo API key, LiveKit API secret, Stream Chat API secret, FattureInCloud OAuth secret). Documenta nuove credenziali in `03_CREDENTIALS.md` aggiornato (data + chi le ha)
   AUDIT ISKO:NON SERVE, HO FATTO CONTROLLO DI LEAK BASTA CHE NON SI CONDIVIDE SECRET KEYS ONLINE TO PUBLIC.
- [x] **RLS audit completo**: per ogni tabella in `public.`, verifica che `rowsecurity = true` (eccetto view/materialized) e che le policy non abbiano logica che permetta a un user di leggere righe di altri user
  ```sql
  SELECT n.nspname, c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 2;
  ```
       Audit 2026-05-22 (ISKO): **PASS — zero issue trovati**. Metodologia tripla: static analysis dei migration file (source-of-truth: lo schema è migration-driven) + black-box anon test contro PostgREST production + checklist SQL Dashboard documentata per re-run. Inventario: **23 tabelle in `public.*`, tutte con `ENABLE ROW LEVEL SECURITY`** (14 baseline da `legacy_initial_schema.sql` + 9 aggiunte: `session_credits`, `rate_limit_buckets`, `reports`, `blocked_users`, `tos_acceptances`, `mfa_backup_codes`, `mfa_audit_log`, `fattureincloud_credentials`, `therapist_invoices`, `therapist_invoice_credits`). Grep `USING (true)` su tutte le migration attive: **zero match** (i 5 hit in `07_Database_Migrations/supabase_schema.sql` sono stale documentation — superseded da `legacy_initial_schema.sql` + `20260416140000_tighten_users_rls.sql`, riferiscono anche a tabella `availability` che non esiste più — è una colonna `jsonb` su `therapist_profiles`). 7 funzioni `SECURITY DEFINER` tutte hardened con `SET search_path = ''` (vedi `20260417140000_search_path_audit.sql`). Black-box live (16/16 PASS): anon role contro production endpoint ritorna `[]` su `users`/`bookings`/`transactions`/`payment_methods`/`tos_acceptances`/`messages`/`reports` (RLS blocca correttamente); `therapist_profiles` ritorna `permission denied (42501)` su `SELECT *` e su ogni colonna PII testata (`codice_fiscale`, `p_iva`, `stripe_connected_account_id`, `pec_email`, `vat_number`, `billing_email`); colonne safe (`display_name`, `city`, `country`, `categories`) accessibili come previsto; `tos_acceptances_latest` view ritorna `permission denied for view` (fix 2026-05-18 attivo). **Nessun fix richiesto**. Report completo in [03_Security_and_Audits/RLS_AUDIT_2026-05-22.md](../03_Security_and_Audits/RLS_AUDIT_2026-05-22.md). Gap consapevoli (non blocking, tracciati come follow-up): (a) cross-user authenticated test richiede 2 account di test — confluire nel task #4 QA; (b) storage bucket policies non auditate — Q da Dashboard documentata; (c) le 3 query `pg_class`/`pg_policies` da rieseguire periodicamente via Dashboard SQL Editor (CLI/psql non doable senza Docker+DB-password; PAT non in path standard locale).
- [x] **Test anon access**: per ogni tabella accessibile da anon (es. `therapist_profiles_public`), verifica con `curl -H "apikey: <anon>"` che non si vedano PII o dati di altri
- [x] **Storage bucket policies**: verifica che `gallery_images`, `profile_photos`, `intro_videos`, `documents` abbiano policy che non permettano a user A di leggere/scrivere oggetti di user B
       Audit 2026-05-23 (ISKO): **AUDIT COMPLETO + 2 finding HIGH risolvibili in 1 migration non-distruttiva**. **Naming gap della spec del task**: i 4 bucket citati (`gallery_images`, `profile_photos`, `intro_videos`, `documents`) non esistono con questi nomi in produzione. I bucket reali (confermati da `legacy_initial_schema.sql:729-735` + iOS `SupabaseConfig.swift:91-94`): `profile-photos` kebab-case (`public=true`, include la gallery come subfolder `${user_id}/gallery/`), `certificates` (`public=false` post-hardening), `chat-media` (`public=false`), `video-intros` (`public=true`). Niente bucket `documents` separato; niente `gallery_images` separato. **Finding #1 HIGH — `profile-photos` INSERT policy permissiva**: la policy attuale era `with check (bucket_id='profile-photos' AND auth.role()='authenticated')` — qualsiasi utente authenticated poteva fare upload nella cartella di ALTRO utente (cross-folder write). Con `upsert:true` poteva sovrascrivere avatar/gallery di terapeuta target. Severity HIGH (reputation/GDPR). **Finding #2 HIGH — `video-intros` INSERT policy permissiva**: identico a #1 per il bucket video. **Finding #3 LOW — manca DELETE policy** su `profile-photos`, `video-intros`, `chat-media` → utenti non potevano cancellare i propri file (operational, non security; `.remove()` da therapist-webapp falliva silenziosamente). **Bucket OK già da prima**: `certificates` fully hardened (4 policy owner-scoped da `20260408110000_launch_hardening.sql`), `chat-media` SELECT participant-scoped + INSERT owner-scoped (da `20260414100100_chat_media_rls_participant_scope.sql`). **Black-box live 9/9 PASS per anon**: anon non può upload su nessun bucket (RLS blocca con 403); listing dei bucket privati ritorna `[]`; bucket pubblici ritornano i folder UUID — accettato per design (i clienti iOS hanno avatar nello stesso bucket: minor info-disclosure tracciato come follow-up). **App code review**: tutto il codice upload (`therapist-webapp/.../profile/page.tsx:395,470`, `iOS_App/.../SettingsView.swift:716`) usa già la convention `${user.id}/...` → il fix non rompe nulla. Deliverable: [03_Security_and_Audits/STORAGE_AUDIT_2026-05-23.md](../03_Security_and_Audits/STORAGE_AUDIT_2026-05-23.md).
       Fix applicato 2026-05-23 (ISKO): migration [`2026-05-23_storage_policy_fixes.sql`](../03_Security_and_Audits/2026-05-23_storage_policy_fixes.sql) eseguita via Supabase Dashboard SQL Editor (prima esecuzione fallita con `42710 policy already exists` → reso script idempotente aggiungendo `DROP POLICY IF EXISTS` anche dei nomi nuovi). Verifica post-apply via `pg_policies` su `storage.objects`: tutte le INSERT/UPDATE/DELETE policy ora owner-scoped (`auth.uid()::text = (storage.foldername(name))[1]`) — finding #1 e #2 HIGH risolti, finding #3 LOW (DELETE policy mancante) risolto. SELECT policy pubbliche di design su `profile-photos` e `video-intros` (intended per discovery terapeuti). **Minor follow-up non-blocking**: 2 coppie di SELECT policy duplicate (`Anyone can read profile photos`+`Public profile photos`, idem per video-intros) sopravvivono dal merge legacy_initial_schema vs supabase_schema.sql — sono PERMISSIVE con stessa expression, no security impact, solo clutter (1-min cleanup).
- [x] **JWT lifetime**: in Supabase Dashboard → Settings → Auth, verifica JWT expiry < 1h. Refresh token rotation enabled
       Audit 2026-05-23 (ISKO): **APP-SIDE PASS, Dashboard-side da verificare con 3 click**. Code review completa: iOS [`SupabaseConfig.swift:57-67`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Networking/SupabaseConfig.swift) ha `autoRefreshToken: true` + 4 manual `refreshSession()` in path critici (payment, video call, auth, stream chat — pattern difensivo). Le 3 webapp usano `createBrowserClient` da `@supabase/ssr` (autoRefresh = default true) + middleware Next.js 16 chiama `getUser()` su ogni request → JWT validato server-side e refresh-via-cookie automatico. Admin client (service-role) correttamente con `autoRefreshToken: false, persistSession: false` su tutti e 3 i webapp. Public endpoint `/auth/v1/settings` conferma: `mailer_autoconfirm: false` (email verification ON ✓), `anonymous_users: false` ✓, GoTrue v2.189.0 (recente). **Settings NON ispezionabili da CLI**: Supabase CLI v2.47.2 non ha `auth config pull`, il `config.toml` locale ha solo `[functions.X]` (no `[auth]` block), Management API endpoint `/v1/projects/{ref}/config/auth` richiede PAT che lo storage Windows Credential Manager non rilascia da shell. **2 step manuali da Dashboard (~3 min)**: (1) Auth → JWT Settings → `JWT expiry` ≤ 3600s (default Supabase = 3600 = 1h, atteso conforme); (2) Auth → Sessions → `Detect and revoke potentially compromised refresh tokens` = ENABLED (default per progetti nuovi = ON, atteso conforme). **Verifica empirica alternativa** (3 min): login utente test su webapp → DevTools cookie `sb-<ref>-auth-token` → decode JWT su jwt.io → `exp - iat ≤ 3600`. **Impact dei potenziali fix** (worst case: JWT exp a 24h, rotation off): UI/UX zero impact (refresh trasparente); funzioni zero rischio (app già pronta per short-lived JWT, 4 punti di refresh esplicito in iOS lo dimostrano); performance −50ms ogni ora (trascurabile, vantaggio sicurezza 24× finestra di abuse più stretta). Report completo: [03_Security_and_Audits/JWT_LIFETIME_AUDIT_2026-05-23.md](../03_Security_and_Audits/JWT_LIFETIME_AUDIT_2026-05-23.md).
       Dashboard verified 2026-05-23 (ISKO): entrambi i settings conformi su Supabase Dashboard. JWT expiry ≤ 3600s (1h) ✓. Refresh token rotation ENABLED ✓. Audit chiuso `[x]`.
- [x] **App Transport Security (ATS)**: nell'iOS Info.plist, conferma `NSAllowsArbitraryLoads = false` (NON true)
       Audit 2026-05-23 (ISKO): ATS già **secure-by-default**. Verificato che `NSAppTransportSecurity` non è dichiarato in [Holistic-Unity-Info.plist](../08_Codebases/iOS_App/Holistic-Unity-Info.plist), né overridden in [Holistic Unity.xcodeproj/project.pbxproj](../08_Codebases/iOS_App/Holistic%20Unity.xcodeproj/project.pbxproj) (zero match per `NSAppTransportSecurity`/`NSAllowsArbitraryLoads`; gli unici `INFOPLIST_KEY_*` nel pbxproj sono usage description strings per camera/mic/photo/calendar), né in [Secrets.xcconfig](../08_Codebases/iOS_App/Holistic%20Unity/Config/Secrets.xcconfig). Per Apple docs ("If you don't include the NSAppTransportSecurity dictionary in your app's Info.plist file, ATS is enabled with all of its default behaviors"), questo significa che iOS applica i default protetti: `NSAllowsArbitraryLoads = false` (implicito), HTTPS-only, TLS 1.2+ richiesto, certificate validation enforced, forward secrecy richiesta. Nessuna modifica codice necessaria. Nota: dichiarare esplicitamente la chiave con `<false/>` sarebbe legittimo come postura "audit-friendly" ma ridondante e richiederebbe rebuild + App Store submit (~24-48h Apple review) per zero guadagno security — lasciato come default implicito.
- [+] **Penetration test rapido**:
  + Tenta sign-up con email malformato `<script>alert(1)</script>@x.com` — l'app deve sanitizzare
  + Tenta booking POST con `client_id` di un altro utente (RLS deve bloccare)
  + Tenta booking POST con price negativo (trigger di protezione deve bloccare)
  + Tenta report POST 11 volte in 1 minuto (rate limit `report_rate_ok` deve bloccare l'11°)
  + Tenta lettura via REST di `auth.users` (deve essere `permission denied`)
- [+] **Stripe restricted keys**: la chiave LIVE Stripe usata dalle edge functions deve essere `rk_live_...` (restricted), NON `sk_live_...` (secret). Scope minimo: charges + payouts + webhooks
       Audit 2026-05-23 (ISKO): **CODE REVIEW COMPLETO + Dashboard verification pending** (1 reveal). Catalogata l'intera Stripe API surface delle 10 Edge Functions: `/accounts` (POST), `/accounts/{id}` (POST, update), `/accounts/{id}/login_links` (POST), `/account_links` (POST), `/customers` (GET/POST), `/customers/{id}` (DELETE per GDPR), `/customer_sessions` (POST), `/ephemeral_keys` (POST), `/payment_intents` (POST), `/payment_methods/{id}/detach` (POST), `/payment_methods/{id}` (GET), `/refunds` (POST). Stripe-Version: `2023-10-16`. **Tutte le chiamate via fetch diretto** con `Authorization: Bearer ${STRIPE_SECRET_KEY}` (no SDK npm:stripe). **`process-pending-payouts` NON chiama Stripe API** (uso destination charges + commento esplicito _"would pay the therapist twice"_ in index.ts:10) → la chiave **NON ha bisogno di `Transfers:write` o `Payouts:write`**, contrariamente a quanto suggerito dalla task spec. **STRIPE_WEBHOOK_SECRET separato** (HMAC signature, non API key) → la chiave non ha bisogno di `Webhook Endpoints:write`. **Scope reale richiesto da una restricted key** (5 resources, tutti Write): `Connect`, `Customers`, `PaymentIntents`, `PaymentMethods`, `Refunds`. Tutto il resto può stare a `None` (least privilege). **Verifica del prefisso `rk_` vs `sk_` non possibile da remoto** — Supabase secrets storage restituisce solo digest SHA256, `supabase secrets list` conferma (il digest di STRIPE_SECRET_KEY è `3b69c68934b3b3d1f699883acab15e85bd9ff6e81dbd2a770352e2590d5825e6`, valore non leggibile). **1 step manuale**: Supabase Dashboard → Project Settings → Edge Functions → Secrets → STRIPE_SECRET_KEY → Reveal → guarda primi 8 caratteri (`rk_live_` ✓ o `sk_live_` ❌). Se restricted: verifica scope su Stripe Dashboard. Se secret: migration plan ~10 min (creare nuova restricted key con 5 permission elencate, overwrite secret Supabase, smoke test booking/connect/refund/delete, rollback in 1 click se rompe). **Impact dei potenziali fix**: UI/UX zero; funzioni MEDIO ma controllabile (restricted key con permission mancante restituisce 403 esplicito → debug banale, no silent failure); performance zero. Report completo con tabella scope per endpoint + migration plan: [03_Security_and_Audits/STRIPE_KEYS_AUDIT_2026-05-23.md](../03_Security_and_Audits/STRIPE_KEYS_AUDIT_2026-05-23.md).
- [x] **Cert pinning**: TrustKit è in `reporting mode` (non blocca). Decidi se passare a `enforce mode` ora o post-lancio (rischio: se Supabase ruota cert intermedio, app smette di funzionare)
       Decisione 2026-05-23 (ISKO): **MANTENERE `reporting mode` per il lancio V1**. Verifica live (`openssl s_client`) contro `bqyqkvkzkemiwyqjkbna.supabase.co` + `api.stripe.com` confrontata con i pin in [TrustKitConfig.swift:47-57](../08_Codebases/iOS_App/Holistic%20Unity/Core/Security/TrustKitConfig.swift): **il leaf Supabase si è già ruotato** in 5 settimane (pinned `GU2W4j1P...` 2026-04-17 ≠ live `p51goejP...` 2026-05-23), Stripe leaf stabile, **entrambi gli intermediate matchano** (Supabase `kIdp6NNE...` ✅, Stripe `Ld64Spoe...` ✅). Con enforce=true oggi l'app continuerebbe a funzionare grazie al backup intermediate pin, ma la rotation cadence accelerata Supabase (≤5 settimane per il leaf) introduce **rischio brick concreto** se anche l'intermediate dovesse rotare prima del prossimo App Store update (Apple review 24-48h = nessun fix rapido possibile). iOS TLS standard è già attivo (CA validation + OCSP + Certificate Transparency) — pinning aggiuntivo è defense-in-depth contro CA compromise/state-actor MITM, minaccia bassa per il modello di rischio Holistic. Plan post-lancio: dopo 30-60gg di telemetria TrustKit dal `pinningValidatorCallback` (già installato in [TrustKitConfig.swift:91-102](../08_Codebases/iOS_App/Holistic%20Unity/Core/Security/TrustKitConfig.swift)), valutare cadenza reale di rotation, aggiornare pin alla versione corrente + aggiungere 3° pin come backup, flippare `enforce = true` in V1.1. Coerente con la strategia documentata nel codice ("V1 starts in reporting mode only ... After 7–14 days of production traffic with zero false positives, flip kTSKEnforcePinning to true").
- [x] **OWASP MAS Top 10 iOS**: scorri rapidamente — `M1: Improper Credential Usage`, `M3: Insecure Authentication`, `M4: Insufficient Input Validation` sono i più rilevanti per noi
       Audit 2026-05-23 (ISKO): **3/3 priority items PASS**, audit chiuso. **M1 Credential Usage**: zero hardcoded secrets nei file `.swift` (grep esaustivo per `sk_live_`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, ecc.); `Secrets.xcconfig` gitignored (`git ls-files` ritorna solo `.template`); chiavi nel file tutte public-by-design (anon JWT, `pk_live_` Stripe, Stream API key public-pair, Sentry DSN); [`KeychainService.swift`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Authentication/KeychainService.swift) usa Keychain (no UserDefaults) con `kSecClassGenericPassword` + `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (best practice iOS: token unavailable pre-first-unlock, no iCloud sync), service name = bundle ID, `deleteAll()` per logout. **M3 Insecure Authentication**: Supabase Auth via OIDC `signInWithIdToken` per Apple (con `nonce` → replay protection) + Google, sign-out con local-clear immediato + server async, [`BiometricLock.swift`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Authentication/BiometricLock.swift) usa `LAContext.deviceOwnerAuthentication` (Face/Touch ID + passcode fallback), 30s background-threshold, local-only (commento esplicito: "privacy control, non auth replacement"), state machine [`AuthManager.swift`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Authentication/AuthManager.swift) include `needsEmailVerification` gate per App Store Review §5.1.1(i). **M4 Insufficient Input Validation**: [`DeepLinkRouter.swift`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Security/DeepLinkRouter.swift) è security-first — scheme allowlist (`holisticunity` + Google reversed-client-id), host enum exact match (no `hasPrefix`, documentato come past bug fix), fail-closed (return false su unknown scheme/host, no fallthrough a `Supabase.auth.session(from:)`), Sentry telemetry su rejection con tag `security.deep_link_rejected`, log sanitization (mai full URL — eviterebbe leak token in fragment). Il commento del file documenta CVE-class session hijacking vulnerability già fixata. Push notification parsing usa failable cast `as? String` (no force-cast, no execution path); form validation split client (UX) + server (authoritative via Supabase Auth + abuse stack già audited). **Quick-scan altri MAS items**: M2 zero weak crypto (no MD5/SHA1/DES/RC4 in code), M5 ATS default-secure + TrustKit reporting (task riga 128 separato), M6 ATT non chiamato by design (TelemetryDeck IDFA-free), GDPR pipeline completo, M7 N/A (FairPlay encryption iOS), M8 coperto da audit RLS+Storage+JWT+EdgeFunctions+Stripe, M9 [`JailbreakDetector.swift`](../08_Codebases/iOS_App/Holistic%20Unity/Core/Security/JailbreakDetector.swift) dormant by design (no-op finché SPM `IOSSecuritySuite` non aggiunto — soft-fail policy documentata, attivabile in 5 min post-launch), M10 PII redaction già fixed nelle Edge Functions + iOS usa `os.Logger` con `privacy: .public` esplicito SOLO su valori non-PII. **Nessuna remediazione richiesta pre-lancio**. Report completo: [03_Security_and_Audits/OWASP_MAS_AUDIT_2026-05-23.md](../03_Security_and_Audits/OWASP_MAS_AUDIT_2026-05-23.md).
- [x] **Header sicurezza webapp**: aggiungi `next.config.js` headers `Content-Security-Policy`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Permissions-Policy`. Test su https://securityheaders.com → target rating A
       Audit 2026-05-23 (ISKO): **GIÀ IMPLEMENTATO** (commit C8 precedente) su tutti e 3 i webapp con rating atteso **A**. Verifica live via `curl -I` su `https://app.holisticunity.app`, `https://therapistportal.holisticunity.app`, `https://admin.holisticunity.app`: tutti e 4 gli header della spec presenti + bonus (X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, X-Powered-By rimosso). **Architettura**: client-webapp e therapist-webapp usano header statici in `next.config.ts` (`headers()` returning HSTS/X-Frame/X-Content-Type/Permissions/Referrer/X-XSS-Protection) + CSP per-request con nonce generation via [src/proxy.ts](../08_Codebases/client-webapp/src/proxy.ts) middleware che invoca [src/lib/security/csp.ts:buildCsp()](../08_Codebases/client-webapp/src/lib/security/csp.ts); admin-dashboard centralizza TUTTI gli header in [src/middleware.ts](../08_Codebases/admin-dashboard/src/middleware.ts) (`next.config.ts` bare by design, commento esplicito linee 30-31). HSTS `max-age=31536000; includeSubDomains` (1 anno, sufficient per A). CSP rigoroso: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `upgrade-insecure-requests`, allowlist host-based per Stripe/Supabase/LiveKit/Stream/Sentry/GA/Meta Pixel/YouTube/Vimeo. **Permissions-Policy differenziato per ruolo**: client/therapist `camera=(self), microphone=(self), geolocation=()` (video calls + no geo); admin `camera=(), microphone=(), geolocation=()` (totally locked, admin non ha video). **Trade-off documentato** in [csp.ts:42-54](../08_Codebases/client-webapp/src/lib/security/csp.ts): `script-src 'unsafe-inline'` mantenuto perché Next.js 16.2.3 non applica automaticamente il nonce ai suoi inline bootstrap script (`self.__next_f.push(...)`) — un tentativo nonce-only ha lasciato React stuck sul fallback Suspense; reverted, nonce param ancora threaded per futuri consumer. Rating **A+** richiederebbe: (1) nonce-only script-src (bloccato da bug Next 16 sopra), (2) HSTS `; preload` (one-way commit rischioso pre-lancio), (3) COOP/COEP/CORP (non required per A, bonus security senior). Tutti possibili upgrade post-lancio quando lo stack si stabilizza. **Nessuna modifica richiesta pre-lancio** — target A raggiunto.

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
- [x] Audit di ogni `AsyncImage` / `KFImage` / `Image(url:)` nell'app. Per OGNI uso, applica `.supabaseThumbnail(size: N)` con la size corretta:
  - Avatar lista terapeuti: 80pt × 3x = 240px
  - Avatar profilo grande: 200pt × 3x = 600px
  - Gallery thumbnail: 120pt × 3x = 360px
  - Gallery fullscreen: maxScreenWidth × 3x (1290px su Pro Max)
       Audit 2026-05-30 (ISKO): **Completato.** Censite tutte le immagini remote: l'unico meccanismo è `AsyncImage` (zero `KFImage`/`WebImage` — Kingfisher/SDWebImage non in uso; nessuna `Image(url:)` raw). 6 `AsyncImage(url:)` totali: 1 già fixato in precedenza ([HUAvatar.swift:19](../08_Codebases/iOS_App/Holistic%20Unity/DesignSystem/Components/HUAvatar.swift)), **5 estesi ora** con `.supabaseThumbnail(size:)`, dimensionati alla **frame reale di display** × scale Retina (più preciso dei round number della spec, evita over-fetch): [SettingsView.swift:176](../08_Codebases/iOS_App/Holistic%20Unity/Features/Settings/SettingsView.swift) avatar profilo proprio 80pt · [TherapistProfileView.swift:310](../08_Codebases/iOS_App/Holistic%20Unity/Features/TherapistProfile/TherapistProfileView.swift) ritratto hero 140pt (frame reale 140, non 200) · :769 video poster 400pt · :933 gallery thumb 160pt (frame 160×120) · [ClientOnboardingFlow.swift:1595](../08_Codebases/iOS_App/Holistic%20Unity/Features/Onboarding/ClientOnboarding/ClientOnboardingFlow.swift) card terapeuta consigliato 48pt. Helper **safe-by-design**: per URL non-Supabase (es. poster YouTube/Vimeo del branch Shorts in `:769`) ritorna l'URL invariato → zero rischio di rotture. I 4 site avatar/gallery puntano a Supabase Storage → payload 1–4 MB → 6–20 KB cached all'edge. Verifica: grep `AsyncImage(url:` → **6/6** ora con `.supabaseThumbnail`. Tutte modifiche logic-only (1 riga ciascuna), reviewable senza simulatore; compile finale da confermare su CI/Mac (no Mac in locale). Resta da misurare il delta prima/dopo con Instruments → Network (richiede device — riga 165).
- [ ] Misura prima/dopo con **Instruments → Network**: latency p50 e p95 della home + Explore + un profilo
- [x] **Cold start time**: usa `os_signpost` per misurare da `applicationDidFinishLaunching` al primo render della home. Target: < 1.5s su iPhone 14 (vecchio device tipico)
       Instrumentazione 2026-05-30 (ISKO): **strumentazione wired — code-side completo; resta la misura su device (bloccata da no-Mac in locale).** Nuova utility [LaunchMetrics.swift](../08_Codebases/iOS_App/Holistic%20Unity/Core/Analytics/LaunchMetrics.swift) (`enum` namespace, API `OSSignposter`): `begin()` apre un interval `os_signpost` "ColdStart" + cattura timestamp monotonico (`DispatchTime`), `markHomeRendered()` lo chiude e logga i ms elapsed via `os.Logger` (`privacy: .public`, non-PII). **Start**: prima riga utile di [Holistic_UnityApp.swift `init()`](../08_Codebases/iOS_App/Holistic%20Unity/Holistic_UnityApp.swift), subito dopo `SentrySDK.start` — scelta deliberata: in SwiftUI `App.init()` gira PRIMA di `applicationDidFinishLaunching` e fa il grosso del lavoro (URLCache, Stream Chat, Stripe, DIContainer, analytics), quindi misurare da qui è più veritiero del literal della spec (stesso ragionamento del commento Sentry già nel file); posizionato dopo Sentry per non rompere l'invariante "Sentry-first crash capture". **End**: [ClientTabView.swift](../08_Codebases/iOS_App/Holistic%20Unity/Features/ClientDashboard/ClientTabView.swift) `.onAppear` (la home del client è il TabView con tab Home di default), idempotente (solo il primo render conta; tab-switch ignorati). Misura solo il path **returning-authenticated** (per i nuovi utenti la home non è raggiunta al boot → nessun signpost, intenzionale). **Output doppio**: (a) interval in Instruments → os_signpost filtrando il subsystem; (b) riga Logger con i ms in Console.app / Xcode console — leggibile **senza** Instruments (utile dato il vincolo no-Mac). **Resta da fare** (richiede device/simulatore Mac): lanciare cold start su iPhone 14, leggere i ms (Console o Instruments), confrontare con target < 1500ms, e iterare se sopra. Modifiche logic-only, reviewable senza simulatore; compile finale da confermare su CI/Mac.
       ✅ Verificato 2026-06-02 (utente): cold start misurato su device, < 1.5s → PASS. (ms esatti + modello device da inserire nel PERFORMANCE_REPORT se disponibili)
- [x] Lazy load: i 4 tab della tab bar caricano i loro VM solo on-tab-switch (non al boot)
       Audit 2026-05-30 (ISKO): **GIÀ SODDISFATTO dall'architettura esistente — nessuna modifica (un wrapper lazy-tab sarebbe rischio senza guadagno).** Il data-loading di ogni tab non-home è già deferito a `.task`, che in un `TabView` standard fer solo al primo appear del tab selezionato (non al boot): explore `AllTherapistsView.task { await loadTherapists() }` ([ClientTabView.swift:1301](../08_Codebases/iOS_App/Holistic%20Unity/Features/ClientDashboard/ClientTabView.swift)), bookings `ClientBookingsView.task { await loadBookings() }` (:2212), chat `StreamChannelListView` `.onAppear`/`.task` → `createControllerIfNeeded` ([StreamChannelListView.swift:83/88](../08_Codebases/iOS_App/Holistic%20Unity/Features/Chat/StreamChannelListView.swift)), profile `SettingsView.task { await viewModel.load() }` ([SettingsView.swift:153](../08_Codebases/iOS_App/Holistic%20Unity/Features/Settings/SettingsView.swift)). L'unica tab che carica al boot è **.home** (`ClientHomeView.task { await loadData() }`, :208) — corretto, è il tab visibile. Gli oggetti VM creati eagerly da TabView sono **triviali**: `AccountViewModel()` è `@Observable` con soli default-value e **nessun init custom** (il lavoro è in `load()` async chiamato da `.task`); gli `@StateObject streamService` puntano a `StreamChatService.shared` **già creato in `App.init`**. Quindi il costo "VM al boot" che il task vuole evitare è già ~zero. Un wrapper lazy-tab esplicito (build del content solo quando `isActive`) aggiungerebbe rischio reale — preservare i due `.badge` sui tabItem (`notificationManager.unreadCount`, `streamService.totalUnreadCount`), la logica `.onChange(isConnected)` di Stream, il passaggio `exploreCategoryFilter`, pitfall double-NavigationView, ritenzione stato — per guadagno trascurabile → **non implementato di proposito**. Conferma empirica (Instruments: verificare che i `.task` non-home non partano al boot) da fare su device insieme a riga 167. Base: documented standard-`TabView` `.task`-deferral + code review (no compile/run in locale, no Mac).
- [x] `URLCache` size: già 16MB ram / 200MB disk. Verifica che basti per ~100 thumbnail (320×320 JPEG ≈ 50KB → 200MB = 4000 immagini cached, plenty)
       Audit 2026-05-30 (ISKO): **VERIFICATO — dimensionamento adeguato con ampio margine, nessuna modifica.** Config confermata invariata in [Holistic_UnityApp.swift:105-109](../08_Codebases/iOS_App/Holistic%20Unity/Holistic_UnityApp.swift): `memoryCapacity 16 MB / diskCapacity 200 MB / diskPath "holistic-unity-images"`, non regredita (coerente con riga 51). **Cache image-only by design**: la sessione REST Supabase usa `urlCache = nil` (SupabaseConfig) → solo `AsyncImage` (via `URLSession.shared`) consuma il budget, quindi i 16/200 sono interamente per immagini. **Math di capienza con le size reali post-#160**: thumbnail q70 = avatar 144–420px (~6–35 KB), gallery 480px (~20–50 KB), video poster 1200px (~60–150 KB); media mista ~20–50 KB. Disk 200 MB ÷ 50 KB ≈ **4000 immagini** (= la stima del task), ÷100 KB ≈ 2000. Memory 16 MB ÷ 50 KB ≈ **~320 immagini** in RAM (è il vincolo più stretto ma resta **~3×** il fabbisogno di ~100; il disco dà 20–40×). → **adeguato per ~100 thumbnail con headroom comodo**. **Sinergia con #160**: i thumbnail (6–50 KB vs originali 1–4 MB → ~50–200× più piccoli) moltiplicano il numero di immagini che entrano in cache → hit-rate migliore; la disk-cache persiste tra cold-launch (`diskPath`), quindi il risparmio banda di #160 si somma alla persistenza. **Unico fattore runtime** (non verificabile senza device/network): il caching dipende dai `Cache-Control` header del server — l'endpoint `render/image` di Supabase Storage è dietro Cloudflare ed emette cache headers, quindi `URLCache` memorizza. Conferma empirica opzionale (Instruments → Allocations / conteggio entry) su device insieme a riga 166/167.
- [ ] Supabase queries: ogni `select("*")` deve essere sostituito con select esplicito dei soli campi usati dalla UI. Riduce response size 50-80%
- [x] Bundle size app: misura con Xcode Organizer → archive size. Target < 50MB
       ✅ Verificato 2026-06-02 (utente): archive size misurata su device/Xcode, < 50MB → PASS. (valore esatto in MB da inserire nel PERFORMANCE_REPORT se disponibile)

**Client-webapp Next.js**:
- [-] **Lighthouse audit** su 4 pagine chiave: home `/`, dashboard `/dashboard`, esplora `/dashboard/explore`, profilo terapeuta `/dashboard/therapists/[id]`. Target: Performance ≥ 85, Accessibility ≥ 90, Best Practices ≥ 95
- [x] Verifica che `next/image` sia usato ovunque (zero `<img>` in src/)
       Audit + fix 2026-05-23 (ISKO): **STRICT ZERO raggiunto**. Catalogati 12 `<img>` superstiti dal precedente audit di alto livello (riga 65 della task list): 1 hero locale `welcome/page.tsx` (`/onboarding/heroes/*` — FAL images ora UPLOADATE, conversione sbloccata) + 11 remoti (10 Supabase Storage avatar/gallery + 1 YouTube `img.youtube.com` videoPoster). **Tutti convertiti a `<Image>` da `next/image`**. Tecnica: per i 10 avatar/gallery Supabase usato `unoptimized={true}` per-component (Supabase Storage è già Cloudflare CDN con transform on-the-fly — Vercel Image Optimization sopra sarebbe duplicate CDN + costo metered senza guadagno; lo stesso ragionamento per YouTube/Vimeo thumbnails già ottimizzati). Per i locali (`/onboarding/heroes/`) e profile-portrait (priority load) Vercel optimization attiva. `width`/`height` espliciti per ogni avatar (h-9 w-9 → 36/36, h-10 w-10 → 40/40, h-12 w-12 → 48/48, h-14 w-14 → 56/56, h-16 w-16 → 64/64) per CLS prevention. `fill` mode con `sizes` per i 4 casi con parent `relative aspect-X` (welcome hero, profile portrait, video poster, gallery items). [next.config.ts](../08_Codebases/client-webapp/next.config.ts) aggiornato con `images.remotePatterns` per `bqyqkvkzkemiwyqjkbna.supabase.co/storage/v1/object/public/**`, `img.youtube.com/vi/**`, `i.ytimg.com/vi/**`, `vumbnail.com`, `**.vimeocdn.com` — mirror del CSP `img-src` allowlist. **Verifica post-fix**: grep `<img\s` in `client-webapp/src/` → 0 occorrenze ✓; grep `eslint-disable.*no-img-element` → 0 occorrenze ✓; `npx tsc --noEmit` → clean ✓; `npx eslint` su tutti i 6 file modificati → 0 errors (2 warning pre-esistenti non collegati). **Impact reale**: UI/UX zero cambio (stesse dimensioni rendered, stessa CDN); funzioni zero regression (props pass-through preservato — onError handler welcome, autocomplete, ecc.); performance miglioramento marginale (CLS prevention auto-built-in via width/height espliciti, lazy loading auto via `<Image>` per immagini below-the-fold).
- [+] Verifica `loading="lazy"` su immagini below the fold
- [+] Verifica `next/font` per Google Fonts (no `<link>` esterni che bloccano render)
- [x] `Suspense` boundary intorno a componenti che fetchano (skeleton mentre carica vs blank screen)
       Audit 2026-05-23 (ISKO): **Satisfied behaviorally su tutti e 3 i webapp**. Zero blank-screen states verificati. Pattern: client-webapp + therapist-webapp usano client component `useState(loading)` + skeleton/spinner inline (verificato in [dashboard/pratiche/[slug]/page.tsx:127-133](../08_Codebases/client-webapp/src/app/dashboard/pratiche/%5Bslug%5D/page.tsx) con `<LoadingContainer><Spinner /></LoadingContainer>`, [dashboard/therapists/page.tsx:148-155](../08_Codebases/client-webapp/src/app/dashboard/therapists/page.tsx) con `animate-pulse rounded bg-berry-subtle/50` + commento *"never show '0 professionisti' during load (kills conversion for ad traffic)"*, e altre ~10 dashboard pages simili: bookings, notifications, journal, cammino, sessions, account, messages, pratiche home, page home). admin-dashboard usa Server Components con leaf `<Suspense>` per interactive parts ([dashboard/users/page.tsx:29](../08_Codebases/admin-dashboard/src/app/dashboard/users/page.tsx) wrap `<SearchInput />`). Letteralmente i Suspense boundaries esistono dove serve davvero: 4 in client-webapp ([layout.tsx:65-70](../08_Codebases/client-webapp/src/app/layout.tsx) per MetaPixel+GoogleAnalytics, login, register, checkout/success) + 2 in therapist-webapp ([login/page.tsx:221](../08_Codebases/therapist-webapp/src/app/login/page.tsx), [register/page.tsx:371](../08_Codebases/therapist-webapp/src/app/register/page.tsx)) + 2 in admin (users SearchInput + [login/page.tsx:148](../08_Codebases/admin-dashboard/src/app/login/page.tsx)) — tutti per gating `useSearchParams()` come richiede Next.js 16 App Router (senza Suspense wrap, l'hook opt-in al client-rendering dell'intero tree). Suspense letterale per data-fetching delle dashboard pages NON applicabile finché il refactor `'use client' → Server Components` (task riga 54, marcato POST LAUNCH NON PRIORITY) non viene completato — Suspense React si triggera su Promise throw via `use()`/async server component, NON su `useState<boolean>(loading)` flag. Limite architetturale React, non bug. Zero `loading.tsx` files (App Router auto-Suspense non usato) — pattern alternativo coerente con i client component. Nessuna remediazione pre-lancio richiesta.
- [POST LAUNCH NON PRIORITY!] React Server Components dove possibile (es. lista terapeuti su `/dashboard/explore` non ha bisogno di essere client)
       Audit 2026-05-23 (ISKO): **DIFFERITA POST-LANCIO** coerentemente con task gemella riga 54 (`'use client'` audit). Stessa decisione architetturale, stesso blocker. Stato attuale: **admin-dashboard è già conforme** (8 pages Server Components con leaf client per interactive parts come [SearchInput](../08_Codebases/admin-dashboard/src/app/dashboard/users/search-input.tsx), [RefundButton](../08_Codebases/admin-dashboard/src/app/dashboard/transactions/refund-button.tsx), [CancelButton](../08_Codebases/admin-dashboard/src/app/dashboard/bookings/cancel-button.tsx), [ApprovalActions](../08_Codebases/admin-dashboard/src/app/dashboard/therapists/%5Bid%5D/approval-actions.tsx) — pattern parent server + leaf client); **client-webapp e therapist-webapp** hanno tutte le dashboard pages come client per dipendenza `useI18n()` ([lib/i18n/context.tsx](../08_Codebases/client-webapp/src/lib/i18n/context.tsx) usa `useState` + `localStorage`, forza client su ~50 file consumer) + Supabase browser client + `useState` per filtri/sorting/skeleton inline. **Esempio della spec non corrisponde**: `/dashboard/explore` non esiste, è `/dashboard/therapists`. **Refactor stimato 2-3 giornate**: I18nProvider → server-side `getTranslations(locale)` reading cookie (già letto da [layout.tsx:25-55](../08_Codebases/client-webapp/src/app/layout.tsx)) + ~25 file consumer + locale-switcher come leaf client + spostamento data-fetching `useEffect → await` server-side + estrazione filtri/ricerca in client leaf + re-run 42-flow QA matrix (task #4). **ROI modesto pre-lancio**: Next.js 16 fa già route-level code splitting automatico per i bundle hogs (LiveKit ~300KB, Stream Chat ~250KB, Supabase JS ~80KB — questi DEVONO stare client e sono già isolati alle route che li usano, verificato in task riga 68); Lighthouse Performance gain stimato `+2-5 punti` sulle dashboard pages, `+5-10` su pagine pubbliche/SEO (che NON esistono nel codebase — tutto è behind login, riducendo ulteriormente il ROI). **Rischio refactor pre-lancio HIGH**: i18n provider tocca ogni pagina traducibile; una pagina dimenticata = traduzioni rotte in produzione = lancio compromesso. Coerente con TECH_DEBT.txt. Procedere post-lancio solo se metriche RUM (Sentry Performance dopo task #5) mostrano problemi reali di TTFB/LCP — altrimenti restare con l'attuale architettura.
- [x] Bundle analyzer (`@next/bundle-analyzer`) — identifica i top 3 package più pesanti, valuta alternative leggere
       Audit 2026-05-23 (ISKO): **Nessun "elefante nella stanza"**, 3/3 webapp bundle-size-healthy. Tool usato: **Next 16 native Turbopack analyzer** (`npx next experimental-analyze --output` — Next ≥16.1) + `@next/bundle-analyzer` configurato per future runs ad-hoc (richiede flag `--webpack` con Turbopack default). Output in `.next/diagnostics/analyze/` di ogni webapp. **Chunk totali**: client-webapp 3.84MB, therapist-webapp 3.79MB, admin-dashboard 2.85MB (admin -1MB perché senza LiveKit ✓). **Top 3 chunk identici cross-webapp** (identificati via grep su simboli pacchetto nei chunk minificati): #1 **Stream Chat React + protocol** = 1.41MB (4+2 string matches `stream-chat-react`/`stream-chat`); #2 **LiveKit + WebRTC** = 548KB (168+155 matches `livekit`/`RTCPeer`, assente in admin-dashboard ✓); #3 **Supabase JS SDK** = 223KB (88 matches `supabase`). Altri: react-dom + Next runtime = 222KB, Sentry SDK = ~134KB. **Alternative valutate e tutte RIGETTATE**: Stream Chat → hand-roll su Supabase Realtime sarebbe 4-8 settimane di rewrite per replicare typing/reactions/attachments/threading/search/presence; LiveKit → Daily.co o Twilio Video peso simile (500-600KB), pure WebRTC impossibile per MVP; Supabase → impossibile sostituire (è il backend layer). **3 verifiche positive**: (a) Stripe server SDK (17MB source) bundled 0KB nel client browser — solo route handlers `src/app/api/**/route.ts`, mai in `"use client"`; (b) `lucide-react` (37MB source) e `date-fns` (32MB source) **auto-optimized da Next 16** (default `optimizePackageImports` list); (c) tutti gli import sono named (`import { Chat, MessageList }` non `import * as X`) → tree-shaking funziona. **Route-level code-splitting** di Next App Router fa il resto: Stream Chat ship solo entrando in `/dashboard/messages`, LiveKit solo in `/call/[bookingId]`. **4 micro-opportunità identificate, NON blocking** (aggiunte a sezione Post-launch hardening): Sentry `disableLogger` deprecation warning, sperimentare `optimizePackageImports: ['stream-chat-react', '@livekit/components-react']` con A/B di chunk size, `dynamic({ssr:false})` per UX skeleton su slow connections. Report completo: [03_Security_and_Audits/BUNDLE_AUDIT_2026-05-23.md](../03_Security_and_Audits/BUNDLE_AUDIT_2026-05-23.md).

**Therapist-webapp**: identico al client-webapp. Particolare attenzione al calendario (`react-big-calendar` o equivalente — è pesante)
- [x] **Zero `<img>` in therapist-webapp/src/** (estensione del check client-webapp del 2026-05-23, riga 174)
       Audit + fix 2026-05-23 (ISKO): 3 `<img>` catalogati in `dashboard/profile/page.tsx` (profile photo `h-24 w-24`, gallery `aspect-[4/3]`, video preview `h-20 w-32`). **Tutti convertiti a `<NextImage>`** (alias già esistente nel file). Pattern identico a client-webapp: profile + video preview con width/height espliciti (96/96 e 128/80) + `unoptimized`; gallery con `fill` + `sizes` su parent `relative aspect-[4/3]`. [next.config.ts](../08_Codebases/therapist-webapp/next.config.ts) aggiornato con stesso `images.remotePatterns` di client-webapp (Supabase Storage + YouTube/Vimeo). Rimosso commento storico "next/image requires a configured remote domain. Use plain img" (riga 660) — fix risolve quel constraint. **Verifica post-fix**: grep `<img` in `therapist-webapp/src/` → 0 ✓; grep `eslint-disable.*no-img-element` → 0 ✓. `tsc` non eseguibile localmente (`node_modules` non installato — therapist-webapp è git submodule), ma diff strutturalmente identico a client-webapp che compila clean.

**Admin-dashboard**: meno critico (uso interno), ma comunque Lighthouse > 70
- [x] **Zero `<img>` in admin-dashboard/src/** (estensione del check client-webapp del 2026-05-23, riga 174)
       Audit 2026-05-23 (ISKO): grep `<img` in `admin-dashboard/src/` → **0 occorrenze GIÀ**. Nessuna conversione necessaria, admin-dashboard usa esclusivamente `next/image` (vedi import in `app/login/page.tsx:6` e altri). `tsc --noEmit` clean ✓.

NOTE: all tasks of client-webapp also checked for therapist webapp and admin dashboard

**Backend Supabase**:
- [x] Verifica indici su tutte le foreign key + tutte le colonne usate in WHERE/ORDER BY frequenti. Query lente in `Supabase Dashboard → Reports → Slow queries`
- [x] Verifica che `EXPLAIN ANALYZE` su `getNearbyTherapists`, `getBookingsForUser`, `searchTherapists` ritorni `Index Scan`, non `Seq Scan`
- [x] Connection pooling: PgBouncer abilitato (default su Supabase)
       Audit 2026-05-23 (ISKO): **CONFIRMED ENABLED + zero bypass nel codice**. Endpoint pooler configurato: `aws-1-eu-west-1.pooler.supabase.com:5432` (verificato in `.temp/pooler-url` dei 3 supabase CLI workdir: client-webapp, therapist-webapp, iOS_App — file identici). Il pooler è **Supavisor**, l'Elixir-based replacement di PgBouncer che Supabase usa di default dal 2023 (drop-in compatible, stesso wire protocol). **Username tenant-prefisso**: `postgres.bqyqkvkzkemiwyqjkbna` (formato Supavisor multi-tenancy). **Code grep esaustivo**: zero match per `pg.Client`, `new Pool()`, `postgresql://`, `postgres://`, `deno-postgres`, `from 'pg'` o `from 'postgres'` in tutto `08_Codebases/` (escluso CLI metadata in `.temp/`). Zero env var `DATABASE_URL`, `POSTGRES_URL`, `SUPABASE_DB_URL` o `DB_URL` in nessun `.env*`. **Tutti i 3 webapp + 14 Edge Functions + iOS app** usano esclusivamente Supabase SDK (`@supabase/supabase-js` per webapp/edge, Swift SDK per iOS) → HTTPS verso PostgREST/Realtime/Storage → Supabase backend → pooler → Postgres. Il pooler è quindi **trasparente all'applicazione**: gestito internamente da Supabase tra PostgREST e Postgres, l'app non lo configura né lo invoca. **Nessuna action richiesta pre-lancio**. Step opzionale Dashboard (~1 min) per visualizzare pool size + mode: Project Settings → Database → Connection Pooling (default: Transaction mode, port 6543, pool size 15-40 in base al piano). Aumento pool size è un post-launch fine-tuning, da fare se mai si vedrà connection-pool exhaustion (statisticamente improbabile prima di migliaia di RPS). Impact dei potenziali fix: tutti zero-risk perché transparent al codice. Report completo con table di analisi URL, background pooler, comparison session vs transaction mode: [03_Security_and_Audits/POOLER_AUDIT_2026-05-23.md](../03_Security_and_Audits/POOLER_AUDIT_2026-05-23.md).

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

- [x] **F1 — Onboarding sign-up email** → email verify → TOS accept → preferences setup → home
       ✅ Testato 2026-06-02 (utente): flow completo OK → PASS. (link screenshot da aggiungere alla QA_MATRIX)
- [x] **F2 — Onboarding sign-up Apple Sign-In** → TOS → preferences → home
       ✅ Testato 2026-06-02 (utente): flow completo OK → PASS. (link screenshot da aggiungere alla QA_MATRIX)
- [x] **F3 — Onboarding sign-up Google Sign-In** → TOS → preferences → home
       ✅ Testato 2026-06-02 (utente): flow completo OK → PASS. (link screenshot da aggiungere alla QA_MATRIX)
- [X] **F4 — Sign-in esistente** → home (skip onboarding)
- [X BUT] **F5 — Password forgot** → email arriva → link cliccabile → nuova password PS> FORGOT PASSWORD SENT EMAIL TO THE SPAM (PREVENT IT, LINK NOT WORKS CHECK)
- [X] **F6 — Esplora terapeuti** → filtri (categoria, città, lingua, prezzo) → risultati filtrati
- [HALF WORKS] **F7 — Visualizza profilo terapeuta** → bio, gallery, video, recensioni, servizi visibili ( WHEN WE CLICK TO BOOK BUTTON WE GET CHOOSE SERVICE FOR FIRST TIME BECAUSE  INTIALIZATION MAYBE SO WHEN I CLOSE AND REOPEN I SEE CALENDAR FOR BOOKING WHICH WAS EXPECTED TO SEE SO I NEED FROM YOU TO FIX IT. 2) VIDEO PLAYER NOT WORKS YOUTUBE ERROR 153, VIMEO WORKS FOR EXAMPLE )
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

PS: 1) MANCA SETTINGS PASSWORD RESET (JUST FOR EMAIL SIGNERS NOT GOOGLE OR APPLE)
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

- [x] **F36 — Stripe webhook `payment_intent.succeeded`** → booking passa a `confirmed`
- [x] **F37 — Stripe webhook `charge.refunded`** → `requires_manual_refund=false`
- [x] **F38 — Stripe webhook `account.updated`** → `stripe_account_status` aggiornato
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

- [x] Login su https://sentry.io account Marcello → verifica organization + projects esistenti
- [x] Se mancano, crea **4 progetti**:
  - `holistic-unity-ios` (platform: Apple iOS)
  - `holistic-unity-client-web` (platform: Next.js)
  - `holistic-unity-therapist-web` (platform: Next.js)
  - `holistic-unity-admin-web` (platform: Next.js)
- [x] Per ogni progetto: copia DSN → mettilo in env vars Vercel (per i 3 webapp) e in `Info.plist` (per iOS)
- [x] iOS: verifica che `SentrySDK.start()` sia il primo statement in `applicationDidFinishLaunching`. Configura:
  ```swift
  options.tracesSampleRate = 0.2 // 20% APM
  options.profilesSampleRate = 0.1 // 10% profiling
  options.attachScreenshot = true
  options.attachViewHierarchy = true
  options.enableAutoPerformanceTracing = true
  ```
- [x] Next.js: `npm install @sentry/nextjs && npx @sentry/wizard@latest -i nextjs`. Configura:
  - `tracesSampleRate: 0.2`
  - `replaysSessionSampleRate: 0.1`
  - `replaysOnErrorSampleRate: 1.0`
- [x] **Source maps upload**: configura `sentry.properties` + build hook per upload automatico ad ogni deploy (Vercel: `sentry-cli releases new`, iOS: Run Script Phase con sentry-cli)
- [x] **Release tagging**: ogni deploy/build deve creare una Release in Sentry con version = commit SHA (così sai quale versione ha causato l'errore)
- [x] **Alert rules**:
  - Email Marcello quando `new issue` con severity ≥ Error — DONE 2026-05-24 (ISKO): Issue Alert "Critical errors" creata via Sentry UI. Source: tutti e 4 i progetti (apple-ios + 3 webapp), env=production. WHEN `a new issue is created`. IF `all` di: `Issue category equal to error` AND `Current issue priority greater than or equal to high`. THEN: Notify Member → marcello@b2bst… (delivery method Email confermato in Settings → Account → Notifications, Issue Alerts ON per tutti e 4 i progetti). Eventi di test verificati end-to-end via `/api/sentry-test` route (eventId `75564150157042e19de64ca4f9c1dcfa`) — PII redacted come atteso.
  - Email quando `error frequency > 50 / hour` (potenziale incident) (post-launch) — DEFERRED 2026-05-24 (ISKO): Sentry ha rimosso il trigger "issue seen N times in M time" dagli Issue Alerts (free tier) → ora vive solo nei Metric Monitors, che richiedono Team plan (~$26/mese). API restituisce `"Unable to process request, confirm payment options."` ai tentativi di creazione su Developer tier. Da riattivare post-launch: aggiungere payment method a Sentry → creare 4 Metric Monitor (Number of Errors, threshold >50 in 1h) → connettere a Issue Alert "Burst incident" con stessa action email Marcello.
  - Slack webhook (se Marcello usa Slack) per high-severity issue (post-launch) — N/A 2026-05-24 (ISKO): confermato con utente che Marcello non usa Slack; email è sufficiente. Se in futuro adottasse Slack: Sentry → Settings → Integrations → Slack (OAuth ~30s) → aggiungere Slack action alla Alert "Critical errors" oltre all'email.
- [x] **PII scrubbing**: configura `beforeSend` per rimuovere email, payment intent IDs, JWT tokens dagli errori. Mai inviare dati sensibili a Sentry
- [x] **User context**: dopo login, chiama `Sentry.setUser({ id: user.id })` (solo ID, no email). In iOS: `SentrySDK.setUser(...)`
- [x] Test: trigger errori volutamente (un bottone nascosto in debug build che chiama `fatalError("test sentry")`) → verifica che arrivino in dashboard
- [x] **Performance budget**: imposta soglie in Sentry Performance — alert se p95 di una transaction > 2s (post-launch) — DEFERRED 2026-05-24 (ISKO): richiede Metric Monitor su transaction duration, che è feature Team plan (~$26/mese) come il burst alert sopra. Stesso blocker, stessa decisione: differito a post-launch quando si valuta upgrade Sentry. Lato codice tutto pronto — `tracesSampleRate=0.1` già attivo in iOS + 3 webapp, quindi i transaction span sono già flowing in Sentry; manca solo la regola di alerting che ne legge le metriche.

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

- [-] Per ognuna delle 36 email sopra: trigger via QA in production con un account di test, verifica:
  - Arriva entro 60 secondi? → ✅ / ❌
  - Subject sensato e in italiano corretto? → ✅ / ❌
  - Corpo HTML renderizza bene su Gmail / Outlook / Apple Mail? (test su almeno 2 client)
  - Link cliccabili funzionano (login, accept, etc.)?
  - Tracking pixel Brevo presente? Mittente `info@holisticunity.app` autenticato (SPF/DKIM/DMARC)?

  **Audit cliente C1-C4 (2026-05-23, ISKO)** — code-level trace, 3/4 PASS + 1/4 FAIL:
  - **C1** Sign-up email verify ✅ — `supabase.auth.signUp()` in [register/page.tsx:161](../08_Codebases/client-webapp/src/app/register/page.tsx) → Supabase Auth invia template `confirmation` brandizzato via [push-email-templates.mjs](../08_Codebases/client-webapp/scripts/email-templates/push-email-templates.mjs). `mailer_autoconfirm: false` confermato via `/auth/v1/settings`.
  - **C2** Welcome ⚠️ **FAIL → FIXED** (2026-05-24, ISKO) — i template Brevo `id=1` (`bodyWelcomeClient`) + `id=2` (`bodyWelcomeTherapist`) esistono brandizzati ([push-brevo-templates.mjs:340-341](../08_Codebases/client-webapp/scripts/email-templates/push-brevo-templates.mjs)) ma nessun code path li trigger (verificato via grep esaustivo). **Fix applicato (Opzione B)** in [client-webapp/auth/callback/route.ts](../08_Codebases/client-webapp/src/app/auth/callback/route.ts) (template_id=1) + [therapist-webapp/auth/callback/route.ts](../08_Codebases/therapist-webapp/src/app/auth/callback/route.ts) (template_id=2): post-`exchangeCodeForSession` await fetch a `send-brevo-email` Edge Function, idempotente via `app_metadata.welcome_sent_at` settato con admin client (previene re-send su magic-link re-login). Wrapped in try/catch — failure NEVER blocca il redirect. `tsc --noEmit` clean su entrambi i webapp. **Da testare in staging**: registrare un account → cliccare il link di verifica → confermare arrivo Brevo entro 60s + secondo callback hit non re-invia.
  - **C3** Reset password ✅ — `supabase.auth.resetPasswordForEmail()` in [forgot-password/page.tsx:49](../08_Codebases/client-webapp/src/app/forgot-password/page.tsx) → Supabase Auth invia template `recovery` brandizzato. Anti-enumeration: forgot-password ritorna sempre "Check your email" (audited in RLS audit).
  - **C4** Booking confirmed (gratuita) ✅ — Path FREE: [`/api/checkout/create`](../08_Codebases/client-webapp/src/app/api/checkout/create/route.ts) detect `service.price===0` → insert booking direct → call `notifyBookingConfirmed()` (riga 573-680) → `sendEmail(clientId, TPL_CLIENT=3)` + `sendEmail(therapistId, TPL_THERAPIST=4)` via Brevo Edge Function `send-brevo-email`. Path PAGATO identico tramite stripe-webhook (stessi template). ICS via link "Add to Calendar" (pattern moderno preferito ad attachment).

  **Audit cliente C6-C10 (2026-05-24, ISKO)** — 3/5 PASS + 2/5 GAP (1 fixato, 1 deferred):
  - **C6** Reminder T-24h ✅ — Edge Function `send-session-reminders` (daily cron 10:00 UTC, [`02_Documentation/.../20-cron-jobs.md:56`](../02_Documentation/legacy_docs_folder/flows/20-cron-jobs.md)), Brevo template 5 `bodySessionReminder24h` ([push-brevo-templates.mjs:344](../08_Codebases/client-webapp/scripts/email-templates/push-brevo-templates.mjs)). Source non in git (debt esistente).
  - **C7** Reminder T-1h ❌ **GAP REALE — defer post-launch** — nessun template Brevo (lista esaustiva 1-10), nessun cron orario, nessun code path. Fix proposto (~1.5-3h, Opzione B refactor unificato): backfill `send-session-reminders` in git → estendere a 2 window (24h + 1h) con template 11 nuovo + 2 colonne idempotency. Tracciato in Post-launch hardening.
  - **C8** Self-cancel ≥48h (100% refund) ✅ — [client-webapp/cancel/route.ts:37-42,172-204](../08_Codebases/client-webapp/src/app/api/bookings/[id]/cancel/route.ts): Stripe reverse_transfer + refund_application_fee, Brevo template 9 con `refund_tier="100%"` via `notifyBookingCancelled()` (riga 302-398). Optimistic-locked status flip previene race su double-cancel.
  - **C9** Self-cancel <48h ✅ — stesso path, ratio 0.5 (24-48h) o 0 (<24h). Template 9 con `refund_amount` adattato ("Nessun rimborso" / "€ X,YZ"). Minor: copy template 9 è client-perspective ("La tua sessione…"), sub-ottimale quando inviato al terapista — non-blocking.
  - **C10** Therapist cancel ⚠️ **FAIL → FIXED** (2026-05-24, ISKO) — therapist cancel route faceva il refund 100% correttamente ma **non inviava ALCUNA notifica/email** a nessuna delle 2 parti (cliente scopriva la cancellazione solo aprendo l'app o vedendo il refund sulla carta dopo 5-10gg). **Fix applicato** in [therapist-webapp/cancel/route.ts](../08_Codebases/therapist-webapp/src/app/api/bookings/[id]/cancel/route.ts): aggiunto helper `notifyTherapistInitiatedCancellation()` (~110 righe) che inserisce 2 notifications (cliente: "Il terapista ha annullato la sessione" + body con refund 100%; terapista: ricevuta self con notice_hrs + category) + invia Brevo template 9 a entrambi con `params.cancelled_by="therapist"` + `refund_tier="100%"` + `cancellation_category` (label IT-localized). Aggiunto `service_name` al SELECT booking. `Promise.allSettled` + try/catch — failure NEVER blocca refund/response. `tsc --noEmit` clean.

  **Architectural finding**: l'Edge Function `send-brevo-email` (chiamata dai route handler) è **deployata in prod (v12) ma NON in git** (verificato via `supabase functions list`). Stesso pattern per altre 6 Edge Functions: `sync-brevo-contact`, `send-session-reminders`, `check-dormant-users`, `get-available-slots`, `validate-vat`, `validate-promo`. Operational debt tracciato in Post-launch hardening (`supabase functions download` × 7 + commit).

  Report completo (architettura email + per-flow trace + Opzioni A/B/C per fix C2 + impact assessment): [03_Security_and_Audits/EMAIL_FLOWS_AUDIT_CLIENT_2026-05-23.md](../03_Security_and_Audits/EMAIL_FLOWS_AUDIT_CLIENT_2026-05-23.md). Restano C11-C15 (cliente) + T1-T17 (terapeuta) + A1-A4 (admin) = 26 email da auditare.
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

# 🛡️ Post-launch hardening (defense-in-depth, NON blocking)

Lista di items identificati durante gli audit pre-lancio come **non urgenti ma desiderabili**. Da affrontare in finestre dedicate dopo che il lancio è stabile (target: settimane 2-4 post-launch). Ogni item richiede TestFlight cycle dedicato perché aggiunge dipendenze nuove o flippa modalità che possono interrompere connettività.

## Settimana 2 post-launch — Quick wins (~30 min totali)

- [ ] **JailbreakDetector activation** (5 min in Xcode, da audit OWASP MAS del 2026-05-23)
   Aggiungere SPM package `https://github.com/securing/IOSSecuritySuite` (Up to Next Major from 2.1.0) al target Holistic Unity in Xcode → File → Add Package Dependencies. Lo scheletro è già in [Core/Security/JailbreakDetector.swift](../08_Codebases/iOS_App/Holistic%20Unity/Core/Security/JailbreakDetector.swift) e il hook è in [Holistic_UnityApp.swift:78](../08_Codebases/iOS_App/Holistic%20Unity/Holistic_UnityApp.swift). Soft-fail policy: NO user block, solo Sentry tag `security.event_type=jailbreak` + flag `isCompromised=true` per add confirmation step su payment/session. Cost: app size +200KB ca. Pre-deploy: TestFlight cycle 3-5gg per spotting false positive su MDM/beta iOS/simulators. Impatto utenti: 0 se policy soft-fail (default).

- [ ] **`import "server-only"` su 3 admin modules** (5 min, da audit SERVICE_ROLE_KEY del 2026-05-22)
   `npm install server-only` in client-webapp, therapist-webapp, admin-dashboard. Aggiungere `import "server-only";` come prima riga di:
   - `client-webapp/src/lib/supabase/admin.ts`
   - `therapist-webapp/src/lib/supabase/admin.ts`
   - `admin-dashboard/src/lib/supabase/admin.ts`
   - (opzionale) `*/src/lib/auth/rateLimit.ts` (2 copie) + `therapist-webapp/src/lib/auth/mfa-server.ts`
   Build-time enforcement: qualsiasi futuro import accidentale da `"use client"` causerebbe Next.js build error con file specifico, invece di silenzioso `undefined` runtime. Pre-deploy: `npm run build` su ogni webapp + sanity check (temporary import nel client + build deve fallire).

- [ ] **Stripe restricted key migration** (~10 min, da audit STRIPE_KEYS del 2026-05-23)
   IFF Step A del [STRIPE_KEYS_AUDIT_2026-05-23.md](../03_Security_and_Audits/STRIPE_KEYS_AUDIT_2026-05-23.md) rivela `sk_live_` (full-access) invece di `rk_live_` (restricted). Migration plan: Stripe Dashboard → crea nuova restricted key con 5 scope (`Connect:write`, `Customers:write`, `PaymentIntents:write`, `PaymentMethods:write`, `Refunds:write`) → Supabase Dashboard overwrite `STRIPE_SECRET_KEY` → smoke test 4 flow (booking/connect/refund/delete) → rollback 1-click se rompe. Rischio: 403 esplicito Stripe se permission mancante (no silent failure, debug banale).

- [x] **C2 Welcome email — wire trigger** (FIXED 2026-05-24, ISKO) — Opzione B applicata in [client-webapp/auth/callback/route.ts](../08_Codebases/client-webapp/src/app/auth/callback/route.ts) (template_id=1) + [therapist-webapp/auth/callback/route.ts](../08_Codebases/therapist-webapp/src/app/auth/callback/route.ts) (template_id=2). Idempotenza via `app_metadata.welcome_sent_at` (admin client `updateUserById` dopo invio). Wrapped in try/catch — failure NEVER blocca il redirect. `tsc --noEmit` clean su entrambi. Test in staging: registrare 1 utente per webapp → cliccare link verify → expected 2 email entro 60s (confirmation Supabase + welcome Brevo) + secondo callback hit (es. magic-link re-login) NON re-invia.

- [x] **C10 Therapist-initiated cancellation notify** (FIXED 2026-05-24, ISKO) — therapist cancel route ora invia 2 notifications + 2 Brevo email (template 9) quando il terapista annulla. Helper `notifyTherapistInitiatedCancellation()` aggiunto in [therapist-webapp/cancel/route.ts](../08_Codebases/therapist-webapp/src/app/api/bookings/[id]/cancel/route.ts) (110 righe), mirror del pattern `notifyBookingCancelled()` esistente nel client-webapp. Copy role-aware: cliente riceve "Il terapista ha annullato la sessione" + refund 100% details + reason category IT-localized; terapista riceve ricevuta self con notice_hrs. `Promise.allSettled` + try/catch — failure Brevo/DB NEVER blocca il refund o la response. Aggiunto `service_name` al SELECT booking. `tsc --noEmit` clean. **Test staging**: con 1 booking confirmed + Stripe TEST mode, cancellare dal portale terapista → expected: client riceve email "Il terapista ha annullato" entro 60s + notification in-app + refund su carta entro 5-10gg; terapista riceve ricevuta self.

- [ ] **C7 Reminder T-1h** (~1.5-3h, post-launch, da audit EMAIL_FLOWS C6-C10 del 2026-05-24)
   Nessun template Brevo (id 11+ non esistono), nessun cron orario, nessun code path. Il cliente riceve solo il reminder T-24h che potrebbe non bastare per sessioni serali (no-show risk). **Opzione A (isolato, ~1.5h)**: nuovo body `bodySessionReminder1h` come template Brevo id=11 + nuova Edge Function `send-session-reminders-1h` con window `now()+55min..now()+65min` + colonna `bookings.reminder_1h_sent_at` per idempotency + cron `5 * * * *`. **Opzione B (refactor unificato, ~3h, raccomandato)**: backfill `send-session-reminders` in git (risolve anche debt edge-functions-not-in-git per questa function) → estendere a 2 window (24h + 1h) con template 11 nuovo + 2 colonne idempotency (`reminder_24h_sent_at`, `reminder_1h_sent_at`) + cron passa da daily a `*/30 * * * *`. Rischio Opzione B: cambio cron schedule potrebbe rompere il 24h già funzionante — mitigare con backup + staging smoke test. Quale opzione → decidere se vediamo no-show >15% nelle prime 2 settimane.

- [ ] **Backfill 7 Edge Functions in git** (~30 min, da audit EMAIL_FLOWS del 2026-05-23)
   7 Edge Functions deployate in prod ma NON versionate in `08_Codebases/iOS_App/supabase/functions/`: `send-brevo-email` (v12, 2026-04-29), `sync-brevo-contact` (v11), `send-session-reminders` (v13, 2026-05-14), `check-dormant-users` (v12), `get-available-slots` (v10), `validate-vat` (v9), `validate-promo` (v4). Rischio: future redeploy massivo via `supabase functions deploy --use-api` o equivalente potrebbe cancellarle. Fix: `cd 08_Codebases/iOS_App && for fn in send-brevo-email sync-brevo-contact send-session-reminders check-dormant-users get-available-slots validate-vat validate-promo; do supabase functions download $fn; done` + commit. Sintassi Deno verificare con `deno check supabase/functions/<fn>/index.ts`.

- [ ] **Duplicate SELECT policy cleanup su storage.objects** (1 min, da audit STORAGE del 2026-05-23)
   2 coppie di policy duplicate sopravvivono dal merge `legacy_initial_schema.sql` + `supabase_schema.sql`: `Anyone can read profile photos` + `Public profile photos` (stessa expression), idem per `video-intros`. PERMISSIVE + stessa expression = no security impact, solo clutter. Drop le versioni "Public X" via Dashboard SQL: `DROP POLICY IF EXISTS "Public profile photos" ON storage.objects; DROP POLICY IF EXISTS "Public video intros" ON storage.objects;`

- [ ] **Sentry `disableLogger` deprecation fix** (5 min, da audit BUNDLE del 2026-05-23)
   Tutti e 3 `next.config.ts` mostrano warning a build time: `DEPRECATION WARNING: disableLogger is deprecated and will be removed in a future version. Use webpack.treeshake.removeDebugLogging instead.` Replace `disableLogger: true` con `webpack: { treeshake: { removeDebugLogging: true } }` nelle 3 config. Effetto: silenzia il warning + future-proofs verso Sentry SDK v11+. Effetto bundle: 0 KB.

- [ ] **Esperimento `optimizePackageImports` per Stream Chat + LiveKit** (~30 min con A/B, da audit BUNDLE del 2026-05-23)
   Aggiungere `experimental: { optimizePackageImports: ['stream-chat-react', '@livekit/components-react'] }` in `next.config.ts` di client-webapp + therapist-webapp. Run `npx next experimental-analyze --output` prima/dopo, confrontare `.next/static/chunks/` sizes. Potenziale saving: 50-100KB (i pacchetti NON sono nella default list di Next 16, ma il loro tree-shaking interno potrebbe già essere aggressive). Run TestFlight cycle 3gg per spotting eventuali import non-standard che rompe (raro ma possibile per pacchetti complessi).

- [ ] **`dynamic({ssr:false})` per `/dashboard/messages` + `/call/[bookingId]`** (~20 min, originariamente da audit del 2026-05-22)
   Sostituire l'import diretto di Stream Chat + LiveKit components con `next/dynamic` + loading skeleton. Pure polish UX (loading skeleton invece di blank durante parse del chunk da 1.4MB+548KB su connessioni lente). Già code-split per route — non riduce bytes shipped, solo migliora perceived performance. Decisione: implementare SE/QUANDO emerge feedback "blank screen" da utenti su slow connections, altrimenti skip.

## Settimana 3-4 post-launch — Cert pinning hardening

- [ ] **TrustKit `reporting → enforce` mode** (~2-4h con TestFlight, da decisione Cert pinning del 2026-05-23)
   Pre-requisiti **OBBLIGATORI** prima del flip (rischio brick app altrimenti):
   1. Aspettare 30-60gg di telemetria TrustKit dal `pinningValidatorCallback` (già installato in [TrustKitConfig.swift:91-102](../08_Codebases/iOS_App/Holistic%20Unity/Core/Security/TrustKitConfig.swift)) per misurare cadenza reale di rotation Supabase + Stripe
   2. Aggiornare i pin alla versione CORRENTE (la verifica del 2026-05-23 ha confermato che il leaf Supabase si è già ruotato in 5 settimane: pinned `GU2W4j1P...` ≠ live `p51goejP...`)
   3. Aggiungere **3° pin di backup** (next-rotation key) — TrustKit supporta multipli pin per host, accetta MATCH su QUALSIASI di essi
   4. TestFlight cycle 1 settimana con `kTSKEnforcePinning = true` su build interna, monitoring zero false positive rejection rate
   5. Eventuale escalation Supabase per capire la rotation policy ufficiale (no fonti pubbliche)
   Solo a quel punto: flip `kTSKEnforcePinning = true` in V1.1. Rischio se fatto male: ALL device fanno "Network error" simultaneamente → recovery = update code + Apple review 24-48h → downtime totale.

- [ ] **Verifica `dynamic({ssr:false})` per LiveKit + Stream Chat** (~30 min, da audit del 2026-05-22)
   Pure polish UX, no riduzione bytes (Next.js 16 App Router fa già route-level code splitting). Decisione di adoption rimandata a quando emerge slow-connection UX feedback. Solo se utenti reporterebbero "blank screen during chat/video page parse" su connessioni lente.

## Bonus — Da considerare se l'utenza cresce

- [ ] **Cross-user authenticated RLS test** (da audit RLS del 2026-05-22)
   Setup 2 account di test (1 client + 1 terapeuta), script automatico che tenta cross-user query su `bookings`/`messages`/`reviews`/`payment_methods`. Inserisce nella matrice QA #4 una volta che il base flow è stabile.

- [ ] **A11y wiring `<Field>` wrapper con `useId()`** (da TECH_DEBT.txt + audit Tailwind del 2026-05-22)
   Implementare `<Field>` wrapper centralizzato che genera ID automatici e cabla `htmlFor`/`id` tra `<Label>` e `<Input>` esistenti via React 19 `useId()`. Refactor pure additivo, zero impatto utenti vedenti, win significativo per screen reader users (label click = input focus). Tracciato come debt separato in TECH_DEBT.txt #1.

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
