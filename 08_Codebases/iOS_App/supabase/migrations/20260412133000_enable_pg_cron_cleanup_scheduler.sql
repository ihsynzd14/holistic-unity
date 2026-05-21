-- Enable pg_cron and register the orphaned booking cleanup job.
-- Supabase Cron stores jobs in the `cron` schema created by the extension.

create extension if not exists pg_cron;

do $$
begin
    perform cron.schedule(
        'cleanup-orphaned-bookings',
        '*/15 * * * *',
        $sql$ select public.cleanup_orphaned_bookings(); $sql$
    );
exception
    when others then
        raise notice 'Unable to schedule cleanup-orphaned-bookings via pg_cron: %', sqlerrm;
end;
$$;
