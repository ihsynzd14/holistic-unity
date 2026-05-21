# 08 — Refund & Cancellation

**Last verified:** 2026-05-04 (added `payout_status='partially_refunded'` for post-escrow 50% case)
**Status:** ✅ Production
**Owner:** Marcello

## Purpose

Cancel a booking and refund the client according to lead time. Five paths can land in this flow (one per actor / surface), but they all converge on the same Stripe refund call, the same `transactions` row update, and the same Brevo template 9 (CANCELLATION_CONFIRMATION).

## Refund tiers (global V1)

| Lead time before `scheduled_at` | Refund | Application fee | Stripe call shape |
|---|---:|---|---|
| ≥ 48h | **100%** | refunded too | `refunds.create({ payment_intent, reverse_transfer: true, refund_application_fee: true })` |
| 24h – 48h | **50%** | platform keeps full fee | `refunds.create({ payment_intent, amount: half, reverse_transfer: true, refund_application_fee: false })` |
| < 24h | **0%** | n/a | no Stripe call; booking just flips to `cancelled` |

**Therapist-initiated cancellations always refund 100%** regardless of lead time (the platform absorbs the cost — see "Therapist cancel" below).

**Reschedule path that times out** (`reschedule_pending` for >24h with no client response) → 100% refund + auto-cancel via `auto-cancel-reschedule` cron. See `13-reschedule.md`.

**Pack credit bookings** (sessions paid for at pack purchase, not at booking) → no Stripe refund; `session_credits.sessions_remaining` is incremented by 1. See `06-booking-pack.md`.

## The five entry points

| Actor | Surface | Route / function | Fee policy |
|---|---|---|---|
| Client | client-webapp | `POST /api/bookings/[id]/cancel` | 3-tier |
| Client | iOS app | Edge Function `request-refund` | 3-tier |
| Therapist | therapist-webapp | `POST /api/bookings/[id]/cancel-by-therapist` | 100% always |
| Admin | admin-dashboard | `POST /api/admin/cancel-booking` (cancel-only, no money) + `POST /api/admin/refund` (refund-only via Edge Function bridge) | manual % chosen by admin |
| System | client-webapp cron | `GET /api/cron/auto-cancel-reschedule` (hourly) | 100% always (`reverse_transfer: true, refund_application_fee: true`) |

All five end in:
1. `bookings.status = 'cancelled'` with `cancelled_by`, `cancelled_at`, `cancellation_notice_hrs`, `cancellation_reason` set
2. `transactions.refund_amount` set; if 100% refund: also `transactions.status='refunded'` AND `payout_status='refunded'`; if partial: only `refund_amount` updated, status stays `completed`
3. Brevo email + in-app `notifications` for both parties

## Client-cancel happy path (client-webapp)

`POST /api/bookings/[id]/cancel`:

1. **Auth** — must be logged in; `booking.client_id === user.id`
2. **Rate limit** — 30 cancel attempts/hour/user (cancel hits Stripe → unbounded retries can rack up costs)
3. **State check** — booking must be in `pending | pending_payment | confirmed | reschedule_pending` (refuse `in_progress | completed | cancelled | no_show`)
4. **Compute refund tier** — server-side from `scheduled_at` and `now()`. Client cannot tamper.
5. **STEP 1 — Atomic optimistic-locked status flip** to `cancelled`:
   ```ts
   .update({ status: "cancelled", cancellation_reason, cancelled_by: "client", cancelled_at, cancellation_notice_hrs })
   .eq("id", bookingId)
   .in("status", CANCELLABLE_STATUSES)
   .select("id").maybeSingle()
   ```
   If `updated === null` → another tab/cron already cancelled it → 409 to user, **no Stripe call**. Prevents double-refund.
6. **STEP 2 — Stripe refund** (only if `refundRatio > 0` AND `stripe_payment_intent_id` present):
   - 100%: `reverse_transfer: true, refund_application_fee: true` → therapist's share is clawed back from connected account, platform's commission is also returned to client
   - 50%: `amount: floor(capturedCents × 0.5), reverse_transfer: true, refund_application_fee: false` → half of session goes back to client, half stays as therapist payout, platform keeps full commission
   - On Stripe failure: distinguish "already refunded" (keep cancelled, treat as success) vs transient error (revert booking to original status, return 502)
7. **STEP 3 — `transactions` update**:
   ```ts
   .update({
     refund_amount: refundAmountCents / 100,
     ...(isFullRefund ? { payout_status: "refunded", status: "refunded" } : {}),
     updated_at: now(),
   })
   .eq("booking_id", bookingId)
   ```
   Note: 50% refunds keep `status='completed'` because therapist is still owed their half. Only 100% refunds flip to `refunded`.
