# 15 — Notifications & Emails

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🟡 Important
**Owner:** Marcello

## Purpose

Two delivery channels, one source of truth:

1. **In-app notifications** — rows in the `public.notifications` table, fanned out to:
   - Web dashboards (client + therapist) via Supabase Realtime subscriptions on the user's row.
   - iOS via APNs push (a DB trigger on `notifications` INSERT calls the `send-push-notification` Edge Function).
2. **Transactional emails** — sent via Brevo (ex-Sendinblue) using the `send-brevo-email` Edge Function, keyed by template IDs (`BREVO_TEMPLATES`). Triggered from webhook handlers, API routes, scheduled jobs, and pg_net DB triggers.

The two channels are independent — an in-app notification may exist without an email (e.g. if Brevo is down) and vice versa. Email is best-effort; in-app is the system of record.

## Preconditions

- Supabase project has `pg_net` extension enabled (used by DB triggers calling Edge Functions).
- `BREVO_API_KEY` set as Supabase secret AND in admin-dashboard / webapp env.
- Brevo templates 1-10, 26, 27 created in the Brevo dashboard with matching IDs.
- `device_tokens` table populated for iOS users wanting push.
- `user_notification_preferences` table for per-user category opt-in/out (push only — in-app is always on).

## Sequence

### A. Brevo template catalog (`iOS App/supabase/functions/_shared/brevo.ts:35`)

Transactional (no consent needed):
- **1** WELCOME_CLIENT
- **2** WELCOME_THERAPIST
- **3** BOOKING_CONFIRMED_CLIENT
- **4** BOOKING_CONFIRMED_THERAPIST
- **5** SESSION_REMINDER_24H
- **6** PAYMENT_RECEIPT
- **7** THERAPIST_APPROVED
- **8** THERAPIST_CHANGES_REQUESTED
- **9** CANCELLATION_CONFIRMATION (full refund)
- **10** REFUND_CONFIRMATION (partial refund)
- **26** RESCHEDULE_PROPOSED
- **27** RESCHEDULE_RESPONDED

Marketing (requires `users.marketing_consent = true`):
- **20** FIRST_BOOKING_NUDGE
- **21** POST_SESSION_FOLLOWUP
- **22** REENGAGEMENT_CLIENT
- **23** PROMO_VOUCHER
- **24** THERAPIST_TIPS
- **25** WEEKLY_EARNINGS_SUMMARY

The `send-brevo-email` Edge Function gates marketing templates on `users.marketing_consent` (`iOS App/supabase/functions/send-brevo-email/index.ts:111`). Transactional emails always send.

### B. send-brevo-email Edge Function (`iOS App/supabase/functions/send-brevo-email/index.ts`)

Authentication accepts:
- A **service-role JWT** (used by all webhook routes + cron jobs) — bypasses RLS, can send to any `user_id`.
- The **`CRON_SECRET`** Supabase secret as Bearer (used by pg_cron jobs that call this function via `pg_net`) — also full access.

Inputs: `{ template_id, user_id?, email?, params, tags, whatsapp? }`. Resolves `recipientEmail` either from `email` directly or by looking up `users.email` for `user_id`. WhatsApp side-channel is best-effort and skipped if no phone or no consent.

GDPR check: `if (MARKETING_TEMPLATES.has(template_id) && !hasMarketingConsent) → skip` (logs `marketing_consent_required` reason and returns 200, NOT an error).

### C. send-push-notification Edge Function (`iOS App/supabase/functions/send-push-notification/index.ts`)

