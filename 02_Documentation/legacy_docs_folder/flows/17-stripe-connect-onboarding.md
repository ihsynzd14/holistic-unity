# 17 — Stripe Connect Onboarding (Therapist Express Account)

**Last verified:** 2026-05-06 (multi-country onboarding shipped: country picker + `country` param to Stripe + EU territories outside VAT zone detection)
**Status:** ✅ Production
**Criticality:** 🔴 Critical
**Owner:** Marcello

> **Country selection is mandatory before Stripe account creation, not when resuming.** The therapist webapp `/dashboard/settings` exposes a country dropdown that's visible only when `stripe_connected_account_id` is null (first-time onboarding). The selected ISO2 is sent as `country` in the body of `POST /api/stripe/connect`, forwarded to the Edge Function `create-connect-account`, validated against `STRIPE_CONNECT_COUNTRIES` (EU 27 + EFTA 4 + UK), and passed to Stripe at `POST /v1/accounts` creation. **The choice is permanent** — Stripe does not allow changing an account's country after creation. Earlier versions of the Edge Function omitted `country`, defaulting to the platform country (IT) and leaving non-IT therapists stuck in `restricted` after they tried to onboard with foreign data (Roberta Pagliani case, 2026-05-06).
>
> **Resume vs create**: when a therapist already has `stripe_connected_account_id` set (status `onboarding_pending` or `restricted`), clicking the button just mints a fresh `account_link` for the SAME existing Stripe account — no new account is created, no country is needed, the country picker is hidden. The button label changes to "Riprendi onboarding". A regression on 2026-05-06 ("non mi ci fa neanche più ritornare in stripe connect") had the button permanently disabled in this case because the disable check `!pickedCountry` ran unconditionally; fixed 2026-05-07 by gating that check on `!stripe.accountId` (i.e. only block the button when creating a new account). The mirror `therapist_profiles.country` is set in the same write so the rest of the app (fee math, tax-mode resolver, billing form regional logic) sees a consistent value.

## Purpose

Therapists need a Stripe Connect Express account to receive payouts. The platform creates the account, hosts the onboarding link, and tracks the activation lifecycle. Payouts are configured **weekly on Friday with a 14-day delay** (Stripe `delay_days=14`) so refunds within the cancellation policy window pull back from pending funds without claw-back.

The hard part isn't account creation — it's the race condition between Stripe's `account.updated` webhook and the activation of `charges_enabled` / `payouts_enabled`. Stripe fires the webhook 1-2 seconds AFTER the user clicks "Submit" in the hosted onboarding, but BEFORE the capabilities finish propagating. The webhook payload often shows `charges_enabled=false` while a freshly fetched account already shows `true`. We work around this with two layers: (a) the webhook re-fetches the live account, (b) on-demand sync route + 15-min Vercel cron for stragglers.

## Preconditions

- Platform Stripe account in Live mode with Connect enabled.
- `STRIPE_SECRET_KEY` set in Supabase function env AND in webapp env.
- Therapist `approval_status='approved'` (cannot start Connect onboarding before admin approval).
- Therapist's `users.email` populated (used as the Stripe account `email`).

## Sequence

### A. Account creation + onboarding link (`create-connect-account` Edge Function)

`iOS App/supabase/functions/create-connect-account/index.ts`

1. iOS or webapp calls the function with `{ therapist_id }`.
2. Auth: `x-user-token` header (preferred to bypass Supabase Edge gateway JWT check) or `Authorization: Bearer <jwt>`. JWT must resolve to the same user as `therapist_id` (`index.ts:130`).
3. If `therapist_profiles.stripe_connected_account_id` exists, skip creation and just generate a fresh onboarding link.
4. Otherwise create:
   ```json
   {
     "type": "express",
     "email": "<therapist_email>",
     "metadata": {
       "supabase_user_id": "<user_id>",
       "therapist_profile_id": "<therapist_id>"
     },
     "capabilities": {
       "card_payments": { "requested": true },
       "transfers": { "requested": true }
     },
     "business_type": "individual",
     "settings": {
       "payouts": {
         "schedule": {
           "interval": "weekly",
           "weekly_anchor": "friday",
           "delay_days": "14"
         }
       }
     }
   }
   ```
