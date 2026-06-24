-- ============================================================
-- Therapist self-registration — Supabase migration
--
-- STATUS (verified against project bqyqkvkzkemiwyqjkbna on 2026-04-16):
--   - public.users already has RLS policies for self-insert / self-read
--     / self-update (policies "Users can insert own row", etc.)
--   - public.therapist_profiles already has RLS for self-insert / self-read
--     / self-update plus "admin_update_therapist_profiles"
--   - The only NEW object required is the prevent_self_approval() trigger
--     below. Without it, the existing "Therapists can update own profile"
--     policy would let a therapist PATCH their own approval_status to
--     'approved' and bypass the admin review step.
--
-- This trigger was applied live via the Supabase Management API on
-- 2026-04-16 from this codebase. This file is kept as documentation so
-- the migration is reproducible if you ever restore from a backup.
-- ============================================================

-- ── BEFORE UPDATE trigger: block self-approval ────────────────
-- If approval_status, is_approved, or is_verified are changing AND the
-- caller is not an admin (is_admin() = false), raise an exception.
-- Admins (flagged via public.users.is_admin = true) can still flip these
-- fields freely from the admin dashboard.

CREATE OR REPLACE FUNCTION public.prevent_self_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $BODY$
BEGIN
  -- Admins can do anything
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
    RAISE EXCEPTION 'Only admins can change approval_status (attempted change from % to %)',
      OLD.approval_status, NEW.approval_status;
  END IF;

  IF OLD.is_approved IS DISTINCT FROM NEW.is_approved THEN
    RAISE EXCEPTION 'Only admins can change is_approved';
  END IF;

  -- is_verified should also be admin-only (used in the directory UI).
  IF OLD.is_verified IS DISTINCT FROM NEW.is_verified THEN
    RAISE EXCEPTION 'Only admins can change is_verified';
  END IF;

  RETURN NEW;
END;
$BODY$;

DROP TRIGGER IF EXISTS therapist_profiles_block_self_approval
  ON public.therapist_profiles;

CREATE TRIGGER therapist_profiles_block_self_approval
  BEFORE UPDATE ON public.therapist_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_approval();


-- ── Optional: auto-provision rows from auth.users ─────────────
-- NOT APPLIED. Kept as reference only. Use this if you prefer the DB
-- to provision public.users + public.therapist_profiles when
-- supabase.auth.signUp runs, instead of the client-side upsert in
-- src/app/register/page.tsx.
--
-- CREATE OR REPLACE FUNCTION public.handle_new_therapist()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- BEGIN
--   IF (NEW.raw_user_meta_data ->> 'role') = 'therapist' THEN
--     INSERT INTO public.users (id, email, display_name, phone_number, role)
--     VALUES (
--       NEW.id,
--       NEW.email,
--       COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''),
--       COALESCE(NEW.raw_user_meta_data ->> 'phone', ''),
--       'therapist'
--     )
--     ON CONFLICT (id) DO NOTHING;
--
--     INSERT INTO public.therapist_profiles (id, display_name, approval_status, is_approved)
--     VALUES (
--       NEW.id,
--       COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''),
--       'pending_review',
--       false
--     )
--     ON CONFLICT (id) DO NOTHING;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- DROP TRIGGER IF EXISTS on_auth_user_created_therapist ON auth.users;
-- CREATE TRIGGER on_auth_user_created_therapist
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_therapist();
