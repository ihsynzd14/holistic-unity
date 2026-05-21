# Security

**Last verified:** 2026-04-17 by Marcello
**Status:** Phases 1–5 security hardening deployed AND Phase 5 database/edge-function changes are **live in production** (applied 2026-04-17 via Management API after CLI history mismatch). Privacy policy sub-processor list is now complete. Still pending user action: (a) add `IOSSecuritySuite` SPM package to activate jailbreak detector (Phase 3.1); (b) add `TelemetryDeck` SPM package + App ID to activate analytics (Phase 5 analytics track); (c) major SDK upgrades — Stream 4.99→5.x, GoogleSignIn 9.1→10.x, stream-chat-react 13→14 — blocked on changelog review (Phase 3.3); (d) push web repos to GitHub so CI workflows (`.github/workflows/{gitleaks,npm-audit}.yml`, `.github/dependabot.yml`) start firing; (e) configure the alert rules documented in `monitoring.md`; (f) implement cookie consent banner on marketing site to gate GA loading (CNIL/Garante exposure); (g) end-to-end test account deletion on real device; (h) enter privacy policy URL in App Store Connect; (i) rotate the Supabase personal access token shared in chat.
**Owner:** Marcello

> **Related top-level docs:** `../../SECURITY_AUDIT.md`, `../../SECURITY_RULES.md`, `../../PRE_DEPLOYMENT_QA.md` — this is the operational summary.

## Threat model (V1)

- Malicious clients tampering with prices / booking state
- Attackers trying to read other users' email, phone, birth data, location
- CSRF on OAuth callbacks
- Webhook replay / forgery
- Brute-force on login + enumeration of video rooms or iCal tokens
- Secrets leaking in logs / source maps / client bundles
- Forged JWTs with spoofed email claims escalating to admin
- MITM via compromised root CA
- Stolen or left-unlocked device accessing therapy content

Out of scope V1: full DDoS mitigation beyond Vercel/Supabase defaults, advanced bot detection, third-party SDK cert pinning (Stream/LiveKit/Sentry not pinned).

## Authentication

- Supabase Auth (email+password + Apple + Google)
- Sessions: iOS Keychain (`Core/Authentication/KeychainService.swift`), web httpOnly cookies via middleware
- Therapist webapp: explicit `role = "therapist"` check at `login/page.tsx:34-46` after sign-in
- **Admin dashboard: defense-in-depth** (see Authorization section)
- iOS Sentry user context is opaque `userId` ONLY — never email/phone (`AuthManager.swift:279-282`)
- **iOS biometric gate** at app launch + on foreground after 30s — `Core/Authentication/BiometricLock.swift`, toggle in Settings (`hu_biometric_enabled`). LAContext `deviceOwnerAuthentication` (Face ID/Touch ID with passcode fallback).

## Authorization (RLS policies)

All 15 public tables have RLS enabled, verified live via Management API on 2026-04-17.

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `users` | **own row OR relationship-scoped** (booking + conversation peers) | (signup trigger) | own row (trigger blocks `is_admin` self-update) | disabled |
| `therapist_profiles` | `is_approved = true` OR own OR `is_admin()` | own | own OR admin | own |
| `therapist_services` | public (approved therapists) + `is_active=true` filter on iOS | own | own | own |
| `bookings` | client OR therapist OR admin | via edge function only | own + rules OR admin | disabled |
| `transactions` | own client/therapist OR admin | webhook only (service_role) | service_role only | disabled |
| `session_credits` | own OR admin | via RPC only | via RPC only | disabled |
| `conversations` | participant | participant | participant | disabled |
| `conversation_participants` | participant | `auth.uid() = user_id` | own | own |
| `messages` | participant | participant | own | disabled |
| `notifications` | own | service_role only | own (mark read) | own |
| `reviews` | public (non-flagged) + admin | client of booking | client / therapist (reply) / admin | admin |
| `therapist_calendar_integrations` | own | own | own | own |
| `device_tokens` | own | own | own | own |
| `user_notification_preferences` | own | own | own | own |
| `rate_limit_buckets` | service_role only (no policies) | — | — | — |

**Key 2026-04-17 additions:**

1. **`users` table locked down** (Phase 1 fix) — two permissive policies (`Authenticated users can read other users`, `Authenticated users can read other users display info`) dropped. Replaced with `Users can read linked users` which only grants SELECT on another user's row when the requester shares a booking or a conversation with them. Before this fix, any authenticated user could `select * from users` and scrape everyone's email, phone, birth_date, lat/lon, fcm_token, stripe_customer_id. GDPR-grade exposure closed.

