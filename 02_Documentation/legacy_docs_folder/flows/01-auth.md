# 01 — Authentication

**Last verified:** 2026-05-03 (post MFA mandate, post admin-trigger service-role bypass fix, post deep-link router)
**Status:** ✅ Production
**Owner:** Marcello

> **MFA is now mandatory for therapists.** This doc covers AAL1 sign-in only. For TOTP enrollment, AAL2 gating, and backup-code recovery, see `14-mfa.md`. The therapist webapp's `dashboard/layout.tsx` redirects any AAL1 session to `/enroll-mfa` (first time) or `/verify-mfa` (subsequent sign-ins) before any dashboard data is accessible.

## Purpose

Three separate auth surfaces, with role isolation that mirrors the surfaces:

- **iOS app — client-only.** Email/password + Sign in with Apple + Sign in with Google. Sign-up auto-assigns `role=client` (no role picker). Any user that happens to have `role=therapist` (e.g. signed up on the web portal and then installed the app) is shown `TherapistWebAppRedirectView` on launch — the iOS app has no therapist UI at all.
- **Therapist webapp** — email/password only, rejects `role != therapist` after login, then forces the user through MFA enrollment / verification (`14-mfa.md`).
- **Admin dashboard** — same Supabase auth, gated by **two-factor check** at the middleware layer + the `requireAdmin.ts` helper:
  - `ADMIN_EMAILS` env whitelist (cookie-bearing requests resolve `user.email`)
  - `users.is_admin = true` in DB via `public.is_admin()` RPC (server-only, defense-in-depth)
  - Both must pass. A BEFORE UPDATE trigger (`_guard_user_is_admin_updates`) blocks any user-JWT write to `is_admin`. A second trigger (`prevent_self_approval`, fixed 2026-04-30 to allow service-role bypass) prevents the same user from approving themselves on the therapist approval path — see `18-admin-approval.md`.

## Preconditions

- Supabase Auth project `bqyqkvkzkemiwyqjkbna` initialized with Apple + Google providers
- `users.role` column populated on user creation (via trigger or client-side insert)
- Mobile app bundle ID registered in Apple OAuth config; Google OAuth client configured with iOS client ID

## Happy path — iOS email sign-in

1. User submits form → `LoginView` calls `AuthManager.signIn(email:password:)` at `Holistic Unity/Core/Authentication/AuthManager.swift:170`
2. AuthManager delegates to `SupabaseAuthRepository.signInWithEmail` at `Data/Repositories/SupabaseAuthRepository.swift:71`
3. On success: `currentUser` populated, `authState = .authenticated` at `AuthManager.swift:11-22`
4. Side effects: Stream Chat connect (`AuthManager.swift:191`), Push token register (`AuthManager.swift:192`)
5. Sentry user context set to **opaque userId only** (no email/PII) at `AuthManager.swift:279-282`

## Happy path — Therapist webapp sign-in

1. Form submit → `therapist-webapp/src/app/login/page.tsx:25` calls `supabase.auth.signInWithPassword({email,password})`
2. After success: explicit role check at `login/page.tsx:34-46` — fetch `users.role` and reject if `!= "therapist"`, signOut immediately
3. Redirect to `/dashboard` at `login/page.tsx:49`
4. **MFA enforcement gate** at `dashboard/layout.tsx:42-58` — server component runs BEFORE any dashboard data is rendered:
   - `auth.mfa.listFactors()` — if no verified TOTP factor exists → redirect to `/enroll-mfa` (4-step wizard)
   - `auth.mfa.getAuthenticatorAssuranceLevel()` — if `currentLevel !== 'aal2'` → redirect to `/verify-mfa` (TOTP entry)
   - Only after both checks pass does the dashboard render. Therapists therefore land on `/dashboard` ONLY when they have a verified factor AND have completed TOTP for the current session. Each fresh session re-prompts for AAL2; backup-code recovery flow lives at `PUT /api/security/backup-codes`. See `14-mfa.md` for the full TOTP enrollment + backup-code lifecycle.

## Happy path — iOS Sign in with Apple / Google

1. `AuthManager.signInWithApple()` / `signInWithGoogle()` at `AuthManager.swift:184-206`
2. Google OAuth redirects via `com.googleusercontent.apps.…` scheme; both cold-launch (AppDelegate) and warm (`onOpenURL`) entry points funnel through `DeepLinkRouter.handle(_:)` which routes Google URLs to `GIDSignIn.handle`. Apple uses native `ASAuthorizationController` and never touches the URL handler.
3. JWT from Apple/Google exchanged via `supabase.auth.signInWithIdToken`
4. First-time flow: `authState = .needsOnboarding(.client)` → routes to `ClientOnboardingFlow`
5. Returning user: direct to main app

