# Holistic Unity — Developer Handover
**Generato il 2026-05-18 · per il nuovo developer che subentra**

> Questo documento è il "domani mattina puoi iniziare" pack. Tutto quello che ti serve per orientarti, fare il primo `git clone`, far girare l'app, capire come si parlano i pezzi, e dove sono i bug noti.

**Repository in formato monorepo** sotto `/Users/marcello/Desktop/Holistic Unity/`. Non è un git repo unificato — i 3 web apps sono progetti Vercel separati; l'iOS app è una cartella Xcode standalone.

---

## ✅ ZERO HALLUCINATIONS DISCLAIMER

Ogni dato sotto è verificato leggendo il sorgente o queryando i sistemi live. Quando un'informazione non è verificabile è esplicitamente marcata "non confermato". Se trovi discrepanze, **il sorgente è sempre la verità** — questo doc viene scritto al tempo T e può divergere.

---

# 🗺️ 1. Cosa è Holistic Unity (in 100 parole)

Marketplace italiano di operatori olistici. I clienti scaricano l'**app iOS** (o usano il **client webapp** su browser), cercano un operatore (ThetaHealing, Costellazioni Familiari, Reiki, Astrologia, Human Design, Numerologia, Naturopatia, Ayurveda, Sciamanesimo), prenotano una sessione video (LiveKit), pagano via Stripe Connect (commissione piattaforma 20% + IVA 22%). Gli operatori usano un **portale web** separato per gestire calendario, fatturazione (FattureInCloud), payout. Un'**admin dashboard** interna serve a Marcello per moderation, refunds, e monitoraggio metrics.

---

# 🏗️ 2. Architettura ad alto livello

```
                                ┌──────────────────┐
                                │    Stripe Live   │
                                │  Connect (IT)    │
                                └────────┬─────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
       ┌──────▼─────┐            ┌───────▼──────┐          ┌────────▼──────┐
       │   iOS App  │            │ Client       │          │  Stripe       │
       │  SwiftUI   │            │ Webapp       │          │  Webhook      │
       │  (Cliente) │            │ Next.js 16   │          │ Receivers (2) │
       └──────┬─────┘            └──────┬───────┘          └────────┬──────┘
              │                         │                           │
              │ Supabase SDK            │ Supabase SSR              │
              ▼                         ▼                           ▼
       ┌─────────────────────────────────────────────────────────────┐
       │     Supabase backend (project bqyqkvkzkemiwyqjkbna)         │
       │  Postgres + Auth + Storage + Edge Functions + Realtime      │
       └───────┬─────────────────┬───────────────────────────────────┘
               │                 │
       ┌───────▼─────┐   ┌───────▼──────┐
       │  Therapist  │   │   Admin      │
       │  Webapp     │   │   Dashboard  │
       │  Next.js 16 │   │  Next.js 16  │
       │ (Operatori) │   │   (Marcello) │
       └─────────────┘   └──────┬───────┘
                                │
                                ▼
                         FattureInCloud
                         (fatture IT)

       ┌─────────────────────────┐    ┌──────────────────┐
       │  Marketing Site         │    │   Stream Chat    │
       │  Static HTML + JS       │    │   (messaging)    │
       │  holistic-unity-website │    └──────────────────┘
       │  (holisticunity.app)    │    ┌──────────────────┐
       └─────────────────────────┘    │  LiveKit Cloud   │
                                      │  (video sessions)│
                                      └──────────────────┘
                                      ┌──────────────────┐
                                      │  Brevo (email +  │
                                      │  WhatsApp)       │
                                      └──────────────────┘
                                      ┌──────────────────┐
                                      │   APNs (push)    │
                                      └──────────────────┘
```

**5 codebases**:
1. iOS app (SwiftUI) — `/iOS App/untitled folder/Backup 6 Aprile/` (canonica)
2. Client webapp (Next.js) — `/client-webapp/`
3. Therapist webapp (Next.js) — `/therapist-webapp/`
4. Admin dashboard (Next.js) — `/admin-dashboard/`
5. Marketing site (HTML statico) — `/holistic-unity-website/`

**Domini produzione**:
- `holisticunity.app` → marketing site (HTML statico, Vercel)
- `app.holisticunity.app` → client webapp (Next.js, Vercel)
- `therapistportal.holisticunity.app` → therapist webapp (Next.js, Vercel)
- `admin.holisticunity.app` → admin dashboard (Next.js, Vercel)
- `bqyqkvkzkemiwyqjkbna.supabase.co` → Supabase backend
- `holistic-unity-7cj033ty.livekit.cloud` → LiveKit (video)

---

# 📱 3. iOS App

**Root canonico**: `/Users/marcello/Desktop/Holistic Unity/iOS App/untitled folder/Backup 6 Aprile/` 

⚠️ Le altre cartelle `iOS App (Backup 1)`, `iOS App (Backup 2)`, `iOS App/`, `Backup 6 Aprile copy/` sono **stale**, ignorale. Il vero codice è in `Backup 6 Aprile/`.

## 3.1 Tech stack

| Voce | Valore |
|---|---|
| Linguaggio | Swift 5 |
| UI framework | **100% SwiftUI** (UIKit solo per push token + haptics) |
| Deployment target | iOS 17.6 |
| Bundle ID | `Holistic-Unity-Healing` |
| Xcode object format | 77 (Xcode 16+) |
| Tema | Light-only (`UIUserInterfaceStyle = Light` in Info.plist) |
| Localizzazioni | EN, IT, Base |
| Development team | `3JXVTKDDXG` |
| Code signing | Automatic |
| Concurrency | Swift 6 mode con MainActor isolation di default |
| App Sandbox | abilitato |

## 3.2 Swift Package Manager dependencies (versioni lock-ate)

| Pacchetto | Repo | Versione | Uso |
|---|---|---|---|
| **supabase-swift** | github.com/supabase/supabase-swift | 2.41.1 | Auth, DB, Storage, Realtime |
| **stripe-ios-spm** | github.com/stripe/stripe-ios-spm | 25.8.0 | Pagamenti (PaymentSheet + Apple Pay + Connect) |
| **stream-chat-swiftui** | github.com/GetStream/stream-chat-swiftui | 4.99.0 | Chat cliente↔operatore (UI nativa Stream) |
| **client-sdk-swift** (LiveKit) | github.com/livekit/client-sdk-swift | 2.12.1 | Video sessione 1:1 |
| **sentry-cocoa** | github.com/getsentry/sentry-cocoa | 9.8.0 | Crash reporting + APM (10% trace sample) |
| **GoogleSignIn-iOS** | github.com/google/GoogleSignIn-iOS | 9.1.0 | OAuth Google login |
| **TrustKit** | github.com/datatheorem/TrustKit | 3.0.7 | Certificate pinning (oggi in **reporting mode**) |

**Prodotti Stripe linkati** (5): Stripe, StripeApplePay, StripeCardScan, StripeConnect, StripeFinancialConnections, StripePaymentSheet.

**Pacchetti referenziati nel codice ma NON ancora aggiunti al SPM** (no-op runtime finché non li linki):
- `TelemetryDeck` (analytics privacy-first EU — quando lo aggiungi setta `TELEMETRY_DECK_APP_ID` in Secrets.xcconfig)
- `IOSSecuritySuite` (jailbreak detection — soft-fail con flag a Sentry)

## 3.3 Capabilities + Entitlements

Da `Holistic Unity/Holistic Unity.entitlements`:
- `com.apple.developer.applesignin` = `Default` (Sign in with Apple)
- `com.apple.developer.aps-environment` = `$(APS_ENVIRONMENT)` (Debug=`development`, Release=`production`)
- `com.apple.developer.in-app-payments` = `merchant.com.holisticunity.app` (Apple Pay)

