-- ============================================================================
-- Problem A: race-proof double-booking guard for public.bookings
-- ============================================================================
--
-- BACKGROUND
-- ----------
-- A booking slot was protected only by the row-level trigger
-- `prevent_overlapping_active_bookings` (migration 20260406203000). That
-- trigger has two gaps:
--
--   G1. It ignores `pending_payment`. The web Stripe-Checkout flow inserts
--       bookings as `pending_payment` (see client-webapp
--       /api/checkout/create), so those rows were NEITHER checked on insert
--       NOR did they block other inserts. Two web clients could pay for the
--       same slot.
--
--   G2. A BEFORE trigger that does a SELECT is not a hard concurrency
--       barrier: two simultaneous transactions can each pass the SELECT
--       (neither sees the other's uncommitted row) and both insert.
--
-- This migration closes both gaps with a true Postgres EXCLUDE constraint,
-- which uses GiST index-level locking to serialize conflicting inserts —
-- the guarantee a trigger cannot give. The trigger is kept (and extended to
-- include `pending_payment`) purely for its friendly error message in the
-- common sequential case; the constraint is the authoritative backstop.
--
-- The status set matches client-webapp's LIVE_STATUSES and the
-- /api/checkout/create conflict check.
--
-- PRE-FLIGHT (RUN THIS FIRST — read-only)
-- ---------------------------------------
-- The ADD CONSTRAINT below will FAIL if any two live bookings already
-- overlap. Find them first and resolve (cancel one of each pair) before
-- applying:
--
--   SELECT a.id AS booking_a, b.id AS booking_b, a.therapist_id,
--          a.scheduled_at AS a_start, a.duration AS a_dur, a.status AS a_status,
--          b.scheduled_at AS b_start, b.duration AS b_dur, b.status AS b_status
--   FROM public.bookings a
--   JOIN public.bookings b
--     ON a.therapist_id = b.therapist_id
--    AND a.id < b.id
--    AND a.status IN ('pending','pending_payment','confirmed','in_progress','reschedule_pending')
--    AND b.status IN ('pending','pending_payment','confirmed','in_progress','reschedule_pending')
--    AND tstzrange(a.scheduled_at, a.scheduled_at + make_interval(mins => greatest(a.duration,1)), '[)')
--     && tstzrange(b.scheduled_at, b.scheduled_at + make_interval(mins => greatest(b.duration,1)), '[)')
--   ORDER BY a.therapist_id, a_start;
--
-- Zero rows → safe to apply. Rows returned → cancel the duplicate(s) first.
-- ============================================================================

-- btree_gist is required so a GiST index can combine an equality predicate
-- (therapist_id WITH =) with the range-overlap predicate (tstzrange WITH &&).
create extension if not exists btree_gist;

-- ── 1. Extend the existing trigger to also cover `pending_payment` ──────────
-- Same logic as 20260406203000, with 'pending_payment' added to BOTH the
-- early-return guard and the conflict subquery so the web flow gets the
-- friendly 'Time slot is no longer available' message too.
create or replace function public.prevent_overlapping_active_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conflict_id uuid;
begin
    if new.status not in ('pending', 'pending_payment', 'confirmed', 'in_progress', 'reschedule_pending') then
        return new;
    end if;

    select b.id
    into v_conflict_id
    from public.bookings b
    where b.id <> new.id
      and b.therapist_id = new.therapist_id
      and b.status in ('pending', 'pending_payment', 'confirmed', 'in_progress', 'reschedule_pending')
      and tstzrange(
            b.scheduled_at,
            b.scheduled_at + make_interval(mins => greatest(b.duration, 1)),
            '[)'
          )
          && tstzrange(
            new.scheduled_at,
            new.scheduled_at + make_interval(mins => greatest(new.duration, 1)),
            '[)'
          )
    limit 1;

    if v_conflict_id is not null then
        raise exception 'Time slot is no longer available';
    end if;

    return new;
end;
$$;

-- ── 2. IMMUTABLE range helper ───────────────────────────────────────────────
-- A constraint/index expression must be IMMUTABLE. The `timestamptz + interval`
-- operator is only STABLE (day/month intervals shift across DST), so it cannot
-- be used directly in the EXCLUDE expression — that is the cause of
-- `42P17: functions in index expression must be marked IMMUTABLE`.
--
-- We only ever add MINUTES, which are fixed 60-second units with no timezone
-- dependence, so the result is genuinely immutable for our inputs. Wrapping
-- the arithmetic in an IMMUTABLE SQL function is the standard, safe workaround.
create or replace function public.booking_slot_range(p_start timestamptz, p_duration integer)
returns tstzrange
language sql
immutable
set search_path = pg_catalog
as $$
  select tstzrange(p_start, p_start + make_interval(mins => greatest(coalesce(p_duration, 1), 1)), '[)');
$$;

-- ── 3. The authoritative, race-proof guard ─────────────────────────────────
-- Partial EXCLUDE constraint: no two LIVE bookings for the same therapist may
-- have overlapping [scheduled_at, scheduled_at + duration) ranges. Cancelled /
-- completed / no_show rows are outside the predicate, so they neither block
-- nor are blocked. Drop-if-exists makes this migration safely re-runnable.
alter table public.bookings
    drop constraint if exists bookings_no_overlap;

alter table public.bookings
    add constraint bookings_no_overlap
    exclude using gist (
        therapist_id with =,
        public.booking_slot_range(scheduled_at, duration) with &&
    )
    where (status in ('pending', 'pending_payment', 'confirmed', 'in_progress', 'reschedule_pending'));

comment on constraint bookings_no_overlap on public.bookings is
    'Race-proof double-booking guard. No two LIVE bookings (pending, pending_payment, confirmed, in_progress, reschedule_pending) for the same therapist may overlap. Backstop to the prevent_overlapping_active_bookings trigger; closes the pending_payment + concurrency gaps.';