5. Store `stripe_connected_account_id` + `stripe_account_status='onboarding_pending'` on `therapist_profiles`.
6. POST `/v1/account_links` with `refresh_url` + `return_url` pointing at Edge Function `connect-redirect` (which then redirects to the therapist webapp). Return the hosted onboarding URL.

### B. Therapist completes hosted onboarding

User opens the URL, fills in business details, ID verification, bank account. On submit, Stripe redirects to `connect-redirect?type=return` which redirects to `https://therapistportal.holisticunity.app/dashboard/billing?stripe=return`.

### C. `account.updated` webhook (Edge Function `stripe-webhook`)

`iOS App/supabase/functions/stripe-webhook/index.ts:594` (case `account.updated`):

1. **CRITICAL: re-fetch live account state** (`index.ts:606`):
   ```ts
   account = await stripeRequest("GET", `/accounts/${eventAccount.id}`);
   ```
   Don't trust the webhook payload's `charges_enabled` / `payouts_enabled` — they're stale (1-2s lag during activation). The re-fetch is the workaround for the activation race.
2. Resolve status:
   ```
   if (charges_enabled && payouts_enabled)        → "active"
   else if (requirements.disabled_reason)         → "restricted"
   else if (details_submitted)                    → "onboarding_pending"
   else                                            → "onboarding_pending"
   ```
3. UPDATE `therapist_profiles` either by `metadata.therapist_profile_id` or by `stripe_connected_account_id` (fallback). Also write `stripe_country` if returned.

### D. On-demand sync (`/api/stripe/sync-status`)

`therapist-webapp/src/app/api/stripe/sync-status/route.ts`

When the therapist opens `/dashboard/billing` or `/dashboard/settings` and sees status `onboarding_pending`, the page calls this route on mount.

1. Auth via Supabase session (the calling therapist).
2. Rate limit `stripe-sync-status` 30/10min (generous because every settings page mount calls it).
3. Fetch live account from Stripe (`GET /v1/accounts/{id}`).
4. Recompute status using same logic as the webhook handler.
5. If different from cached → UPDATE `therapist_profiles`. If unchanged → no-op (saves a roundtrip + keeps `updated_at` meaningful).
6. Return `{ synced, changed, status, charges_enabled, payouts_enabled }`.

### E. 15-minute cron sweep (`/api/cron/sync-stripe-status`)

`therapist-webapp/src/app/api/cron/sync-stripe-status/route.ts`

Configured in `therapist-webapp/vercel.json` (15-minute schedule). Catches stragglers — therapists who closed the onboarding tab and never returned to the webapp, so the on-demand path didn't fire.

1. Auth: `Authorization: Bearer ${CRON_SECRET}` constant-time compared.
2. Lookup up to 30 therapists with `stripe_account_status='onboarding_pending'` AND `stripe_connected_account_id IS NOT NULL` AND `updated_at < now() - 5min`.
3. For each: fetch Stripe account, recompute status, UPDATE if changed.
4. **Crucial detail (`route.ts:99`):** if status is unchanged, **still bump `updated_at`** to implement an implicit 5-min backoff. Without this, every still-pending therapist would be re-queued every 15 min indefinitely, burning Stripe API quota and never letting the row "escape" the cron's filter.

## Critical assertions

