-- ============================================================
-- Migration: Postgres-backed distributed rate limiter
-- Date: 2026-04-17
-- Phase: Pre-TestFlight security hardening — Phase 1.2
--
-- Goal: replace the per-instance in-memory rate limiter used by
-- Edge Functions with a Postgres-backed implementation. All Deno
-- instances share the same counter, so the rate limit is truly
-- global — an attacker cannot scale the effective limit by
-- triggering horizontal autoscale.
--
-- Design (fixed-window counter):
--   - One row per (key, time_bucket) pair. Bucket ID = floor(now / window).
--   - INSERT ... ON CONFLICT UPDATE — atomic, single-round-trip.
--   - Cleanup cron deletes expired buckets every 10 minutes.
--
-- Performance notes:
--   - Each check = 1 UPSERT on a small primary-key-indexed table.
--   - At 1000 active users the table never holds more than a few
--     thousand rows (windows are ≤ 1 minute; cleanup keeps it tight).
--   - Upsert latency ≈ 5–15 ms via pooler. Adequate for our scale.
--
-- Why not Upstash: explicit decision to minimise external vendors.
-- See PRE_DEPLOYMENT_QA.md "Phase 1 security hardening" for rationale.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
    bucket_key   text        PRIMARY KEY,
    count        bigint      NOT NULL DEFAULT 0,
    expires_at   timestamptz NOT NULL
);

-- Partial index on expiry for cheap cleanup scans.
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expires_idx
    ON public.rate_limit_buckets(expires_at);

-- ── RPC: atomic check + increment ───────────────────────────────────
--
-- Returns { count, limited } where:
--   - count   = the counter AFTER this call (so a request that hits
--               the limit still contributes to the count for visibility)
--   - limited = true if count > max (caller should return 429)
--
-- SECURITY DEFINER + explicit empty search_path: prevents the mutable
-- search_path privilege-escalation class of attacks.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_key             text,
    p_max             bigint,
    p_window_seconds  int DEFAULT 60
)
RETURNS TABLE (count bigint, limited boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bucket_id  bigint;
    v_bucket_key text;
    v_expires    timestamptz;
    v_count      bigint;
BEGIN
    -- Validate inputs defensively.
    IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 256 THEN
        RAISE EXCEPTION 'invalid rate-limit key';
    END IF;
    IF p_max <= 0 OR p_window_seconds <= 0 OR p_window_seconds > 86400 THEN
        RAISE EXCEPTION 'invalid rate-limit parameters';
    END IF;

    -- Fixed-window bucket ID — changes every p_window_seconds.
    v_bucket_id := FLOOR(EXTRACT(EPOCH FROM NOW()) / p_window_seconds)::bigint;
    v_bucket_key := 'rl:' || p_key || ':' || v_bucket_id::text;
    v_expires := NOW() + (p_window_seconds || ' seconds')::interval;

    -- Atomic UPSERT + increment.
    INSERT INTO public.rate_limit_buckets (bucket_key, count, expires_at)
    VALUES (v_bucket_key, 1, v_expires)
    ON CONFLICT (bucket_key) DO UPDATE
        SET count = public.rate_limit_buckets.count + 1
    RETURNING public.rate_limit_buckets.count INTO v_count;

    count := v_count;
    limited := v_count > p_max;
    RETURN NEXT;
END;
$$;

-- Only the service role (used by Edge Functions) may call this.
REVOKE ALL ON FUNCTION public.check_rate_limit(text, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, bigint, int) TO service_role;

-- ── Cleanup function + cron ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_buckets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted integer;
BEGIN
    DELETE FROM public.rate_limit_buckets WHERE expires_at < NOW();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_rate_limit_buckets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_buckets() TO service_role;

-- Schedule cleanup every 10 minutes via pg_cron.
DO $$
BEGIN
    PERFORM cron.schedule(
        'cleanup-rate-limit-buckets',
        '*/10 * * * *',
        'SELECT public.cleanup_rate_limit_buckets();'
    );
EXCEPTION WHEN OTHERS THEN
    -- pg_cron unavailable — function can be triggered externally.
    RAISE NOTICE 'pg_cron unavailable; cleanup_rate_limit_buckets() must run externally.';
END;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────
-- Nobody should ever SELECT/UPDATE/DELETE this table directly from
-- client code. Enable RLS with NO policies — only service_role can
-- access it (via SECURITY DEFINER functions above).

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
