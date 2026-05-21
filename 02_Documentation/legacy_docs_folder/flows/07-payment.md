# 07 — Payment (Stripe Connect, Fees, Payout)

**Last verified:** 2026-05-04 (mirror fee-config sync + Art. 9 consent gate added)
**Status:** ✅ Production
**Owner:** Marcello

> **Source of truth for fee math:** `client-webapp/src/lib/payments/fee-config.ts` and its mirror `supabase/functions/_shared/fee-config.ts` (mirror was stale until 2026-05-04 — used reverse-gross-up `ceil((price+30)/(1-0.029))` which produced a 1–9¢ drift; now linear-additive matching the canonical). Anything in this doc that contradicts those two files is wrong — fix the doc.

> **GDPR Art. 9 gate (added 2026-05-04):** booking creation on BOTH surfaces (iOS Edge Function `create-booking-with-payment` + Vercel route `/api/checkout/create`) requires `tos_acceptances_latest.health_data_accept = TRUE` for the calling client. HTTP 412 with `error: "health_data_consent_required"` if missing/revoked. Pre-migration users with NULL are blocked until they re-consent — see `PLATFORM_MAP.md §9 action items`.

## Purpose

Accept card payments from clients, route the therapist's share to their connected Stripe account at charge time via destination charges (`application_fee_amount` + `transfer_data.destination`), hold funds for 14 days for chargeback protection, and write a single canonical `transactions` row that downstream features (earnings dashboard, monthly fattura cron, refund flow) read from.

## Two payment surfaces, one fee model

| Surface | Path | Method | Webhook handler |
|---|---|---|---|
| iOS App | `BookingFlowView.swift` → Edge Function `create-booking-with-payment` | PaymentSheet (PaymentIntent) | Edge Function `stripe-webhook` (`payment_intent.succeeded`) |
| client-webapp | `/api/checkout/create` → Stripe Checkout Session | Hosted Checkout page | Vercel route `/api/webhooks/stripe` (`checkout.session.completed`) |

Both surfaces:
- Set the same `metadata` keys on the PaymentIntent (booking_id, client_id, therapist_id, session_price, commission_base, iva_amount, iva_applied, service_fee, therapist_country, fee_region, total_charged)
- Use the same fee math (computed from `calculatePaymentAmounts(sessionPriceCents, country)`)
- Use the same `stripe_payment_intent_id` UNIQUE constraint on `transactions` for dedup

Both webhook handlers can fire on the SAME web payment (Stripe sends `payment_intent.succeeded` to the Edge Function regardless of source). The race is resolved via the **INSERT-then-UPDATE pattern** (see "Webhook v2 race protection" below).

## Preconditions

- `therapist_profiles.stripe_connected_account_id` exists, `stripe_account_status = 'active'`, and `payouts_enabled = true`
- `therapist_profiles.country` is set (drives `feeRegion` → IVA / reverse-charge / scope-out)
- `therapist_profiles.currency` is set to `'eur'` (DB default was historically `'usd'` — fixed 2026-05-03; 2 therapist rows were backfilled)
- Server env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`
- iOS xcconfig: `STRIPE_PUBLISHABLE_KEY`

## Fee computation (canonical in `fee-config.ts`)

```
PLATFORM_FEE_PERCENT  = 0.20   // 20% of session price (commission)
IVA_RATE              = 0.22   // 22% Italian VAT, applied ONLY when therapist.country = IT
SERVICE_FEE_PERCENT   = 0.029  // 2.9%, passed through to client
SERVICE_FEE_FIXED     = 30     // €0.30 (in cents), passed through to client
```

For a session price `S` (cents) and therapist country code `cc`:

```
platformFee       = round(S × 0.20)
                  // For IT: this 20% INCLUDES IVA. We split it for accounting:
                  //   platformFeeNet = round(platformFee / 1.22)
                  //   ivaAmount      = platformFee − platformFeeNet
                  // For EU/UK: reverse charge — no IVA charged, recipient self-accounts
                  // For US/ROW: out of scope of Italian VAT