`UIBackgroundModes` in Info.plist: `audio` (per LiveKit attivo in background), `remote-notification` (per push).

**NON presenti**: Associated Domains, iCloud, HealthKit, CarPlay.

## 3.4 Info.plist — chiavi critiche

- `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` — video calls
- `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` — profile pic + chat attachments
- `NSLocationWhenInUseUsageDescription` — "Vicino a me" therapists
- `NSFaceIDUsageDescription` — biometric lock
- `NSCalendarsUsageDescription` (dichiarato in pbxproj) — "Aggiungi a calendario"
- **`NSUserTrackingUsageDescription` NON dichiarato** (intenzionale, nessun ATT prompt)
- `ITSAppUsesNonExemptEncryption` = `false` (HTTPS standard, niente crypto custom)
- `UIUserInterfaceStyle` = `Light`
- `UIAppFonts`: Fraunces72pt-Regular/SemiBold/Bold/Italic.ttf
- `CFBundleURLTypes` (deep links): `com.googleusercontent.apps.446468190938-…` (Google OAuth) + `holisticunity://` (Stripe Connect redirect)

**Chiavi runtime risolte da Secrets.xcconfig**:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `STRIPE_PUBLISHABLE_KEY` (`pk_live_…` in produzione)
- `STREAM_API_KEY` (= `dx6gpjra45gt`)
- `LIVEKIT_WS_URL` (= `wss://holistic-unity-7cj033ty.livekit.cloud`)
- `SENTRY_DSN`

**Google OAuth client ID** (hardcoded, non secret): `446468190938-sfbcfb83u38cqj5fuehln7sv9iv4gj4u.apps.googleusercontent.com`

## 3.5 Architettura interna (cartelle)

```
Holistic Unity/
├── App/              # Entry point, DIContainer, AppCoordinator state machine, AppState
├── Config/           # Secrets.xcconfig + Swift config per ogni SDK
├── Core/             # Authentication, Networking, Security, Storage, Analytics, Constants, Extensions, Utilities
├── Data/             # Repositories (Supabase impl + Mock), Services, DTOs, Mappers
├── Domain/           # Models (14: User, Therapist, Booking, ChatMessage, Review, …), Repositories (protocol)
├── DesignSystem/     # Theme.swift + 12 componenti HU* riutilizzabili
├── Features/         # Viste per area funzionale (vedi sotto)
└── Fonts/            # Fraunces TTF (4 cuts)
```

**Layers**:
- **Domain** = modelli + protocol repository (pure Swift, no dipendenze)
- **Data** = implementazioni Supabase + DTOs + mappers
- **Features** = ScreenViews + ViewModels (uno per feature)
- **DesignSystem** = HUColor, HUFont, HUSpacing tokens + componenti
- **Core** = singleton services + utilities

## 3.6 AppCoordinator state machine

In `Core/Authentication/AuthManager.swift` enum `AuthState`:

```
.loading                              → LaunchLoadingView (lotus pulsing)
.unauthenticated                      → WelcomeView
.needsEmailVerification               → EmailVerificationView (solo provider .email)
.needsRole                            → auto-assigns .client
.needsOnboarding(.client)             → ClientOnboardingFlow (11 step painted)
.needsOnboarding(.therapist)          → TherapistWebAppRedirectView
.needsTOSAcceptance(role)             → AcceptTermsView (4 checkbox GDPR)
.authenticated                        → ClientTabView (5 tab) o redirect web therapist
```

Gates (in `resolveAuthState`):
1. Email verification (`isEmailVerified`)
2. Role assignment (`role`)
3. **Onboarding completion** (`client_preferences.completed_at IS NOT NULL`) — appena aggiunto 2026-05-18
4. TOS acceptance (async)

## 3.7 Features map

| Cartella `Features/` | Cosa fa | Views chiave |
|---|---|---|
| `Booking/` | Prenotazione sessione + manage/reschedule | `BookingFlowView`, `ManageBookingView` |
| `Chat/` | Chat Stream — factory + lista canali | `HUChatViewFactory`, `StreamChannelListView` |
| `ClientDashboard/` | Tab bar cliente + Home personalizzata | `ClientTabView`, `PersonalizationEngine` |
| `Notifications/` | Centro notifiche in-app | `NotificationsView` |
| `Onboarding/` | Welcome, Auth, Email verify, TOS, painted onboarding 11-step | `WelcomeView`, `AuthView`, `EmailVerificationView`, `AcceptTermsView`, `ClientOnboardingFlow` |
| `Reviews/` | Scrittura recensione post-sessione | `WriteReviewView` |
| `Settings/` | Account/profilo/preferenze | `SettingsView` |
| `TherapistProfile/` | Profilo terapista pubblico | `TherapistProfileView` |
| `TherapistRedirect/` | Redirect a webapp per operatori | `TherapistWebAppRedirectView` |
| `VideoCall/` | LiveKit video + screen-capture protection | `VideoCallView` |
| `Marketplace/`, `Payments/` | Cartelle vuote (placeholder) | — |

## 3.8 Services + Singletons

- `DIContainer.shared` — wire-up di repository + service
- `AuthManager` (`@Observable` MainActor) — state machine auth
- `SupabaseConfig.client` — singleton SupabaseClient
- `PushNotificationService.shared` — registrazione APNs
- `NotificationManager.shared` — in-app notifications
- `StreamChatService.shared` — ChatClient + JWT (con `muteUser/unmuteUser` aggiunti per block)
- `VideoCallService.shared` — LiveKit room
- `SupabaseStorageService.shared` — upload buckets
- `TOSService.shared`, `KeychainService.shared`, `BiometricLock.shared`, `NetworkMonitor.shared`
- `ReportService.shared` (nuovo 2026-05-18) — UGC reports + block

## 3.9 Design tokens (`Core/Constants/DesignTokens.swift`)

- **Colors**: `HUColor.primary` = `#7B2252` berry · `HUColor.brandMagenta` = `#AE0062` (solo onboarding) · `HUColor.brandCream` = `#FDF6F0` · `HUColor.brandGold` = `#C9A96E` · tile pastels per painted illustrations
- **Fonts**: `HUFont.display*()` = **Fraunces 72pt** serif · `HUFont.body()` etc. = SF Pro system
- **Spacing**: `HUSpacing.xxs` (2) → `.massive` (64)
- **Radii**: `HURadius.sm` (6) → `.pill` (100)

## 3.10 Build & run

```bash
cd "/Users/marcello/Desktop/Holistic Unity/iOS App/untitled folder/Backup 6 Aprile"
open Holistic\ Unity.xcodeproj
# In Xcode: select scheme "Holistic Unity" + simulator → Cmd+R
```

Secrets necessari in `Config/Secrets.xcconfig` (file presente con credenziali live — **NON committarlo** in pubblico; il template è `Secrets.xcconfig.template`).

Test bundle: `Holistic UnityTests` con 12 file di unit test (BookingFlowVM, models, mocks).

---

# 🌐 4. Tre web apps (Next.js 16)

Tutte e tre condividono lo stesso baseline: **Next.js 16.2.3 App Router + React 19.2.4 + TypeScript strict + Tailwind v4 + Supabase SSR**. Sono deploy Vercel separati nello stesso team (`team_6BCebq1X0b1Ogw2VnMWrVZkM`).

## 4.1 Tabella comparativa