## Deep link routing (Phase 3.2, 2026-04-17)

**File:** `Holistic Unity/Core/Security/DeepLinkRouter.swift`

Every inbound URL — from OAuth callbacks, push-notification link taps, universal-link clicks, and cold-launch deep links — passes through the router's strict allowlist. Unknown scheme/host combinations are rejected, logged to Sentry (scheme + host only; the full URL is never logged because it may contain auth tokens), and discarded.

Allowed combinations:
- Scheme = `com.googleusercontent.apps.446468190938-…` → `GIDSignIn.handle(url)` (Google OAuth)
- Scheme = `holisticunity`, host = `stripe-connect-success` | `stripe-connect-refresh` → NotificationCenter post (therapist-who-is-also-client future use; no-op today)
- Scheme = `holisticunity`, host = `auth-callback` → `Supabase.auth.session(from:)` (reserved for magic-link / password-reset flows)
- Everything else → rejected + telemetry

**Why this matters:** the previous handler had a silent fallthrough that piped ANY `holisticunity://` URL into `Supabase.auth.session(from:)`, which parses `access_token`/`refresh_token` from URL fragments. A crafted phishing link (QR code, email, message) would have silently overwritten the user's session with attacker-controlled tokens — the user then interacts with the attacker's account thinking it's theirs. Closed by the allowlist.

## iOS biometric gate (opt-in, per-device)

**Files:** `Holistic Unity/Core/Authentication/BiometricLock.swift`, `BiometricLockView.swift`, `Holistic_UnityApp.swift`

1. User toggles "Require Face ID / Touch ID" in `SettingsView` → `@AppStorage("hu_biometric_enabled")` flips to `true`
2. On app launch, `Holistic_UnityApp.onAppear` calls `biometricLock.applyInitialLock()` — sets `isLocked = true` if toggle is on
3. On `scenePhase == .active` transition (background → foreground), `biometricLock.handleForeground()` evaluates whether the 30-second threshold has elapsed since last successful auth:
   - ≤ 30 s: no prompt (covers Control Center pulls, brief notification peeks)
   - \> 30 s: `isLocked = true` → overlay appears
4. While `isLocked == true`, `BiometricLockView` covers the entire app window (ZStack overlay over `AppCoordinator`)
5. User taps "Unlock with Face ID" → `LAContext.evaluatePolicy(.deviceOwnerAuthentication)` (biometric with device-passcode fallback)
6. On success: `isLocked = false`, `lastAuthDate = Date()`, overlay dismisses
7. On failure / cancellation: overlay remains; user must retry or exit app

**Invariants:**
- Biometric gate is **in addition to** Supabase auth, not a replacement. If the user signs out, the gate still triggers on next launch.
- No secrets stored behind the biometric — it's UI gating only. Keychain-stored auth tokens remain accessible to code (Keychain's own biometric binding is NOT used in V1).
- Disabled by default. User must opt in.

## Invariants

- Therapists can ONLY use the webapp login. Any non-therapist attempting webapp login is signed out before reaching the dashboard (`login/page.tsx:42`)
- `users.role` is set exactly once at signup and never changed by client code
- `users.is_admin` can only be flipped by a service-role caller (server-side) — the `_guard_user_is_admin_updates` BEFORE UPDATE trigger blocks all user-JWT writes to that column.
- Sentry never receives email, phone, or any PII — only `userId` (opaque UUID)
- Session tokens stored via Supabase SDK (Keychain on iOS, httpOnly cookies on web through middleware)

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Wrong password | iOS or webapp step 2 | Localized error surfaced to UI (`t.login.error` or `signInError.message`) |
| Therapist portal, role=client | webapp step 2 | signOut + error message `t.login.notTherapist` |
| Apple/Google cancelled | iOS step 1 | No state change, error swallowed |
| Session expired mid-app | Any API call returns 401 | Supabase SDK auto-refreshes, falls back to signOut if refresh fails |

## Test checklist

