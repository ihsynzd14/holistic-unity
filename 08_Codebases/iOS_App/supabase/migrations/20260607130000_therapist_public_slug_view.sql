-- ============================================================
-- Migration: expose therapist slug to client-facing reads
-- Date: 2026-06-07
-- Builds on 20260607120000_therapist_public_slug.sql (adds the column).
--
-- The base therapist_profiles table uses COLUMN-LEVEL grants, so the new
-- `slug` column is NOT readable by anon/authenticated — nor through the
-- security_invoker `therapist_profiles_public` view — until granted.
-- Grant it, then expose `slug` on the view so client list surfaces can
-- build pretty /dashboard/therapists/<slug> links (UUID stays as the
-- fallback). This also unblocks the therapist portal's own-row slug read
-- and the checkout-success therapist join.
--
-- Idempotent: GRANT is repeatable; CREATE OR REPLACE VIEW appends the
-- trailing `slug` column (no DROP ... CASCADE).
-- ============================================================

-- 1. Column-level SELECT on slug for the client roles. Needed by the
--    security_invoker view AND direct base-table reads (therapist portal
--    own-row read, checkout-success embedded therapist join).
grant select (slug) on public.therapist_profiles to anon, authenticated;

-- 2. Append `slug` to the public view. CREATE OR REPLACE keeps the
--    existing grants + security_invoker and only ADDS a trailing column.
--    The column list below MUST match the live view exactly with `slug`
--    appended at the end (if this errors on a column mismatch, diff it
--    against the current view definition and adjust the leading columns).
create or replace view public.therapist_profiles_public
with (security_invoker = true)
as select
  id, display_name, photo_url, bio, tagline, helps_with,
  city, country, latitude, longitude,
  categories, languages, availability,
  average_rating, total_reviews,
  years_experience, has_mfa, is_verified, is_approved,
  profile_completeness, gallery_image_urls,
  video_intro_url, currency, cancellation_policy, approval_status,
  created_at, slug
from public.therapist_profiles
where is_approved = true and approval_status = 'approved';

grant select on public.therapist_profiles_public to anon, authenticated;
