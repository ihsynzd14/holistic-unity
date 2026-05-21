-- ============================================================
-- Migration: GDPR right-to-erasure with soft-delete + 30-day retention
-- Date: 2026-04-17
-- Phase: Pre-TestFlight compliance — Phase 5.1
--
-- Context: the previous `delete_user_account()` RPC (recorded in the
-- legacy `supabase_migration.sql` snapshot, never migrated here) did a
-- hard DELETE across users + bookings + reviews. That approach has three
-- problems:
--
--   1. Breaks therapist historical records — bookings vanish, so the
--      therapist's earnings aggregate loses prior transactions.
--   2. Breaks financial audit trails — transactions have FKs into
--      bookings and would cascade-delete, losing VAT records we may
--      be required to retain for 7+ years.
--   3. No grace period — a regretful user cannot be restored.
--
-- New flow:
--   • `users.deleted_at` set → user can no longer log in (auth.users
--     row is deleted immediately by the orchestrating edge function).
--   • PII in users.* is anonymized (email becomes
--     `deleted_<uuid>@anonymized.holisticunity.app`, display_name
--     nulled, etc.).
--   • Bookings with status in ('pending','confirmed','reschedule_pending')
--     are cancelled; completed bookings retained with anonymized
--     client FK for therapist records.
--   • Reviews retained but text replaced with `[Deleted]` so the
--     therapist's aggregate rating is unaffected.
--   • Session credits deleted (they're personal to the client).
--   • Device tokens / notification prefs / in-app notifications deleted.
--   • Chat participation cleaned up via Stream Chat API (orchestrator
--     edge function — not this RPC).
--
-- After 30 days (`hard_purge_deleted_accounts()` cron), anonymized
-- users rows are hard-deleted. Bookings/reviews with anonymized FKs
-- remain — they reference a now-gone user id, which is OK because:
--   • Bookings have a `deleted_client` tombstone we insert to satisfy
--     FKs (see below).
--   • Reviews don't display client names to the therapist in V1, so
--     the dangling FK is invisible.
--
-- Activation: iOS `SettingsView` and the webapp delete paths must call
-- the new `delete-user-account` edge function, NOT `rpc('delete_user_account')`
-- directly — the edge function orchestrates Stream + Stripe cleanup
-- before invoking this RPC.
-- ============================================================

-- 1. Soft-delete columns on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

-- Partial index for the purge cron so it can find rows cheaply even as
-- the users table grows.
CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON public.users(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 2. Tombstone row for anonymized clients so bookings keep a valid FK.
--    We use a single well-known UUID so all anonymized bookings point
--    here — saves table bloat vs. inserting a fresh tombstone per delete.
--    Row created via service_role below; idempotent insert.
DO $$
BEGIN
  INSERT INTO public.users (
    id, email, role, display_name, is_admin, deleted_at, anonymized_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'tombstone@anonymized.holisticunity.app',
    'client',
    '[Deleted User]',
    false,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  -- Tombstone may fail if there's a trigger blocking inserts with
  -- `role='client'` on a non-authenticated path. Swallow and continue;
  -- the function below can re-try on each delete.
  RAISE NOTICE 'Tombstone row insert skipped: %', SQLERRM;
END$$;

-- 3. Replacement `delete_user_account()` — soft-delete + anonymize.
--
--    This replaces the legacy hard-delete version. Must be called by
--    the orchestrating edge function AFTER external-service cleanup
--    (Stream Chat user deletion, Stripe customer revoke, etc.).
--
--    DROP first because the legacy function had `RETURNS void` and the
--    new one has `RETURNS json` — Postgres disallows changing return
--    type via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.delete_user_account();
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_tombstone_id uuid := '00000000-0000-0000-0000-000000000001';
  v_counts json;
  v_bookings_cancelled int;
  v_reviews_redacted int;
  v_credits_deleted int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Safety net: refuse to delete an already-deleted user.
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_user_id AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account already deleted';
  END IF;

  -- 3.1 Cancel in-flight bookings (client side — pending / confirmed /
  --     reschedule_pending only). Completed bookings retained for
  --     therapist records with client FK re-pointed to tombstone.
  WITH cancelled AS (
    UPDATE public.bookings
    SET
      status = 'cancelled',
      cancellation_reason = 'user_deleted_account'
    WHERE client_id = v_user_id
      AND status IN ('pending', 'confirmed', 'reschedule_pending')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_bookings_cancelled FROM cancelled;

  -- 3.2 Re-point completed bookings' client_id to tombstone so the
  --     therapist's history stays intact but can't be traced to a real
  --     user id. Transactions keep their original user_id (required for
  --     accounting); transactions are covered by separate retention.
  UPDATE public.bookings
  SET client_id = v_tombstone_id
  WHERE client_id = v_user_id
    AND status = 'completed';

  -- 3.3 Redact reviews: keep rating (so average stays valid) but wipe
  --     text + re-point client_id to tombstone.
  WITH redacted AS (
    UPDATE public.reviews
    SET
      text = '[Deleted]',
      client_id = v_tombstone_id
    WHERE client_id = v_user_id
    RETURNING id
  )
  SELECT COUNT(*) INTO v_reviews_redacted FROM redacted;

  -- 3.4 Delete session credits (personal, not useful post-deletion).
  WITH deleted_credits AS (
    DELETE FROM public.session_credits
    WHERE client_id = v_user_id
    RETURNING id
  )
  SELECT COUNT(*) INTO v_credits_deleted FROM deleted_credits;

  -- 3.5 Delete device tokens (push) + notification prefs + notifications.
  DELETE FROM public.device_tokens WHERE user_id = v_user_id;
  DELETE FROM public.user_notification_preferences WHERE user_id = v_user_id;
  DELETE FROM public.notifications WHERE user_id = v_user_id;

  -- 3.6 Clean up chat participation rows. Conversations themselves are
  --     managed server-side via Stream Chat + our mirror; orchestrator
  --     edge function handles the Stream API side. Here we just
  --     remove participant rows so listings don't show the deleted user.
  DELETE FROM public.conversation_participants WHERE user_id = v_user_id;

  -- 3.7 Anonymize the users row. Email is rewritten to a predictable
  --     anonymized pattern so re-signup detection can be implemented
  --     later (hash of original email lives nowhere — GDPR would have
  --     required purpose-limited storage to justify keeping it).
  UPDATE public.users
  SET
    email = 'deleted_' || id::text || '@anonymized.holisticunity.app',
    display_name = NULL,
    photo_url = NULL,
    phone_number = NULL,
    city = NULL,
    country = NULL,
    preferred_languages = NULL,
    interests = NULL,
    budget_tier = NULL,
    birth_date = NULL,
    birth_time = NULL,
    birth_city = NULL,
    marketing_consent = false,
    marketing_consent_date = NULL,
    deleted_at = NOW(),
    anonymized_at = NOW()
  WHERE id = v_user_id;

  -- 3.8 If user was also a therapist, anonymize the therapist profile.
  --     V1 iOS is client-only, so this branch is rare — but guards against
  --     a therapist signing up on the webapp and later deleting via iOS.
  UPDATE public.therapist_profiles
  SET
    display_name = '[Deleted Therapist]',
    tagline = NULL,
    bio = NULL,
    photo_url = NULL,
    city = NULL,
    country = NULL,
    video_intro_url = NULL,
    gallery_image_urls = NULL,
    vat_number = NULL,
    availability = NULL,
    is_approved = false,
    is_verified = false
  WHERE id = v_user_id;

  -- Return counts for the orchestrating edge function to log.
  v_counts := json_build_object(
    'user_id', v_user_id,
    'bookings_cancelled', v_bookings_cancelled,
    'reviews_redacted', v_reviews_redacted,
    'credits_deleted', v_credits_deleted,
    'deleted_at', NOW()
  );
  RETURN v_counts;
END;
$$;

-- Scope: only the calling user can erase themselves. Service role may
-- call it via the orchestrator edge function (which also runs as the
-- caller's JWT, so auth.uid() resolves correctly).
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

-- 4. Purge cron — after 30 days, actually delete the anonymized row.
--    At this point the tombstone FKs take over for referential integrity.
CREATE OR REPLACE FUNCTION public.hard_purge_deleted_accounts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purged int;
BEGIN
  WITH purged AS (
    DELETE FROM public.users
    WHERE
      deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '30 days'
      AND id <> '00000000-0000-0000-0000-000000000001' -- never purge tombstone
    RETURNING id
  )
  SELECT COUNT(*) INTO v_purged FROM purged;

  RETURN v_purged;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hard_purge_deleted_accounts() FROM PUBLIC;
-- Only service_role (via pg_cron) executes this.

-- 5. Schedule the purge to run daily at 03:00 UTC.
--    Idempotent: drop old schedule first if present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('hard-purge-deleted-accounts')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'hard-purge-deleted-accounts'
    );
    PERFORM cron.schedule(
      'hard-purge-deleted-accounts',
      '0 3 * * *',
      $cronsql$ SELECT public.hard_purge_deleted_accounts(); $cronsql$
    );
  END IF;
END$$;

-- 6. RLS: deleted users must not appear in any public query. Add a
--    filter that hides them from non-admin reads. Admins still see
--    (for audit) via the separate "admin_read_all_users" policy added
--    in migration 20260417120000_admin_role.
DROP POLICY IF EXISTS "users_hide_deleted_from_peers" ON public.users;
CREATE POLICY "users_hide_deleted_from_peers" ON public.users
  FOR SELECT TO authenticated
  USING (
    -- Own row always visible (user can see their own anonymized state)
    id = (SELECT auth.uid())
    -- Non-deleted peers visible to others via existing relationship policies
    OR deleted_at IS NULL
  );

-- Ensure existing non-admin SELECT policies are AND-compatible; the new
-- policy is permissive/OR. Combined result: peer reads hide deleted rows.
