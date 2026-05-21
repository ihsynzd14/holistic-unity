-- ============================================================
-- Migration: tighten users RLS — relationship-based SELECT only
-- Date: 2026-04-16
-- Severity: 🔴 CRITICAL data exposure
--
-- The previous policy "Authenticated users can read other users"
-- allowed ANY authenticated user to SELECT ALL rows of public.users.
-- Since public.users holds email, phone_number, birth_date,
-- birth_time, birth_place, latitude, longitude, fcm_token, and
-- stripe_customer_id, this was a GDPR-grade data exposure.
--
-- Fix: replace with a relationship-based policy that only returns
-- another user's row when the requester shares a booking or a
-- conversation with them. This is what the app actually needs
-- (therapist viewing client's display_name + email for bookings,
-- participant viewing conversation peer's display_name).
-- ============================================================

-- Drop BOTH overly permissive variants that were found on production.
DROP POLICY IF EXISTS "Authenticated users can read other users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can read other users display info" ON public.users;

-- Keep the "own row" policy intact — it's already correct:
--   CREATE POLICY "Users can read own row" ON public.users
--     FOR SELECT USING (auth.uid() = id);
-- (verified present)

-- Add a relationship-scoped policy for reading OTHER users.
CREATE POLICY "Users can read linked users" ON public.users
FOR SELECT
USING (
  -- Therapist ↔ client booking relationship (either direction).
  EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE (b.therapist_id = users.id AND b.client_id = (SELECT auth.uid()))
       OR (b.client_id    = users.id AND b.therapist_id = (SELECT auth.uid()))
  )
  -- Conversation participant — I can see you if we're in the same convo.
  OR EXISTS (
    SELECT 1
    FROM public.conversation_participants me
    JOIN public.conversation_participants peer
      ON me.conversation_id = peer.conversation_id
    WHERE me.user_id = (SELECT auth.uid())
      AND peer.user_id = users.id
  )
);

-- Public discovery still works because:
--   - Therapist display_name + photo_url are also stored in
--     therapist_profiles (public SELECT when is_approved = true).
--   - Clients browsing therapists never query the users table
--     directly; they query therapist_profiles.
--
-- So this change affects only reads of OTHER users' rows from
-- the users table — which is legitimately scoped to people you
-- have a booking or chat with.