2. **`users.is_admin` column** (Phase 1.3) — boolean, default false, partial index. Paired with `public.is_admin()` RPC (SECURITY DEFINER, `SET search_path = ''`). Admin-scoped policies added on users, bookings, transactions, reviews, therapist_profiles, session_credits. Trigger `_guard_user_is_admin_updates` blocks any non-admin, non-service_role update of `is_admin` — a user cannot promote themselves.

3. **admin-dashboard routes now call `requireAdmin()`** (`admin-dashboard/src/lib/auth/requireAdmin.ts`) which checks BOTH env `ADMIN_EMAILS` AND `is_admin()` RPC. Single-layer bypass (forged JWT spoofing admin email) no longer sufficient.

Storage buckets (unchanged since 2026-04-14 hardening):

- `profile-photos` — public read; authenticated write to own `${userId}/*` path
- `chat-media` — participant-scoped RLS (migration `20260414100100`)
- `certificates` — private; owner read/write
- `video-intros` — public read; owner write

## Rate limiting (distributed via Postgres)

Phase 1.2 added a shared rate limiter backed by Postgres. Before this fix each Deno instance had its own in-memory counter — an attacker could scale the effective limit by triggering horizontal autoscale. Now all instances share a single counter.

Architecture:

- Table: `public.rate_limit_buckets (bucket_key text PK, count bigint, expires_at timestamptz)` — RLS enabled, zero policies (service_role only).
- RPC: `public.check_rate_limit(key, max, window_sec)` — SECURITY DEFINER, `SET search_path = ''`, atomic INSERT ... ON CONFLICT UPDATE RETURNING count.
- Cleanup cron: `cleanup_rate_limit_buckets()` every 10 minutes via pg_cron.
- Caller wrappers:
  - Edge Functions: `supabase/functions/_shared/rate-limit.ts` — fetches the RPC with 800 ms timeout; falls back to in-memory if Postgres unreachable.
  - Webapp: `therapist-webapp/src/lib/auth/rateLimit.ts` — `withRateLimit(request, {key, max, windowSec, userId?})`. Identifies by user ID > `x-forwarded-for` > `x-real-ip` > `"anon"`.

Coverage:

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| `livekit-token` | 20 | 60 s | per user |
| `stream-token` | 20 | 60 s | per user |
| `create-booking-with-payment` | 5 | 60 s | per user |
| `create-payment-intent` | 5 | 60 s | per user |
| `request-refund` | 3 | 60 s | per user |
| `detach-payment-method` | 5 | 60 s | per user |
| `/api/ical/[therapistId]/[token]` | 60 | 3600 s | per IP (per therapistId) |
| `/api/stripe/connect` | 10 | 600 s | per user |
| `/api/calendar/google/authorize` | 30 | 60 s | per user |
| `/api/calendar/microsoft/authorize` | 30 | 60 s | per user |

