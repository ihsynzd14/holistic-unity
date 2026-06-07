-- ============================================================
-- Migration: therapist_profiles.slug (public profile handle)
-- Date: 2026-06-07
-- Purpose: Give every approved therapist a stable, URL-safe slug so the
--          client web app can serve public profiles at
--          app.holisticunity.app/t/<slug> (e.g. /t/sarah-sivieri).
--
--   - Slug auto-derived from display_name, deduplicated.
--   - Same name + surname: the earliest therapist (created_at ASC) keeps
--     the clean slug; later duplicates get their CITY appended
--     (sarah-sivieri-milano), falling back to a number when the city is
--     missing or also identical (sarah-sivieri-2 / sarah-sivieri-milano-2).
--   - STABLE: assigned once (at approval) and never auto-recomputed when
--     display_name later changes, so shared links never break. `slug` is
--     added to the admin-protected columns so a therapist cannot
--     edit/clear it from their dashboard.
--
-- Builds on:
--   20260526120000_add_therapist_tier.sql         (tier + protect trigger)
--   20260528120000_add_therapist_tier_request.sql (latest protect fn body)
--
-- NOTE: this migration does NOT touch the `therapist_profiles_public`
-- view. Nothing reads the slug through it today (the public page reads
-- the base table with the service-role client, and the therapist portal
-- reads its own row). Avoiding the view keeps us off a DROP ... CASCADE.
--
-- Accent folding uses translate() (covers Italian + common European
-- accents) rather than the `unaccent` extension, so the migration is
-- self-contained and has no extension/schema dependency.
--
-- Idempotent: IF NOT EXISTS on column/index, CREATE OR REPLACE on
-- functions, DROP ... IF EXISTS on the trigger, and the backfill only
-- touches rows where slug IS NULL.
-- ============================================================

-- ── 1. Column + partial UNIQUE index ───────────────────────────────
alter table public.therapist_profiles
  add column if not exists slug text;

-- Partial unique index: uniqueness only among assigned slugs. The many
-- NULL rows (un-approved therapists) don't collide and aren't indexed.
create unique index if not exists therapist_profiles_slug_key
  on public.therapist_profiles (slug)
  where slug is not null;

-- ── 1b. Clean slate for the typed functions ────────────────────────
-- therapist_profiles.id is uuid. An earlier draft of this migration
-- declared text id params; drop both signatures so a re-run lands a
-- single, correct uuid-typed set instead of leaving stale text overloads.
drop function if exists public.assign_therapist_slug(text);
drop function if exists public.assign_therapist_slug(uuid);
drop function if exists public.generate_therapist_slug(text, text, text);
drop function if exists public.generate_therapist_slug(text, text, uuid);
drop function if exists public.next_available_slug(text, text);
drop function if exists public.next_available_slug(text, uuid);

-- ── 2. slugify(text) -> url-safe base ──────────────────────────────
-- lower -> fold accents -> non-alphanumerics to '-' -> trim '-' ->
-- 'operatore' fallback for empty / symbol-only input. Truly immutable:
-- only built-ins, no extension.
create or replace function public.slugify(p_input text)
returns text
language sql
immutable
as $func$
  select coalesce(
    nullif(
      trim(both '-' from
        regexp_replace(
          translate(
            lower(coalesce(p_input, '')),
            'àáâãäåèéêëìíîïòóôõöùúûüýÿçñ',
            'aaaaaaeeeeiiiiooooouuuuyycn'
          ),
          '[^a-z0-9]+', '-', 'g'
        )
      ),
      ''
    ),
    'operatore'
  );
$func$;

-- ── 3. next_available_slug(stem, self_id) -> stem | stem-2 | stem-3…─
-- Returns `stem` if free, else the first free `stem-N`. `p_self_id`
-- lets a row ignore its own current slug (safe for re-runs).
create or replace function public.next_available_slug(
  p_stem text,
  p_self_id uuid default null
)
returns text
language plpgsql
stable
set search_path = ''
as $func$
declare
  v_candidate text := p_stem;
  v_n integer := 1;
begin
  loop
    if not exists (
      select 1 from public.therapist_profiles
      where slug = v_candidate
        and (p_self_id is null or id <> p_self_id)
    ) then
      return v_candidate;
    end if;
    v_n := v_n + 1;
    v_candidate := p_stem || '-' || v_n::text;
  end loop;
end;
$func$;

-- ── 4. generate_therapist_slug(name, city, self_id) ────────────────
-- The single source of truth for the disambiguation policy (reused by
-- the backfill, the approval trigger, and assign_therapist_slug):
--   base = slugify(name)
--   if base is free  -> base            (first-mover keeps the clean link)
--   else city present -> next_available(base-city)   (sarah-sivieri-milano)
--   else              -> next_available(base)         (sarah-sivieri-2)
create or replace function public.generate_therapist_slug(
  p_name text,
  p_city text,
  p_self_id uuid default null
)
returns text
language plpgsql
stable
set search_path = ''
as $func$
declare
  v_base text;
  v_stem text;
