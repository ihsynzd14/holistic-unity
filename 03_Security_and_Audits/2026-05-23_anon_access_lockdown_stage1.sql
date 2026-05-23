-- ════════════════════════════════════════════════════════════
-- SECURITY FIX 2026-05-23 — Stage 1: lockdown anon access (partial)
--
-- Findings from anon-access audit 2026-05-22 (live curl tests
-- against bqyqkvkzkemiwyqjkbna production with the public anon key):
--
--   LEAK #2: stripe_webhook_events readable by anon — leaks
--            payment volume/timing intelligence + Stripe event IDs.
--            Pure operational table, no user-facing consumer.
--
--   LEAK #3: reviews.client_id (raw UUID) exposed to anon. The
--            client_name + client_photo_url are denormalized on
--            purpose for marketplace display; the raw client UUID
--            is NOT needed by any anon-facing UI and combined
--            with other tables enables user→therapist profiling.
--
-- NOT INCLUDED here (deliberate, decision pending):
--   LEAK #1: user_display_info exposes all users (clients +
--            therapists) to anon. Requires creating a separate
--            therapist_display_info view + refactor of any
--            anon-context consumer. To be addressed separately.
--
-- Approach: granular column-level GRANT, non-destructive (no
-- DROP, no DDL on existing tables). Mirrors the pattern of
-- 2026-05-18_critical_security_fixes.sql.
-- ════════════════════════════════════════════════════════════


-- ─── FIX #2: stripe_webhook_events — admin-only ──────────────
-- No client app (iOS, client-webapp, therapist-webapp) queries
-- this table from the browser or via anon key. It's written by
-- the stripe-webhook edge function (service-role) and consumed
-- by admin-dashboard for debugging. Anon has no business here.
REVOKE SELECT ON public.stripe_webhook_events FROM anon;


-- ─── FIX #3: reviews — hide client_id, keep client_name ──────
-- Marketplace shows "Test Client QA ⭐⭐⭐⭐⭐" using the
-- denormalized client_name / client_photo_url columns. The raw
-- client_id UUID is only needed by authenticated flows (e.g.
-- the therapist replying to a review, which goes through a
-- route handler with user JWT, not anon). Hiding it from anon
-- prevents UUID-based profiling.
REVOKE SELECT ON public.reviews FROM anon;
GRANT SELECT (
  id,
  booking_id,
  therapist_id,
  client_name,
  client_photo_url,
  rating,
  text,
  therapist_reply,
  therapist_reply_date,
  is_flagged,
  created_at
) ON public.reviews TO anon;
