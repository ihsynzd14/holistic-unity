-- ============================================================
-- Migration: Harden SECURITY DEFINER search_path
-- Date: 2026-04-17
-- Phase: Pre-TestFlight security hardening — Phase 2.4
--
-- Rationale: SECURITY DEFINER functions run as the function OWNER
-- (usually supabase_admin). If their search_path is mutable, an
-- attacker with CREATE privilege on any schema can shadow tables
-- (e.g. create their own `public.users` in a schema earlier in
-- search_path) — the function then reads attacker-controlled data
-- and grants them supabase_admin privileges.
--
-- Mitigation: every SECURITY DEFINER function MUST pin search_path
-- explicitly. Best practice is `search_path = ''` — forces every
-- identifier in the function body to be schema-qualified.
--
-- Audit on 2026-04-17 found 5 functions with vulnerable config.
-- Fixed below. Note the function bodies ALREADY reference public.X
-- explicitly, so setting search_path = '' is a zero-behavior change.
-- ============================================================

-- 1. get_conversation_participants_for_user
ALTER FUNCTION public.get_conversation_participants_for_user(uuid)
  SET search_path = '';

-- 2. get_or_create_conversation
-- Has multiple overloads — lock each down. Query pg_proc for the
-- actual arg lists, then alter.
DO $$
DECLARE
    fn_oid oid;
    fn_sig text;
BEGIN
    FOR fn_oid, fn_sig IN
        SELECT p.oid, pg_get_function_identity_arguments(p.oid)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('get_or_create_conversation',
                            'increment_unread_count',
                            'trigger_push_notification',
                            'protect_booking_columns')
          AND p.prosecdef = true
    LOOP
        EXECUTE format(
            'ALTER FUNCTION public.%I(%s) SET search_path = ''''',
            (SELECT proname FROM pg_proc WHERE oid = fn_oid),
            fn_sig
        );
        RAISE NOTICE 'Pinned search_path for public.%(%)',
            (SELECT proname FROM pg_proc WHERE oid = fn_oid),
            fn_sig;
    END LOOP;
END $$;
