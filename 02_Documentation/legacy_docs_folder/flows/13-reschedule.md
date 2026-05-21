# 13 — Reschedule

**Last verified:** 2026-05-04 (V1 scope clarified for client-propose path)
**Status:** ✅ Production
**Criticality:** 🟡 Important

> **⚠️ V1 scope on the client-webapp:** the `client-webapp` only exposes the **respond** path (accept/reject a therapist-proposed reschedule) at `/api/bookings/[id]/reschedule/respond`. There is **no client-propose UI** in the web app — the bookings page only offers cancel + respond. Clients who want to propose a new time must use the iOS app, which calls the `reschedule-request` route that lives historically under `therapist-webapp/src/app/api/bookings/[id]/reschedule-request/`. This route's auth check is `booking.client_id !== user.id` — semantically it's a client route despite its file location, and iOS hardcodes the therapist-portal URL for this single call. Web-side client-propose UI is V1.1.
**Owner:** Marcello

## Purpose

Two-step reschedule between client and therapist for a `confirmed` booking. Either party can propose a new time; the other party must approve. The state machine routes to four endpoints depending on who proposed and how the other party responded:

```
                    confirmed
                        │
   therapist proposes ──┴── client proposes
       │                          │
       ▼                          ▼
  reschedule_pending         reschedule_pending
  (proposed_by=therapist)    (proposed_by=client)
       │                          │
       ├── client accept           ├── therapist approve
       │     → confirmed           │     → confirmed
       │                          │
       ├── client reject           ├── therapist decline
       │     → cancelled +         │     → confirmed (revert)
       │       100% refund         │       (no refund)
       │                          │
       └── 24h timeout             └── 24h timeout
             → cancelled +              → confirmed (revert)
               100% refund                (no refund)
```

The asymmetry on timeout matters: when the **therapist** proposes and the client doesn't respond, the booking auto-cancels with full refund (the therapist initiated the change, so the client can't be blamed for inaction). When the **client** proposes and the therapist doesn't respond, the booking reverts to confirmed at the original time (otherwise a client could game free cancellations by proposing impossible times).

## Preconditions

- Booking `status = 'confirmed'` (cannot reschedule pending_payment, completed, cancelled).
- `reschedule_count < 3` (anti-abuse cap; counts both successful and declined attempts).
- Caller is either the therapist or the client of the booking.
- Proposed time:
  - Therapist proposing: ≥ 1h in the future.
  - Client proposing: ≥ 24h in the future (aligned with cancellation policy threshold to prevent dodging the 50% fee).

## Sequence

### Path A — Therapist proposes (most common)

1. Therapist clicks "Riprogramma" in `/dashboard/bookings` and picks a new datetime.
2. POST `/api/bookings/[id]/reschedule` (`therapist-webapp/src/app/api/bookings/[id]/reschedule/route.ts:31`).
3. Route checks (`route.ts:36-117`):
   - Auth, rate limit `therapist-reschedule` 20/h.
   - `proposed_scheduled_at` ≥ 1h from now.
   - Therapist owns the booking; status = `confirmed`.
   - `reschedule_count < 3`.
   - Reliability gate: rejects if `get_therapist_reliability` returns tier `high` or `critical`.
4. Atomic UPDATE `confirmed → reschedule_pending` with `proposed_scheduled_at`, `reschedule_proposed_by='therapist'`, `reschedule_proposed_at=now()`.
5. `notifyClientOfRescheduleProposed` (`route.ts:168`):
   - Inserts `notifications` row (`type='reschedule_pending'`).
   - Calls `send-brevo-email` Edge Function with template **26** (RESCHEDULE_PROPOSED). Awaited inside `Promise.allSettled` — never blocks the response, but cannot be killed by serverless terminate.

### Path B — Client responds to therapist proposal

POST `/api/bookings/[id]/reschedule/respond` with `{ action: 'accept' | 'reject' }` (`client-webapp/src/app/api/bookings/[id]/reschedule/respond/route.ts:28`).

**Accept:**
1. Atomic UPDATE `reschedule_pending → confirmed`, `scheduled_at = proposed_scheduled_at`, `reschedule_count++`, clear proposal columns (`route.ts:84-97`).
2. `notifyTherapistOfRescheduleResponse(action='accepted')` → `notifications` + Brevo template 27.

