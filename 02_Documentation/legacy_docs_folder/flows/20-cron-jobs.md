# 20 — Cron Jobs Catalog

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🔴 Critical (catalog of revenue + integrity jobs)
**Owner:** Marcello

## Purpose

Catalog of every scheduled job across the 4 codebases, with schedule, ownership, and what happens if it stops running. Three runners are in play:

1. **Vercel Cron** — driven by `vercel.json` `crons` array, hits HTTPS endpoints with `Authorization: Bearer ${CRON_SECRET}`.
2. **pg_cron** (Supabase) — runs SQL functions on a Postgres schedule. Calls Edge Functions via `pg_net.http_post` with `CRON_SECRET` Supabase secret.
3. **Database webhooks** — Supabase Database > Webhooks (not technically cron, but listed for completeness).

`CRON_SECRET` is rotated on a yearly cadence (last rotation 2026-05-03 covered both Vercel env and Supabase secret simultaneously).

## Vercel Cron — admin-dashboard

`admin-dashboard/vercel.json`:

| Path | Schedule | Purpose | Doc |
|------|----------|---------|-----|
| `/api/cron/monthly-invoices` | `0 3 1 * *` (1st of month, 03:00 UTC) | Issue 20% commission fattura riepilogativa per therapist via FattureInCloud + SDI | `16-fattura-monthly.md` |
| `/api/cron/daily-credit-notes` | `0 4 * * *` (daily, 04:00 UTC) | Issue nota di credito for refunds processed after the monthly invoice | `16-fattura-monthly.md` (refund storno section) |
| `/api/cron/billing-reminders` | `0 9 * * 1` (Monday, 09:00 UTC) | Email therapists with `INCOMPLETE` billing data nudging them to complete | `23-vat-validation.md` |

Auth: each route checks `Authorization: Bearer ${CRON_SECRET}` constant-time (or via `=== `Bearer ${secret}``). Routes return 401 otherwise.

## Vercel Cron — client-webapp

`client-webapp/vercel.json`:

| Path | Schedule | Purpose | Doc |
|------|----------|---------|-----|
| `/api/cron/auto-cancel-reschedule` | `15 * * * *` (hourly, :15) | Cancel + 100%-refund therapist-proposed reschedules whose 24h window expired without client response | `13-reschedule.md` |
| `/api/cron/cleanup-pending-payment` | `30 * * * *` (hourly, :30) | Release `pending_payment` bookings older than **35 min** (5-min buffer beyond the Stripe Checkout `expires_at = 30min` set in `/api/checkout/create`) — slot becomes bookable again. Backstop for the Stripe `checkout.session.expired` webhook path. Updated 2026-05-04 to align with the explicit Stripe expiry; the webhook's `cancelled-but-paid` branch handles the residual race | `07-payment.md` |

Both routes use `timingSafeEqual` for the secret check.

## Vercel Cron — therapist-webapp