429 responses include `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers.

## Input validation (Zod)

Phase 2.1 added `supabase/functions/_shared/validate.ts` with Zod schemas. The helper `parseJson(req, schema, corsHeaders)` returns a 400 response with structured `issues` on failure.

Endpoints currently validated:

- `livekit-token` → `LivekitTokenSchema` (roomName alphanumeric+`-_`, max 128; participantName max 100)
- `create-booking-with-payment` → `BookingPaymentSchema` (all UUIDs strict, price 0.5–999999.99, discount 0–0.95, ISO currency)
- `request-refund` → `RefundSchema` (refine: transaction_id or booking_id required)
- `detach-payment-method` → `DetachPaymentMethodSchema` (UUID row ID)

Request pipeline order: **JWT auth → rate limit (429) → Zod parse (400) → business logic**. Malformed payloads from unauthenticated callers never reach the parser.

## Secrets

Secret inventory (see `env-config.md` for full list):

| Secret | Storage | Rotation cadence |
|--------|---------|------------------|
| Supabase anon key | Public client bundles | On project reset only |
| Supabase service_role | Supabase Edge Functions + admin-dashboard server | Yearly or on compromise |
| Stripe secret key | Supabase Edge Functions (`STRIPE_SECRET_KEY`) | Yearly |
| Stripe webhook secret | Supabase Edge Functions | On webhook endpoint change |
| Google OAuth client secret | Vercel env + `.env.local` | Per Google policy (~2yr) |
| Microsoft OAuth client secret | Vercel env + `.env.local` | Max 24mo (Azure limit) |
| Stream API secret | Supabase Edge Functions + Vercel (server-side only) | Yearly |
| LiveKit API secret | Supabase Edge Functions | Yearly |
| iCal signing secret | Vercel env (`ICAL_SECRET`) | Yearly or on leak |
| OAuth state secret | Vercel env (`OAUTH_STATE_SECRET`; falls back to ICAL_SECRET) | Yearly or on leak |

Secrets NEVER in: iOS source code, client bundles, public repos, Sentry, error messages. Verified via secret leak scan 2026-04-17: zero secrets committed to any of the 3 git repos.

## CSRF / OAuth state

Calendar OAuth (Google + Outlook) uses a signed, timestamped, nonce-bearing state parameter built in `therapist-webapp/src/lib/calendar/tokens.ts`:

```
state = base64url(payload) + "." + HMAC-SHA256(payload, OAUTH_STATE_SECRET)
payload = { therapistId, timestamp, nonce: randomUUID() }
```

Callbacks (`google/callback/route.ts` and `microsoft/callback/route.ts`) verify ALL of:

1. Signature — constant-time HMAC comparison against `OAUTH_STATE_SECRET` (falls back to `ICAL_SECRET`). Tampered state is rejected.
2. `timestamp` within 15-minute TTL — expired state rejected (`?reason=state_expired`).
3. `therapistId` matches `auth.uid()` of the logged-in session — prevents one user attaching another user's calendar (`?reason=user_mismatch`).
4. `nonce` — crypto-random, defence in depth. Makes the encoded payload unpredictable even for the same `{therapistId, timestamp}` pair.

## Webhook verification

- Stripe webhook verifies signature with `STRIPE_WEBHOOK_SECRET` before DB writes (`stripe-webhook/index.ts` line ~20).
- Timing-safe HMAC comparison.
- 5-minute tolerance on the Stripe-sent timestamp to allow clock drift.
- Idempotency: UNIQUE constraint on `transactions.stripe_payment_intent_id`; duplicate events INSERT ON CONFLICT DO NOTHING.

## iOS certificate pinning (TrustKit)

Phase 2.3 added SSL/TLS pinning via TrustKit SPM (`https://github.com/datatheorem/TrustKit`, version 3.0+). Config at `Core/Security/TrustKitConfig.swift`, initialized in `AppDelegate.didFinishLaunchingWithOptions` BEFORE any network request.

**Scope (intentionally conservative):**

- **Pinned:** `supabase.co` (`includeSubdomains=true`), `api.stripe.com`
- **NOT pinned:** Stream Chat, LiveKit, Sentry, Google OAuth, Apple. Third-party SDKs rotate certs without notice — pinning them risks multi-hour outages. Their TLS is validated by iOS default chain verification.

**Each domain has 2 pins** (leaf + intermediate SPKI SHA-256 base64) so a cert rotation doesn't brick the app. Extracted 2026-04-17 via `openssl s_client | openssl dgst -sha256 -binary | base64`.

**Current state: REPORTING MODE** (`kTSKEnforcePinning = false`). Pin mismatches log to `os.log` subsystem `Holistic-Unity-Healing` category `TrustKit` but don't fail connections. Flip to enforcement after 7–14 days of production soak with zero false positives — 1-line change in `TrustKitConfig.swift`.

Monitor with:
```bash
xcrun simctl spawn booted log show \
  --predicate 'subsystem == "Holistic-Unity-Healing" AND category == "TrustKit"' \
  --last 24h
```

## HTTP headers (therapist webapp + admin dashboard)