| | `client-webapp` | `therapist-webapp` | `admin-dashboard` |
|---|---|---|---|
| **URL prod** | `app.holisticunity.app` | `therapistportal.holisticunity.app` | `admin.holisticunity.app` |
| **Vercel project ID** | `prj_P0TurrmfpyY7Xg73OfEQBxdWURWo` | `prj_ppUI7TXeLkWOMKCvwLBJhpGCCP0X` | `prj_zfRa7lAJboiq1qSdFM3QZUA6k5Id` |
| **Middleware file** | `src/proxy.ts` | `src/proxy.ts` | `src/middleware.ts` |
| **Auth** | Supabase SSR + **TOS-version gate** | Supabase SSR + **MFA TOTP** opzionale | Supabase SSR + **MFA TOTP + dual-gate `requireAdmin`** (env allowlist + `is_admin()` RPC) |
| **Service-role Supabase usato?** | Sì (webhooks) | Sì | Sì (gran parte ops) |
| **Stripe SDK** | `stripe@^22.0.2` | `stripe@^22.1.0` | No SDK (chiamate via fetch) |
| **LiveKit** | Sì | Sì | No |
| **Stream Chat** | Sì | Sì | Sì |
| **FattureInCloud** | No | No | **Sì** (OAuth integration) |
| **Sentry** | Sì (browser + server + edge) | Sì | Sì |
| **CookieBanner GDPR** | Sì (binary consent) | Sì (placeholder, no pixel) | No |
| **Meta Pixel** | **Sì** — id `1445760663897743` hardcoded | No | No |
| **GA4** | **Sì** — `G-WPVE6Z3V41`, Consent Mode v2 | No | No |
| **Google Ads conversion** | **Sì** — `sign_up` via GA→Ads link | No | No |
| **i18n** | Custom IT/EN con geo-detect | IT hardcoded | EN hardcoded |
| **Vercel crons** | `auto-cancel-reschedule` (hourly), `cleanup-pending-payment` (hourly) | `sync-stripe-status` (ogni 15 min) | `monthly-invoices` (mensile), `daily-credit-notes` (daily), `billing-reminders` (lunedì) |
| **`.env.local.template`** | No | No | **Sì** |

## 4.2 Client webapp — dettagli rilevanti

Routes principali sotto `src/app/`:
- `accept-terms`, `auth`, `call`, `checkout`, `forgot-password`, `login`, `register`, `reset-password`, `welcome`
- `dashboard/`: `account`, `bookings`, `cammino`, `journal`, `messages`, `notifications`, `pratiche`, `sessions`, `therapists`

**API routes** (`src/app/api/`):
- `auth/`, `bookings/`, `checkout/`, `livekit/`, `reviews/`, `stream/`, `stripe/`, `therapists/`, `tos/`, `webhooks/`
- `cron/`: `auto-cancel-reschedule`, `cleanup-pending-payment` (CRON_SECRET-gated)
- `security/`