- [ ] iOS: email/password sign-in → reach main tab
- [ ] iOS: Sign in with Apple (first time) → onboarding flow
- [ ] iOS: Sign in with Google → returning user → main tab
- [ ] Webapp: login with therapist account → `/dashboard`
- [ ] Webapp: login with client account → sign out + error shown
- [ ] Session expired (wait 1h or manually expire) → silent refresh or re-login prompt
- [ ] Sign out on iOS → Stream Chat disconnects, push token removed from `device_tokens`
- [ ] **iOS biometric ON: app launch → lock overlay → Face ID → unlock**
- [ ] **iOS biometric ON: background → 5s wait → foreground → no re-prompt (within threshold)**
- [ ] **iOS biometric ON: background → 60s wait → foreground → lock overlay reappears**
- [ ] **iOS biometric ON: Face ID fails 3 times → device-passcode fallback prompt appears**
- [ ] **Admin dashboard: account NOT in `ADMIN_EMAILS` env but `users.is_admin=true` → still rejected (both must pass)**
- [ ] **Admin dashboard: account in env BUT `users.is_admin=false` → rejected**
- [ ] **Client attempts to `UPDATE users SET is_admin = true WHERE id = auth.uid()` → trigger blocks with error**
- [ ] **Deep link `holisticunity://malicious` → rejected, Sentry event `deep_link_rejected` with reason `unknown_host`**
- [ ] **Deep link `xsstest://holisticunity` → rejected (wrong scheme)**
- [ ] **Deep link `holisticunity://stripe-connect-success-evil` → rejected (no longer prefix-matches)**
- [ ] **Google OAuth callback (cold-launch): tap Google login link while app is terminated → launches cleanly**

## Related

- `02-therapist-onboarding.md` — what happens after a therapist's first AAL1 sign-in (forced into `/enroll-mfa`, then `/enroll-payments`, then `pending review`)
- `03-client-onboarding.md` — post-signup flow for clients (no MFA)
- `14-mfa.md` — TOTP enrollment + AAL2 gate + backup codes (mandatory for therapists)
- `18-admin-approval.md` — `prevent_self_approval` trigger (the admin counterpart of the auth-side `_guard_user_is_admin_updates`)
- `22-account-deletion.md` — full `delete-user-account` Edge Function orchestrator (Stripe + Stream + Supabase + auth.users)
- `11-messaging.md` (Stream connection on sign-in)
- `platform/security.md` (session handling, token storage)

## Account deletion (GDPR Art 17, App Store Guideline 5.1.1(v))

**Entry point:** iOS Settings → Account → "Delete Account" (`SettingsView.swift:61`)

1. User confirms in dialog.
2. `AuthRepository.deleteAccount()` (at `SupabaseAuthRepository.swift:165`) invokes edge function `delete-user-account` — NOT the DB RPC directly (pre-Phase-5 code did the latter, skipping external-service cleanup).
3. Edge function orchestrates:
   a. Auth check — require valid user JWT.
   b. Rate limit — 1 delete attempt per 5 min per user.
   c. **Stripe** — `DELETE /v1/customers/{stripe_customer_id}` (if a customer record exists via `payment_methods.stripe_customer_id`). Detaches all cards; retains transaction history for audit.
   d. **Stream Chat** — `serverClient.deleteUser(userId, {mark_messages_deleted: true, hard_delete: false})`. Stream's recommended GDPR pattern.
   e. **Supabase DB** — invokes `public.delete_user_account()` RPC (migration `20260417150000`) as the user's JWT. The RPC:
      - Cancels in-flight bookings (status IN 'pending' | 'confirmed' | 'reschedule_pending')
      - Re-points completed-booking `client_id` to tombstone UUID `00000000-0000-0000-0000-000000000001` (preserves therapist records)
      - Redacts review text to `[Deleted]` but keeps rating (therapist aggregate valid)
      - Deletes session_credits, device_tokens, notification_preferences, notifications, conversation_participants
      - Nulls PII in the user row; sets `deleted_at` + `anonymized_at`
      - If user is also a therapist: anonymizes `therapist_profiles`
   f. **auth.users** — admin-API delete so the user cannot log in again.
4. Returns summary JSON `{ok, user_id, db, stripe, stream, auth}` — partial failures in stripe/stream are non-fatal per GDPR Art 17 precedence; the user is erased even if Stream is down.

**30-day retention:** the anonymized `public.users` row remains for 30 days. `hard_purge_deleted_accounts()` cron (daily 03:00 UTC) hard-deletes rows where `deleted_at > 30 days ago`. During the retention window an admin can manually restore (via service_role update) if the user changes their mind.

## Known gaps

- No password reset flow in iOS app (users redirected to Supabase hosted UI)
- No email verification enforcement (Supabase sends verification but login is allowed without it)
- No CAPTCHA on signup/login yet (Phase 5.4 — activation plan at `platform/abuse-hardening-roadmap.md`)
- ~~No rate limiting on login attempts~~ — Supabase default throttling in place; custom RL applies to Edge Function endpoints (not login itself, which is handled by Supabase Auth)
- Biometric gate is UI-only (does NOT bind auth tokens to biometric via Keychain `kSecAttrAccessControl`). Future hardening: bind the refresh token to biometric access control.
- Jailbreak detection scaffolded (`Core/Security/JailbreakDetector.swift`) but dormant until `IOSSecuritySuite` SPM package is added — see Phase 3.1 in `platform/security.md`.
- Account deletion's 30-day retention is not user-visible — no "undo delete" UI; restore requires support ticket to admin@holisticunity.app.
