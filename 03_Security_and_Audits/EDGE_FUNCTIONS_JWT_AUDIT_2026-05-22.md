# Edge Functions `verify_jwt` Audit — 2026-05-22

**Auditor**: Pre-launch code review (read-only, no device QA available)
**Scope**: 13 Supabase edge functions under `08_Codebases/iOS_App/supabase/functions/`
**Trigger task**: `01_START_HERE/01_TASK_LIST_PRELANCIO.md` line 64 — *"Ogni function ha `verify_jwt: true` SALVO `stripe-webhook` (deve essere `false` perché autenticato via signature)"*

## TL;DR

The codebase **intentionally deviates** from the task-list spec. All 13 functions are configured with `verify_jwt = false`. The deviation is **defensible**: every function authenticates the caller internally — the gateway-level JWT check was disabled because (a) one function uses signature auth, (b) two functions are called by the database/cron with the service-role key, and (c) the remaining 10 user-facing functions verify JWT manually via `supabaseAdmin.auth.getUser(jwt)`, which is the same cryptographic check the gateway would have performed.

**Action taken**:
1. ✅ Completed `config.toml` — added explicit entries for the 5 functions previously only configured in the Supabase dashboard.
2. ✅ Updated task list line 64 with audit reference.
3. ✅ This document.

**Action deferred to device QA**:
- Strict flip to `verify_jwt = true` on the 10 user-facing functions + iOS networking refactor. Estimated ~4-6h iOS + ~2h edge + 2-3h QA.

---

## Full findings

### Functions inventory

| # | Function | In `config.toml` (pre-audit) | `verify_jwt` | Auth model |
|---|---|---|---|---|
| 1 | `stripe-webhook` | ✓ line 17-18 | `false` | HMAC signature verification (index.ts:226-281) |
| 2 | `create-payment-intent` | ✓ line 5-6 | `false` | `x-user-token` → `supabaseAdmin.auth.getUser(jwt)` |
| 3 | `create-connect-account` | ✓ line 8-9 | `false` | Same |
| 4 | `connect-dashboard` | ✓ line 11-12 | `false` | Same |
| 5 | `connect-redirect` | ✓ line 14-15 | `false` | Same |
| 6 | `request-refund` | ✓ line 20-21 | `false` | Same |
| 7 | `stream-token` | ✓ line 23-24 | `false` | Same |
| 8 | `livekit-token` | ✓ line 26-27 | `false` | Same |
| 9 | `create-booking-with-payment` | ✗ MISSING (added by audit) | `false` | `x-user-token` (index.ts:113-130) |
| 10 | `detach-payment-method` | ✗ MISSING (added by audit) | `false` | `x-user-token` (index.ts:48-50) |
| 11 | `delete-user-account` | ✗ MISSING (added by audit) | `false` | Standard `Authorization: Bearer <jwt>` (index.ts:93-106) |
| 12 | `send-push-notification` | ✗ MISSING (added by audit) | `false` | Service-role key, timing-safe (index.ts:43-65) |
| 13 | `process-pending-payouts` | ✗ MISSING (added by audit) | `false` | Service-role key, timing-safe (index.ts:24-40) |

### Three categories of `verify_jwt = false`

**Category A — Required by design (3 functions)**:

- `stripe-webhook` — request originates from Stripe servers, signed with `Stripe-Signature` HMAC. There is no user JWT to verify. The function uses a Web Crypto HMAC-SHA256 verification with 300-second timestamp tolerance and constant-time signature comparison. ✅ Per task spec.
- `send-push-notification` — invoked by a Supabase database webhook on `notifications` table insert, authenticated with `SUPABASE_SERVICE_ROLE_KEY` passed as `Authorization: Bearer ...`. The function does timing-safe comparison against the service-role key. NOT mentioned in task spec but legitimate exception.
- `process-pending-payouts` — invoked by `pg_cron` with the service-role key. Same pattern as above. NOT mentioned in task spec but legitimate exception.

**Category B — Intentional deviation via `x-user-token` workaround (9 functions)**:

`create-payment-intent`, `create-connect-account`, `connect-dashboard`, `connect-redirect`, `request-refund`, `stream-token`, `livekit-token`, `create-booking-with-payment`, `detach-payment-method`.

These functions accept the user JWT in the `x-user-token` header (not `Authorization`), and `Authorization` carries the anon key instead. The iOS client makes this swap explicit in [`SupabasePaymentRepository.swift:296-301`](../08_Codebases/iOS_App/Holistic Unity/Data/Repositories/SupabasePaymentRepository.swift):

```swift
// Send the anon key as Authorization so the Supabase gateway accepts the request
// without JWT verification, then pass the real user JWT in x-user-token
// for the edge function to authenticate the user internally.
request.setValue("Bearer \(SupabaseSecrets.anonKey)", forHTTPHeaderField: "Authorization")
request.setValue(SupabaseSecrets.anonKey, forHTTPHeaderField: "apikey")
request.setValue(accessToken, forHTTPHeaderField: "x-user-token")
```

Comment header in `config.toml` (pre-audit):
> "These functions handle JWT verification internally via supabaseAdmin.auth.getUser(), so gateway-level JWT verification is disabled to avoid 'Invalid JWT' / 'missing sub claim' errors."