Static headers in `next.config.ts` (applied by Vercel to every response):

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), microphone=(self), geolocation=()` (admin dashboard: `camera=(), microphone=()` — no A/V needed)
- `X-Powered-By` stripped
- Source maps OFF in production

### Content-Security-Policy — current state (Phase 3.4, last revised 2026-05-04)

CSP is built **per request** in the edge middleware (not in `next.config.ts`, which can't inject dynamic values). Each response gets a fresh 128-bit nonce; the nonce flows through two channels:

1. Request header `x-nonce` — forwarded into the RSC render. Intended to be auto-applied by Next.js to its internally generated inline scripts (hydration + router).
2. Response header `Content-Security-Policy` — enforced by the browser.

| Webapp | Middleware file | Helper |
|--------|-----------------|--------|
| therapist-webapp | `src/proxy.ts` (Next 16 `proxy` convention) | `src/lib/security/csp.ts` |
| admin-dashboard  | `src/middleware.ts` | `src/lib/security/csp.ts` |

**Hosts allowlisted on `img-src` and `connect-src` for therapist video posters (added 2026-05-05):** `img-src` allows `https://img.youtube.com`, `https://i.ytimg.com`, and `https://*.vimeocdn.com` so the YouTube/Vimeo thumbnail URLs the therapist profile renders as a video tile poster aren't CSP-blocked. `connect-src` allows `https://vimeo.com` for the public oEmbed endpoint (`vimeo.com/api/oembed.json?url=…`) used to resolve Vimeo thumbnails — Vimeo's CDN paths aren't deterministic so we have to ask. YouTube thumbnails resolve synchronously without any fetch and are loaded directly as `<img>` src.

**⚠️ Current published `script-src`:**

```
script-src 'self' 'unsafe-inline'             # 'unsafe-eval' added in dev
```

We **rolled back from nonce-only to `'unsafe-inline'`** (see comment at `client-webapp/src/lib/security/csp.ts:42-54` and the equivalent files in `therapist-webapp` + `admin-dashboard`). The rollback rationale: Next.js 16.2.3 should auto-apply the per-request nonce to its bootstrap inline scripts (the `self.__next_f.push(...)` chunks) when the middleware sets `Content-Security-Policy` on the forwarded request headers, but in this project that auto-application doesn't happen reliably — the SSR'd inline scripts come back without a `nonce=` attribute and the browser blocks them, leaving `__next_f.length === 0` and React stuck on the Suspense fallback ("Caricamento..."). The nonce parameter is still computed and threaded through for any downstream consumer; nothing currently relies on it.

This is a documented regression vs the original intent. The XSS posture is now **equivalent to the pre-Phase-3.4 baseline**, not stronger. Revisit when Next.js fixes the nonce attachment OR if we move bootstrap scripts to external chunks.

Other directives (unchanged):

```
default-src 'self';
style-src 'self' 'unsafe-inline'              # kept — see trade-off note
img-src 'self' data: blob: https://*.supabase.co;
font-src 'self' data:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            wss://*.livekit.cloud https://*.livekit.cloud
            https://api.stripe.com
            https://*.stream-io-api.com wss://*.stream-io-api.com;  # therapist-webapp only
frame-src 'self' https://js.stripe.com https://hooks.stripe.com;   # therapist-webapp; admin = 'none'
media-src 'self' blob:;
object-src 'none';
frame-ancestors 'none';                       # belt-and-suspenders with X-Frame-Options: DENY
base-uri 'self';
upgrade-insecure-requests
```

**Remaining trade-off — `style-src 'unsafe-inline'`:** Next.js + Tailwind JIT emit inline `<style>` and `style=` attributes at runtime. Dropping `'unsafe-inline'` on styles would require a nonce-per-style-tag migration across the entire component tree that is disproportionate effort for the XSS risk reduction. Documented intentional trade-off; revisit if Trusted Types ever lands.

**Dev exception:** `'unsafe-eval'` is included only when `NODE_ENV !== 'production'` (needed by Next.js Fast Refresh).

## iOS deep-link strict validation (Phase 3.2, 2026-04-17)

All inbound URLs are routed through `Core/Security/DeepLinkRouter.swift` — a single choke point used by both entry paths (UIKit `AppDelegate.application(_:open:)` and SwiftUI `onOpenURL`). The previous silent fallthrough (any `holisticunity://` URL piped into `Supabase.auth.session(from:)`, which parses `access_token`/`refresh_token` from URL fragments) is removed. Attack vector: a crafted phishing link could have planted attacker-controlled session tokens.

Allowlist:
- Scheme `com.googleusercontent.apps.446468190938-...` → `GIDSignIn.handle(url)`
- Scheme `holisticunity` + host `stripe-connect-success` | `stripe-connect-refresh` → NotificationCenter post
- Scheme `holisticunity` + host `auth-callback` → `Supabase.auth.session(from:)`
- Anything else → rejected; Sentry event tagged `security.event_type=deep_link`; URL scheme+host logged, never the full URL (would leak tokens)

