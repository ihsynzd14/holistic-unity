-- C7: Prevent duplicate transactions from concurrent Stripe webhook events.
-- The stripe-webhook edge function checks for existing rows before insert,
-- but under simultaneous delivery both reads see "no row" and both insert.
-- This partial UNIQUE index makes the second insert fail with a constraint
-- violation instead of silently creating a duplicate transaction.
-- Partial because credit-based bookings have NULL stripe_payment_intent_id.

DROP INDEX IF EXISTS idx_transactions_payment_intent;

CREATE UNIQUE INDEX uq_transactions_stripe_payment_intent_id
  ON public.transactions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
