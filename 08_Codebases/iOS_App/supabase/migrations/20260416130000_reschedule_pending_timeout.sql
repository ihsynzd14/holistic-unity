-- ============================================================
-- Migration: auto-cancel stale reschedule_pending bookings
-- Date: 2026-04-16
-- Rationale: QA Case 7 found that bookings stuck in
-- `reschedule_pending` had no auto-expiry. If a therapist proposed
-- a reschedule and never acted, and the original `scheduled_at`
-- passed, the booking was stuck forever — confusing the user and
-- blocking the slot.
--
-- Policy: after the original scheduled_at time passes with no
-- therapist action, auto-cancel the booking with reason
-- `auto_cleanup: reschedule timed out`. The client's payment still
-- needs to be refunded separately (therapist-initiated cancel =
-- full refund per refund-cancellation flow).
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_stale_reschedule_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    cancelled_count INTEGER;
BEGIN
    -- Any booking in reschedule_pending whose ORIGINAL scheduled_at
    -- is more than 1 hour in the past is considered abandoned.
    UPDATE public.bookings
    SET
        status = 'cancelled',
        cancellation_reason = 'auto_cleanup: reschedule timed out (therapist did not respond before original session time)',
        updated_at = NOW()
    WHERE status = 'reschedule_pending'
      AND scheduled_at < NOW() - INTERVAL '1 hour';

    GET DIAGNOSTICS cancelled_count = ROW_COUNT;

    IF cancelled_count > 0 THEN
        RAISE NOTICE 'Cancelled % stale reschedule_pending bookings', cancelled_count;
    END IF;

    RETURN cancelled_count;
END;
$$;

-- Schedule via pg_cron — runs every 30 minutes.
DO $$
BEGIN
    PERFORM cron.schedule(
        'cleanup-stale-reschedule-pending',
        '*/30 * * * *',
        'SELECT public.cleanup_stale_reschedule_pending();'
    );
EXCEPTION WHEN OTHERS THEN
    -- pg_cron not available — the function can be called manually.
    RAISE NOTICE 'pg_cron unavailable; cleanup_stale_reschedule_pending() must be triggered externally.';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_reschedule_pending() FROM PUBLIC;
-- Allow service_role to run it from Edge Function if pg_cron is unavailable.
GRANT EXECUTE ON FUNCTION public.cleanup_stale_reschedule_pending() TO service_role;
