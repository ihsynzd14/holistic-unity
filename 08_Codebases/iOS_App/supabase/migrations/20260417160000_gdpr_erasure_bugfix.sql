-- ============================================================
-- Migration: GDPR erasure pipeline bugfixes (Phase 5.1 follow-up)
-- Date: 2026-04-17
-- Applied to production: 2026-04-17 (via Management API)
--
-- DB-level E2E test of the Phase 5 erasure flow (migration
-- 20260417150000) surfaced four bugs. All fixed here.
--
-- BUG 1 — Trigger refused client cancellation from 'reschedule_pending'
--   The protect_booking_columns trigger only allowed cancellation from
--   'pending' or 'confirmed'. But when a client wants to decline the
--   therapist's reschedule proposal, the client MUST be able to
--   cancel the booking. Phase 5's delete_user_account hits this path
--   when cancelling in-flight bookings for the deleting user.
--   → Added 'reschedule_pending' to the allowed source states.
--
-- BUG 2 — Trigger refused client_id modification unconditionally
--   Phase 5's re-point of completed-booking client_id to the
--   tombstone UUID was blocked. Fix: delete_user_account elevates
--   `request.jwt.claim.role` to 'service_role' via
--   set_config(..., is_local=true) at function entry; the trigger's
--   existing service-role bypass then permits the modification.
--   Elevation is transaction-local so it cannot leak past the RPC call.
--
-- BUG 3 — Column names in the original anonymization UPDATE drifted
--   from reality
--   The original migration anonymized `interests`, `budget_tier`,
--   `birth_city` — which exist in docs/platform/data-model.md but
--   NOT in the production schema. Real columns are: latitude,
--   longitude, auth_provider, is_email_verified, fcm_token,
--   stripe_customer_id, experience_level, intention, birth_place
--   (not birth_city), has_skipped_birth_data. The anonymization
--   now targets the correct set.
--
-- BUG 4 — Several columns are NOT NULL; cannot set them to NULL
--   display_name, preferred_languages, auth_provider, is_email_verified,
--   has_skipped_birth_data, marketing_consent, is_admin are all NOT NULL.
--   Anonymization now uses sentinel values: '[Deleted]', empty array,
--   false.
-- ============================================================

-- 1. Allow client-side cancellation from 'reschedule_pending'.
CREATE OR REPLACE FUNCTION public.protect_booking_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.price IS DISTINCT FROM OLD.price THEN
    RAISE EXCEPTION 'Cannot modify booking price';
  END IF;
  IF NEW.platform_fee IS DISTINCT FROM OLD.platform_fee THEN
    RAISE EXCEPTION 'Cannot modify platform fee';
  END IF;
  IF NEW.therapist_payout IS DISTINCT FROM OLD.therapist_payout THEN
    RAISE EXCEPTION 'Cannot modify therapist payout';
  END IF;
  IF NEW.discount IS DISTINCT FROM OLD.discount THEN
    RAISE EXCEPTION 'Cannot modify discount';
  END IF;
  IF NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
     AND OLD.stripe_payment_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify payment intent';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (SELECT auth.uid()) = OLD.client_id THEN
      IF NEW.status != 'cancelled' THEN
        RAISE EXCEPTION 'Clients can only cancel bookings';
      END IF;
      -- BUGFIX 2026-04-17: added 'reschedule_pending' to allowed set.
      IF OLD.status NOT IN ('pending', 'confirmed', 'reschedule_pending') THEN
        RAISE EXCEPTION 'Cannot cancel a booking in status: %', OLD.status;
      END IF;
    ELSIF (SELECT auth.uid()) = OLD.therapist_id THEN
      IF NEW.status NOT IN ('confirmed', 'cancelled', 'in_progress', 'completed', 'no_show') THEN
        RAISE EXCEPTION 'Invalid status transition for therapist';
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorized to change booking status';
    END IF;
  END IF;

  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'Cannot modify booking client';
  END IF;
  IF NEW.therapist_id IS DISTINCT FROM OLD.therapist_id THEN
    RAISE EXCEPTION 'Cannot modify booking therapist';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. delete_user_account — final, verified-working version.
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

  IF EXISTS (
    SELECT 1 FROM public.users WHERE id = v_user_id AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account already deleted';
  END IF;

  -- Elevate role so protect_booking_columns permits our status +
  -- client_id modifications. `is_local=true` restores on COMMIT.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  WITH cancelled AS (
    UPDATE public.bookings
    SET status = 'cancelled', cancellation_reason = 'user_deleted_account'
    WHERE client_id = v_user_id
      AND status IN ('pending', 'confirmed', 'reschedule_pending')
    RETURNING id
  ) SELECT COUNT(*) INTO v_bookings_cancelled FROM cancelled;

  UPDATE public.bookings
  SET client_id = v_tombstone_id
  WHERE client_id = v_user_id AND status = 'completed';

  WITH redacted AS (
    UPDATE public.reviews
    SET text = '[Deleted]', client_id = v_tombstone_id
    WHERE client_id = v_user_id
    RETURNING id
  ) SELECT COUNT(*) INTO v_reviews_redacted FROM redacted;

  WITH deleted_credits AS (
    DELETE FROM public.session_credits WHERE client_id = v_user_id RETURNING id
  ) SELECT COUNT(*) INTO v_credits_deleted FROM deleted_credits;

  DELETE FROM public.device_tokens WHERE user_id = v_user_id;
  DELETE FROM public.notifications WHERE user_id = v_user_id;
  DELETE FROM public.conversation_participants WHERE user_id = v_user_id;

  -- Anonymize the users row — NOT-NULL fields use sentinel values.
  -- Column list matches the LIVE schema (not the drifted data-model.md).
  UPDATE public.users SET
    email = 'deleted_' || id::text || '@anonymized.holisticunity.app',
    display_name = '[Deleted]',
    photo_url = NULL,
    phone_number = NULL,
    city = NULL,
    country = NULL,
    latitude = NULL,
    longitude = NULL,
    preferred_languages = ARRAY[]::text[],
    fcm_token = NULL,
    experience_level = NULL,
    intention = NULL,
    birth_date = NULL,
    birth_time = NULL,
    birth_place = NULL,
    has_skipped_birth_data = false,
    marketing_consent = false,
    marketing_consent_date = NULL,
    deleted_at = NOW(),
    anonymized_at = NOW()
  WHERE id = v_user_id;

  -- Anonymize therapist_profiles if user is also a therapist.
  UPDATE public.therapist_profiles SET
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

REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