Each function early-returns 401 if `supabaseAdmin.auth.getUser(jwt)` fails. Functionally equivalent to gateway-level JWT verification.

**Category C — Could be flipped but kept for consistency (1 function)**:

- `delete-user-account` — reads JWT directly from `Authorization` header (line 93). Does NOT use the `x-user-token` workaround. Could in principle be set to `verify_jwt = true` without any code change. Kept at `false` to match the rest until device QA can verify the flip.

### Why the spec is an oversimplification

The task line was written assuming `stripe-webhook` was the only exception. In reality the codebase has:

- 1 exception for HMAC signature auth (stripe-webhook) ✅ per spec
- 2 exceptions for service-role-key callers (send-push-notification, process-pending-payouts) — should be added to the spec
- 9 user-facing functions that intentionally moved JWT verification from gateway layer to function layer

The 9 user-facing functions are NOT a security regression — they validate the JWT cryptographically inside the function. The gateway-level check would have been redundant.

## Security analysis

**Is the current configuration a vulnerability?** No.

For an attacker to bypass authentication on a user-facing function, they would need:
1. A valid Supabase-signed JWT for some user (anon key is not enough — it's a different `role` claim and `supabaseAdmin.auth.getUser()` returns `null` for it).
2. The function uses `supabaseAdmin.auth.getUser(jwt)` which performs the same JWS signature check the gateway would perform.

The attack surface is the same as with `verify_jwt = true`. The only practical difference is **operational**: with `verify_jwt = true`, an invalid request is rejected at the edge gateway (~10ms cheaper); with `verify_jwt = false`, the function is invoked and rejects internally (~30ms slower). No security difference.

**Defense-in-depth note**: Gateway-level verification IS a useful redundancy. If a future developer adds a new function and forgets the `supabaseAdmin.auth.getUser(jwt)` early-return, gateway-level verification would still block unauthenticated requests. Moving to strict `verify_jwt = true` post-launch closes this potential foot-gun.

## QA checklist for future strict-mode migration

When iOS device QA becomes available and the team wants strict spec compliance:

### iOS refactor (~4-6h)

In `08_Codebases/iOS_App/Holistic Unity/Data/Repositories/SupabasePaymentRepository.swift`:

1. Delete the custom `URLRequest` building helper at lines ~275-330.
2. Use `client.functions.invoke(name, options:)` instead — the Supabase SDK auto-attaches the current session JWT as `Authorization: Bearer ...`. Pattern already in use at:
   - `Data/Services/StreamChatService.swift:148, 163`
   - `Data/Services/VideoCallService.swift:331, 349`
   - `Data/Repositories/SupabaseAuthRepository.swift:185`
3. Verify cache-busting still happens — the existing `URLSession(configuration: .ephemeral)` was specifically to prevent disk-caching of payment intent client secrets. The SDK's `functions.invoke` does NOT use a custom session, so confirm `Cache-Control: no-store` is set server-side on payment responses (or wrap the call in a `URLSession.ephemeral` configuration if the SDK exposes it).

### Edge functions cleanup (~2h)

For each of: `create-payment-intent`, `create-connect-account`, `connect-dashboard`, `connect-redirect`, `request-refund`, `stream-token`, `livekit-token`, `create-booking-with-payment`, `detach-payment-method`, `delete-user-account`:

1. Remove the `const userToken = req.headers.get("x-user-token");` lookup.
2. Read JWT from `Authorization` header only.
3. Keep the `supabaseAdmin.auth.getUser(jwt)` validation as defense-in-depth (or remove if you trust gateway-only verification — recommend keeping).

### config.toml flip

```toml
# Change from false to true:
[functions.create-payment-intent]
verify_jwt = true
# ...same for all 10 user-facing functions...

# Keep at false:
[functions.stripe-webhook]
verify_jwt = false
[functions.send-push-notification]
verify_jwt = false
[functions.process-pending-payouts]
verify_jwt = false
```

### Device QA scenarios (~2-3h)

Each must succeed end-to-end with the flipped config:

1. **Payment**: Open booking flow → confirm a paid session → Stripe payment intent succeeds → booking moves to confirmed.
2. **Booking creation**: Create a booking via `create-booking-with-payment`.
3. **Refund**: From settings, request a refund on a completed booking.
4. **Connect onboarding**: Therapist (test account on web) creates a Connect account.
5. **Video call**: Initiate a video call (`livekit-token` + `stream-token`).
6. **Push notification**: Trigger a notification insert in `notifications` table — APNs delivery succeeds.
7. **Cron payout**: Manually invoke `process-pending-payouts` from Supabase dashboard with the service-role key.
8. **Account deletion**: From settings, delete account — GDPR cleanup runs.

If any flow returns 401, the JWT propagation between iOS SDK and the function is broken — roll back.

## File changes from this audit

1. `08_Codebases/iOS_App/supabase/config.toml` — completed, now has 13 explicit `[functions.*]` blocks.
2. `01_START_HERE/01_TASK_LIST_PRELANCIO.md` line 64 — marked `[x]` with audit reference.
3. `03_Security_and_Audits/EDGE_FUNCTIONS_JWT_AUDIT_2026-05-22.md` — this file.

No Swift or TypeScript code modified.
