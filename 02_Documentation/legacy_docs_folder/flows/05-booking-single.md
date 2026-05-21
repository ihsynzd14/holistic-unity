# 05 — Booking Single Session

**Last verified:** 2026-04-16 by Marcello (cross-reference note added 2026-05-04)
**Status:** ✅ Production
**Owner:** Marcello

> **Note on currency of this doc:** last fully audited 2026-04-16 and iOS-heavy in places. The canonical references for the **web checkout** flow (which is what most clients use) are `07-payment.md` (fee math + Stripe Checkout `expires_at` + cancelled-but-paid branch) and `21-webhooks.md` (race protection across Vercel + Edge Function). When this doc and 07/21 disagree, 07/21 win — the web checkout has been the active surface since the iOS app gated payments through PaymentSheet. Full web-focused rewrite of this doc is V1.1.

## Purpose

Client books a single paid session: picks service, slot, pays via Stripe, receives confirmation. For pack purchases see `06-booking-pack.md`. For free intro calls, the flow is identical minus the payment step.

## Preconditions

- Client authenticated, has completed onboarding
- Therapist `is_approved = true`, `stripe_account_status = active`
- Service `is_active = true`
- Requested slot is within therapist availability and not blocked by Google/Outlook calendar

## Happy path

Entry: `Features/Booking/BookingFlowView.swift:57` `init(therapist:,currentUserId:)`.

### Step 1 — Select service
- ViewModel caches `selectedService`
- At `BookingFlowView.swift:224` `checkForExistingCredits()` determines if user should see pack / credit option. For a pack-enabled service the user can choose `.single` / `.pack` / `.useCredit`
- For a non-pack service, default `.single`

### Step 2 — Select date & slot
- `fetchAvailableSlots(for: selectedDate)` calls edge function `get-available-slots` at `supabase/functions/get-available-slots/index.ts`
- The edge function computes slots from `availability` JSONB + subtracts Google Calendar `freeBusy` + Outlook `freeBusy` (if connected)
- **No local fallback** — on network error, user sees error (`BookingFlowView.swift` error path) — prevents showing slots that conflict with external calendars
- `effectiveBasePrice` computed at `BookingFlowView.swift:194-207`:
  - `.single` → `service.price`
  - `.pack` → `service.packPrice!` (per-session)
  - `.useCredit` → 0

### Step 3 — Confirm + pay
- User taps "Book" → `createBookingWithPayment()` at `BookingFlowView.swift:336-406`
- Atomic edge function `create-booking-with-payment` at `supabase/functions/create-booking-with-payment/index.ts`:
  1. Validates service exists + is active + belongs to therapist
  2. Validates `body.price` matches service (accepts single OR pack price)
  3. Computes `totalCharged`, `platformFee`, `processingFee`, `therapistPayout`, `ivaAmount` (see `07-payment.md`)
  4. Creates PaymentIntent with idempotency key `pi-${bookingId}`, application_fee_amount, transfer_data.destination = therapist Stripe account
  5. Inserts `bookings` row + returns `client_secret` + bookingId
- iOS confirms PaymentIntent via Stripe Payment Sheet
- Webhook `payment_intent.succeeded` fires on Stripe side → `stripe-webhook/index.ts:232` inserts/updates `transactions` row + updates `bookings.status = confirmed`

### Step 4 — Calendar auto-event
- `stripe-webhook/index.ts` calls `syncBookingToCalendar()` after booking confirmation
- POSTs event to Google Calendar or Microsoft Graph (whichever provider is connected)
- Non-blocking: errors logged, don't fail the webhook

### Step 5 — User sees confirmed booking
- iOS `SessionsView` and therapist dashboard `/dashboard/bookings` both show the new booking
- Push notifications to both parties (via `PushNotificationService`)

## Invariants

- `booking.price >= 0` (CHECK constraint)
- `transactions.stripe_payment_intent_id` is UNIQUE (partial index, migration `20260414_unique_stripe_payment_intent`)
- Idempotency: retrying the same `createBookingWithPayment` never creates 2 PaymentIntents (key = `pi-${bookingId}`)
- Two users can NOT book the same slot: DB overlap guard `bookings_overlap_guard` trigger from migration `20260414_booking_overlap_guard`
- `booking.therapist_payout` is pre-computed at booking time so refunds have a fixed reference

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Stripe decline | Step 3 PaymentIntent confirm | Booking row NOT created (edge function rolled back); iOS shows Stripe's error message |
| Slot taken while paying | Step 3 DB insert | 409 from overlap guard; iOS refetches slots, prompts user to pick again |
| Price mismatch | Step 3 edge function validation | 400 error, iOS surfaces "Price changed, please refresh" |
| Webhook delayed | Step 4 | Booking remains `pending` up to 10min; iOS polls `getTransactionForBooking` at `SupabasePaymentRepository.swift:38-65` |
| Calendar event creation fails | Step 4 | Logged only; booking is still valid, therapist just won't see it in external calendar |

## Test checklist

- [ ] Book with test card `4242 4242 4242 4242` → transaction `completed`, booking `confirmed`
- [ ] Book with declined card `4000 0000 0000 0002` → no booking created, no orphan transaction
- [ ] Book intro call (price = 0) → no PaymentIntent, booking created directly
- [ ] Book after tampering price in client (`price: 1` but service is €80) → edge function rejects
- [ ] Book with network flap during confirm → no double charge (idempotency)
- [ ] Two clients race-book same slot → exactly one succeeds
- [ ] Booking appears in therapist Google Calendar within 1 minute

## Related

- `06-booking-pack.md` (pack variant)
- `07-payment.md` (fee math, Stripe Connect)
- `08-refund-cancellation.md` (cancel/refund path)
- `10-calendar-sync.md` (auto-event creation)

## Known gaps

- No "waitlist" if slot becomes available after user closed flow
- Client can't change timezone for booking (uses therapist's timezone always)
- Duration change mid-flow isn't supported (must restart if service duration differs)
