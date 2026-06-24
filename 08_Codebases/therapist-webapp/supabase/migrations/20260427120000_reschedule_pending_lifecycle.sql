-- 2026-04-27: Differentiate stale reschedule_pending handling by proposer.
--
-- Background. We now have two ways a booking enters reschedule_pending:
--   * therapist proposes (POST /api/bookings/[id]/reschedule)
--   * client proposes   (POST /api/bookings/[id]/reschedule-request — new)
--
-- The existing cleanup function `cleanup_stale_reschedule_pending`
-- cancels any reschedule_pending booking whose ORIGINAL scheduled_at
-- has passed by 1h. That logic was correct when only therapists could
-- propose: if the therapist proposed and the client never responded,
-- the booking would sit until the original time passed and then get
-- auto-cancelled.
--
-- Now that clients can also propose, the same logic creates a perverse
-- incentive: a client could propose a far-future date and wait out the
-- 24h response window, but with the existing cron the booking sits
-- stale until the ORIGINAL scheduled_at passes — at which point it
-- auto-cancels with a refund (handled out-of-band). That is effectively
-- a free cancellation that bypasses the tiered policy in
-- docs/flows/08-refund-cancellation.md.
--
-- Fix: keep the existing cron entry and the existing function NAME
-- (so we don't have to touch cron.job), but add a new client-revert
-- branch at the TOP of the function that fires 24h after the proposal.
-- Client-proposed expiries revert the booking to `confirmed` (no
-- refund); the original scheduled_at still stands. If the client
-- really cannot make the original slot, they cancel under the
-- standard tiered policy.
--
-- Therapist-proposed and legacy (no reschedule_proposed_by) rows still
-- fall through to the original scheduled_at-based cancellation branch.
--
-- The cron job (`cleanup-stale-reschedule-pending`, every 30 min)
-- continues to call this function without modification.

create or replace function public.cleanup_stale_reschedule_pending()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
    reverted_count  integer := 0;
    cancelled_count integer := 0;
begin
    -- 1) NEW — client-proposed reschedules expire 24h after the proposal
    --    timestamp. Revert to confirmed (the original time still
    --    stands). No refund, no Stripe call. The cancellation_reason
    --    column is reused as the optional "why I'm asking for a
    --    reschedule" note from the client; clear it on revert so it
    --    doesn't leak into a later cancellation audit trail.
    update public.bookings
    set
        status                 = 'confirmed',
        proposed_scheduled_at  = null,
        reschedule_proposed_by = null,
        reschedule_proposed_at = null,
        cancellation_reason    = null,
        updated_at             = now()
    where status                 = 'reschedule_pending'
      and reschedule_proposed_by = 'client'
      and reschedule_proposed_at < now() - interval '24 hours';

    get diagnostics reverted_count = row_count;

    -- 2) EXISTING — any reschedule_pending whose ORIGINAL scheduled_at
    --    is more than 1h in the past is considered abandoned. This
    --    catches therapist-proposed reschedules the client never
    --    accepted, plus legacy rows (no reschedule_proposed_by).
    --    Refund handling for these cancellations is out-of-band
    --    (existing edge job / admin worker — not changed here).
    update public.bookings
    set
        status              = 'cancelled',
        cancellation_reason = 'auto_cleanup: reschedule timed out (therapist did not respond before original session time)',
        updated_at          = now()
    where status        = 'reschedule_pending'
      and scheduled_at  < now() - interval '1 hour';

    get diagnostics cancelled_count = row_count;

    if reverted_count > 0 then
        raise notice 'cleanup_stale_reschedule_pending: reverted % client-proposed reschedules to confirmed', reverted_count;
    end if;
    if cancelled_count > 0 then
        raise notice 'cleanup_stale_reschedule_pending: cancelled % stale reschedule_pending bookings', cancelled_count;
    end if;

    return reverted_count + cancelled_count;
end;
$function$;

comment on function public.cleanup_stale_reschedule_pending() is
  'Cron worker for stale reschedule_pending bookings. Branches by reschedule_proposed_by: client-proposed > 24h old → revert to confirmed (no refund); anything else past original scheduled_at + 1h → cancel (refund handled out-of-band).';
