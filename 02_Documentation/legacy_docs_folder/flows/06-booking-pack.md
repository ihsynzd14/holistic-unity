# 06 — Booking Pack + Session Credits

**Last verified:** 2026-04-16 by Marcello (V1 scope clarified 2026-05-04)
**Status:** ✅ Production (iOS only in V1)
**Owner:** Marcello

> **⚠️ V1 scope:** pack purchase + `session_credits` consumption is **iOS-only**. The `client-webapp` checkout flow (`/api/checkout/create`) accepts only `{therapistId, serviceId, slotIso}` and the therapist profile page renders only single-session services — there is no web path for `pack_size`, `pack_price`, or `create_booking_with_credit`. iOS users get the full pack experience; web users see single sessions only and must use the iOS app for packs. Web pack support is V1.1 (will require: pack selection UI on profile page, `pack_size` + `pack_price` in `/api/checkout/create`, separate `/api/checkout/use-credit` route for follow-up sessions).

## Purpose

Client buys a discounted pack of sessions (e.g. 4×€68 vs 1×€80). First booking pays the full pack total; subsequent bookings consume a "credit" and have `price = 0`. Cancellations restore credits.

## Preconditions

- Service has `pack_size` ≠ null and `pack_price` ≠ null (set by therapist in `/dashboard/services`)
- Client has Stripe payment method or will enter one

## Happy path

### Purchase pack (first booking)

1. Client selects service with pack option → `BookingFlowView.swift:224` `checkForExistingCredits()` offers 3 options: `.single` / `.pack` / `.useCredit` (if has credits)
2. User picks `.pack` → `effectiveBasePrice = service.packPrice * packSize` → e.g. €68 × 4 = €272
3. `createBookingWithPayment()` at `BookingFlowView.swift:336` sends `price = €272` and `pack_sessions = packSize`
4. Edge function `create-booking-with-payment/index.ts` at line ~199:
   - Validates pack price matches `service.packPrice * pack_size`
   - Creates booking with `pack_sessions_remaining = packSize`
   - Creates PaymentIntent for full pack total
5. On webhook `payment_intent.succeeded`, `stripe-webhook/index.ts:286-309` creates `session_credits` row with `sessions_remaining = packSize - 1` (the first session is this booking)
6. Booking confirmed, client sees "Pack of 4 — 3 sessions remaining"

### Use credit (subsequent bookings)

1. Client selects the SAME service → `checkForExistingCredits()` fetches `session_credits` for this client+service combo
2. UI shows "Use Session Credit (N of M remaining)" as an option
3. User picks `.useCredit` → `effectiveBasePrice = 0`
4. `BookingFlowView.swift:300-317` calls atomic RPC `create_booking_with_credit` (added by migration `20260414100200_atomic_credit_booking`)
5. RPC in a single transaction:
   - Decrements `session_credits.sessions_remaining` (rejects if ≤ 0)
   - Inserts new booking with `price = 0` + `credit_id` link
6. No PaymentIntent created; booking is immediately confirmed

### Restore credit on cancellation

1. User cancels an `.useCredit` booking in `ManageBookingView.swift:527-570`
2. `SupabaseSessionCreditRepository.restoreCredit(creditId:)` increments `sessions_remaining`
3. Booking status → `cancelled`

## Invariants

- `session_credits.sessions_remaining >= 0` (RPC enforces, raises exception on violation)
- Pack purchase creates EXACTLY one `session_credits` row per payment (webhook has idempotency via UNIQUE constraint on `transactions.stripe_payment_intent_id`)
- Credit bookings have `price = 0` and `therapist_payout = 0` (the payout was front-loaded on the pack purchase)
- `session_credits.service_id` + `client_id` + `therapist_id` define which credits can be used for which service
- No expiry in V1 (`expiresAt: Date?` exists in model but unused)

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Pack sold out (race with self) | RPC decrements below 0 | Exception; iOS refetches credits + surfaces error |
| Pack cancelled before first session | V1 NOT supported | User would see 3 unused credits; manual refund via admin |
| Credit used on wrong service | Shouldn't happen if UI enforces | DB has no constraint linking credit→service — risk if client code bypassed |
| Webhook processes pack twice | UNIQUE constraint on `stripe_payment_intent_id` | Second insert silently skipped (`ON CONFLICT DO NOTHING`) |

## Test checklist

- [ ] Buy pack of 4 (€68/session × 4 = €272) → Stripe charges €272 + fees, `session_credits.sessions_remaining = 3` after booking 1
- [ ] Book second session with credit → `sessions_remaining = 2`, no Stripe charge
- [ ] Cancel second booking → `sessions_remaining = 3` again
- [ ] Try to book 5th session after using all 4 → no credit option, only `.single` and `.pack` shown
- [ ] Book single + pack combined on different services of same therapist → separate `session_credits` rows
- [ ] Admin manually sets `sessions_remaining = 0` → no credit option in UI

## Related

- `05-booking-single.md` (non-pack flow)
- `07-payment.md` (payout math for packs)
- `08-refund-cancellation.md` (credit restore logic)

## Known gaps

- **GAP from session:** `therapist_payout` is all on first booking of pack (N-1 subsequent bookings show €0). Fine for V1 but documented as asymmetric reporting. V1.1 could split proportionally.
- Credits never expire (add `expiresAt` field + filter in V1.1)
- No way to transfer credits between services or therapists
- If therapist raises prices after pack purchase, client still uses credits at old price (correct business behavior, but not documented to client)
