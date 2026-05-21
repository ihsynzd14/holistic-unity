-- ============================================================
-- Migration: Remove session format column from the platform.
-- Date: 2026-04-16
-- Rationale: Holistic Unity V1 is virtual-only (all sessions via
-- LiveKit video). The format column (virtual/in_person/both) is no
-- longer a business concept. See docs/flows/09-video-call.md.
--
-- Prerequisites:
--   - iOS app updated to not send format in booking creation
--   - Webapp updated to not read/write format
--   - Edge functions updated to not reference format
-- ============================================================

-- Drop old RPC signature (had p_format) before recreating without it.
-- Using DROP IF EXISTS + CREATE (not CREATE OR REPLACE) because the
-- parameter list changes and CREATE OR REPLACE can't change arguments.
DROP FUNCTION IF EXISTS public.create_booking_with_credit(
  UUID, UUID, UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID, UUID
);

-- Drop format column from bookings (trigger and RLS do not reference it)
ALTER TABLE public.bookings DROP COLUMN IF EXISTS format;

-- Drop format column from therapist_services. The CHECK constraint is
-- dropped automatically when the column is dropped.
ALTER TABLE public.therapist_services DROP COLUMN IF EXISTS format;

-- Recreate RPC without p_format parameter.
CREATE OR REPLACE FUNCTION public.create_booking_with_credit(
  p_booking_id        UUID,
  p_client_id         UUID,
  p_therapist_id      UUID,
  p_service_id        UUID,
  p_service_name      TEXT,
  p_duration          INTEGER,
  p_scheduled_at      TIMESTAMPTZ,
  p_timezone          TEXT,
  p_video_room_id     TEXT,
  p_pack_booking_id   UUID,
  p_credit_id         UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_credit  public.session_credits;
  v_booking public.bookings;
BEGIN
  IF (SELECT auth.uid()) != p_client_id THEN
    RAISE EXCEPTION 'Unauthorized: client_id does not match authenticated user';
  END IF;

  -- Step 1: Decrement the credit (fails atomically if exhausted).
  UPDATE public.session_credits
  SET
    sessions_remaining = sessions_remaining - 1,
    updated_at = now()
  WHERE id = p_credit_id
    AND client_id = p_client_id
    AND sessions_remaining > 0
  RETURNING * INTO v_credit;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session credit is unavailable or exhausted';
  END IF;

  -- Step 2: Create the booking atomically (no format column anymore).
  INSERT INTO public.bookings (
    id, client_id, therapist_id, service_id, service_name,
    duration, price, scheduled_at, timezone,
    status, video_room_id, platform_fee, therapist_payout,
    reschedule_count, pack_booking_id, created_at, updated_at
  ) VALUES (
    p_booking_id, p_client_id, p_therapist_id, p_service_id, p_service_name,
    p_duration, 0, p_scheduled_at, p_timezone,
    'confirmed', p_video_room_id, 0, 0,
    0, p_pack_booking_id, now(), now()
  )
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'credit_id', v_credit.id,
    'sessions_remaining', v_credit.sessions_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_with_credit(
  UUID, UUID, UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID
) TO authenticated;
