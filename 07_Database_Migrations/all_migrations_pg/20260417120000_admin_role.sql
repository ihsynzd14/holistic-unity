-- ============================================================
-- Migration: admin role via DB column + is_admin() RPC
-- Date: 2026-04-17
-- Phase: Pre-TestFlight security hardening — Phase 1.3
--
-- Rationale: admin-dashboard currently gates admin operations
-- solely with ADMIN_EMAILS env whitelist. A forged JWT with
-- spoofed email claim (e.g. through a compromised OAuth provider
-- or auth bug) would bypass the only check. Defense-in-depth
-- requires DB-backed admin flag with RLS support.
--
-- After this migration:
--   - public.users.is_admin (boolean, default false, indexed)
--   - public.is_admin() helper: SECURITY DEFINER, checks current session
--   - New admin-read policies on sensitive tables
--   - Admin-dashboard API routes will also call is_admin() in code
--     (in addition to env whitelist) — see Phase 1.3d.
-- ============================================================

-- 1. Add is_admin column to users.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 2. Partial index — tiny cost, very fast admin lookups.
CREATE INDEX IF NOT EXISTS users_is_admin_idx
  ON public.users(is_admin)
  WHERE is_admin = true;

-- 3. Helper function: is the current session user an admin?
--    SECURITY DEFINER + explicit search_path = '' prevents the mutable
--    search_path privilege-escalation class of attacks.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.users WHERE id = (SELECT auth.uid())),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 4. Admin-read policies on sensitive tables.
--    Note: does NOT replace existing user-scoped policies; it adds
--    an OR-joined path so admins can see everything. Regular users
--    still only see their own rows via the existing policies.

-- Users
DROP POLICY IF EXISTS "admin_read_all_users" ON public.users;
CREATE POLICY "admin_read_all_users" ON public.users
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Bookings
DROP POLICY IF EXISTS "admin_read_all_bookings" ON public.bookings;
CREATE POLICY "admin_read_all_bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_bookings" ON public.bookings;
CREATE POLICY "admin_update_bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Transactions
DROP POLICY IF EXISTS "admin_read_all_transactions" ON public.transactions;
CREATE POLICY "admin_read_all_transactions" ON public.transactions
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Therapist profiles (admin needs to approve/flag therapists)
DROP POLICY IF EXISTS "admin_update_therapist_profiles" ON public.therapist_profiles;
CREATE POLICY "admin_update_therapist_profiles" ON public.therapist_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Reviews (admin needs to moderate / flag)
DROP POLICY IF EXISTS "admin_update_reviews" ON public.reviews;
CREATE POLICY "admin_update_reviews" ON public.reviews
  FOR UPDATE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_reviews" ON public.reviews;
CREATE POLICY "admin_delete_reviews" ON public.reviews
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Session credits (admin may need to adjust)
DROP POLICY IF EXISTS "admin_read_all_session_credits" ON public.session_credits;
CREATE POLICY "admin_read_all_session_credits" ON public.session_credits
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Payment methods — intentionally NOT added. Admins should not read
-- raw payment methods even for support. Use Stripe dashboard instead.

-- 5. Prevent users from updating their own is_admin flag.
--    Existing "Users can update own row" policy would otherwise let
--    any user set themselves to admin. Add a trigger that blocks it.
CREATE OR REPLACE FUNCTION public._guard_user_is_admin_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only the service_role or an existing admin can flip is_admin.
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF NOT COALESCE(public.is_admin(), false) AND auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'Only admins can modify is_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_user_is_admin_updates ON public.users;
CREATE TRIGGER guard_user_is_admin_updates
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_user_is_admin_updates();