- **Payout schedule is `weekly Friday delay_days=14`.** Set at account creation; verified end-to-end via Stripe Dashboard and the Connect diagnostic function. Changing this requires a Stripe API call PLUS coordinated change in the cancellation policy doc — refund tiers assume 14d hold.
- **Re-fetch live account in webhook handler.** Stripe payload during activation is unreliable. The re-fetch is the only race-safe way to determine `active` status. Without it, ~30% of therapists ended up stuck at `onboarding_pending` post-launch.
- **Status decision logic identical in 3 places.** Webhook handler, `/api/stripe/sync-status`, and `/api/cron/sync-stripe-status` all run the same `if/else` cascade. Keep them in sync — divergence has caused incidents.
- **5-min backoff on cron via `updated_at` bump.** Even when nothing changed, the cron writes `updated_at = now()` so the next run's `.lt("updated_at", fiveMinAgo)` filter excludes the row. This prevents infinite re-queueing.
- **`metadata.therapist_profile_id` is the lookup key.** Stripe stores it on the account so the webhook can resolve back to our therapist row even if the local mapping was somehow lost.
- **`approval_status='approved'` gate on entry.** The Edge Function doesn't enforce this directly (it checks ownership only); it's the therapist webapp UI that hides the "Connect Stripe" button until approved. Defence in depth: a malicious therapist could still call the function pre-approval — they'd get an account but it can't accept payments because no booking endpoints will route money to a non-approved therapist.
- **The Edge Function uses `x-user-token` header preferentially** to bypass Supabase Edge Function gateway's automatic JWT verification — necessary for some clients that can't pass the token in `Authorization` (legacy iOS path).

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| User abandons onboarding | No Stripe event | Account stays `onboarding_pending`. 15-min cron periodically re-checks. User can resume by re-clicking "Connect Stripe" → fresh `account_link` |
| Stripe rejects ID verification | `requirements.disabled_reason` set | Status = `restricted`. Therapist sees a banner with link to resume onboarding |
| Webhook signature invalid | `verifyStripeSignature` | 400 returned to Stripe; no DB write. Stripe retries |
| Sync race: webhook fires DURING onboarding completion | re-fetch account in handler | Live state is authoritative; webhook payload's stale `charges_enabled=false` ignored |
| Therapist updates bank | `account.updated` event | Status remains `active`; `stripe_country` may shift if account migrates |
| Cron quota exhausted | Stripe API 429 | Per-therapist try/catch; counted as `errors` in response. Next run retries |

## Files

- `iOS App/supabase/functions/create-connect-account/index.ts` — account creation + onboarding link
- `iOS App/supabase/functions/connect-redirect/index.ts` — bridge that redirects from Stripe's hosted return URL to the therapist webapp deep link (https-only requirement workaround)
- `iOS App/supabase/functions/connect-dashboard/index.ts` — generates Stripe Express dashboard login link (used when therapist clicks "Vai al cruscotto Stripe")
- `iOS App/supabase/functions/stripe-webhook/index.ts` — `account.updated` handler with re-fetch
- `therapist-webapp/src/app/api/stripe/sync-status/route.ts` — on-demand sync at therapist mount
- `therapist-webapp/src/app/api/cron/sync-stripe-status/route.ts` — 15-min cron for stragglers
- `therapist-webapp/vercel.json` — cron schedule
- `therapist-webapp/src/app/dashboard/billing/page.tsx` — UI that surfaces status + retry buttons

## Recent fixes / known issues

- **Re-fetch live account in webhook (2026-04-22).** Previously trusted the webhook payload, leaving 30%+ of post-onboarding therapists stuck at `onboarding_pending`. Adding the live re-fetch resolved the activation race entirely.
- **5-min backoff via `updated_at` bump (2026-04-30).** Earlier the 15-min cron looped infinitely on the same set of `onboarding_pending` rows whose Stripe state genuinely was still pending — every 15 min we'd re-query Stripe for nothing. Bumping `updated_at` even on no-change implements an implicit "wait at least 5 min before re-checking this row" backoff. Cuts Stripe API calls by ~80% on the cron path.
- **`x-user-token` header workaround (2026-04-12).** Some iOS code paths couldn't override the `Authorization` header set by the Supabase Edge Function gateway; the gateway auto-verifies it as a JWT and sometimes rejected legitimate calls. Routing the user JWT through `x-user-token` and reading it preferentially in the function (`index.ts:67`) was the cleanest fix.
- **Known gap:** No automatic notification when a therapist's account becomes `restricted`. They have to notice the banner on their dashboard. V1.1 to add a Brevo email + in-app notification when status flips to restricted.
- **Known gap:** Reliability tier UI doesn't show "still onboarding" — therapists in `onboarding_pending` show as "available" in the marketplace if they have a profile, but bookings against them fail at the Edge Function fee-config step. UX could be tighter.
- **Known gap:** `delay_days=14` is hardcoded. Different therapist tiers (high-reliability) might warrant shorter delays in V2.
