-- ============================================================
-- Migration: therapist_services.is_active column
-- Date: 2026-04-16
-- Purpose: Allow therapists to disable services without deleting them.
--          iOS client queries filter .eq("is_active", true) so inactive
--          services are hidden from bookable lists.
--
-- Idempotent: uses IF NOT EXISTS to safely re-apply if the column was
-- already added via Supabase Studio manually.
-- ============================================================

ALTER TABLE public.therapist_services
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Back-fill: if any existing row has NULL (shouldn't, but safety),
-- treat as active.
UPDATE public.therapist_services
SET is_active = true
WHERE is_active IS NULL;

-- Index to keep is_active filter fast
CREATE INDEX IF NOT EXISTS idx_therapist_services_active
  ON public.therapist_services(therapist_id, is_active)
  WHERE is_active = true;

-- ============================================================
-- Migration: therapist_profiles.gallery_image_urls (ensure exists)
-- Some schema snapshots show this column, some don't. Safe to re-apply.
-- ============================================================

ALTER TABLE public.therapist_profiles
  ADD COLUMN IF NOT EXISTS gallery_image_urls TEXT[] NOT NULL DEFAULT '{}';

-- ============================================================
-- Migration: therapist_profiles.country and users.country (ensure exists)
-- Required so iOS location header can display "City, Country".
-- ============================================================

ALTER TABLE public.therapist_profiles
  ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS country TEXT;
