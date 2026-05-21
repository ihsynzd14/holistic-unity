-- ─────────────────────────────────────────────────────────────────────────
-- therapist_profiles.categories validation trigger.
--
-- Background:
--   `therapist_profiles.categories` is a free-text `text[]`. The
--   marketplace + practices listing rely on it joining (by exact
--   string match) against `practices.category_key`. A previous bug
--   (2026-05-05) had therapists with `["Naturopathy", "Numerology"]`
--   while practices used `["Naturopatia", "Numerologia"]` — same
--   discipline, different language — and the practices listing
--   silently rendered "In arrivo" badges on practices that actually
--   had bookable therapists. Cost: full discoverability loss for
--   those practices.
--
-- This trigger blocks future regressions at write time:
--   - INSERTs and UPDATEs that touch `categories` are validated
--   - Any value in `categories` not present in `practices.category_key`
--     causes the write to fail with a clear error message listing
--     the invalid values + the canonical valid set
--   - NULL or empty `categories` are allowed (a therapist may have
--     no categories yet during onboarding)
--   - The trigger does NOT filter by `practices.is_published`:
--     temporarily unpublishing a practice should not lock all of
--     its therapists out of editing their profile
--
-- The error message includes the full valid set so a therapist who
-- mistyped sees exactly what to use. The therapist webapp profile
-- editor should also surface this 23514 error inline rather than
-- a generic "save failed" toast.
--
-- Apply once via Supabase dashboard → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.validate_therapist_categories()
returns trigger
language plpgsql
as $$
declare
  invalid_categories text[];
  valid_set text;
begin
  if NEW.categories is null or array_length(NEW.categories, 1) is null then
    return NEW;
  end if;

  select array_agg(c)
  into invalid_categories
  from unnest(NEW.categories) as c
  where c not in (select category_key from public.practices);

  if invalid_categories is not null
     and array_length(invalid_categories, 1) > 0 then
    select string_agg(category_key, ', ' order by display_order)
    into valid_set
    from public.practices;

    raise exception
      'Invalid therapist_profiles.categories %: %. Valid values are: %',
      'values',
      invalid_categories,
      valid_set
      using errcode = '23514'; -- check_violation, surfaceable to clients
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_therapist_categories on public.therapist_profiles;

create trigger trg_validate_therapist_categories
  before insert or update of categories on public.therapist_profiles
  for each row
  execute function public.validate_therapist_categories();

comment on function public.validate_therapist_categories() is
  'Rejects therapist_profiles.categories[] values that don''t match an existing practices.category_key. Prevents the language-mismatch class of bug where therapists end up with English category strings while practices listing uses Italian, silently hiding them from discovery.';
