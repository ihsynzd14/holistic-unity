# Holistic Unity — Security Audit Report

**Date:** 15 April 2026
**Auditor:** Claude (automated + manual verification)
**Scope:** iOS App, Therapist Webapp, Supabase Backend, Edge Functions

---

## A. Authentication & Session Management

- [x] **Auth is handled by Supabase Auth (not custom-built)**
  ✅ Implemented — 14 API routes use `createClient()` from `@supabase/ssr`
  iOS: `Core/Authentication/AuthManager.swift` uses `SupabaseConfig.client.auth`

- [x] **JWTs are not exposed in URLs or query parameters**
  ✅ Implemented — JWTs passed via headers (`Authorization`, `x-user-token`), cookies, or React state. The only URL-exposed token is Google OAuth revocation (`/revoke?token=`) which is standard.

- [x] **Token refresh logic handles expired tokens gracefully**
  ✅ Implemented — `SupabaseConfig.swift:26` `autoRefreshToken: true`. Webapp middleware at `src/middleware.ts` calls `updateSession()` on every request. iOS `VideoCallService.swift:315-327` retries on 401.

- [ ] **Password reset links expire within 30-60 min**
  ⚠️ Partially — Supabase `mailer_otp_exp: 3600` (1 hour). Acceptable but could be tightened to 30 min.
  **Action:** Update via Supabase dashboard > Auth > Email Templates > OTP Expiry.

- [ ] **OAuth callbacks validate the state parameter**
  ⚠️ Partially — State includes `{therapistId, timestamp}` with 15-min expiry check + user ID match. But state is `Base64(JSON)`, NOT cryptographically random.
  **Files:** `src/app/api/calendar/google/callback/route.ts:30-50`, `microsoft/callback/route.ts`
  **Action:** Replace with `crypto.randomUUID()`, store mapping server-side.

- [x] **Session tokens stored in httpOnly cookies**
  ✅ Implemented — Supabase SSR uses httpOnly cookies via `src/lib/supabase/middleware.ts` + `server.ts`. iOS uses Keychain (`Core/Authentication/KeychainService.swift`).

---

## B. Authorization & Row-Level Security (RLS)

- [x] **RLS is enabled on EVERY table**
  ✅ Verified live on DB — ALL 11 tables: `users`, `therapist_profiles`, `therapist_services`, `bookings`, `transactions`, `payment_methods`, `session_credits`, `conversations`, `conversation_participants`, `messages`, `notifications`

- [x] **A logged-in user cannot read another user's data**
  ✅ Verified — All SELECT policies use `auth.uid() = client_id` or `auth.uid() = user_id`. Tested via DB query.

- [x] **A practitioner cannot see another practitioner's earnings**
  ✅ Verified — `transactions` SELECT: `auth.uid() = therapist_id` (only own transactions)

- [x] **A client cannot see another client's bookings**
  ✅ Verified — `bookings` SELECT: `auth.uid() = client_id` for clients

- [ ] **No wildcard INSERT policies**
  ❌ **FAIL — 3 overly permissive INSERT policies found:**
  1. `conversation_participants`: `WITH CHECK (auth.role() = 'authenticated')` — any user can join any conversation
  2. `notifications`: `WITH CHECK (auth.role() = 'authenticated')` — any user can send notifications to anyone
  3. `conversations`: `WITH CHECK (auth.role() = 'authenticated')` — any user can create conversations
  **Action:** Restrict to `auth.uid() = user_id` or drop the permissive policy.

- [x] **RLS policies use `auth.uid()`**
  ✅ Verified — All SELECT/UPDATE/DELETE policies use `auth.uid()`, not client-supplied IDs.

- [x] **service_role key is NEVER used client-side**
  ✅ Verified — `grep` found zero matches for `service_role` in iOS Swift or webapp TypeScript source.

---

## C. API Security

- [x] **All API keys in environment variables only**
  ✅ iOS: `Secrets.xcconfig` → `Info.plist` → `Bundle.main.infoDictionary`. Webapp: `.env.local` + Vercel env vars. Edge functions: Supabase Secrets.