8. **STEP 4 — `notifyBookingCancelled`** — fires Brevo template 9 to both parties + inserts `notifications` row. AWAITED (not fire-and-forget) — serverless function terminates after response, killing un-awaited promises.

## Client-cancel (iOS) — `request-refund` Edge Function

Same logic as web but executed in Deno. Reads `transaction` row, re-computes refund% server-side, calls Stripe, updates DB. Push notification sent via `send-push-notification` Edge Function.

## Therapist-cancel happy path

`POST /api/bookings/[id]/cancel-by-therapist`:

- Same auth/state/notify pattern, but:
- `refundRatio = 1` ALWAYS (no tier check; platform absorbs the cost)
- `cancelled_by = 'therapist'`
- Brevo template signals "cancelled by operator" tone (sympathetic to client)
- Therapist-side UI in `therapist-webapp/src/app/dashboard/bookings/...` warns about no-payout-for-late-cancels (this is the platform paying the client back, not the therapist)

## Admin paths

**Cancel without refund** (`/api/admin/cancel-booking`):
- Direct DB write: `status='cancelled', cancelled_by='admin', cancelled_at, cancellation_notice_hrs`
- `logAdminAction` audit row inserted
- No Stripe call — admin uses this for "stuck" bookings (e.g. ghost `pending_payment` from abandoned checkouts)

**Refund-only** (`/api/admin/refund`):
- Bridges to Edge Function `request-refund` (sends `transaction_id: transaction.booking_id` in body — note the field name oddity, it's the booking ID)
- Admin chooses percentage manually
- `logAdminAction` audit row inserted

These are split (cancel + refund are separate routes) so admin can refund without cancelling (e.g. comp a session) or cancel without refunding (e.g. clean ghost rows).

## Cron path — `auto-cancel-reschedule`

`GET /api/cron/auto-cancel-reschedule` (hourly, Vercel cron, `CRON_SECRET` auth):

1. Find bookings `status='reschedule_pending' AND reschedule_proposed_at < now() - 24h`
2. For each, **refund FIRST** (so money isn't stuck if status flip succeeds but refund doesn't): full refund with `reverse_transfer + refund_application_fee`
3. Then optimistic-locked update to `cancelled` with `cancelled_by='system'`, `cancellation_category='conflitto_agenda'`
4. Update `transactions` row
5. Limit batch to 50/run to stay under Vercel's 10s serverless timeout

Idempotent on retry: optimistic lock + Stripe's "already refunded" recognition + `Math.max(0, noticeHrs)` clamp for past-due bookings.

## Invariants

- A booking can only be cancelled once (optimistic lock on `bookings.status IN CANCELLABLE_STATUSES`)
- A transaction's `refund_amount ≤ amount` (Stripe enforces server-side; we don't bypass)
- `payout_status='refunded'` is set ONLY for full refunds; partial refunds keep `payout_status='pending'` for the un-refunded half
- 100% refund within Stripe's 14-day delay_days window: pulled from pending Connect funds, no claw-back from therapist's bank
- 100% refund AFTER 14d window has elapsed: Stripe initiates a `reverse_transfer` from the connected account's available balance — can fail if therapist already withdrew (rare; admin handles manually)
- Credit-restore is idempotent: second cancel of a credit booking no-ops because `bookings.status='cancelled'` blocks the re-flip
- `notifications` rows are not deduped by content, so the cancel route MUST be guarded by the optimistic lock at step 5 — without it, two concurrent cancels = two pairs of notifications

## State transitions

```
bookings.status:
  pending          → cancelled
  pending_payment  → cancelled
  confirmed        → cancelled
  reschedule_pending → cancelled (auto-cancel-reschedule cron OR client/therapist explicit)

transactions (post 2026-05-04):
  status='completed', payout_status='pending'  →  status='refunded',           payout_status='refunded'           (100% refund)
  status='completed', payout_status='paid'     →  status='refunded',           payout_status='refunded'           (100% refund AFTER escrow — reverse_transfer)
  status='completed', payout_status='pending'  →  status='partially_refunded', payout_status='pending'            (50% refund pre-escrow — cron will eventually pay the un-refunded half)
  status='completed', payout_status='paid'     →  status='partially_refunded', payout_status='partially_refunded' (50% refund AFTER escrow — DB now matches Stripe clawback)
```

**`payout_status='partially_refunded'`** was added 2026-05-04 to handle the post-escrow 50% refund case. Earlier the cron would flip `payout_status` to `'paid'` at day 14, then a partial refund at day 16 would update `status` to `'partially_refunded'` but leave `payout_status='paid'` — DB out of sync with Stripe (which had clawed back 50% from the connected account).