No prefix matching — `hasPrefix("stripe-connect")` was replaced with exact enum rawValue match, closing the `stripe-connect-malicious-suffix` hole.

## iOS jailbreak / runtime-tampering detection (Phase 3.1, 2026-04-17)

**Scaffold:** `Core/Security/JailbreakDetector.swift` is in place and wired into app launch. Uses `#if canImport(IOSSecuritySuite)` so the file compiles with or without the SPM package linked. **Activation requires user to add `https://github.com/securing/IOSSecuritySuite` via Xcode → Add Package Dependencies** — until then the detector is a no-op.

Checks (active once SPM linked):
- Jailbreak artifacts (Cydia.app, writable `/private`, suspicious dylibs)
- Debugger attached (release builds only)
- Reverse-engineering tools (Frida, Cycript)
- Runtime method-swizzling hooks (release builds only)

**Policy: soft-fail.** A flagged device sets `JailbreakDetector.shared.isCompromised = true`, emits a Sentry event tagged `security.event_type=jailbreak`, and continues. No hard-block — TestFlight reviewers sometimes use jailbroken devices, and false positives from corporate MDM are common. Sensitive flows (payments) can consult the flag to add confirmation steps or annotated telemetry.

## Database function hardening

All 23 SECURITY DEFINER functions in `public.*` verified on 2026-04-17 to have `SET search_path = ''`. Phase 2.4 migration `20260417140000_search_path_audit.sql` fixed 5 that previously had `search_path = public` or unset. Mutable search_path on SECURITY DEFINER is a privilege-escalation class (attacker with CREATE on any schema can shadow `public.users` etc.) — now closed.

## Screen recording protection (iOS video call)

`Features/VideoCall/ScreenCaptureProtection.swift` implements a SwiftUI `.protectAgainstScreenCapture()` modifier. Observes `UIScreen.capturedDidChangeNotification`; when `isCaptured = true` blurs the protected view (40pt radius) and shows an opaque privacy panel. Applied to `VideoCallView`. Defeats ReplayKit, QuickTime USB capture, AirPlay mirroring.

Best-effort: does not defeat a phone camera pointed at the screen. For therapy session privacy this is the appropriate level (legal requirement is "reasonable safeguards," not "physically impossible").

## iOS specific (other)

- HTTPS only (no ATS exceptions in Info.plist).
- Secrets in xcconfig (`Config/Secrets.xcconfig`, not committed). All `Config/*.swift` read from `Bundle.main.infoDictionary` via `guard let ... else fatalError(...)` — app crashes with clear message if a key is missing, rather than silently defaulting to empty string.
- All logging via `os.log` Logger. Zero `print()` calls in source (verified grep).
- Permission descriptions in Info.plist: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSFaceIDUsageDescription`, `NSUserTrackingUsageDescription`. All V1-appropriate copy explaining why and that declining is supported where possible.
- Privacy manifest at `PrivacyInfo.xcprivacy` declares email + name as `Linked`, `AppFunctionality`, not tracking.

## Enforcement

- SQL rules: see `../../SECURITY_RULES.md` — checklist to run before merging any SQL migration.
- Pre-release grep checks:
  - `grep -r "unsafe-inline" therapist-webapp/next.config.ts` — expected only for style-src (trade-off documented above).
  - `grep -rE "sbp_|sk_live|whsec_" **/*.swift` — should return 0 results.
  - `grep -r "console.log.*token" therapist-webapp` — no token logging.
  - `grep -r "print(" Holistic\ Unity/**/*.swift` — should return 0 results.
- Pre-TestFlight QA: `../../PRE_DEPLOYMENT_QA.md` has the full 8-part checklist (Parts A-I).
- **CI (Phase 4):** Once repos are pushed to GitHub, `gitleaks.yml` + `npm-audit.yml` fire on every push + PR + cron. Build is blocked on any finding at gitleaks default/custom-rule severity OR on `npm audit --audit-level=high` for production deps.
- **Dependabot:** weekly grouped PRs per repo (`.github/dependabot.yml`) — next-stack, supabase, stream-chat, livekit, dev-tooling groups. Stream Chat major bumps deliberately ignored pending V1.1 upgrade track.
- **Manual scans:** `scanning-runbook.md` — MobSF on Release IPA before each major release, OWASP ZAP monthly against both webapps, testssl.sh quarterly, ggshield belt-and-suspenders before each public release.
- **Monitoring:** `monitoring.md` — 5 Sentry alert rules + 7 Supabase log queries. Tag-propagation checklist therein tracks which code paths still need Sentry tagging to make the rules fire.

## Known gaps (remaining after Phase 3)

**Closed in Phase 3 (2026-04-17):**
- ~~Deep-link `holisticunity://` silent fallthrough~~ — closed via `DeepLinkRouter.swift` strict allowlist.
- ~~CSP `'unsafe-inline'` + `'unsafe-eval'` on script-src~~ — closed via per-request nonce in edge middleware. Admin dashboard gained a full CSP (previously had none).
- ~~Jailbreak detection absent~~ — scaffolded. Activation pending user-side SPM package add (see Phase 3.1 note in Status).