- [x] **No hardcoded secrets in source files**
  ✅ Verified — `grep` for `sk_live_`, `sk_test_`, `service_role`, `whsec_` returned 0 matches in source.

- [x] **`.env` files in `.gitignore`**
  ✅ Verified — `.gitignore` line 34: `.env*`. iOS `.gitignore`: `Secrets.xcconfig`.

- [x] **CORS allows only our domains**
  ✅ Implemented — `_shared/cors.ts` whitelist: `therapistportal.holisticunity.app`, `therapist-webapp-tau.vercel.app`, `holisticunity.com`, `holisticunity.app`. No wildcard in production.

- [ ] **Rate limiting on all public API endpoints**
  ⚠️ Partially — Rate limiting exists (`_shared/rate-limit.ts`) but is **per-instance memory only**, not distributed. 10 Edge Function instances = 10x the limit.
  **Action:** Migrate to Redis-based (Upstash) rate limiting for production scaling.

- [x] **API routes validate authentication**
  ✅ All edge functions check JWT via `supabaseAdmin.auth.getUser(jwt)`. Webapp API routes check via `supabase.auth.getUser()`.

- [ ] **No over-fetching in API responses**
  ⚠️ Minor — `stream-token` returns only `{token, userId}` (good). Some booking queries use `select("*")` instead of specific columns.

---

## D. Input Validation & Injection Prevention

- [x] **Server-side validation**
  ✅ Edge functions validate: payment amount (> 0, < 99999999), booking parameters, refund bounds. iOS validates locally + server re-validates.

- [x] **SQL injection prevented**
  ✅ All queries use Supabase SDK parameterized queries. RPC functions use `$1` parameters. No raw SQL in application code.

- [x] **XSS prevented**
  ✅ No `eval()`, `innerHTML`, or `dangerouslySetInnerHTML` found in webapp source. React auto-escapes by default.

- [ ] **File upload validation**
  ⚠️ Not fully verified — Storage policies restrict by bucket, but no server-side file type/size validation found. Relies on client-side checks + Supabase Storage limits.
  **Action:** Add server-side MIME type validation on upload.

---

## E. Payments (Stripe Connect - Destination Charges)

- [x] **Stripe secret key only server-side**
  ✅ `STRIPE_SECRET_KEY` only in Supabase Edge Function env vars. Never in client code.

- [x] **Stripe publishable key is the only client-side key**
  ✅ iOS: `STRIPE_PUBLISHABLE_KEY` in `Secrets.xcconfig` → `Info.plist`. Webapp: N/A (payments are iOS-only).

- [x] **Webhook verifies signature**
  ✅ `stripe-webhook/index.ts:135-150` — reads `stripe-signature` header, verifies against `STRIPE_WEBHOOK_SECRET`.

- [x] **Webhook is idempotent**
  ✅ UNIQUE constraint `uq_transactions_stripe_payment_intent_id` prevents duplicate transactions. Webhook handles `23505` error gracefully.

- [ ] **Payment amounts calculated server-side (never trust client)**
  ❌ **FAIL** — `create-booking-with-payment/index.ts:163` uses `body.price` from client WITHOUT comparing against the service's actual price in DB. Client could send modified price.
  **Action:** After fetching the service at line 182, compare `body.price` against `service.price` (or `service.pack_price * service.pack_size`). Reject if mismatch.

- [x] **Connected account validated against DB**
  ✅ `create-booking-with-payment/index.ts:207-212` — fetches `stripe_connected_account_id` from `therapist_profiles` table, not from client request.

- [x] **Commission computed server-side**
  ✅ `PLATFORM_FEE_PERCENT = 0.20`, `SERVICE_FEE_PERCENT = 0.029`, IVA rate — all in edge function, not client.

