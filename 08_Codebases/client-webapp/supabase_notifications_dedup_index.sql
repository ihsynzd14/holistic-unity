-- ─────────────────────────────────────────────────────────────────────────
-- Atomic idempotency for booking-related notifications.
--
-- Both webhook handlers — Vercel `/api/webhooks/stripe` (case
-- `checkout.session.completed`) and Supabase Edge Function `stripe-webhook`
-- (case `payment_intent.succeeded`) — insert in-app `notifications` rows
-- after a successful booking payment. They each run a SELECT pre-check
-- on `(booking_id, user_id, type)` before the INSERT, but a SELECT
-- followed by an INSERT is NOT atomic — two concurrent handlers can both
-- read "no row exists" and then both insert, producing duplicates.
--
-- This partial unique index closes that TOCTOU window at the DB level:
-- the second INSERT raises 23505 (unique_violation), which the handler
-- already logs as a non-blocking warning. The "winning" row (the one
-- inserted first) is preserved.
--
-- Why partial (WHERE booking_id IS NOT NULL):
--   The notifications table also stores message-type and system-type
--   rows that have NO booking_id (they reference conversations or are
--   global). A full unique index would either reject those (broken) or
--   require including a non-NULL placeholder column.
--
-- Pre-flight check before applying:
--   SELECT booking_id, user_id, type, COUNT(*) FROM public.notifications
--   WHERE booking_id IS NOT NULL
--   GROUP BY booking_id, user_id, type HAVING COUNT(*) > 1;
--   → Should return zero rows. If not, dedup before applying:
--     DELETE FROM public.notifications a USING public.notifications b
--     WHERE a.booking_id = b.booking_id AND a.user_id = b.user_id
--       AND a.type = b.type AND a.id::text > b.id::text;
--
-- Apply once via Supabase dashboard → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

create unique index if not exists notifications_booking_user_type_unique
  on public.notifications (booking_id, user_id, type)
  where booking_id is not null;

comment on index public.notifications_booking_user_type_unique is
  'Atomic idempotency for booking-related notifications. The Vercel + Edge Function webhook handlers both insert booking_confirmed rows for the same booking; the partial unique index guarantees at most one row per (booking_id, user_id, type) regardless of TOCTOU race windows. Partial (WHERE booking_id IS NOT NULL) so message/system notifications without a booking are unaffected.';