serviceFee        = round(S × 0.029) + 30
totalCharged      = S + serviceFee                       // what client pays
applicationFee    = platformFee + serviceFee             // what platform retains
therapistPayout   = totalCharged − applicationFee        // = S − platformFee = 80% of S, always
```

**Invariant**: the therapist always receives exactly 80% of their listed price, regardless of country. The service fee is borne by the client, not the therapist.

`feeRegion` mapping (drives invoice note + IVA logic):

| Country | feeRegion | IVA applied? | VAT mechanism | Note on commission invoice |
|---|---|---|---|---|
| IT, ITALY, ITALIA | `IT` | ✅ 22% | iva_inclusa | "Commissione 20% IVA inclusa ai sensi del DPR 633/72" |
| EU + EEA (27+3) | `EU` | ❌ | reverse_charge | Art. 44 Directive 2006/112/CE — recipient accounts for VAT |
| GB, UK | `UK` | ❌ | reverse_charge | Outside scope Italian VAT — recipient accounts for UK VAT |
| US | `US` | ❌ | none | Out of scope, no US federal VAT |
| Anything else | `ROW` | ❌ | none | Out of scope Italian VAT |

## PaymentIntent / Checkout creation

iOS surface (Edge Function `create-booking-with-payment`):

```ts
stripe.paymentIntents.create({
  amount: totalChargedCents,
  currency: therapist.currency || "eur",   // hard fallback to 'eur' since 2026-05-03
  application_fee_amount: applicationFeeCents,
  transfer_data: { destination: therapist.stripe_connected_account_id },
  metadata: {
    booking_id, client_id, therapist_id, connected_account_id,
    service_id, service_name, fee_region,
    session_price, commission_base, iva_amount, iva_applied,
    service_fee, therapist_country, total_charged,
    pack_sessions_remaining,
  },
}, { idempotencyKey: `pi-${bookingId}` })
```

client-webapp surface (route `/api/checkout/create`):
- Creates a Stripe Checkout Session (mode=payment) with the same `metadata` and `payment_intent_data.application_fee_amount` + `payment_intent_data.transfer_data.destination`
- Booking starts in `pending_payment` status; Stripe Checkout has 24h expiry
- On `checkout.session.expired` we flip booking to `cancelled` (slot is freed)

## Stripe Checkout session lifetime

Sessions are created with **`expires_at = now() + 30 min`** (since 2026-05-04). Stripe's default is 24 hours; the override aligns Stripe's lifecycle with our `cleanup-pending-payment` cron. A payment cannot land more than 30 minutes after session creation. The cron's 35-minute cutoff (5-minute buffer beyond Stripe expiry) is the second safety layer; the webhook's `cancelled-but-paid` branch (next section) is the third.

### Cancelled-but-paid auto-refund (defensive third layer)

Race window: a payment that completes seconds before Stripe expiry could land in our webhook AFTER the cleanup cron has already flipped the booking to `cancelled`. The slot may already be re-booked by another client, so we cannot "uncancel". Fix at `client-webapp/src/app/api/webhooks/stripe/route.ts` (after `paymentIntentId` extraction):

```ts
if (booking.status === "cancelled" && paymentIntentId) {
  await stripe.refunds.create({
    payment_intent: paymentIntentId,
    reverse_transfer: true,
    refund_application_fee: true,
    metadata: { booking_id, reason: "cancelled_but_paid_race" },
  });
  Sentry.captureMessage("stripe_webhook.cancelled_but_paid_auto_refund", { level: "warning", ... });
  return; // do NOT confirm, do NOT insert transaction, do NOT email
}
```

Stripe's idempotency on refunds + our `stripe_webhook_events` PRIMARY KEY claim means a webhook retry won't double-refund. The Sentry alert is `warning` (not `error`) because the auto-refund recovers the situation gracefully — admin only needs to know it happened, not to act.

## Webhook v2 race protection

Two handlers can both receive `payment_intent.succeeded` for a web checkout. The Edge Function reads fee data from `paymentIntent.metadata` (correctly populated by both surfaces since 2026-04-27), but only the Vercel route has access to the canonical `fee-config.ts` for re-derivation if metadata is ever missing.

**1. Event-level dedup** — `stripe_webhook_events` table with `event_id` PRIMARY KEY:

```ts
await supabase.from("stripe_webhook_events")
  .insert({ event_id: event.id, event_type: event.type });
// On 23505 (unique violation): another delivery already processed → return 200, skip handler.
```

**2. Booking flip with optimistic lock** — UPDATE with `WHERE status='pending_payment'`:

```ts
const { data: lockedUpdate } = await supabase
  .from("bookings")
  .update({ status: "confirmed", stripe_payment_intent_id, video_room_id })
  .eq("id", booking.id)
  .eq("status", "pending_payment")
  .select("id").maybeSingle();
