# 07 — Payment (Stripe Connect, Fees, Payout)

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Production
**Owner:** Marcello

> **Source of truth:** `../PAYMENT_MODEL.md` (v3.0). This doc is the operational summary with file:line refs.

## Purpose

Accept card payments from clients, route money to therapists via Stripe Connect (Destination Charges with `application_fee_amount`), hold funds for 14 days (`delay_days`), and record everything in `transactions` table.

## Preconditions

- Therapist `stripe_connected_account_id` exists and `stripe_account_status = active`
- `STRIPE_SECRET_KEY` (platform), `STRIPE_WEBHOOK_SECRET` set in Supabase function secrets
- `STRIPE_PUBLISHABLE_KEY` in iOS xcconfig

## Happy path

### Fee computation (at `supabase/functions/create-booking-with-payment/index.ts`)

Inputs: `servicePrice` (single or pack total), `therapistCountry`.

```
PLATFORM_COMMISSION_PCT = 0.20   // 20% IVA-included
STRIPE_PERCENT           = 0.029 // 2.9% — used uniformly across markets
STRIPE_FIXED_CENTS       = 30    // €0.30

processingFee   = round(servicePrice * STRIPE_PERCENT + STRIPE_FIXED_CENTS)
totalCharged    = servicePrice + processingFee                // client pays this
platformFee     = round(servicePrice * PLATFORM_COMMISSION_PCT)
therapistPayout = servicePrice - platformFee                  // goes to therapist Connect account
ivaAmount       = (therapistCountry == "IT")
                ? platformFee - round(platformFee / 1.22)     // 22% IVA quota
                : 0
```

### PaymentIntent creation

```
stripe.paymentIntents.create({
  amount: totalCharged,
  currency: "eur",
  application_fee_amount: platformFee + processingFee,
  transfer_data: { destination: therapist.stripe_connected_account_id },
  metadata: { booking_id, client_id, therapist_id, iva_amount, platform_fee, processing_fee, therapist_payout, pack_sessions },
}, { idempotencyKey: `pi-${bookingId}` })
```

### Webhook (`stripe-webhook/index.ts:232`)

On `payment_intent.succeeded`:
1. Verifies Stripe signature with `STRIPE_WEBHOOK_SECRET` (line ~20)
2. Inserts `transactions` row with all fee breakdown columns
3. UNIQUE constraint on `stripe_payment_intent_id` prevents duplicates
4. Updates `booking.status = confirmed`
5. Creates `session_credits` if pack (line 286-309)
6. Syncs to Google/Outlook calendar (`syncBookingToCalendar`)

### Payout

- Platform holds funds for 14 days (`delay_days` set on Connect account)
- After 14 days, Stripe auto-transfers `therapistPayout` to therapist's bank
- Refunds within the 14-day window pull back from pending funds (no claw-back needed)

## Invariants

- `totalCharged = servicePrice + processingFee` — always, whether single or pack
- `therapistPayout + platformFee = servicePrice` — always
- `transactions.stripe_payment_intent_id` UNIQUE → no double-insert webhooks
- `application_fee_amount` is captured in one step; therapist NEVER has access to platform commission
- For Italian therapists: IVA quota (22% of commission) is stored for bookkeeping; NOT charged to client
- Idempotency: same bookingId → same idempotency key → Stripe returns same PaymentIntent

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Therapist Connect not active | Edge function pre-check | 400 error, client told to contact support |
| Price tampered on client | Edge function validation (accepts single OR pack price) | 400 error |
| Idempotency collision (same booking retried quickly) | Stripe returns same intent | No double charge; client sees existing intent |
| Webhook signature invalid | Line ~20 | 400 returned to Stripe, no DB write |
| Webhook delivery delayed | Async | Booking `pending` for up to 10min; iOS polls; eventually settles |
| Card declined | Stripe during confirm | No DB rows written; iOS shows Stripe error |

## Test checklist

- [ ] Single service €80 → client pays €82.62 (80 + 2.9%*80 + 0.30 = 82.62 rounded), therapist gets €64, platform gets €16 commission + €2.62 Stripe fee pass-through
- [ ] Pack 4×€68 → client pays €272 + processing fee ≈ €280.19, therapist gets €217.60 over 4 sessions
- [ ] Book with declined card → transactions row NOT created
- [ ] Replay webhook manually → second attempt ignored (UNIQUE constraint)
- [ ] Check Stripe dashboard 14 days after → funds released to therapist connected account

## Related

- `05-booking-single.md` + `06-booking-pack.md` (upstream flows)
- `08-refund-cancellation.md` (refund math)
- `platform/security.md` (webhook signature, secret rotation)
- `../PAYMENT_MODEL.md` (v3.1 full math with examples)

## Known gaps

- **Promo codes: not active in V1.** `BookingFlowView.swift:161` calls an edge function named `validate-promo` that does not exist on the server — requests fail silently and `promoDiscount` stays `0`. UI shows a promo field but no code will ever apply. When V1.1 lights this up, the server should return an HMAC-signed discount that `create-booking-with-payment` can verify (don't trust client-sent `body.discount`).
- Stripe fee charged to the client is a flat 2.9% + €0.30 across all markets (matches the rate shown in the therapist Earnings UI). Stripe's actual cost to the platform may be slightly different per region (eg. SEPA vs card-not-present); the difference is absorbed by the platform.
- Payout is NOT immediate. `transfer_data.destination` routes funds to the therapist Connect account at charge time, but Stripe holds them `pending` for **14 days** (`delay_days=14`) before making them available for bank payout. A therapist who expects same-day money will be surprised — surface this in onboarding UX.
- No 3DS enforcement beyond Stripe's default (some EU markets require explicit opt-in).
- Payout split across pack sessions is front-loaded on first booking (see `06-booking-pack.md` Known gaps).
- No invoice PDF generated for client — only transaction email from Stripe.
- Refund policy is global (48h/24h/0) — per-therapist cancellation policy is not exposed V1 even though the `therapist_profiles.cancellation_policy` column exists.
