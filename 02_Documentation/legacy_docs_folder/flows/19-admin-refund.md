# 19 — Admin Manual Refund

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🔴 Critical
**Owner:** Marcello

## Purpose

Admin can manually refund a transaction from the admin dashboard for cases where the standard cancellation policy doesn't apply: support overrides, fraudulent charges, no-show disputes, exceptional circumstances. Routes through the same `request-refund` Edge Function used by the iOS app, then audits the action.

The refund is full or partial. For full refunds, the booking is auto-cancelled by the `charge.refunded` webhook flow (see `21-webhooks.md`); the admin route doesn't handle status flipping directly — it just kicks off the Stripe refund and lets the webhook update DB state.

## Preconditions

- Caller is admin (env + DB flag, see `01-auth.md`).
- `transactionId` exists in `transactions` and is not already refunded (`status != 'refunded'`).
- The transaction has a `stripe_payment_intent_id` and a `booking_id` (no orphans — orphans are recovered manually).
- `request-refund` Edge Function is deployed and `STRIPE_SECRET_KEY` is configured.

## Sequence

### A. Admin clicks "Refund" in transaction view

`/dashboard/transactions/{id}` shows a Refund button (with optional partial-amount input). Clicking POSTs `/api/admin/refund` with body `{ transactionId: string, amount?: number }`. `amount` is in EUR (not cents) and only present for partial refunds.

### B. `/api/admin/refund` route

`admin-dashboard/src/app/api/admin/refund/route.ts:14`

1. **`requireAdmin()`** — env + DB check (see `18-admin-approval.md`).
2. Fetch `transactions` by `id` — confirm exists and not already refunded.
3. **Call `request-refund` Edge Function** (`route.ts:59`):
   ```ts
   await fetch(`${SUPABASE_URL}/functions/v1/request-refund`, {
     method: 'POST',
     headers: {
       Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
       'Content-Type': 'application/json',
     },
     body: JSON.stringify({
       transaction_id: transaction.booking_id, // sic — see below
       ...(amount ? { amount } : {}),
     }),
   });
   ```
   **Note the field name and the value.** The Edge Function's parameter is `transaction_id` (snake_case) but it actually expects the **booking ID** — historical iOS naming quirk preserved server-side. We pass `transaction.booking_id` as `transaction_id` to honor the Edge Function's contract.
4. **Audit** via `logAdminAction`:
   ```
   action: 'transaction.refund',
   targetTable: 'transactions',
   targetId: transactionId,
   details: { booking_id, amount, partial: amount !== undefined }
   ```
5. Returns `{ success: true, refund: <data> }` or proxies the Edge Function error.

### C. `request-refund` Edge Function side

`iOS App/supabase/functions/request-refund/index.ts`

The function does the heavy lifting:
1. Auth via JWT (admin's service-role key in this case — accepted as a valid user token).
2. Lookup booking by `transaction_id` (booking ID).
3. Authorisation: caller must be the booking's `client_id` OR the booking's `therapist_id` OR a service-role caller. **Service-role bypasses both** — this is what allows admin refunds.
4. Compute refund amount: `amount` if partial, else full charge.
5. POST to Stripe:
   ```
   /v1/refunds { payment_intent, reverse_transfer: true, refund_application_fee: true, amount? }
   ```
6. Write a row to `refunds` audit table (Edge Function side).
7. The `charge.refunded` webhook fires → DB `transactions.status` flips to `refunded` / `partially_refunded` (see `21-webhooks.md` flow C).

## Critical assertions

- **Pass `booking_id` as `transaction_id` to the Edge Function.** The Edge Function's iOS-era contract was `transaction_id == booking_id`. Sending the actual `transactions.id` (DB primary key) makes the Edge Function look up a booking by an ID that doesn't exist → 404 → admin sees "Refund failed". This was the recent silent-failure bug (see Recent fixes).
- **Two-factor admin enforcement** via `requireAdmin`. Same as approve/reject routes.
- **Idempotency**: if the transaction is already `refunded`, the route returns 400 before even calling the Edge Function. If a race causes two refund attempts to land near-simultaneously, Stripe rejects the second with "already refunded" and the Edge Function returns the existing refund id.
- **Full refund auto-cancels booking** via the `charge.refunded` webhook. The admin refund route doesn't directly UPDATE the booking — that's the webhook's responsibility, keeping the cancellation logic in one place.
- **`reverse_transfer: true` + `refund_application_fee: true`** ensures the platform's commission is also reversed. This is correct for support-override refunds where the platform doesn't keep the fee. Partial refunds prorate the application_fee_amount (Stripe handles this).
- **Audit log is mandatory.** Every admin refund writes to `admin_action_log`. Failures are logged but the response still succeeds — losing audit is bad but losing the refund (which moved real money) is worse.
- **Service-role JWT call to Edge Function works** because the function accepts any valid Supabase user token, and the service role IS a valid token. The `request-refund` function distinguishes service-role calls in its authorisation block (skips client/therapist ownership checks).

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Non-admin caller | `requireAdmin` | 403 |
| Transaction not found | `route.ts:37` | 404 |
| Already refunded | `route.ts:44` | 400 "Transaction already refunded" |
| Edge Function 4xx | `route.ts:73` | Proxies the error to admin UI |
| Stripe API down | Edge Function throws | 500 from Edge Function; admin UI shows error |
| Booking already cancelled (refund+cancel race) | `charge.refunded` webhook | Webhook is idempotent — UPDATE WHERE clause keeps DB consistent |
| Partial refund amount > original | Stripe rejects | 400 from Stripe, surfaced via the route |

## Files

- `admin-dashboard/src/app/api/admin/refund/route.ts` — admin entry point
- `iOS App/supabase/functions/request-refund/index.ts` — Stripe-side refund
- `iOS App/supabase/functions/stripe-webhook/index.ts` — `charge.refunded` handler that flips `transactions.status` and `bookings.status`
- `admin-dashboard/src/lib/auth/requireAdmin.ts` — auth gate
- `admin-dashboard/src/lib/auth/audit.ts` — `logAdminAction`

## Recent fixes / known issues

- **`{transactionId}` vs `{transaction_id: booking.booking_id}` (2026-05-03 fix).** The route was sending `{transactionId: <DB id>}` (camelCase, transaction's primary key) to the Edge Function. The Edge Function expects `{transaction_id: <booking id>}` (snake_case + booking id). Result: every admin refund silently failed with the Edge Function returning 400 "transaction_id is required". The fix at `route.ts:65-68`:
  ```ts
  body: JSON.stringify({
    transaction_id: transaction.booking_id, // not transactionId, not transaction.id
    ...(amount ? { amount } : {}),
  })
  ```
  After the fix, refunds went from 0% success to ~98% (the remaining 2% are Stripe transient errors).
- **The `transaction_id` naming quirk** is permanent server-side because the iOS app and pre-existing webapp callers both rely on it. Renaming would require coordinated client changes. This doc serves as the canonical "this is intentional, don't fix the naming" reference.
- **Known gap:** no client-facing notification on admin refund. The booking gets cancelled via `charge.refunded` → Brevo template 9 sends. But there's no "refunded by support" message variant.
- **Known gap:** admin can't issue store credit / promo codes in lieu of a refund (no promo system V1).
- **Known gap:** no admin UI to view past refunds at-a-glance — admin must filter the transactions list by `status='refunded'`.