`therapist-webapp/vercel.json` (not all of admin/client config above; therapist-webapp's own):

| Path | Schedule | Purpose | Doc |
|------|----------|---------|-----|
| `/api/cron/sync-stripe-status` | every 15 min | Re-fetch Stripe accounts for therapists stuck in `onboarding_pending` >5min; updates `stripe_account_status` if Stripe says `active`/`restricted` | `17-stripe-connect-onboarding.md` |

## pg_cron (Supabase) — `cron.job` table

All pg_cron jobs use `CRON_SECRET` Supabase secret (rotated 2026-05-03) when calling Edge Functions via `pg_net.http_post`.

| Job name | Schedule | Calls | Purpose |
|----------|----------|-------|---------|
| `cleanup-orphaned-bookings` | every 15 min | SQL function `cleanup_orphaned_bookings()` | Cancel bookings stuck in `pending` (no payment intent) > 30 min. Original safety net before `pending_payment` flow added; still runs for legacy paths |
| `send-session-reminders-daily` | daily 10:00 UTC | Edge Function `send-session-reminders` | Email + push reminder for sessions in the next 24h. Uses Brevo template 5 (SESSION_REMINDER_24H) |
| `check-dormant-users-weekly` | Mon 09:00 UTC | Edge Function `check-dormant-users` | Move clients with no booking in 30+ days from `CLIENTS_ACTIVE` to `CLIENTS_DORMANT` Brevo list |
| `cleanup-stale-reschedule-pending` | every 30 min | SQL function `cleanup_stale_reschedule_pending()` | Two branches: (a) revert client-proposed reschedules > 24h old to `confirmed`; (b) cancel any `reschedule_pending` whose original `scheduled_at` is > 1h in the past. See `13-reschedule.md` |
| `cleanup-rate-limit-buckets` | every 10 min | SQL function `cleanup_rate_limit_buckets()` | Delete `rate_limit_buckets` rows older than 1h (table is the implementation of `withRateLimit` from `lib/auth/rateLimit.ts`) |
| `hard-purge-deleted-accounts` | daily 03:00 UTC | SQL function `hard_purge_deleted_accounts()` | Hard-delete `users` rows with `deleted_at > 30 days ago`. The 30-day window is the GDPR Art 17 retention buffer for accidental-delete recovery |
| `auto-complete-expired-bookings` | every 15 min | SQL function `auto_complete_expired_bookings()` | Flip `status='confirmed'` → `'completed'` for bookings where `scheduled_at + duration < now() - 30 min`. Triggers review prompt + post-session emails |
| `process-pending-payouts-daily` | daily 05:00 UTC | Edge Function `process-pending-payouts` | Flip `transactions.payout_status` from `pending` to `paid` (for `status='completed'`) or to `partially_refunded` (for `status='partially_refunded'`) once `payout_after` (charge time + 14d) has elapsed. **Added 2026-05-03** + **partial-refund branch 2026-05-04** (without it, pre-escrow 50% refund rows stayed `pending` forever, inflating therapist's pending-payouts total indefinitely — see `16-fattura-monthly.md` bugfix #2 and `08-refund-cancellation.md` payout state machine) |

## Database webhooks (Supabase Database > Webhooks)

| Trigger | Target | Purpose | Doc |
|---------|--------|---------|-----|
| INSERT on `notifications` | Edge Function `send-push-notification` | Fan out new notification rows to APNs (iOS push) | `15-notifications-emails.md` |

## Auth pattern across runners

- **Vercel Cron** uses `CRON_SECRET` env var on the deployment. Vercel automatically sets `Authorization: Bearer ${env.CRON_SECRET}` on the cron request. Routes verify with constant-time compare.
- **pg_cron** uses Supabase secret `CRON_SECRET` (set via dashboard or `supabase secrets set`). The SQL function reads it via `vault.decrypted_secrets` or `current_setting('app.cron_secret')` and passes it in the `Authorization` header to the target Edge Function.
- **Edge Functions** validate Bearer either by exact-match or timing-safe compare.
- The two `CRON_SECRET` values (Vercel env + Supabase secret) **MUST be the same string** for the rare case of a Vercel cron calling an Edge Function. Rotated together.

## Critical assertions

- **All cron jobs are idempotent.** Re-running a missed cycle should never double-charge, double-refund, or duplicate notifications. Most use optimistic-locked UPDATEs (e.g. `.eq('status', 'pending')`) to claim work; some (monthly-invoices) use UNIQUE constraints to dedup.
- **Per-job batch limits** — most cron functions limit per-run batch (e.g. `auto-cancel-reschedule` limits to 50 bookings, `sync-stripe-status` limits to 30 therapists). Prevents a backlog from blowing past Vercel's serverless timeout (~10s on Hobby, 60s on Pro).
- **`updated_at` bump on no-change** for `sync-stripe-status` — implements implicit 5-min backoff. Other status-polling crons should follow this pattern (currently only `sync-stripe-status` does).
- **Constant-time secret comparison.** `timingSafeEqual` is used in `auto-cancel-reschedule`, `cleanup-pending-payment`, `sync-stripe-status`. Other routes that use `===` are vulnerable to timing attacks in theory; the practical risk is low because all cron routes only return 401 on mismatch (no other side effects to time).
- **Schedules are intentional, not arbitrary.** The 15:00 / 30:00 offsets in client-webapp avoid cron stampede on the hour boundary. The 03:00 / 04:00 / 05:00 staggering in Supabase + admin-dashboard avoids overlapping FIC API calls.
- **`process-pending-payouts-daily` is required for the monthly invoice cron.** Without it, `payout_status` never flips to `paid`, and any future business logic that reads `payout_status` would break. See `16-fattura-monthly.md` bugfix #2.
- **CRON_SECRET rotation requires coordinated update** of Vercel env (3 deployments) AND Supabase secret. A mismatch = silent cron failures (401s logged in Vercel).

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Vercel cron paused (manual) | Vercel dashboard | Job stops running until re-enabled. Compensated by manual run via Vercel UI |
| pg_cron disabled | Postgres `cron.job.active=false` | Same — no run. Compensated by `select cron.alter_job(...) set active=true` |
| `CRON_SECRET` mismatch | Route returns 401 | Sentry captures; alert via Vercel logs |
| Edge Function down | `pg_net` retry policy | pg_net retries with backoff; eventually consistent |
| FIC API down (monthly cron) | Per-therapist try/catch | Skips affected therapist; admin re-runs cron after FIC recovers |
| Stripe API down | Per-row try/catch | Skips affected row; next cron run retries |

## Files

- `admin-dashboard/vercel.json` — admin cron schedule
- `client-webapp/vercel.json` — client cron schedule
- `therapist-webapp/vercel.json` — therapist cron schedule
- `admin-dashboard/src/app/api/cron/monthly-invoices/route.ts`
- `admin-dashboard/src/app/api/cron/daily-credit-notes/route.ts`
- `admin-dashboard/src/app/api/cron/billing-reminders/route.ts`
- `client-webapp/src/app/api/cron/auto-cancel-reschedule/route.ts`
- `client-webapp/src/app/api/cron/cleanup-pending-payment/route.ts`
- `therapist-webapp/src/app/api/cron/sync-stripe-status/route.ts`
- `iOS App/supabase/functions/process-pending-payouts/index.ts`
- `iOS App/supabase/functions/send-session-reminders/index.ts`
- `iOS App/supabase/functions/check-dormant-users/index.ts`
- `iOS App/supabase/functions/send-push-notification/index.ts`
- pg_cron jobs registered in migration files (search `cron.schedule` in `supabase/migrations/*.sql`)

## Recent fixes / known issues

- **`process-pending-payouts-daily` was never scheduled (2026-05-03 fix).** The Edge Function existed but no pg_cron job called it. Result: `transactions.payout_status` was `pending` forever, breaking any consumer that reads it. Added pg_cron schedule at 05:00 UTC daily.
- **`cleanup-pending-payment` cron added 2026-04-27.** Stripe `checkout.session.expired` webhook handles the happy path (Stripe fires 24h after session creation). But if the user closes the tab before Stripe expires the session, no event fires — booking sits in `pending_payment` blocking the slot. The new cron releases it after 30 min.
- **CRON_SECRET rotated 2026-05-03.** Both Vercel env (3 deployments) and Supabase secret updated in coordinated fashion. Verified by running each cron manually post-rotation.
- **Known gap:** no monitoring dashboard for cron health. Vercel surfaces success/failure per run but there's no aggregate view ("are all 7 jobs green?"). V1.1 to add a status page.
- **Known gap:** no replay tooling for missed runs — must manually `curl` the route with the Bearer token.
- **Known gap:** pg_cron job names are loosely tracked; if migration files are renamed/regenerated, the `cron.schedule` calls may duplicate. Periodic `select * from cron.job` audit recommended.