**Reject (full refund cancellation):**
1. Race-safe pattern: UPDATE FIRST `reschedule_pending → cancelled` with `cancellation_category='conflitto_agenda'`, `cancelled_by='client'` (`route.ts:130`). Two concurrent rejects can't both call Stripe.
2. Stripe `refunds.create({ payment_intent, reverse_transfer: true, refund_application_fee: true })` (`route.ts:193`).
3. On Stripe failure (non-`already-refunded`) → `revertReschedulePending()` restores the row to `reschedule_pending` so the client can retry.
4. UPDATE `transactions.refund_amount`, `payout_status='refunded'`, `status='refunded'`.
5. `notifyTherapistOfRescheduleResponse(action='rejected', refundAmount)` → notifications + Brevo 27.

### Path C — Client proposes

POST `/api/bookings/[id]/reschedule-request` (`therapist-webapp/src/app/api/bookings/[id]/reschedule-request/route.ts:32` — but called by the client-webapp via this URL since it's RLS-checked; the therapist-webapp file is the canonical implementation that both surfaces use? No — this is a therapist-webapp file, so the client-webapp calls a different route. Actually the path `/api/bookings/[id]/reschedule-request` lives in the therapist-webapp because the file declares `client_id` ownership check; clients going through the client-webapp hit `/api/bookings/[id]/reschedule-request` on the same domain. **Verified:** the route is in `therapist-webapp/src/app/api/bookings/[id]/reschedule-request/route.ts` but the auth check at line 89 is `booking.client_id !== user.id`, meaning the route is intended for the **client** — file location is historical.)

1. Auth, rate limit `client-reschedule-request` 10/h.
2. `proposed_scheduled_at` ≥ 24h from now (closes the cancellation-policy loophole).
3. Booking client_id = user.id; status = `confirmed`; `reschedule_count < 3`.
4. Atomic UPDATE → `reschedule_pending` with `reschedule_proposed_by='client'`.

### Path D — Therapist approves a client proposal

POST `/api/bookings/[id]/approve-reschedule` (`therapist-webapp/src/app/api/bookings/[id]/approve-reschedule/route.ts:26`).

1. Auth (therapist owns booking), rate limit `therapist-approve-reschedule` 30/h.
2. State must be `reschedule_pending` AND `reschedule_proposed_by='client'` (route at line 68 explicitly rejects therapist-self-approving their own proposal — that would burn `reschedule_count` without client consent).
3. `reschedule_count < 3`; `proposed_scheduled_at >= 1h` from now.
4. Atomic UPDATE `reschedule_pending → confirmed`, `scheduled_at = proposed_scheduled_at`, `reschedule_count++`.
5. The `bookings_overlap_guard` DB trigger (migration `20260414_booking_overlap_guard.sql`) is the **single source of truth** for slot conflict — if `proposed_scheduled_at` overlaps another active booking for the same therapist, the UPDATE fails and the route returns 409 "in conflitto con un'altra sessione".
6. `notifyClientOfRescheduleApproved` → notifications + Brevo template 27.

### Path E — Therapist declines a client proposal

POST `/api/bookings/[id]/decline-reschedule` (`therapist-webapp/src/app/api/bookings/[id]/decline-reschedule/route.ts:22`).

1. Auth, rate limit `therapist-decline-reschedule` 30/h.
2. State must be `reschedule_pending` (any proposer — but clients can't reach this endpoint).
3. Atomic UPDATE → `confirmed`, restore original `scheduled_at`, clear proposal columns, `reschedule_count++` (decline still counts).
4. `notifyClientOfRescheduleDeclined` → notifications + Brevo template 27 (`action='rifiutata'`).

### Path F — Auto-cancel on timeout

Two cron jobs handle expiry:

1. **Vercel hourly cron `/api/cron/auto-cancel-reschedule`** (client-webapp, `15 * * * *`). For any `reschedule_pending` booking older than 24h since `reschedule_proposed_at` AND `reschedule_proposed_by='therapist'` (or legacy NULL): full Stripe refund + status='cancelled' with `cancelled_by='system'` and `cancellation_category='conflitto_agenda'`. Idempotent via optimistic locking.
2. **pg_cron `cleanup_stale_reschedule_pending`** (`supabase/migrations/20260427120000_reschedule_pending_lifecycle.sql`, every 30 min). Two branches:
   - Client-proposed AND > 24h old → revert to `confirmed` (no refund).
   - Any reschedule_pending whose ORIGINAL `scheduled_at` is > 1h in the past → cancel with `auto_cleanup` reason (handles legacy + therapist-proposed that the auto-cancel-reschedule cron missed).

## Critical assertions

- **`reschedule_count < 3` cap applies to ALL outcomes** (success, decline, client revert via timeout). Without this a malicious client could submit unlimited proposals knowing the therapist would decline — abuse vector closed by incrementing on decline (see "Recent fixes" below).
- **Race-safe optimistic locking on every state transition.** All UPDATEs include `.eq("status", "reschedule_pending")` (or whatever expected from-state) in the WHERE clause and check `.maybeSingle()` returned a row. Concurrent webhooks/clicks cannot double-process.
- **Therapist cannot self-approve their own proposal.** `approve-reschedule` checks `reschedule_proposed_by === 'client'` (`route.ts:68`); the therapist must wait for the client's `respond` route.
- **Client 24h floor on proposed time** prevents using reschedule to dodge the 24h-50%-fee tier in the cancellation policy.
- **Refund-on-reject uses `reverse_transfer: true` + `refund_application_fee: true`** so the platform's commission is also reversed (consistent with cancellation policy 100%-refund tier).
- **Stripe failure path reverts the cancellation** in the client-respond route — without this, the booking would be cancelled in DB but unrefunded in Stripe, leaving the client out of pocket and unable to retry.
- **All 4 routes notify both parties** via in-app `notifications` row + Brevo template (26 propose, 27 respond). Awaited inside `Promise.allSettled` so a Brevo outage doesn't fail the route, but the writes can't be killed by serverless terminate.
- **`bookings_overlap_guard` trigger is authoritative** — routes don't pre-check slot availability; they let the trigger reject UPDATEs that would create conflicts.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Therapist hits reliability cap | `/reschedule` line 81 | 403 "Hai superato la soglia di affidabilità" |
| `reschedule_count >= 3` | All proposal routes | 409 "Cancella e prendi un nuovo appuntamento" |
| Slot conflict on approve | `bookings_overlap_guard` trigger | UPDATE fails → 409 "in conflitto con un'altra sessione" |
| Stripe refund fails on reject | `revertReschedulePending` | Booking returns to `reschedule_pending`; client can retry |
| Stripe refund "already refunded" | Caught at `route.ts:208` | Treated as success — keep cancellation, no DB rollback |
| Therapist tries to approve own proposal | `approve-reschedule` line 68 | 409 "Solo il cliente può approvare" |
| Client never responds (therapist proposed) | auto-cancel-reschedule cron | Cancel + 100% refund after 24h |
| Therapist never responds (client proposed) | `cleanup_stale_reschedule_pending` cron | Revert to confirmed at original time, no refund |
| Two concurrent accepts | Optimistic-locked UPDATE | First wins, second gets `null` row → 409 |

## Files

- `therapist-webapp/src/app/api/bookings/[id]/reschedule/route.ts` — therapist proposes
- `therapist-webapp/src/app/api/bookings/[id]/approve-reschedule/route.ts` — therapist approves client proposal
- `therapist-webapp/src/app/api/bookings/[id]/decline-reschedule/route.ts` — therapist declines client proposal
- `therapist-webapp/src/app/api/bookings/[id]/reschedule-request/route.ts` — client proposes (file is in therapist-webapp historically; route called from client surface)
- `client-webapp/src/app/api/bookings/[id]/reschedule/respond/route.ts` — client accept/reject of therapist proposal
- `client-webapp/src/app/api/cron/auto-cancel-reschedule/route.ts` — Vercel hourly cron for therapist-proposed timeouts
- `therapist-webapp/supabase/migrations/20260427120000_reschedule_pending_lifecycle.sql` — pg_cron `cleanup_stale_reschedule_pending` with two branches

## Recent fixes / known issues

- **`decline-reschedule` was missing `reschedule_count++` (abuse vector, 2026-04-27).** A client could propose, get declined, and propose again indefinitely without ever burning the 3-cap. Fixed at `decline-reschedule/route.ts:69` — every decline now increments the counter.
- **All 4 reschedule routes had `metadata` column inserts that didn't exist (2026-04-27).** Routes were inserting `notifications` rows with a `metadata` jsonb column that the `notifications` schema doesn't have — the inserts silently failed (Supabase doesn't error on unknown columns when `?` is used? Actually it does error; the catch suppressed it). Replaced with canonical columns (`booking_id`, `therapist_id`, `client_id`).
- **Brevo emails added (2026-04-27).** Previously routes only inserted in-app notifications; Brevo template 26 (propose) and 27 (respond) now wired.
- **Client 24h floor (2026-04-27):** added to close the loophole where client could propose a ridiculous time then cancel for free when therapist declined.
- **Two-branch pg_cron (2026-04-27):** before this, client-proposed reschedules waiting on therapist response would auto-cancel with full refund once the original time passed — effectively a free cancellation. Fixed by reverting client-proposed expiries to `confirmed` instead.
- **Known gap:** no Brevo templates 26 and 27 set up in the dashboard yet for some accounts — emails fail silently inside `Promise.allSettled` and will start working once the templates are created. No code change needed.
- **Known gap:** no in-product way to see history of past reschedules per booking; only counter.