const alreadyProcessed = !lockedUpdate;
```

If `lockedUpdate` is null, the OTHER handler beat us. We still backfill the transactions row (next step) but skip notification sends to avoid duplicate emails.

**3. Transaction INSERT-then-UPDATE** — partial unique index defeats `.upsert()`, so we do it manually:

```ts
const { error } = await supabase.from("transactions").insert(txValues);
if (error?.code === "23505") {
  // Edge Function inserted first — overwrite with our canonical fee values.
  await supabase.from("transactions").update(txValues).eq("booking_id", booking.id);
}
```

Why we always overwrite: the Edge Function ran with metadata that may be partial (older iOS versions); the Vercel route always has the full canonical calc from `calculatePaymentAmounts`.

**4. Notification gate** — only the winner of step 2 sends notifications, so users get exactly one Brevo email and one in-app `notifications` row.

## Payout (escrow + ledger flip)

- Stripe destination charges move the therapist's share to their connected account **at charge time** (no separate `Transfer` is created)
- Stripe holds those funds in `pending` for 14 days at the connected-account level (`delay_days=14` configured at Connect onboarding) — chargeback safety window
- `transactions.payout_after = now() + 14 days` is set when the row is inserted
- Edge Function `process-pending-payouts` runs daily at 05:00 UTC (pg_cron job 11), authenticated via `CRON_SECRET` or service-role key — flips `payout_status: pending → paid` for transactions where `status='completed' AND payout_after <= now()`. **It does NOT call Stripe Transfers** — funds are already with the therapist; this is just an internal ledger flip
- After Stripe's escrow elapses, the therapist's actual bank deposit happens on the next scheduled payout (weekly Friday for our UK platform)

## Invariants

- `totalCharged = S + serviceFee` — always
- `therapistPayout + applicationFee = totalCharged` — always
- `therapistPayout = 0.80 × S` — exact for any country (rounding handled at cents)
- `transactions.stripe_payment_intent_id` UNIQUE → no double-insert
- `stripe_webhook_events.event_id` PRIMARY KEY → at-most-once webhook handling
- For IT therapists: `iva_amount = platformFee − round(platformFee / 1.22)`, `iva_applied = true`
- For EU/UK therapists: `iva_amount = 0`, `iva_applied = false`, but `requires_vat_number = true` (enforced by VAT validation flow `23-vat-validation.md`)
- The therapist NEVER has access to `application_fee_amount` — Stripe deducts it before crediting the connected account

## State transitions

```
booking.status:
  pending_payment  → confirmed     (on payment_intent.succeeded; race-resolved)
  pending_payment  → cancelled     (on checkout.session.expired OR timeout)
  confirmed        → cancelled     (manual cancel paths — see 08-refund-cancellation.md)

transaction.status:
  (inserted as) completed   ← only on successful charge
  completed → refunded             (on full refund)
  completed → partially_refunded   (on partial refund — only via 50% mid-tier)

transaction.payout_status:
  pending → paid     (process-pending-payouts cron, after 14d escrow)
  pending → refunded (on refund within escrow window — see 08)
  paid    → refunded (on refund after escrow — uses Stripe reverse_transfer)