Triggered by a DB webhook on `notifications` INSERT (configured in Supabase Database > Webhooks). Reads the inserted row, looks up `device_tokens` for `user_id`, checks `user_notification_preferences` for category gating (e.g. `push_booking_reminders`), then signs an APNs JWT (ES256 with the team's `.p8` key) and POSTs to Apple.

Bundle id and environment (`APNS_BUNDLE_ID`, `APNS_ENVIRONMENT=production|development`) live in Supabase secrets. The `metadata` field on the notification row drives deep-link routing on the device.

### D. Where notifications get inserted

The canonical writers (and what they trigger):

- **`/api/webhooks/stripe` (client-webapp)** — on `checkout.session.completed`, inserts 2 notifications (client + therapist `booking_confirmed`) AND queues 2 Brevo emails (templates 3 + 4) via `notifyBookingConfirmed` (`route.ts:358`). Race-aware: if the Edge Function `stripe-webhook` already flipped the booking, the notification block is skipped to avoid duplicates.
- **Edge Function `stripe-webhook` (Supabase)** — on `payment_intent.succeeded` (iOS path), sends Brevo templates 3, 4, 6 directly without going through `send-brevo-email` (uses `sendTransactionalEmail` from `_shared/brevo.ts`). Also sends template 9 / 10 on `charge.refunded`.
- **`/api/bookings/[id]/cancel` (client + therapist)** — inserts notification + Brevo template 9.
- **All 4 reschedule routes** — see `13-reschedule.md`. Insert notification + Brevo 26 (propose) or 27 (respond).
- **Admin approve/reject (`/api/therapists/[id]/{approve,reject}`)** — Brevo template 7 / 8 + sync-brevo-contact.
- **iOS direct insert** — review submission, profile update, etc., insert directly via the SDK; protected by `normalize_review_identity` and other triggers.
- **pg_cron jobs** — session reminders, dormant nudges (see `20-cron-jobs.md`). These call `send-brevo-email` via `pg_net.http_post` with the `CRON_SECRET` header.

### E. notifications schema (`public.notifications`)

Canonical columns:
- `id` uuid PK
- `user_id` uuid (recipient — RLS: `auth.uid() = user_id` for SELECT)
- `type` text (e.g. `booking_confirmed`, `reschedule_pending`, `cancellation`)
- `title` text
- `body` text
- `booking_id` uuid (nullable, for deep-link)
- `client_id` / `therapist_id` uuid (nullable, the *other* party)
- `read_at` timestamptz (nullable)
- `created_at` timestamptz default now()

Note: there is **no `metadata` jsonb column.** Five reschedule routes used to insert with a `metadata` field that didn't exist on the table — the inserts silently failed (the `await` chain wrapped the error in `Promise.allSettled` so nothing surfaced). Fixed 2026-04-27 by switching to canonical columns.

## Critical assertions

- **In-app `notifications` is the source of truth.** Email and push are derivative channels. If Brevo or APNs is down, the notification row still exists; users see it next time they open the app/dashboard.
- **Transactional emails are NOT gated by marketing consent.** `BREVO_TEMPLATES` for booking confirmations, receipts, refunds, MFA, etc. always send. Marketing templates (20-25) check `users.marketing_consent` and silently skip otherwise.
- **`send-brevo-email` returns 200 even when skipping marketing emails** to keep callers idempotent — they don't need to know whether consent was given. The skip is logged with `reason: marketing_consent_required`.
- **Service-role OR CRON_SECRET to call `send-brevo-email`.** No user JWT path — preventing arbitrary users from spamming each other via the function.
- **iOS direct-insert from Supabase SDK** is allowed for `notifications` (RLS permits `auth.uid() = client_id` writes for some types). The fan-out to APNs happens via the DB INSERT trigger, decoupled from the writer.
- **Email send is awaited inside `Promise.allSettled`.** Routes never let a Brevo outage fail the response, but the awaited promise prevents serverless terminate from killing the in-flight request.
- **No PII in push payload metadata.** The metadata field carries `booking_id` and `type` — the device fetches the rest from the API after waking the app.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Brevo API 5xx | `sendTransactionalEmail` | Logged, swallowed in `Promise.allSettled`; in-app notification still visible |
| Marketing template + no consent | `send-brevo-email:111` | 200 with `success:false, reason:marketing_consent_required` (not an error) |
| User has no email | `send-brevo-email:74` | 404 "User not found" if `user_id` resolves to no email; route caller proceeds |
| Brevo template not configured | API call returns 400 | Email fails; in-app notification still inserted |
| `device_tokens` empty | `send-push-notification:50` | 200 `{ skipped: "no device tokens" }` |
| User has push disabled | `user_notification_preferences.push_enabled=false` | 200 skip with reason |
| Category-specific opt-out (e.g. `push_booking_reminders=false`) | `send-push-notification:74` | 200 skip with category reason |
| APNs returns 410 (token invalid) | not handled in V1 | Stale tokens accumulate — V1.1 cleanup |
| `metadata` column on notifications insert | DB returns column-not-found | Promise rejected inside Promise.allSettled; nothing visible to user. **Fixed 2026-04-27** by removing `metadata` from all reschedule routes |

## Files

- `iOS App/supabase/functions/send-brevo-email/index.ts` — Brevo dispatcher
- `iOS App/supabase/functions/send-push-notification/index.ts` — APNs sender
- `iOS App/supabase/functions/_shared/brevo.ts` — `BREVO_TEMPLATES`, `sendTransactionalEmail`, `trackEvent`
- `client-webapp/src/app/api/webhooks/stripe/route.ts` — `notifyBookingConfirmed`
- `iOS App/supabase/functions/stripe-webhook/index.ts` — Brevo emails for iOS booking confirmations + refunds
- `client-webapp/src/app/api/bookings/[id]/cancel/route.ts` — cancellation email
- `client-webapp/src/app/api/bookings/[id]/reschedule/respond/route.ts` — reschedule responded
- `therapist-webapp/src/app/api/bookings/[id]/{reschedule,approve-reschedule,decline-reschedule,reschedule-request}/route.ts` — all 4 reschedule routes
- `admin-dashboard/src/app/api/therapists/[id]/{approve,reject}/route.ts` — approval emails

## Recent fixes / known issues

- **Reschedule routes had non-existent `metadata` column (2026-04-27).** All 5 routes (4 in therapist-webapp + 1 in client-webapp) inserted `notifications` with a `metadata` JSON blob. The column doesn't exist on the schema; inserts failed silently inside `Promise.allSettled`. Replaced with canonical columns (`booking_id`, `therapist_id`, `client_id`).
- **Brevo template 26/27 added (2026-04-27).** Previously reschedule routes only inserted in-app notifications. Now also queue Brevo emails (RESCHEDULE_PROPOSED + RESCHEDULE_RESPONDED). The templates may not yet be created in every Brevo account — emails fail silently inside `Promise.allSettled` until then; no code change needed when templates land.
- **iOS direct-insert from Supabase SDK** is the most fragile path because it bypasses API-route validation. Protected for `reviews` by the `normalize_review_identity` BEFORE INSERT trigger; for `notifications`, type-specific RLS limits the surface but nothing prevents a malicious user from spamming themselves with notifications they wouldn't otherwise see (low-impact abuse vector).
- **Known gap:** No SMS fallback for users with no email. Marketing data shows ~0.3% of registered users have invalid emails — they receive nothing.
- **Known gap:** Stale APNs tokens not pruned. If a user uninstalls and reinstalls, the old token will 410 forever; V1.1 to add cleanup on 410.
- **Known gap:** No notification batching — every event creates an immediate row + email + push. Could group "5 new messages from X" but Stream Chat handles that natively for messaging notifications, so the gap only affects booking-related events (rare bursts).
