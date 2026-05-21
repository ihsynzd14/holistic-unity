-- Restrict cleanup_orphaned_bookings() to service_role only.
-- PostgreSQL grants EXECUTE to PUBLIC by default on new functions.
-- Revoke public access so only service_role (pg_cron, admin) can call it.

revoke execute on function public.cleanup_orphaned_bookings() from public;
revoke execute on function public.cleanup_orphaned_bookings() from anon;
revoke execute on function public.cleanup_orphaned_bookings() from authenticated;
grant  execute on function public.cleanup_orphaned_bookings() to service_role;