begin
  v_base := public.slugify(p_name);

  if not exists (
    select 1 from public.therapist_profiles
    where slug = v_base
      and (p_self_id is null or id <> p_self_id)
  ) then
    return v_base;
  end if;

  if p_city is not null and length(btrim(p_city)) > 0 then
    v_stem := v_base || '-' || public.slugify(p_city);
  else
    v_stem := v_base;
  end if;

  return public.next_available_slug(v_stem, p_self_id);
end;
$func$;

-- ── 5. assign_therapist_slug(id) -> text (service-role entry point) ─
-- Called by the admin approve route. Row-locks the therapist, assigns a
-- slug ONLY when none exists yet (stability), returns the effective slug.
create or replace function public.assign_therapist_slug(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_existing text;
  v_name     text;
  v_city     text;
  v_slug     text;
begin
  select slug, display_name, city
    into v_existing, v_name, v_city
    from public.therapist_profiles
   where id = p_id
   for update;

  if not found then
    raise exception 'assign_therapist_slug: therapist % not found', p_id;
  end if;

  if v_existing is not null then
    return v_existing;            -- never overwrite an assigned slug
  end if;

  v_slug := public.generate_therapist_slug(v_name, v_city, p_id);
  update public.therapist_profiles set slug = v_slug where id = p_id;
  return v_slug;
end;
$func$;

-- Lock the RPC down to service-role (the admin client). PostgREST would
-- otherwise expose it to anon/authenticated.
revoke all on function public.assign_therapist_slug(uuid) from public;
grant execute on function public.assign_therapist_slug(uuid) to service_role;

-- ── 6. Backfill (created_at ASC so the oldest duplicate wins clean) ─
-- Loop, not a single UPDATE: each row's dedup must see slugs assigned
-- earlier in the same pass. Re-runnable (only touches slug IS NULL).
do $func$
declare
  r record;
  v_slug text;
begin
  for r in
    select id, display_name, city
      from public.therapist_profiles
     where slug is null
     order by created_at asc, id asc
  loop
    v_slug := public.generate_therapist_slug(r.display_name, r.city, r.id);
    update public.therapist_profiles set slug = v_slug where id = r.id;
  end loop;
end;
$func$;

-- ── 7. Approval safety-net trigger ─────────────────────────────────
-- Primary assignment is the admin approve route's RPC, but if ANY
-- trusted path moves a row into the approved state while slug IS NULL,
-- fill it here so an approved row is never slug-less. Guarded to trusted
-- callers (service_role, or a direct SQL session with no JWT) so a
-- therapist can't mint a slug by spoofing approval_status. BEFORE so it
-- mutates NEW.slug inline (no recursive UPDATE); the slug-set path
-- (NEW.slug already non-null) short-circuits, so no recursion.
create or replace function public.therapist_slug_on_approval()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
  if new.slug is null
     and new.approval_status = 'approved'
     and new.display_name is not null
     and length(btrim(new.display_name)) > 0
     and (
       current_setting('request.jwt.claims', true) is null
       or current_setting('request.jwt.claims', true) = ''
       or current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
     )
  then
    new.slug := public.generate_therapist_slug(new.display_name, new.city, new.id);
  end if;
  return new;
end;
$func$;

drop trigger if exists therapist_profiles_slug_on_approval on public.therapist_profiles;
create trigger therapist_profiles_slug_on_approval
  before insert or update of approval_status, slug
  on public.therapist_profiles
  for each row
  execute function public.therapist_slug_on_approval();

-- ── 8. Protect slug from therapist self-edits (stability guard) ────
-- Re-declare the current protect fn (from 20260528120000) verbatim and
-- append: a non-service / non-allowlisted caller can never change an
-- already-set slug (revert to OLD). NULL -> value is still allowed so
-- the approval trigger / service_role can assign it once.
create or replace function public.protect_therapist_admin_columns()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
    if current_setting('request.jwt.claims', true)::json->>'role' != 'service_role'
        and current_setting('app.allow_therapist_review_submit', true) != 'true'
        and current_setting('app.allow_therapist_rating_update', true) != 'true'
    then
        new.is_approved := old.is_approved;
        new.approval_status := old.approval_status;
        new.is_verified := old.is_verified;
        new.average_rating := old.average_rating;
        new.total_reviews := old.total_reviews;
        new.stripe_connected_account_id := old.stripe_connected_account_id;
        new.stripe_account_status := old.stripe_account_status;
        new.tier := old.tier;

        if new.tier_request_status is distinct from old.tier_request_status
            and new.tier_request_status <> 'pending'
        then
            new.tier_request_status := old.tier_request_status;
        end if;

        -- slug is system-owned: once set it is immutable to the
        -- therapist (prevents link-breaking renames). A NULL slug stays
        -- NULL until the approval trigger / service_role assigns it.
        if old.slug is not null then
            new.slug := old.slug;
        end if;
    end if;

    return new;
end;
$func$;

-- The protect trigger itself was attached by an earlier migration;
-- CREATE OR REPLACE FUNCTION above swaps the body in place.