- [x] **No test keys in production**
  ✅ Verified — `grep` for `sk_test_`, `pk_test_` returned 0 matches in `.env.local` and `Secrets.xcconfig`. The Stripe key is `pk_live_*`.

---

## F. Frontend Security

- [x] **No sensitive data in client-side JS**
  ✅ Only `NEXT_PUBLIC_*` vars exposed (Supabase URL, anon key, Stream API key — all designed to be public).

- [x] **Custom error screens**
  ✅ Error states exist in all major pages with user-friendly messages.

- [ ] **CSP headers configured**
  ⚠️ Partially — CSP is set but includes `'unsafe-inline' 'unsafe-eval'` (required by Next.js).
  **File:** `next.config.ts:28`
  **Action for V1.1:** Implement nonce-based CSP.

- [x] **HTTPS enforced**
  ✅ Vercel enforces HTTPS. Supabase enforces HTTPS. No HTTP fallback.

- [x] **X-Frame-Options: DENY**
  ✅ `next.config.ts:13`

- [x] **X-Content-Type-Options: nosniff**
  ✅ `next.config.ts:14`

- [x] **HSTS enabled**
  ✅ `next.config.ts:16` — `max-age=31536000; includeSubDomains`

---

## G. Infrastructure & Deployment

- [x] **HTTPS everywhere**
  ✅ All endpoints (API, frontend, webhooks, WebSocket) use TLS.

- [x] **Deployment supports rollback**
  ✅ Vercel supports instant rollback to any previous deployment.

- [x] **npm audit clean**
  ✅ `npm audit --production`: **0 vulnerabilities**

- [ ] **Logging configured**
  ⚠️ Partially — Edge functions log errors to console. No centralized logging/alerting for payment failures or auth anomalies.
  **Action:** Configure Supabase log drain to monitoring service.

---

## H. WebRTC-Specific

- [x] **TURN/STUN managed by LiveKit**
  ✅ LiveKit Cloud handles TURN/STUN server infrastructure. No direct credentials in app.

- [x] **Video sessions require auth from both parties**
  ✅ `livekit-token/index.ts:81` — checks `booking.client_id !== user.id && booking.therapist_id !== user.id` before issuing token.

- [x] **Participant name sanitized**
  ✅ `livekit-token/index.ts:141` — `substring(0, 100)` length limit.

- [ ] **Screen recording protection**
  ❌ Not implemented — No `UIScreen.main.isCaptured` check on iOS. No screen recording detection in webapp.
  **Action:** Add screen capture detection + warning banner.

---

## SUMMARY

| Category | Pass | Partial | Fail | Total |
|----------|------|---------|------|-------|
| A. Authentication | 4 | 2 | 0 | 6 |
| B. Authorization | 5 | 0 | 1 | 6 (+1 sub-finding) |
| C. API Security | 5 | 2 | 0 | 7 |
| D. Input Validation | 3 | 1 | 0 | 4 |
| E. Payments | 7 | 0 | 1 | 8 (+3 sub-findings) |
| F. Frontend | 5 | 1 | 0 | 6 |
| G. Infrastructure | 3 | 1 | 0 | 4 |
| H. WebRTC | 3 | 0 | 1 | 4 |
| **TOTAL** | **35** | **7** | **3** | **45** |

---

## LAUNCH-BLOCKING ISSUES (must fix before deployment)

1. **B5** — Overly permissive INSERT on `conversation_participants`, `notifications`, `conversations`
2. **E5** — Client-sent price not verified against DB in `create-booking-with-payment`
3. **Missing** — No CHECK constraint on `bookings.price >= 0` and `therapist_services.price > 0`

## IMPORTANT (fix soon after launch)

4. OAuth state not cryptographically random
5. Rate limiting per-instance only
6. iCal feed exposes client names
7. Screen recording not protected
8. CSP `unsafe-inline`/`unsafe-eval`

## NICE-TO-HAVE

9. Certificate pinning on iOS
10. Distributed rate limiting (Redis)
11. Password reset expiry tightened to 30 min
12. File upload MIME type validation
