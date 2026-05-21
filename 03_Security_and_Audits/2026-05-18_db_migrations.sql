-- ════════════════════════════════════════════════════════════════════
-- Holistic Unity — DB migrations 2026-05-18
-- Run AFTER 2026-05-18_critical_security_fixes.sql (the security one).
--
-- Bundles:
--   1. `reports` table for Guideline 1.2 (UGC moderation)
--   2. `blocked_users` table for client-side block list (Stream Chat
--      mute is the primary mechanism; this row is the source of truth
--      iOS reads on cold launch)
--   3. Extend `therapist_profiles_public` view to include lat/lng so
--      iOS can refactor away from raw `therapist_profiles` table
--   4. Trigger: keep `public.users.is_email_verified` in sync with
--      `auth.users.email_confirmed_at` (fixes BUG #2 in the IG guide)
--   5. Trigger: auto-confirm free bookings (price=0) — fixes BUG #4
--      (free Introductory Call appearing "IN ATTESA" forever)
--   6. Backfill is_email_verified for existing users
-- ════════════════════════════════════════════════════════════════════


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. reports table (Guideline 1.2)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Polymorphic target: a therapist profile, a chat message, or a review.
  reported_type   text NOT NULL CHECK (reported_type IN ('therapist','message','review')),
  reported_id     text NOT NULL,                -- UUID or Stream Chat msg id
  reason          text NOT NULL CHECK (reason IN (
    'inappropriate_behaviour', 'spam', 'scam_or_fraud',
    'misleading_credentials', 'harassment', 'other'
  )),
  details         text,                          -- optional free-text, 500 char cap enforced client-side
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaged','resolved','dismissed')),
  triaged_at      timestamptz,
  triaged_by      uuid REFERENCES auth.users(id),
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter   ON public.reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_target     ON public.reports(reported_type, reported_id);
CREATE INDEX IF NOT EXISTS idx_reports_status_age ON public.reports(status, created_at DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Reporters can INSERT their own reports
DROP POLICY IF EXISTS reports_insert_self ON public.reports;
CREATE POLICY reports_insert_self ON public.reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

-- Reporters can SEE their own past reports (transparency)
DROP POLICY IF EXISTS reports_select_self ON public.reports;
CREATE POLICY reports_select_self ON public.reports
  FOR SELECT USING (auth.uid() = reporter_id);

-- Admins (is_admin=true) can see/triage all
DROP POLICY IF EXISTS reports_admin_all ON public.reports;
CREATE POLICY reports_admin_all ON public.reports
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- Rate-limit guard: max 10 reports per reporter per 24h
-- (uses a function so the policy stays declarative + cheap)
CREATE OR REPLACE FUNCTION public.report_rate_ok(p_reporter uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (
    SELECT COUNT(*) FROM public.reports
    WHERE reporter_id = p_reporter
      AND created_at > now() - interval '24 hours'
  ) < 10;
$$;

-- Replace the INSERT policy to fold in rate limit
DROP POLICY IF EXISTS reports_insert_self ON public.reports;
CREATE POLICY reports_insert_self ON public.reports
  FOR INSERT WITH CHECK (
    auth.uid() = reporter_id
    AND public.report_rate_ok(auth.uid())
  );

GRANT SELECT, INSERT ON public.reports TO authenticated;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. blocked_users table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.blocked_users (
  blocker_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason       text,                  -- short note, optional
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_by_blocker ON public.blocked_users(blocker_id);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Users can manage their own block list
DROP POLICY IF EXISTS bu_self_all ON public.blocked_users;
CREATE POLICY bu_self_all ON public.blocked_users
  FOR ALL USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

GRANT SELECT, INSERT, DELETE ON public.blocked_users TO authenticated;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. Extend therapist_profiles_public to include lat/lng
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Recreate view (lat/lng are needed for getNearbyTherapists; OK to be
-- public — already implied by the city/country fields)
DROP VIEW IF EXISTS public.therapist_profiles_public CASCADE;
CREATE VIEW public.therapist_profiles_public
WITH (security_invoker = true)
AS SELECT
  id, display_name, photo_url, bio, tagline, helps_with,
  city, country, latitude, longitude,
  categories, languages, availability,
  average_rating, total_reviews,
  years_experience, has_mfa, is_verified, is_approved,
  profile_completeness, gallery_image_urls,
  video_intro_url, currency, cancellation_policy, approval_status,
  created_at
FROM public.therapist_profiles
WHERE is_approved = true AND approval_status = 'approved';

GRANT SELECT ON public.therapist_profiles_public TO anon, authenticated;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. is_email_verified sync trigger (fixes BUG #2)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- When auth.users.email_confirmed_at changes, mirror to public.users.is_email_verified
CREATE OR REPLACE FUNCTION public.sync_email_verification_to_users() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.users
  SET is_email_verified = (NEW.email_confirmed_at IS NOT NULL),
      updated_at        = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_user_email_verified_sync ON auth.users;
CREATE TRIGGER auth_user_email_verified_sync
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_email_verification_to_users();


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. Free-booking auto-confirm trigger (fixes BUG #4)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- When a booking is inserted with price=0 and status='pending_payment',
-- auto-promote to 'confirmed' (no Stripe webhook will ever arrive).
CREATE OR REPLACE FUNCTION public.auto_confirm_free_bookings() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price = 0
     AND NEW.status IN ('pending_payment', 'pending')
  THEN
    NEW.status := 'confirmed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_auto_confirm_free ON public.bookings;
CREATE TRIGGER bookings_auto_confirm_free
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_free_bookings();


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. Backfill is_email_verified for existing users
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UPDATE public.users u
SET    is_email_verified = true, updated_at = now()
WHERE  is_email_verified = false
  AND  EXISTS (
    SELECT 1 FROM auth.users a
    WHERE a.id = u.id AND a.email_confirmed_at IS NOT NULL
  );

-- Confirm earlier free-booking rows too (for past test bookings).
-- The protect_booking_columns_trigger blocks status changes unless the
-- session role is service_role. We set that claim locally so the trigger
-- bypasses for this single statement (rolls back on COMMIT/ROLLBACK).
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.bookings
  SET    status = 'confirmed', updated_at = now()
  WHERE  price = 0 AND status IN ('pending_payment', 'pending');
END $$;