**Closed in Phase 4 (2026-04-17):**
- ~~No MobSF / OWASP ZAP / gitleaks in CI~~ — gitleaks + npm-audit workflows staged in `.github/workflows/`; Dependabot config staged; manual scan runbook at `scanning-runbook.md`. Will activate as soon as repos are pushed to GitHub.
- ~~No systematic log-based alerting~~ — Sentry + Supabase alert rules drafted at `monitoring.md`.

**Closed in Phase 5 (2026-04-17):**
- ~~Hard-delete `delete_user_account` breaks therapist history~~ — migration `20260417150000_gdpr_erasure_pipeline.sql` **applied to production 2026-04-17**; soft-delete + PII anonymization + 30-day retention via tombstone pattern.
- ~~Account deletion skipped Stream + Stripe cleanup~~ — `delete-user-account` edge function **deployed to production 2026-04-17**; orchestrates external cleanup before DB anonymization.
- ~~Data export only covered 3 tables~~ — expanded to 7 tables with 3rd-party-processor disclaimer.
- ~~No incident response runbook~~ — `../INCIDENT_RESPONSE.md` covers severity matrix, secret rotation per provider, Art 33 breach notification, PITR procedure, Stripe dispute, outage playbook.
- ~~Privacy policy sub-processor list incomplete~~ — **updated 2026-04-17** in `holistic-unity-website/privacy-policy.html` sections 7.3-7.11: LiveKit, Brevo, Stream Chat, Sentry, OAuth providers (Apple/Google/Microsoft), Vercel, APNS all declared. International transfers section 9 refreshed. Pending legal counsel review.
- ~~No product analytics path~~ — TelemetryDeck (privacy-first, EU-hosted) scaffold added; dormant until SPM add + App ID configuration, then runs with no IDFA, no ATT prompt, SHA-256-hashed pseudonymous user id only.

**Still open — queued for V1.0 or V1.1:**
- **SDK major-version upgrades** (Phase 3.3) — user-driven: Stream Chat iOS 4.99 → 5.x, GoogleSignIn-iOS 9.1 → 10.x, stream-chat-react 13.14 → 14.0 on both Next.js repos. All pending changelog review before update. Current minor-version state verified clean: `npm audit` shows 1 moderate (`follow-redirects` via stream-chat 9.41.0 → axios 1.15.0; resolved by bumping stream-chat).
- **Sentry tag propagation** — 3 of 5 `security.event_type` tags are not yet emitted: rate-limit (edge functions don't have Sentry wired), admin-denied (webapp route handler doesn't tag), biometric-failed (iOS Sentry call not yet added). Rules in `monitoring.md` are ready but dormant. See the "Tag propagation checklist" therein.
- **CI activation** depends on user pushing repos to GitHub (currently local-only).
- No WAF in front of Vercel / Supabase (out of scope unless abuse seen).
- No bot/CAPTCHA on signup (Phase 5.4 — hCaptcha planned for public launch).
- Biometric gate is UI-only — does NOT bind Keychain-stored tokens to biometric access via `kSecAttrAccessControl` (Phase 2+ hardening deferred).
- TrustKit still in reporting mode — 7-day soak required before flipping `kTSKEnforcePinning = true` in `TrustKitConfig.swift`.
- Audio not blocked during iOS screen recording (visual-only protection on video call).
- No CSP violation reporting endpoint — any CSP bugs post-deploy surface only in browser console, not telemetry. If an issue is spotted, add a `report-to` directive + Sentry CSP endpoint.
- No Vercel log draining — Hobby plan retains 1 h of logs. Log draining to Axiom/Logflare recommended before public launch.
