# 21 — Webhooks (Stripe + DB-Triggered)

**Last verified:** 2026-05-05 (notification fix hardened — scope + `.data` corrections deployed, plus a partial unique index `notifications_booking_user_type_unique ON (booking_id, user_id, type) WHERE booking_id IS NOT NULL` that closes the TOCTOU window between SELECT pre-check and INSERT. With the index in place even concurrent handler runs can't produce duplicate booking_confirmed rows — the second INSERT raises 23505 which the handler already swallows as a non-blocking warning. SQL: `client-webapp/supabase_notifications_dedup_index.sql`.)

> **`checkout.session.completed` cancelled-but-paid branch:** since 2026-05-04 the Vercel-side handler refuses to confirm a booking whose status is already `cancelled` (cleanup-pending-payment cron fired during checkout). Instead it auto-refunds the charge (`reverse_transfer + refund_application_fee`) and emits a Sentry warning. This protects against a charged-client/no-booking outcome in the rare race window between Stripe's 30-minute session expiry and the cron's 35-minute cutoff. See `07-payment.md` "Cancelled-but-paid auto-refund".
**Status:** ✅ Production
**Criticality:** 🔴 Critical
**Owner:** Marcello

## Purpose

The platform has **three webhook surfaces**, each handling different event categories:

- **(A) Stripe → Vercel `client-webapp`** — handles web Checkout flow events (`checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`).
- **(B) Stripe → Supabase Edge Function `stripe-webhook`** — handles iOS PaymentIntent flow (`payment_intent.succeeded`, `payment_intent.payment_failed`), refund accounting (`charge.refunded`), and Connect account state (`account.updated`).
- **(C) DB → Supabase Edge Function `send-push-notification`** — Database webhook on `notifications` INSERT triggers APNs push (see `15-notifications-emails.md`).

The split between (A) and (B) is intentional: web payments use Stripe Checkout (which emits `checkout.session.*` events the iOS flow doesn't see), and iOS uses raw PaymentIntents (no Checkout). **Since 2026-05-04 both webhooks claim each event_id via `stripe_webhook_events.insert({event_id, event_type})` BEFORE processing.** First INSERT wins, the loser sees 23505 (unique violation) and returns 200 with `deduplicated:true` so Stripe stops retrying. Without this on the Edge Function side, web payments could trigger duplicate confirmation emails (Stripe sends both `payment_intent.succeeded` and `checkout.session.completed` for the same web checkout, hitting both handlers).

## Preconditions

- `STRIPE_WEBHOOK_SECRET` set in client-webapp Vercel env AND in Supabase Edge Function secrets. **They are different secrets** — Stripe gives you one per webhook endpoint configured in the Stripe Dashboard.
- `stripe_webhook_events` table exists with PRIMARY KEY on `event_id` and `event_type` column.
- Database webhook for `notifications` INSERT → `send-push-notification` is registered in Supabase Dashboard > Database > Webhooks.

## Sequence

### A. Stripe → Vercel client-webapp (`/api/webhooks/stripe/route.ts`)

`client-webapp/src/app/api/webhooks/stripe/route.ts:27`

1. **Raw body read** — `request.text()`. Critical for signature verification.
2. **Signature verification** via `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` (`route.ts:44`). Returns 400 on mismatch.
3. **Idempotency claim** (`route.ts:60`):
   ```sql
   INSERT INTO stripe_webhook_events (event_id, event_type) VALUES (...);
   ```
   23505 unique violation → return 200 with `deduplicated: true` (Stripe stops retrying). Other errors → log + still process (better duplicate than drop).
4. **Event dispatch:**

   #### `checkout.session.completed` (web payment success)
   - Parse session, extract `metadata.booking_id`, `metadata.client_id`, `metadata.therapist_id`.
   - Lookup booking in DB. If missing → log, return.
   - **Metadata cross-check** (`route.ts:166`): if `metadata.client_id !== booking.client_id` OR `metadata.therapist_id !== booking.therapist_id` → log "possible forged event" and SKIP processing. Defence-in-depth against a leaked webhook secret being used to forge events for arbitrary booking IDs.
   - **Race-aware UPDATE** (`route.ts:221`): `bookings UPDATE status='confirmed', stripe_payment_intent_id, video_room_id WHERE id=$1 AND status='pending_payment'`. The `pending_payment` filter is the optimistic lock. Returns the row only if it actually flipped — `null` means the Edge Function `stripe-webhook` (path B) got there first.
   - `alreadyProcessed = !lockedUpdate`. Used to gate notifications later.
   - **Transaction backfill** (`route.ts:296`): INSERT row with full fee breakdown. On 23505 (Edge Function inserted first with iOS-shape values), UPDATE WHERE booking_id with the canonical web-shape values. The `bookings.video_room_id` partial unique index forces this hand-written upsert pattern (PostgREST `onConflict` doesn't support partial indexes).
   - `notifyBookingConfirmed` ONLY when `!alreadyProcessed` (`route.ts:334`). Notifications + Brevo emails are not idempotent; double-firing would send 2 emails per user.

   #### `checkout.session.expired`
   - Stripe fires this 24h after session creation if the user never paid. Flip booking → `cancelled` with reason "Checkout Stripe scaduto senza pagamento" (`route.ts:88`).
   - Optimistic-locked UPDATE: `WHERE id=$1 AND status='pending_payment'` so a late `completed` event right before expiry doesn't get clobbered.

   #### `payment_intent.payment_failed`
   - Flip booking → `cancelled` with `pi.last_payment_error?.message`. Optimistic-locked.

5. Return `{ received: true }` (200). Stripe stops retrying.

### B. Stripe → Supabase Edge Function `stripe-webhook`

`iOS App/supabase/functions/stripe-webhook/index.ts`

1. **Web Crypto signature verification** (`index.ts:61`) — Deno doesn't have the Stripe Node SDK; we re-implement constant-time HMAC-SHA-256 comparison and a 5-min timestamp tolerance.
2. **Event dispatch:**

   #### `payment_intent.succeeded` (iOS payment success)
   - Read fee breakdown from `paymentIntent.metadata` (set by `create-payment-intent`).
   - INSERT `transactions` row (UNIQUE constraint on `stripe_payment_intent_id` for idempotency).
   - UPDATE booking → `status='confirmed'`. **No optimistic lock here** — race-handling is on the Vercel side (path A), which detects and gates against this path winning.
   - Insert `session_credits` for pack bookings.
   - Save `payment_methods` row (card last4, brand) for future use.
   - Send Brevo emails (templates 3, 4, 6) — direct call to `sendTransactionalEmail`, not via `send-brevo-email` Edge Function (legacy path).

   #### `payment_intent.payment_failed`
   - INSERT failed `transactions` row (status='failed', amount=0 fee fields). Audit trail only.

   #### `charge.refunded`
   - `refundedAmount = charge.amount_refunded / 100`; `isFullRefund = refundedAmount >= totalAmount`.
   - UPDATE `transactions` → `status` = 'refunded' OR 'partially_refunded', `refund_amount`, `payout_status` = 'refunded' (if full).
   - **Preserve audit trail (recent fix):** if full refund, ALSO update the booking to `cancelled` with `cancelled_by='system'`, `cancelled_at=now()`, `cancellation_notice_hrs` (computed from `scheduled_at`), and `cancellation_reason='Rimborso completo processato via Stripe'`. Earlier code only updated `transactions`, leaving the booking dangling — admin reliability dashboard couldn't distinguish system-initiated cancellations from therapist-initiated ones.
   - Send Brevo template 9 (full) or 10 (partial) to client.

   #### `account.updated`
   - **Re-fetch live account** (`index.ts:606`) — webhook payload during onboarding completion is stale. See `17-stripe-connect-onboarding.md`.
   - Recompute status (`active` / `restricted` / `onboarding_pending`).
   - UPDATE `therapist_profiles` either by `metadata.therapist_profile_id` or fallback by `stripe_connected_account_id`.

### C. DB → `send-push-notification`

Supabase Database Webhook configured in dashboard:
- **Table:** `public.notifications`
- **Events:** INSERT
- **Type:** Supabase Edge Functions
- **Edge Function:** `send-push-notification`
- **Headers:** standard service-role auth

Function (see `15-notifications-emails.md`):
1. Reads `record` from request body (the inserted row).
2. Looks up `device_tokens` for `record.user_id`.
3. Checks `user_notification_preferences` for category opt-out.
4. Signs APNs JWT (ES256 with `.p8` key) and POSTs to `https://api.push.apple.com/3/device/{token}` with the title/body/badge payload.
5. Best-effort: APNs 410 (invalid token) currently NOT pruned (V1.1).

## Critical assertions

- **Two webhook endpoints share `stripe_webhook_events` idempotency table.** The same Stripe event_id might be delivered to both endpoints (Stripe Dashboard configuration). Without the shared dedup table, both paths would fire and we'd double-send notifications. The PRIMARY KEY on `event_id` ensures the second INSERT fails with 23505 → 200 to Stripe → no retries.
- **Vercel side claims the event FIRST** (the dedup INSERT happens before the dispatch switch). This means if both endpoints are configured, the slower one might 23505 and skip processing; the faster one does the work. Both paths are designed to produce identical DB state, so it doesn't matter which "wins" for the booking row — but notifications gating depends on the alreadyProcessed signal.
- **Optimistic-locked UPDATEs are the source of truth for race detection.** The Vercel handler uses `WHERE status='pending_payment'` and inspects `.maybeSingle()` to determine whether it actually flipped the booking. The Edge Function doesn't optimistic-lock — it's expected to race and lose sometimes.
- **Metadata cross-check defends against forged events.** A leaked `STRIPE_WEBHOOK_SECRET` would let an attacker forge `checkout.session.completed` for any `booking_id`. The cross-check ensures `session.metadata.client_id == booking.client_id` and `session.metadata.therapist_id == booking.therapist_id` — both are bound at checkout creation time, so a forgery against an unrelated booking would mismatch and be ignored.
- **Raw body required for signature verification.** Both endpoints read `request.text()` (Vercel) or `req.text()` (Deno) BEFORE doing anything else. JSON-parsing first would alter the byte sequence and the HMAC would mismatch.
- **`charge.refunded` writes booking audit fields** so the reliability dashboard can correctly attribute system-vs-therapist cancellations.
- **`account.updated` re-fetches live account.** Workaround for the activation race; without it ~30% of post-onboarding therapists got stuck at `onboarding_pending`.
- **`notifyBookingConfirmed` is gated by `alreadyProcessed`.** Notifications and Brevo emails are NOT idempotent — sending them twice means 2 emails per user. The Edge Function (path B) sends its own emails for the iOS flow, so when path A loses the race we skip the notify call entirely.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Signature mismatch | Vercel `route.ts:46` / Edge Function `:158` | 400; Stripe will retry several times then alert |
| Idempotency collision | `stripe_webhook_events` 23505 | 200 `deduplicated:true`; no double-process |
| Booking missing on session.completed | `route.ts:153` | Log + return; ghost charge possible (Sentry alert via `transactions_write_failed_post_confirm`) |
| Metadata mismatch (forged event) | `route.ts:166` | Log "possible forged event"; skip processing; 200 to Stripe |
| Edge Function wins booking race | `lockedUpdate=null` in route.ts | Vercel still backfills `transactions` with canonical fees but skips notifications |
| Both endpoints configured | Shared dedup table | First-to-INSERT wins idempotency; second sees 23505 |
| `transactions` insert fails | `route.ts:307` | `Sentry.captureException('transactions_write_failed_post_confirm')` — booking is confirmed but ledger is wrong; admin must backfill |
| Stripe webhook delivery delay | Async retry | Booking remains `pending_payment` for up to 10 min; cleanup-pending-payment cron picks up after 30 min |
| `account.updated` for unknown account | Lookup by metadata fails | Fallback lookup by `stripe_connected_account_id`; if both miss → log and ignore |
| `charge.refunded` for unknown PI | UPDATE matches 0 rows | Log; refund still went through at Stripe — admin must reconcile manually |

## Files

- `client-webapp/src/app/api/webhooks/stripe/route.ts` — Vercel webhook handler (web)
- `iOS App/supabase/functions/stripe-webhook/index.ts` — Edge Function (iOS + refunds + Connect)
- `iOS App/supabase/functions/send-push-notification/index.ts` — DB-triggered push handler
- Migration `20260414_unique_stripe_payment_intent.sql` — UNIQUE on `transactions.stripe_payment_intent_id`
- Migration with `stripe_webhook_events` table (search `stripe_webhook_events` in `supabase/migrations/*.sql`)
- `client-webapp/src/lib/payments/fee-config.ts` — `calculatePaymentAmounts` used by Vercel handler
- `iOS App/supabase/functions/_shared/brevo.ts` — `sendTransactionalEmail` used by Edge Function

## Recent fixes / known issues

- **`alreadyProcessed` flag derived from optimistic UPDATE (2026-04-27).** Earlier code always called `notifyBookingConfirmed` regardless of who won the race. Web users got 2 booking confirmation emails (one from each handler). Fixed by gating notifications on the locked-UPDATE returning a row.
- **`charge.refunded` preserves audit trail (2026-04-30).** Added `cancelled_by='system'`, `cancelled_at`, `cancellation_notice_hrs`, `cancellation_reason` to the booking UPDATE. Without these the admin reliability dashboard counted system refunds as therapist no-shows (false positive on therapist's reliability score).
- **Re-fetch live account in `account.updated` (2026-04-22).** Fixed activation race — see `17-stripe-connect-onboarding.md`.
- **Metadata cross-check (2026-04-15).** Added defence-in-depth against forged events from a hypothetical leaked webhook secret.
- **Hand-written INSERT-then-UPDATE for `transactions`** because the partial unique index `WHERE booking_id IS NOT NULL` doesn't work with PostgREST `onConflict`. Documented in code comment at `route.ts:265`.
- **Known gap:** APNs 410 (invalid token) responses don't prune `device_tokens`. Stale tokens accumulate; throughput unaffected but DB grows.
- **Known gap:** no replay tooling — if a webhook is dropped (Stripe retried 5x, all fails), admin must manually trigger via Stripe Dashboard "Send test webhook" with the original event payload.
- **Known gap:** no metric on the metadata-mismatch path. If a real attacker probed forged events, we'd see logs but no alert/dashboard.
- **Known gap:** notification idempotency is currently a pre-INSERT existence check, not a DB-level UNIQUE constraint. This is enough for ordinary Stripe retries and the observed Edge/Vercel race, but a true same-millisecond double insert could still create duplicate in-app rows. Add a unique index on `(booking_id, user_id, type)` after deduping historical rows if this becomes noisy.
- **2026-05-05 sanity fix:** the first Edge notification patch referenced `client`, `therapist`, and `booking` outside their block scope, so the notification insert could fail non-blocking with a runtime `ReferenceError`. The shared party/booking fetch now happens before Brevo + notifications, and booking row fields are read directly (`booking.scheduled_at`, `booking.service_name`). Vercel notification inserts were also changed from a blind insert to the same pre-check pattern documented above.
