# 08 — Refund & Cancellation

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Production
**Owner:** Marcello

## Purpose

Either party (client or therapist) can cancel a confirmed booking. Refund policy (global V1, three-tier):
- **≥ 48h** before session start → **100%** refund
- **24h – 48h** before → **50%** refund
- **< 24h** before → **0%** (therapist keeps payout for reserved time)

Therapist-initiated cancellations always refund 100% regardless of timing (platform protects clients).

Pack credit bookings restore the credit on cancellation (see `06-booking-pack.md`).

## Preconditions

- Booking exists and `status = confirmed` (or `reschedule_pending`)
- Transaction linked to booking (for paid bookings)
- User making cancellation is either the client or therapist of the booking

## Happy path

### Client cancels a paid single booking

1. User taps "Cancel" in `Features/Booking/ManageBookingView.swift`
2. Compute `hoursUntilSession` and `refundPercentage` via `CancellationPolicy.refundPercentage(hoursUntilSession:)` at `Domain/Models/Therapist.swift` (3-tier: ≥48h → 1.0, ≥24h → 0.5, else 0.0)
3. iOS calls edge function `request-refund` at `supabase/functions/request-refund/index.ts`
4. Edge function:
   - Validates `transaction.status = "completed"`
   - Re-computes refund percentage server-side (cannot be tampered by client)
   - If `refundPercentage = 0` → rejects with 400 "no refund available"
   - Otherwise creates Stripe refund at `amount × refundPercentage` (includes proportional reverse of `application_fee`)
   - Updates `transaction.status = "refunded"` (100%) or `"partially_refunded"` (50%) + `booking.status = "cancelled"`
5. Push notification to therapist

### Client cancels a credit booking

1. `ManageBookingView.swift:527-570` calls `SupabaseSessionCreditRepository.restoreCredit(creditId:)`
2. `session_credits.sessions_remaining` incremented by 1
3. Booking marked `cancelled`. No Stripe refund (no money was charged for this booking).

### Therapist cancels

- Always full refund regardless of time (platform eats the cost if < 48h, to protect clients)
- TODO: explicit UX in therapist webapp to surface this cost

### Reschedule instead of cancel

- Status transitions `confirmed → reschedule_pending`
- Video call rejoin still allowed during rescheduling window
- If reschedule not confirmed within 48h, auto-cancels

## Invariants

- `refund_amount <= transaction.amount` (enforced in edge function + Stripe API)
- A booking can only be refunded once (`transaction.status` transitions to `refunded` and stays)
- Credit restore only happens ONCE per cancellation (idempotent via booking status check)
- Therapist payout is clawed back from pending funds (within 14-day delay_days window)
- After `delay_days` expires, refund may fail if therapist already withdrew funds — admin handles manually (rare)

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Transaction not found | Step 3 | 404 → iOS shows error |
| Already refunded | Step 4 status check | 400 "already refunded", no-op |
| Stripe refund fails (insufficient Connect balance) | Step 4 | 500 → booking kept `confirmed`, admin alerted via Sentry |
| Credit restore race (user spams cancel) | RPC is idempotent | Second call no-ops |
| Cancel < 48h with `refund = 0` | Step 3 | Booking `cancelled`, transaction stays `completed` (no Stripe action) |

## Test checklist

- [ ] Confirmed booking 50h away → cancel → **100%** refund + booking cancelled
- [ ] Confirmed booking 36h away → cancel → **50%** refund, booking cancelled
- [ ] Confirmed booking 12h away → cancel → **0%** refund (edge function rejects, booking can still be cancelled but no Stripe action)
- [ ] Credit booking 3h away → cancel → credit restored (`sessions_remaining +1`, no Stripe refund)
- [ ] Therapist cancels 12h away → client gets 100% refund (therapist-initiated path)
- [ ] Try to cancel already-cancelled booking → no-op, no duplicate refund
- [ ] Refund within 14 days of booking → pulled from pending payout
- [ ] Check Stripe dashboard: `application_fee` is reduced proportionally (50% for partial refunds)

## Related

- `05-booking-single.md` (upstream payment)
- `06-booking-pack.md` (credit restore logic)
- `07-payment.md` (fee math for refund calculation)
- `12-reviews.md` (review eligibility depends on non-cancelled booking)

## Known gaps

- Per-therapist cancellation policy (V1 is global 48h/100%) — `therapist_profiles.cancellation_policy` column exists but is read-only
- No partial refund UI (Stripe API supports it; not exposed)
- No-show policy: client doesn't join → currently treated as completed session (therapist gets paid). UX to mark no-show is V1.1
- Therapist cancellations should ideally add a "reason" field for audit (not required V1)
