-- C1: Atomic credit+booking in a single DB transaction.
--
-- BEFORE: The iOS app called createBooking() then useCredit() as two separate
-- operations. If the credit deduction failed, the booking existed with no
-- credit consumed. The compensating rollback used try? (silent failure).
--
-- AFTER: A single SECURITY DEFINER function that decrements the credit and
-- creates the booking in one transaction — both succeed or both roll back.

CREATE OR REPLACE FUNCTION public.create_booking_with_credit(
  p_booking_id        UUID,
  p_client_id         UUID,
  p_therapist_id      UUID,
  p_service_id        UUID,
  p_service_name      TEXT,
  p_duration          INTEGER,
  p_scheduled_at      TIMESTAMPTZ,
  p_timezone          TEXT,
  p_format            TEXT,
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
  -- Verify the caller is the client
  IF (SELECT auth.uid()) != p_client_id THEN
    RAISE EXCEPTION 'Unauthorized: client_id does not match authenticated user';
  END IF;

  -- Step 1: Decrement the credit (fails atomically if exhausted).
  -- The WHERE sessions_remaining > 0 clause prevents negative balances.
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

  -- Step 2: Create the booking (inside the same transaction).
  -- price = 0 and fees = 0 because this is a credit-based booking.
  INSERT INTO public.bookings (
    id, client_id, therapist_id, service_id, service_name,
    duration, price, scheduled_at, timezone, format,
    status, video_room_id, platform_fee, therapist_payout,
    reschedule_count, pack_booking_id, created_at, updated_at
  ) VALUES (
    p_booking_id, p_client_id, p_therapist_id, p_service_id, p_service_name,
    p_duration, 0, p_scheduled_at, p_timezone, p_format,
    'confirmed', p_video_room_id, 0, 0,
    0, p_pack_booking_id, now(), now()
  )
  RETURNING * INTO v_booking;

  -- Both operations succeeded atomically
  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'credit_id', v_credit.id,
    'sessions_remaining', v_credit.sessions_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_with_credit(
  UUID, UUID, UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID, UUID
) TO authenticated;