```

## Error paths

| Error | Where | Behavior |
|---|---|---|
| Therapist Connect not active | Edge Function pre-check (line 207) | 400, client told to contact support |
| Currency mismatch (Connect account currency ≠ requested) | Edge Function (line 252) | 400 "Unsupported currency" |
| Price tampered on client | Edge Function (validates `body.amount` against `service.price`) | 400 |
| Webhook signature invalid | Stripe SDK `constructEvent` throws | 400 returned, no DB write |
| Idempotency-key replay | Stripe deduplicates server-side | Same PaymentIntent returned, no double charge |
| Card declined | Stripe during PaymentSheet confirm | No DB rows; iOS shows Stripe error toast |
| Edge Function inserts wrong fees, Vercel webhook fixes | INSERT-then-UPDATE | Final row has Vercel canonical values |
| Webhook delivery delayed >10min | n/a, async retry | iOS polls `bookings` table; eventually settles to `confirmed` |
| `transactions` write fails post-confirm | Sentry capture (line 312) | Booking is confirmed but no financial row → admin must backfill |

## Promo codes — still NOT active in V1

`BookingFlowView.swift:142` (current build) calls an Edge Function named `validate-promo` that **does not exist** on the server (the deployed list is: check-dormant-users, create-booking-with-payment, create-connect-account, create-payment-intent, process-pending-payouts, request-refund, send-brevo-email, send-push-notification, send-session-reminders, stripe-webhook). The fetch fails silently → `promoDiscount` stays at 0. The UI shows a promo input field but no code can ever apply.

When V1.1 lights this up, the Edge Function should:
1. Look up the code in a `promo_codes` table (with usage caps + expiry)
2. Return an HMAC-signed `{discount_cents, expires_at}` payload using a server-side secret
3. `create-booking-with-payment` verifies the HMAC and applies the discount BEFORE computing `serviceFee` and `applicationFee`
4. NEVER trust client-sent `body.discount` — that's the whole point

Until then: leave the field hidden in iOS, or rip the field out of the UI. Right now it's a confusing dead end.

## Test checklist

- [ ] IT therapist, €80 session → client pays €80 + 0.029×80 + €0.30 = €82.62; therapist nets €64.00; platform commission €16.00 (of which net €13.11 + IVA €2.89); service fee €2.62
- [ ] EU therapist (DE), €80 session → client pays €82.62; therapist nets €64.00; platform commission €16.00 (no IVA, reverse_charge note); service fee €2.62
- [ ] UK therapist (GB), €80 session → same client total; commission invoice notes "outside scope Italian VAT, reverse charge to UK"
- [ ] US therapist, €80 session → same client total; commission invoice notes "out of scope, no US federal VAT"
- [ ] Pack 4×€68 → client pays €272 × (1 + 0.029) + €0.30 = €280.19; therapist nets €217.60; service fee €8.19
- [ ] Card declined → no `transactions` row, booking stays `pending_payment`
- [ ] Replay same webhook → `stripe_webhook_events` rejects with 23505, Vercel returns `{deduplicated: true}`
- [ ] Race iOS Edge Function vs Vercel route → exactly one notification email per party, transactions row has Vercel canonical values
- [ ] Currency edge: therapist row with `currency = NULL` → falls back to `'eur'` (no longer to `'usd'`)
- [ ] After 14 days → `process-pending-payouts` flips `payout_status` to `paid` (run manually: `select cron.schedule('payout-test', '* * * * *', $$select net.http_post(...)$$)` to validate)

## Related

- `05-booking-single.md`, `06-booking-pack.md` (upstream — how booking row is created and reaches `pending_payment`)
- `08-refund-cancellation.md` (downstream — 3-tier refund + reverse_transfer)
- `16-fattura-monthly.md` (downstream — monthly commission invoice cron, post bug-fix sprint of 2026-05-03)
- `17-stripe-connect-onboarding.md` (precondition — how `stripe_connected_account_id` gets set)
- `21-webhooks.md` (cross-cutting — full webhook architecture, both surfaces, idempotency table)
- `23-vat-validation.md` (precondition — VIES/HMRC for EU/UK therapists)
- `client-webapp/src/lib/payments/fee-config.ts` (canonical fee math)

## Known gaps

- **Promo codes still dead** (see above). Either ship `validate-promo` or remove the UI field.
- **No 3DS opt-in beyond Stripe defaults.** Some EU markets require explicit 3DS; we rely on Stripe's automatic risk handling.
- **Pack payout split is front-loaded.** All 4/6/8/10 sessions of a pack are paid in one PaymentIntent at booking. The therapist gets the full 80% on day 0 even though they deliver sessions over weeks. If a client cancels mid-pack, the refund math has to claw back from already-paid sessions (see `06-booking-pack.md` and `08-refund-cancellation.md`).
- **No client-side invoice PDF.** Client only gets Stripe's transactional receipt email. We don't generate an Italian "ricevuta" for B2C clients (we are not the seller of the therapist's service — the therapist is — but B2C consumers in IT may expect one).
- **Per-therapist cancellation policies not exposed.** `therapist_profiles.cancellation_policy` column exists but the refund flow uses the global 48h/24h/0 tiers regardless. V1.1 candidate.
- **Currency lock to EUR.** A therapist with Connect account in GBP/USD would fail at `create-booking-with-payment` line 252 ("Unsupported currency"). All current therapists are EUR; revisit when expanding markets.