**The same value is now also set by the cron** for pre-escrow partial refunds: a 50% refund at day 5 sets `transactions.status='partially_refunded'` with `payout_status='pending'`; on day 14+ when escrow elapses, `process-pending-payouts` flips `payout_status: 'pending' → 'partially_refunded'` (NOT `'paid'`). Without this branch the row would have stayed `pending` forever because the cron's pre-2026-05-04 filter only matched `status='completed'`. The earnings dashboard must distinguish `partially_refunded` from full `'paid'` for both timing scenarios.

## Error paths

| Error | Where | Behavior |
|---|---|---|
| Booking not found / not yours | Lookup | 404 (same shape — don't leak existence) |
| Already cancelled (race) | Optimistic lock at step 5 | 409 "stato cambiato, ricarica" |
| Stripe transient error (network, 5xx) | Step 6 catch | Revert booking to original status, return 502, user retries |
| `charge_already_refunded` | Step 6 catch | Keep cancelled, treat as success |
| `STRIPE_SECRET_KEY` not set | Step 6 pre-check | Revert booking, return 500 |
| Insufficient Connect balance for reverse_transfer | Step 6 catch | Revert booking, 502; admin must handle manually |
| Brevo / notifications failure | Step 8 (Promise.allSettled inside helper) | Logged, response still 200 — non-blocking |
| `< 24h` cancel | Step 4 → step 6 skipped | Booking flips to `cancelled`, NO Stripe call, `refund_amount = 0`, response `refundTier: "0%"` |

## Test checklist

- [ ] Confirmed booking 50h away → cancel → 100% refund + booking cancelled, `application_fee` returned to client
- [ ] Confirmed booking 36h away → cancel → 50% refund (half of total_charged), booking cancelled, therapist keeps half
- [ ] Confirmed booking 12h away → cancel → 0% refund, booking cancelled, NO Stripe call
- [ ] Credit booking 3h away → cancel → `sessions_remaining +1`, booking cancelled, NO Stripe call
- [ ] Therapist cancels 12h away → client gets 100% refund (therapist-initiated path overrides tier)
- [ ] Spam-cancel same booking from two tabs → exactly one Stripe refund (optimistic lock catches second)
- [ ] Stripe network blip mid-cancel → booking reverts to original status, user gets 502, can retry
- [ ] `reschedule_pending` for >24h → cron refunds 100% + flips to cancelled with `cancelled_by='system'`
- [ ] Refund within 14 days → pulled from Connect pending; check Stripe dashboard
- [ ] Refund after 14 days → uses `reverse_transfer` from available balance
- [ ] Brevo template 9 fires for both client and therapist (subject reflects tier %)

## Related

- `05-booking-single.md`, `06-booking-pack.md` (creation)
- `07-payment.md` (fee math + webhook v2 race protection)
- `13-reschedule.md` (auto-cancel-reschedule cron — sibling flow)
- `19-admin-refund.md` (admin-only manual-percentage refund detail)
- `15-notifications-emails.md` (Brevo template 9)
- `12-reviews.md` (only non-cancelled bookings can be reviewed)
- `client-webapp/src/app/api/bookings/[id]/cancel/route.ts` (canonical 3-tier code)

## Known gaps

- **Per-therapist cancellation policies still not exposed.** `therapist_profiles.cancellation_policy` column exists but is read-only / display-only. Code uses fixed `48 / 24` constants. V1.1 candidate.
- **Partial-refund UI not exposed to admin.** Stripe API supports any % between 0–100; the admin route accepts a `percentage` argument but the dashboard UI only shows preset buttons (0%, 50%, 100%). For arbitrary refunds, admin currently has to call the API directly.
- **No-show policy.** If client doesn't join the video call within the join window, the booking auto-completes and therapist gets paid in full. UX to mark no-show + selectively refund is V1.1.
- **Therapist cancel doesn't capture a "reason" cost-attribution.** When a therapist cancels < 48h, the platform absorbs the refund. We log `cancellation_reason` free-text but no structured category that would let us bill it back / surface a "you cancelled X late this month" warning to the therapist.
- **Pack mid-pack cancel claw-back.** A client who paid for a 4-pack and used 1 session can request to cancel the remaining 3. We currently treat each future booking as a credit-restore (no Stripe call). If the client wants the unused portion refunded as cash, admin must manually refund — no UI exists. See `06-booking-pack.md`.
- **Already-paid (escrow elapsed) refund failure.** If `payout_status='paid'` and the connected account doesn't have enough balance to cover the reverse_transfer, Stripe throws and the booking is reverted to `confirmed`. Admin must manually wire the refund or hold the therapist's next payout. We don't pre-check the connected balance — V1.1 should warn admin in the dashboard.
