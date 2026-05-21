-- Automatically cancel orphaned bookings that have been stuck in "pending"
-- status for more than 30 minutes with no associated payment intent.
-- This cleans up bookings created during step 1 of the payment flow where
-- step 2 (payment intent creation) or step 3 (linking) failed.

-- Function: cancel stale pending bookings
create or replace function public.cleanup_orphaned_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    cancelled_count integer;
begin
    update public.bookings
    set
        status = 'cancelled',
        cancellation_reason = 'auto_cleanup: orphaned pending booking',
        updated_at = now()
    where status = 'pending'
      and stripe_payment_intent_id is null
      and created_at < now() - interval '30 minutes';

    get diagnostics cancelled_count = row_count;

    if cancelled_count > 0 then
        raise notice 'Cleaned up % orphaned pending bookings', cancelled_count;
    end if;

    return cancelled_count;
end;
$$;

-- Schedule via pg_cron (runs every 15 minutes).
-- If pg_cron is not enabled, this SELECT will fail silently — the function
-- can still be called manually or from an Edge Function cron.
do $$
begin
    perform cron.schedule(
        'cleanup-orphaned-bookings',
        '*/15 * * * *',
        $sql$ select public.cleanup_orphaned_bookings(); $sql$
    );
exception when others then
    raise notice 'pg_cron not available — schedule cleanup_orphaned_bookings manually';
end;
$$;

-- Also allow the function to be called by authenticated users (e.g., admin)
grant execute on function public.cleanup_orphaned_bookings() to service_role;