**Env vars richiesti** (`.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://bqyqkvkzkemiwyqjkbna.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…       (usato lato server per webhooks)
NEXT_PUBLIC_STREAM_API_KEY=dx6gpjra45gt
STREAM_API_SECRET=…
NEXT_PUBLIC_SENTRY_DSN=…
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-WPVE6Z3V41
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
MICROSOFT_CLIENT_ID=…
MICROSOFT_CLIENT_SECRET=…
STRIPE_SECRET_KEY=…           (NON in .env.local locale — solo in Vercel env)
STRIPE_WEBHOOK_SECRET=…       (idem)
BREVO_API_KEY=…               (idem)
```

⚠️ **Meta Pixel ID `1445760663897743` è hardcoded** in `src/components/MetaPixel.tsx:6` — per cambiarlo modifica il file (no env var).

## 4.3 Therapist webapp — dettagli rilevanti

Routes:
- `auth`, `call`, `enroll-mfa`, `verify-mfa`, `forgot-password`, `login`, `register`, `reset-password`
- `dashboard/`: `availability`, `billing`, `bookings`, `earnings`, `invoices`, `messages`, `notifications`, `profile`, `reviews`, `services`, `sessions`, `settings`

**Env aggiuntivi** (rispetto al client):
- `GOOGLE_REDIRECT_URI=https://therapistportal.holisticunity.app/api/calendar/google/callback`
- `MICROSOFT_REDIRECT_URI=https://therapistportal.holisticunity.app/api/calendar/microsoft/callback`
- `ICAL_SECRET=…` (per token feed iCal)
- `CRON_SECRET=…`
- `OAUTH_STATE_SECRET=…`
- `NEXT_PUBLIC_LIVEKIT_URL=wss://holistic-unity-7cj033ty.livekit.cloud`

**Notabile**: `bcrypt@^6.0.0` installato — probabilmente per hashing iCal tokens.

## 4.4 Admin dashboard — dettagli rilevanti

Routes:
- `login`, `enroll-mfa`, `verify-mfa`
- `dashboard/`: `audit`, `bookings`, `integrations`, `messages`, `security`, `therapists`, `transactions`, `users`

**Auth dual-gate** (in `src/lib/auth/requireAdmin.ts`):
1. Email in `ADMIN_EMAILS` env allowlist (oggi `marcello@stormxdigital.com`)
2. `users.is_admin` flag true (via `is_admin()` SECURITY DEFINER RPC)

**FattureInCloud OAuth integration** (`src/lib/integrations/fattureincloud/`) — invoicing IT.

**Audit log** (`src/lib/auth/audit.ts`) registra tutte le azioni admin.

---

# 🌍 5. Marketing website

**Path**: `/Users/marcello/Desktop/Holistic Unity/holistic-unity-website/`
**Stack**: HTML statico puro + CSS + JS inline, **nessun framework, nessun build step**
**Hosting**: Vercel (project `prj_WDGMP74Ib3SxEfONAgKCWuaAbnj3`)
**Domain**: `holisticunity.app` (apex)

**Pagine** (17 top-level + 34 blog posts):
- `index.html`, `about.html`, `privacy-policy.html`, `cookie-policy.html`, `terms-clients.html`, `terms-therapists.html`
- 10 modality pages: `astrology.html`, `ayurveda.html`, `family-constellation.html`, `human-design.html`, `naturopathy.html`, `numerology.html`, `reiki.html`, `shamanism.html`, `systemic-constellation.html`, `thetahealing.html`
- `blog/index.html` + 33 post HTML
- `sitemap.xml` con 49 URL

**Tracking pixels** (in `shared.js`, consent-gated):
- **GA4**: `G-0WEMYZ5DZ0` (`shared.js:114`)
- **Meta Pixel**: `1445760663897743` (`shared.js:159`) + eventi custom in `shared-pixel-events.js` (Lead, ViewContent, Contact, Search, CompleteRegistration, LanguageSwitch, ScrollDepth, EngagedSession)

⚠️ **Due GA4 stream separati**:
- Marketing site: `G-0WEMYZ5DZ0`
- Client webapp: `G-WPVE6Z3V41`
Sono stitched via `linker.domains` per persistere client_id cross-domain. Se rompi il linker, rompi attribution Google Ads.

**Altre cartelle "sito"**:
- `holisticunity-site/` — placeholder "Coming Soon" + privacy URL App Store (3 pagine, NON hosted)
- `privacy-policy.html` (top-level) — copia di `holisticunity-site/privacy/index.html`

---

# 🗄️ 6. Backend Supabase

**Project ref**: `bqyqkvkzkemiwyqjkbna`
**URL**: `https://bqyqkvkzkemiwyqjkbna.supabase.co`
**Display name**: "Holistic New"

## 6.1 Database tables (public schema)

### Identità + utenti
- `users` — mirror di `auth.users` + profilo + ruolo (`client`|`therapist`) + dati billing
- `therapist_profiles` — profilo terapista completo con **PII fiscali** (codice_fiscale, p_iva, vat_number, codice_destinatario, pec_email, billing_address, stripe_connected_account_id, ecc.) + bio + categorie + lat/lng + status approvazione
- `therapist_profiles_public` — **VIEW** filtrata su `is_approved=true AND approval_status='approved'`, esclude PII fiscali. ⚠️ Attualmente NON contiene `latitude/longitude` — il fix è nella migration pending `Security_Fixes/2026-05-18_db_migrations.sql`
- `my_therapist_profile`, `user_display_info`, `user_contact_info` — views

### Booking + soldi
- `bookings` — sessioni prenotate (status: pending / pending_payment / confirmed / completed / cancelled), legate a `service_id` + `client_id` + `therapist_id`
- `transactions` — riga finanziaria per ogni booking pagato (amount + platform_fee + therapist_payout + stripe_payment_intent_id + payout_status)
- `session_credits` — credit emesso quando il terapista cancella, redimibile dal cliente
- `payment_methods` — carte salvate (tokenized via Stripe)
- `therapist_invoices` — fatture IT generate via FattureInCloud (period_month, gross_collected, commission_gross, imponibile, iva, fic_invoice_id, sdi_status)
- `therapist_invoice_credits` — note di credito
- `fattureincloud_credentials` — OAuth tokens FattureInCloud
- `stripe_webhook_events` — log eventi processati (idempotency)
- `admin_pending_manual_refunds` — view per refund da processare manualmente

### Chat + comunicazione
- `conversations`, `conversation_participants`, `messages` — **stack chat legacy in-DB**
- `notifications` — in-app notifications (type, title, body, booking_id, conversation_id, is_read)
- `device_tokens` — APNs tokens
- `user_notification_preferences`

⚠️ Stream Chat è ALSO in uso (vedi `STREAM_API_KEY` + edge function `stream-token`) — coesistono due stack chat. Il nuovo dev deve verificare quale viene effettivamente usato in iOS e webapp prima di refactorare.

### Pratiche + servizi
- `practices` — catalogo content (slug, category_key, title, hero_image_url, what_is_it)
- `therapist_services` — servizi offerti per terapista (name, duration, price, is_intro_call, pack_size)
- `certifications` — certificazioni terapista (verified flag)

### Recensioni + onboarding
- `reviews` — recensioni post-sessione (rating, text, therapist_reply, is_flagged)
- `client_preferences` — risposte onboarding cliente (intent, focus_areas, familiar_practices, approaches, timing, life_season, current_practices, cosmic_marker, research_consent)
- `tos_acceptances` — log acceptance ToS + privacy + GDPR Art. 9 health data + ip_address + user_agent + document_hash
- `tos_acceptances_latest` — VIEW latest row per user

### Security + audit
- `mfa_audit_log`, `mfa_backup_codes`, `login_events`
- `admin_actions`, `data_access_log`, `rate_limit_buckets`
- `therapist_calendar_integrations` — OAuth Google/Microsoft per sync calendario

### Tabelle pending (NON ancora in prod — `Security_Fixes/2026-05-18_db_migrations.sql`)
- `reports` — UGC moderation (Guideline 1.2)
- `blocked_users` — block list utente

## 6.2 Edge Functions

**Path**: `/iOS App/untitled folder/Backup 6 Aprile/supabase/functions/` (canonica). `therapist-webapp/supabase/functions/` ne ha alcune addizionali.

⚠️ **Tutte hanno `verify_jwt = false`** in `supabase/config.toml` — la verifica auth è fatta internamente con `supabaseAdmin.auth.getUser(jwt)`. Pattern fragile (basta dimenticare il check in una function per esporre l'endpoint).

| Function | Cosa fa | Dipendenze | Chiamante |
|---|---|---|---|
| `_shared/` | cors.ts, rate-limit.ts, validate.ts, brevo.ts, fee-config.ts | — | n/a |
| `connect-dashboard` | Genera Stripe Express dashboard login link | Stripe | therapist-webapp |
| `connect-redirect` | HTTPS shim per Stripe Connect onboarding, redirect a `holisticunity://stripe-connect-{return,refresh}` | — | Stripe → iOS |
| `create-booking-with-payment` | **Atomic booking + PaymentIntent**. Inserisce booking pending + crea PI con `transfer_data.destination` e `application_fee_amount`. Rollback su failure | Stripe | iOS |
| `create-connect-account` | Crea Stripe Express account per terapista (IT defaults, 14gg payout delay, weekly anchor venerdì) | Stripe | therapist-webapp |
| `create-payment-intent` | Standalone PaymentIntent (legacy, preferire `create-booking-with-payment`) | Stripe | iOS |
| `delete-user-account` | **GDPR Art. 17 cascade**: Stripe customer delete → Stream Chat delete → `delete_user_account()` RPC → `auth.admin.deleteUser()`. Rate-limit 1/5 min | Stripe, Stream | iOS |
| `detach-payment-method` | Rimuove carta salvata | Stripe | iOS |
| `livekit-token` | Mint AccessToken LiveKit per video room | LiveKit | iOS |
| `process-pending-payouts` | Cron job: flip `transactions.payout_status` da `pending` → `paid` dopo escrow 14gg | — | scheduled |
| `request-refund` | Crea refund Stripe + aggiorna DB | Stripe | iOS + admin |
| `send-push-notification` | APNs token-based JWT (ES256), push a iOS device. Triggered da DB webhook su `notifications` insert | APNs | DB webhook |
| `stream-token` | Mint JWT Stream Chat user, rate-limited | Stream | iOS + admin |
| `stripe-webhook` | Verifica signature + handle `payment_intent.succeeded` etc. + sync Google/Microsoft calendar via OAuth refresh | Stripe + Google/Microsoft OAuth | Stripe → backend |
| `validate-promo` (in `therapist-webapp/supabase/`) | **STUB** — TODO da wire | — | n/a |
| `send-brevo-email` (in `/iOS App/supabase/functions/`) | Send transactional/marketing email via Brevo, consent gating | Brevo | webhook DB |
| `sync-brevo-contact`, `send-session-reminders`, `check-dormant-users` | (in `/iOS App/supabase/functions/`) Email automation | Brevo | scheduled |
| `get-available-slots`, `validate-vat` | (in `/iOS App/supabase/functions/`) helpers | — | iOS / webapp |

## 6.3 Authentication

Da `https://bqyqkvkzkemiwyqjkbna.supabase.co/auth/v1/settings`:
- **Provider attivi**: Apple, Google, Email
- `mailer_autoconfirm: false` → **email confirmation ON** (richiesta per email signup)
- `disable_signup: false`
- `passkeys_enabled: false`, `phone_autoconfirm: false`, `anonymous_users: false`
- SMTP per email auth: default Supabase (NON Brevo per le verification emails — Brevo è solo per transactional)

## 6.4 Storage buckets

| Bucket | Public | Uso |
|---|---|---|
| `profile-photos` | ✅ | Avatars cliente + gallery terapista |
| `chat-media` | ❌ | Attachments DM (RLS: visibili solo a participants) |
| `video-intros` | ✅ | Video presentazione terapista |
| `certificates` | ❌ | Documenti certificazione terapista |

## 6.5 RLS policies (spot-check)

| Tabella | RLS | Policies note |
|---|---|---|
| `users` | ON | `users_hide_deleted_from_peers`, `admin_read_all_users`, trigger `guard_user_is_admin_updates` previene non-admin che settano `is_admin` |
| `therapist_profiles` | ON | `admin_update_therapist_profiles` + dopo SQL fix #1: **GRANT granulare per colonna** (codice_fiscale et al. inaccessibili a anon) |
| `bookings` | ON | `admin_read_all_bookings`, `admin_update_bookings`, trigger `protect_booking_columns()` impedisce edit a financial cols |
| `session_credits` | ON | Client/therapist own-row + admin_read_all |
| `reviews` | ON | `admin_delete_reviews`, `admin_update_reviews` |
| `transactions` | ON | `admin_read_all_transactions` |
| `client_preferences` | ON | Owner-only access |
| `tos_acceptances` | ON | Owner-only (dopo SQL fix #2) |
| `reports` (pending) | ON | `reports_insert_self` con rate-limit 10/24h, `reports_select_self`, `reports_admin_all` |
| `blocked_users` (pending) | ON | Self-managed `bu_self_all` |

Pattern admin: `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)`.

## 6.6 Cron jobs (pg_cron)

| Nome | Schedule | Sorgente migration |
|---|---|---|
| `cleanup-orphaned-bookings` | `*/15 * * * *` | `20260412100000_cleanup_orphaned_bookings.sql` |
| `cleanup-rate-limit-buckets` | `*/10 * * * *` | `20260417130000_pg_rate_limit.sql` |
| `cleanup-stale-reschedule-pending` | `*/30 * * * *` | `20260416130000_reschedule_pending_timeout.sql` |
| `hard-purge-deleted-accounts` | `0 3 * * *` daily | `20260417150000_gdpr_erasure_pipeline.sql` |

Più Vercel crons (vedi sezione 4).

## 6.7 Database functions + triggers

**In produzione**:
- `is_admin()` — usato in RLS predicates
- `_guard_user_is_admin_updates()` — trigger protezione `is_admin` flag
- `protect_booking_columns()` — trigger su `bookings` financial cols
- `check_rate_limit(...)`, `cleanup_rate_limit_buckets()` 
- `cleanup_orphaned_bookings()`, `cleanup_stale_reschedule_pending()`
- `create_booking_with_credit(...)` — atomic booking + credit consumption
- `delete_user_account()`, `hard_purge_deleted_accounts()` — GDPR pipeline
- `get_or_create_conversation(...)`
- `handle_new_user()` (legacy, in `supabase_migration.sql`) — copia auth.users → public.users al signup

**Pending** (in `Security_Fixes/2026-05-18_db_migrations.sql`):
- `report_rate_ok(uuid)` — STABLE SQL fn per rate limit reports
- `sync_email_verification_to_users()` + trigger `auth_user_email_verified_sync` — fixa BUG #2 IG guide
- `auto_confirm_free_bookings()` + trigger `bookings_auto_confirm_free` — fixa BUG #4 IG guide

## 6.8 Realtime

Pubblicazioni Realtime non enumerabili via REST. Default `supabase_realtime` publication esiste; tabelle aggiunte via Dashboard. Da verificare al primo accesso quali tabelle sono incluse (probabilmente `messages`, `conversations`, `notifications`, `bookings`).

---

# 💳 7. Payment flow end-to-end (CRITICO)

## 7.1 Configurazione Stripe

- **Modalità**: **LIVE** (pubblicabile = `pk_live_…` in `Secrets.xcconfig:8`)
- **Stripe Connect**: Express con `transfer_data.destination` (destination charges)
- **Apple Pay merchant ID**: `merchant.com.holisticunity.app` (`StripeConfig.swift:14` + entitlements)
- **Webhook receivers** (2 separati, entrambi devono essere registrati in Stripe Dashboard):
  1. Supabase: `https://bqyqkvkzkemiwyqjkbna.supabase.co/functions/v1/stripe-webhook`
  2. Vercel webapp: `https://app.holisticunity.app/api/webhooks/stripe`
- **Webhook secret env var**: `STRIPE_WEBHOOK_SECRET` (in entrambi i webhook receivers)
- **Currencies supportate**: EUR, USD, GBP, BRL (`StripeConfig.swift:16-23` + allowlist in `create-booking-with-payment/index.ts:252`)

## 7.2 Flow iOS (PaymentSheet)

```
1. User tap slot in BookingFlowView.swift                            
   ↓                                                                  
2. preparePaymentSheet() → paymentRepository.createBookingWithPayment(request)
   ↓                                                                  
3. Edge Function `create-booking-with-payment` chiamata               
   ↓                                                                  
4. INSERT into bookings (status='pending', platform_fee, therapist_payout)
   ↓                                                                  
5. Stripe PaymentIntent created:                                      
   - amount = sessionPrice + 2.5% + €0.25 processing fee              
   - application_fee_amount = commissionBase (20%) + processing       
   - transfer_data: { destination: therapist.stripe_connected_account_id }
   - automatic_payment_methods: enabled                               
   - Idempotency-Key: pi-{bookingId}                                  
   - rich metadata: booking_id, client_id, fee breakdown, IVA, ecc.   
   - Stripe Customer + ephemeral key + customer session secret minted 
   ↓                                                                  
6. Response → iOS builds PaymentSheet                                 
   ↓                                                                  
7. User taps Pay → Apple Pay sheet o card entry                       
   ↓                                                                  
8. PaymentSheet → completed (or failed/canceled)                      
   ↓                                                                  
9. iOS calls finalizeBooking() — NON cambia status, aspetta webhook   
   ↓                                                                  
10. Stripe → POST payment_intent.succeeded → stripe-webhook Edge fn   
    a) Verify signature (HMAC-SHA256 constant-time)                   
    b) Insert/upsert transactions row (status='completed',            
       payout_status='pending', payout_after=now+14gg)                
    c) UPDATE bookings SET status='confirmed'                         
    d) syncBookingToCalendar() (Google + Microsoft, non-blocking)     
    e) Create session_credits per pack purchases                      
    f) Save payment method on payment_methods                         
   ↓                                                                  
11. Email + push:                                                     
    - Brevo email template 3 (cliente) + 4 (terapista)                
    - INSERT notifications row → DB webhook → send-push-notification  
   ↓                                                                  
12. Therapist payout: AUTO via destination charges (Stripe transfer al
    payment time). Edge fn `process-pending-payouts` (cron) flippa solo
    `transactions.payout_status` da `pending` → `paid` dopo 14gg     
```

## 7.3 Flow web (Stripe Checkout)

Differenze rispetto a iOS:
- Webapp usa **Stripe Checkout hosted page** invece di PaymentSheet
- `POST /api/checkout/create` → booking con `status='pending_payment'` → `stripe.checkout.sessions.create` con `mode='payment'`, `application_fee_amount`, `transfer_data`, `customer_update`, `billing_address_collection: 'required'`, `phone_number_collection`, optional CF custom field
- Checkout session ha **expiry 31 min** (allineato al `/api/cron/cleanup-pending-payment` cron)
- Webhook receiver: `/api/webhooks/stripe` (gestisce `checkout.session.completed`, deduplica via `stripe_webhook_events` table)

## 7.4 Refund

- Trigger: iOS o web call `request-refund` Edge Function (file `request-refund/index.ts`)
- Policy 3-tier: ≥48h prima = **100%** · 24-48h = **50%** · <24h = **0%**
- Refund creato via Stripe API `/refunds`
- `charge.refunded` webhook → aggiorna `transactions.status` a `refunded`/`partially_refunded` + cancella booking (`stripe-webhook/index.ts:582-624`)
- Webapp ha refund paths anche in `api/bookings/[id]/cancel/route.ts` e `api/bookings/[id]/reschedule/respond/route.ts`

## 7.5 Therapist payout

**Con destination charges, Stripe auto-trasferisce al payment time** — non c'è chiamata `Transfer` API esplicita. La Edge Function `process-pending-payouts` aggiorna solo internamente `transactions.payout_status` da `pending` → `paid` dopo 14gg escrow. Schedule via service-role-key gated (non documentata Vercel/Supabase scheduled).

---

# 📧 8. Email infrastructure (Brevo)

**Provider unico**: Brevo (ex-Sendinblue).

- API helper: `iOS App/supabase/functions/_shared/brevo.ts`
- Env: `BREVO_API_KEY`
- Base URL: `https://api.brevo.com/v3`
- Default sender: `support@holisticunity.app`

## 8.1 Templates Brevo (IDs)

**Transactional (no consent richiesto)**:
| ID | Nome |
|---|---|
| 1 | WELCOME_CLIENT |
| 2 | WELCOME_THERAPIST |
| 3 | BOOKING_CONFIRMED_CLIENT |
| 4 | BOOKING_CONFIRMED_THERAPIST |
| 5 | SESSION_REMINDER_24H |
| 6 | PAYMENT_RECEIPT |
| 7 | THERAPIST_APPROVED |
| 8 | THERAPIST_CHANGES_REQUESTED |
| 9 | CANCELLATION_CONFIRMATION |
| 10 | REFUND_CONFIRMATION |
| 26 | RESCHEDULE_PROPOSED |
| 27 | RESCHEDULE_RESPONDED |

**Marketing (gated su `users.marketing_consent`)**:
| ID | Nome |
|---|---|
| 20 | FIRST_BOOKING_NUDGE |
| 21 | POST_SESSION_FOLLOWUP |
| 22 | REENGAGEMENT_CLIENT |
| 23 | PROMO_VOUCHER |
| 24 | THERAPIST_TIPS |
| 25 | WEEKLY_EARNINGS_SUMMARY |

## 8.2 Brevo contact lists

| ID | Nome |
|---|---|
| 4 | ALL_USERS |
| 5 | CLIENTS |
| 6 | THERAPISTS |
| 7 | MARKETING_OPTED_IN |
| 8 | CLIENTS_ACTIVE |
| 9 | CLIENTS_DORMANT |
| 10 | THERAPISTS_APPROVED |
| 11 | THERAPISTS_PENDING |

## 8.3 WhatsApp

Brevo viene usato anche per WhatsApp Business (`_shared/brevo.ts:193-200`, env `BREVO_WHATSAPP_NUMBER`).

## 8.4 Email auth (Supabase native)

**Verification email** per signup è gestita da **Supabase Auth nativa** (NON Brevo). Welcome email (template 1/2) parte dopo conferma account.

---

# 🔔 9. Push notifications

**APNs solo** (no Web Push, no Android).

- Edge Function: `send-push-notification` (`/supabase/functions/send-push-notification/index.ts`)
- ES256 JWT auth, `Bearer <jwt>`, key id + team id + private key in env
- Env: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT` (`development`/`production`)
- Reads `device_tokens` table
- Respects `user_notification_preferences`
- Strips 410 Unregistered tokens (auto-cleanup)
- Triggered by Supabase DB webhook on `notifications` table INSERT (service-role bearer gated)

---

# 📊 10. Analytics & tracking (CRITICO PER MARKETING)

## 10.1 Inventory completo

| Tool | Dove | Account / ID | Eventi tracciati | File |
|---|---|---|---|---|
| **GA4 Marketing** | `holisticunity.app` | `G-0WEMYZ5DZ0` | page_view, consent state | `holistic-unity-website/shared.js:114` |
| **GA4 Webapp** | `app.holisticunity.app` | `G-WPVE6Z3V41` | page_view (SPA), sign_up (Google Ads conversion w/ Enhanced Conversions) | `client-webapp/src/components/GoogleAnalytics.tsx` |
| **Meta Pixel Marketing** | `holisticunity.app` | `1445760663897743` | Lead, ViewContent, Contact, Search, CompleteRegistration, LanguageSwitch, ScrollDepth, EngagedSession | `holistic-unity-website/shared-pixel-events.js` |
| **Meta Pixel Webapp** | `app.holisticunity.app` | `1445760663897743` (stesso, hardcoded) | Lead, CompleteRegistration, ViewContent, InitiateCheckout, Purchase | `client-webapp/src/components/MetaPixel.tsx:6` |
| **Google Ads conversion** | webapp `/welcome` | tied to GA→Ads link | `sign_up` event con Enhanced Conversions (email+phone) | `client-webapp/src/app/welcome/page.tsx:180-186` |
| **Sentry iOS** | iOS app | DSN in Secrets.xcconfig | Crashes + 10% perf traces | `Holistic_UnityApp.swift:54-61` |
| **Sentry Webapp** | tutte e 3 le webapp | `NEXT_PUBLIC_SENTRY_DSN` env | Browser + server + edge errors + traces | `sentry.*.config.ts` per app |
| **TelemetryDeck** | iOS (stub) | `TELEMETRY_DECK_APP_ID` non settato | NO-OP — SPM non linkato | `Core/Analytics/TelemetryDeckAnalyticsService.swift` |

**NON in uso**: Hotjar, Clarity, TikTok Pixel, GTM container, Mixpanel, Amplitude, PostHog, Segment.

## 10.2 Consent management (GDPR)

- **Marketing site**: `shared.js` cookie banner, attiva GA/Pixel SOLO dopo accept
- **Client webapp**: `CookieBanner.tsx` (binary "Solo essenziali" / "Accetta tutti"), pixel gated dietro `hu-marketing-ack=1` cookie
- **Therapist webapp**: ha CookieBanner ma nessun pixel attivo
- **Admin dashboard**: nessun banner (interna)
- Consent Mode v2 Google attivo nella webapp

---

# 🔐 11. Authentication & security

## 11.1 Provider auth

- **Email + password** (Supabase Auth) — verifica email obbligatoria
- **Sign in with Apple** — iOS native + Supabase OIDC
- **Google OAuth** — iOS (GoogleSignIn SDK) + web

## 11.2 MFA (Multi-Factor Auth)

- **Therapist webapp**: routes `/enroll-mfa` + `/verify-mfa` con Supabase Auth TOTP (`aal1` → `aal2`). Opzionale.
- **Admin dashboard**: stesse routes, MFA infrastructure presente. `mfa_audit_log` + `mfa_backup_codes` tables.

## 11.3 Sicurezza iOS

- **Keychain**: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (no iCloud sync, no backup leak)
- **TrustKit certificate pinning**: pin SHA-256 SPKI per `supabase.co` (subdomains, 2 pin: leaf + intermediate) e `api.stripe.com` (2 pin). ⚠️ **Oggi in reporting mode** (`enforce = false` in `TrustKitConfig.swift:63`). Flippa a `true` dopo 14gg soak.
- **JailbreakDetector**: stub (`isCompromised = false`) finché `IOSSecuritySuite` SPM non linkato. Soft-fail con Sentry breadcrumb.
- **Sentry**: solo `userId` opaco (NO email/PII), `attachScreenshot=false`

## 11.4 Sicurezza web

- **Per-request CSP nonce** in middleware (tutte e 3 le webapp)
- **CookieBanner GDPR-compliant** (binary consent, no preselect)
- **Security headers** (X-Frame-Options, HSTS, Permissions-Policy) — in middleware admin, in `next.config.ts` client+therapist
- **Admin requires `requireAdmin()` dual-gate** (env allowlist + DB flag)

## 11.5 Audit findings 2026-05-18 (vedi `Security_Fixes/AUDIT_REPORT_2026-05-18.md`)

**FIXATI già**:
- BUG #1: `AuthManager.signUp` "Auth session missing" (App Store blocker)
- BUG #3: Onboarding skip dopo TOS per sign-in users
- XSS WebView YouTube embed (validazione 11-char ID + youtube-nocookie.com)
- signOut() wipe URLCache + UserDefaults
- URLSession ephemeral in PaymentRepository
- Privacy manifest expanded (FileTimestamp, SystemBootTime, DiskSpace + PreciseLocation, CrashData, PerformanceData)
- ITSAppUsesNonExemptEncryption = false
- IT locale added a knownRegions

**DA FIXARE** (SQL pronto in `Security_Fixes/2026-05-18_critical_security_fixes.sql` + `_db_migrations.sql`):
- 🔴 **GDPR leak**: anon può leggere codice_fiscale + P.IVA + Stripe IDs di tutti i 16 terapisti via `/rest/v1/therapist_profiles`
- 🔴 `tos_acceptances_latest` view leakava user UUIDs + IP addresses a anon
- 🟠 `is_email_verified` non sync con `auth.users.email_confirmed_at`
- 🟡 Free booking €0 resta "IN ATTESA" — manca trigger auto-confirm

---

# 🚀 12. Deployment & environments

## 12.1 Vercel projects (team `team_6BCebq1X0b1Ogw2VnMWrVZkM`)

| Project | ID | Domain |
|---|---|---|
| Marketing site | `prj_WDGMP74Ib3SxEfONAgKCWuaAbnj3` | `holisticunity.app` |
| client-webapp | `prj_P0TurrmfpyY7Xg73OfEQBxdWURWo` | `app.holisticunity.app` |
| therapist-webapp | `prj_ppUI7TXeLkWOMKCvwLBJhpGCCP0X` | `therapistportal.holisticunity.app` |
| admin-dashboard | `prj_zfRa7lAJboiq1qSdFM3QZUA6k5Id` | `admin.holisticunity.app` |

## 12.2 Supabase

- **Project ref**: `bqyqkvkzkemiwyqjkbna`
- **Display name**: "Holistic New"
- **Org**: `zrpaftiqqwyqdhajixsa`
- **Region**: Frankfurt (inferred)
- **CLI linked project**: file `iOS App/supabase/.temp/linked-project.json`

## 12.3 LiveKit

- **WebSocket URL**: `wss://holistic-unity-7cj033ty.livekit.cloud`
- **Cloud project**: `holistic-unity-7cj033ty`

## 12.4 Stream Chat

- **API Key**: `dx6gpjra45gt` (public)
- **Secret**: in `STREAM_API_SECRET` env (only webapp/admin)

## 12.5 Brevo

- **API Key**: `BREVO_API_KEY` env (only Edge Functions)

## 12.6 Stripe

- **Mode**: LIVE
- **Connect**: Express con destination charges
- **Webhooks (2)**: Supabase + Vercel webapp

## 12.7 Secrets management

**iOS**: `Config/Secrets.xcconfig` (file presente con credenziali live — **NON committare** in git pubblico)

**Web apps**: `.env.local` per dev locale, **Vercel env vars** in prod

**Edge Functions**: env settati via Supabase Dashboard

⚠️ **Service role key Supabase è leggibile** in:
- `admin-dashboard/.env.local` (uso legittimo)
- `client-webapp/.env.local` (uso legittimo per webhooks)
- `therapist-webapp/.env.local` (uso legittimo per cron + webhooks)

Da rotare se queste vengono accidentalmente committate.

---

# ⚠️ 13. Known issues + audit findings

Vedi report dettagliati:
- `Security_Fixes/AUDIT_REPORT_2026-05-18.md` — security + performance + App Store audit
- `Security_Fixes/FINAL_REPORT_2026-05-18.md` — fix applicati + cosa resta
- `IG_Onboarding_Guide/GUIDA_IG.md` — 9 bug trovati durante test guida IG

## 13.1 Bug noti consolidati

| # | Severità | Bug | Stato |
|---|---|---|---|
| 1 | 🔴 | GDPR leak PII therapist_profiles via anon | SQL fix pronto, da runnare in Dashboard |
| 2 | 🔴 | UGC reports + block fake (Guideline 1.2) | Code shipped, DB migration da runnare |
| 3 | 🟠 | `is_email_verified` non sync con auth.users | SQL trigger pronto |
| 4 | 🟡 | Free booking €0 resta "IN ATTESA" | SQL trigger pronto |
| 5 | 🟢 | Email autocorrect | ✅ Fixed (autocorrectionDisabled added) |
| 6 | 🟢 | Stats Account a 0 dopo prenotato | By-design, da decidere |
| 7 | 🟢 | Marcello non emerge nei consigliati | Da investigare (kebab-case fix) |
| 8 | 🟢 | Breathing ritual screen 7.5s auto-advance | Non bug, finestra cattura |
| 9 | 🟢 | Tap card terapista in Explore richiede coord precise | UX edge case |

## 13.2 App Store rejection risks

| # | Cosa | Stato |
|---|---|---|
| 1 | ITSAppUsesNonExemptEncryption | ✅ Fixed |
| 2 | Privacy manifest required APIs | ✅ Fixed |
| 3 | App icon 1024x1024 corrotto | ✅ Fixed |
| 4 | Demo reviewer account placeholder | ✅ Created (`reviewer@holisticunity.app` / `AppleReviewer2026!`) |
| 5 | Report + Block UGC funzionante | Code ✅, DB SQL pending |
| 6 | Screenshots 6.9" Pro Max (1320×2868) | ✅ 4 catturati in `/AppStore_Screenshots_6_9inch/` |
| 7 | Dual Info.plist source of truth (pbxproj + standalone) | ⚠️ Da risolvere |

## 13.3 Performance al 100x scale

- **Image CDN**: helper `URL.supabaseThumbnail()` aggiunto, applicato a `HUAvatar`. Per ulteriore scale considerare Cloudflare Images.
- **N+1 in Bookings tab**: TODO batchare `getProfile` in `.in()` query
- **`searchTherapists` returns all columns**: TODO tighten SELECT (drop bio, availability, gallery_image_urls)
- **HLS pipeline per video**: TODO Mux/Cloudflare Stream
- **PostGIS per nearby**: TODO se >1000 terapisti
- **Asset bundle 12.4MB**: comprimere illustrations a WebP

---

# 🎓 14. Onboarding checklist per il nuovo dev

## Day 1 (mattina) — setup ambiente

- [ ] **Clone delle 4 cartelle codice**:
  - iOS: `/iOS App/untitled folder/Backup 6 Aprile/`
  - client-webapp, therapist-webapp, admin-dashboard, holistic-unity-website
- [ ] **iOS**: apri Xcode, verifica `Secrets.xcconfig` presente (chiedi a Marcello se non c'è), select scheme + simulator iPhone 17 Pro
- [ ] **Webapp**: in ogni cartella `npm install` + crea `.env.local` da template (template solo in admin-dashboard, gli altri devi ricavarli da `.env.local.template` mancante — chiedi a Marcello)
- [ ] **Build iOS**: Cmd+R, deve girare in 20s circa
- [ ] **Test login**: usa account reviewer `reviewer@holisticunity.app` / `AppleReviewer2026!`

## Day 1 (pomeriggio) — accessi richiesti

Chiedi a Marcello:
- [ ] **Apple Developer access** (team `3JXVTKDDXG`)
- [ ] **App Store Connect** access
- [ ] **Vercel team** invite (`team_6BCebq1X0b1Ogw2VnMWrVZkM`)
- [ ] **Supabase project** member su `bqyqkvkzkemiwyqjkbna` (Holistic New)
- [ ] **Stripe Dashboard** invite
- [ ] **LiveKit Cloud** invite
- [ ] **Stream Chat dashboard** invite
- [ ] **Sentry** invite
- [ ] **Brevo** invite
- [ ] **Google Analytics + Google Ads** invite (2 proprietà)
- [ ] **Meta Business Manager** invite (Pixel `1445760663897743`)
- [ ] **FattureInCloud** account access
- [ ] **Domain registrar** access (per DNS holisticunity.app)
- [ ] **GitHub repo** invite (verifica se i 5 codebases sono già in github — non confermato in questa audit)

## Day 1 (sera) — read

Leggi (in ordine):
1. Questo file (HANDOVER_2026-05-18.md)
2. `Project Handoff/01_ARCHITECTURE.md` (esistente — leggi per cross-check)
3. `Project Handoff/02_DEPLOYMENT_GUIDE.md`
4. `Project Handoff/03_CREDENTIALS.md`
5. `Project Handoff/04_DATABASE_SCHEMA.md`
6. `Security_Fixes/AUDIT_REPORT_2026-05-18.md`
7. `Security_Fixes/FINAL_REPORT_2026-05-18.md`

## Day 2 — fix critici da fare PRIMA di qualsiasi altra cosa

1. [ ] Run `Security_Fixes/2026-05-18_critical_security_fixes.sql` nel Supabase Dashboard (GDPR leak)
2. [ ] Run `Security_Fixes/2026-05-18_db_migrations.sql` (Report + Block tables + 2 triggers)
3. [ ] Verifica leak chiuso:
   ```bash
   curl https://bqyqkvkzkemiwyqjkbna.supabase.co/rest/v1/therapist_profiles?select=codice_fiscale \
     -H "apikey: <ANON_KEY>"
   # Deve restituire [{}] (vuoto, niente colonne sensibili)
   ```
4. [ ] Test Report flow su iOS (TherapistProfileView → Segnala → invia)
5. [ ] Test Block flow (TherapistProfileView → Blocca)
6. [ ] Verifica build iOS verde dopo SQL migration

## Day 3+ — backlog medio-termine

Priorità decrescente (da `Security_Fixes/FINAL_REPORT_2026-05-18.md` sezione "Quick wins"):
1. Refactor `SupabaseTherapistRepository` per usare `_public` view (defense-in-depth)
2. Risolvere dual Info.plist source iOS
3. Update Supabase SDK alla versione più recente
4. Implementare i 12 medium-term performance items quando hits scala
5. Marketing translations IT per App Store Connect

---

# 📂 15. File index — dove trovare cosa

```
/Users/marcello/Desktop/Holistic Unity/
│
├── iOS App/untitled folder/Backup 6 Aprile/  ← iOS canonico
│   ├── Holistic Unity.xcodeproj
│   ├── Holistic-Unity-Info.plist
│   ├── Holistic Unity/                       ← Swift source
│   │   ├── Holistic_UnityApp.swift           ← @main entry point
│   │   ├── App/                              ← AppCoordinator, AppState, DI
│   │   ├── Config/Secrets.xcconfig           ← SECRETS (gitignore!)
│   │   ├── Core/                             ← Authentication, Networking, Security
│   │   ├── Data/                             ← Repositories, Services, DTOs
│   │   ├── Domain/Models/                    ← Domain models
│   │   ├── DesignSystem/                     ← Theme, HU* components
│   │   └── Features/                         ← Per-feature views
│   ├── supabase/functions/                   ← Edge Functions canonical
│   └── supabase/migrations/                  ← 28 launch-hardening migrations
│
├── client-webapp/                            ← Next.js 16 client app
├── therapist-webapp/                         ← Next.js 16 therapist portal
├── admin-dashboard/                          ← Next.js 16 admin
├── holistic-unity-website/                   ← Static marketing site (LIVE)
├── holisticunity-site/                       ← Placeholder + privacy URL App Store
│
├── App_Review_Notes.md                       ← Pronto per App Store Connect
├── App_Store_Metadata.md                     ← Description + keywords
├── APP_STORE_SUBMISSION_WALKTHROUGH.md       ← Submission step-by-step
├── HOLISTIC_UNITY_KNOWLEDGE_BASE.md          ← KB esistente
├── PAYMENT_MODEL.md                          ← Fee structure (20% commission, 22% IVA)
├── stripe_incremental_migration.sql          ← Stripe migration script
├── privacy-policy.html                       ← Privacy URL App Store
│
├── Project Handoff/                          ← Doc esistenti
│   ├── 01_ARCHITECTURE.md
│   ├── 02_DEPLOYMENT_GUIDE.md
│   ├── 03_CREDENTIALS.md
│   ├── 04_DATABASE_SCHEMA.md
│   ├── 05_STATUS_TRACKER.md
│   ├── 06_DEVELOPER_ONBOARDING.md
│   ├── HANDOVER_2026-05-18.md                ← QUESTO FILE
│   ├── README.md
│   └── STRIPE_LIVE_MIGRATION.md
│
├── Security_Fixes/                           ← Audit + SQL pending
│   ├── 2026-05-18_critical_security_fixes.sql   ← 🔴 RUN FIRST in Dashboard
│   ├── 2026-05-18_db_migrations.sql              ← 🔴 RUN SECOND
│   ├── AUDIT_REPORT_2026-05-18.md
│   └── FINAL_REPORT_2026-05-18.md
│
├── IG_Onboarding_Guide/                      ← Screenshots + guida onboarding
│   ├── GUIDA_IG.md
│   ├── HolisticUnity_GuidaOnboarding.pdf
│   └── 31 PNG screenshot
│
├── AppStore_Screenshots_6_9inch/             ← 4 screenshots 1320×2868 ready
│   ├── 01_home.png
│   ├── 02_explore.png
│   ├── 03_marcello_profile.png
│   └── 04_account.png
│
├── App Store Screenshots/                    ← Vecchi screenshots (size wrong)
└── docs/                                     ← Cartella docs aggiuntiva (esistente)
```

---

# 📞 16. Contatti

- **Owner**: Marcello Di Pierro — operatore + founder (testa anche personalmente le sessioni)
- **Support email**: `support@holisticunity.app`
- **Default Brevo sender**: `support@holisticunity.app`

---

# 🎯 17. Decisioni architetturali da sapere (rationale)

1. **Why SwiftUI 100%?** App nuova, target iOS 17+, beneficio Observable + concorrenza Swift 6
2. **Why no Android?** Single dev (Marcello) — focus solo iOS+web come MVP. FCM/Android infra non presente
3. **Why 3 webapp separate invece di monolith?** Sicurezza (admin isolato), team boundary (terapisti diversi da clienti), deploy indipendenti
4. **Why Supabase invece di custom backend?** Velocità MVP + RLS + auth built-in + storage + edge functions in un pacchetto
5. **Why Stream Chat + LiveKit (non native iOS Chat/SDK)?** SDK production-ready, niente WebRTC custom, video quality predicibile
6. **Why Brevo per email?** Italian focus + WhatsApp Business integrato + template editor non-tech-friendly
7. **Why FattureInCloud?** Standard de-facto Italy per fatturazione elettronica + SDI compliance
8. **Why Stripe Connect Express?** Onboarding rapido per operatori, no compliance overhead vs Custom
9. **Why TrustKit pinning?** Health-adjacent app — Stripe + Supabase need ATS+pinning per audit conformity
10. **Why no ATT?** Privacy-first stance, no third-party tracking, evita prompt invasivo, TelemetryDeck (quando linkato) è privacy-respecting

---

# 📌 Fine del documento

**Versione**: 1.0 — 2026-05-18
**Generato da**: audit completo con 4 agent paralleli + verifica live DB + lettura sorgenti
**Prossimo update**: dopo che vengono runnate le 2 SQL migrations pending in Security_Fixes/

Buon lavoro al nuovo dev. 🪷
