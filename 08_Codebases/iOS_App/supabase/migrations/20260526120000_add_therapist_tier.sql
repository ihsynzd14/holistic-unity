-- ============================================================
-- Migration: therapist_profiles.tier (credential level)
-- Date: 2026-05-26
-- Purpose: Track each therapist's credential level so the apps can
--          show a tier badge next to their name (Practitioner /
--          Trainer / Supervisor). Only admins / service_role can
--          assign or change a tier — therapists cannot promote
--          themselves.
--
-- Idempotent: uses IF NOT EXISTS on the type, column, and index.
-- ============================================================

-- 1. Enum type for the three credential levels.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'therapist_tier') THEN
        CREATE TYPE public.therapist_tier AS ENUM (
            'practitioner',
            'trainer',
            'supervisor'
        );
    END IF;
END
$$;

-- 2. Add the column. Default 'practitioner' so existing therapists
--    keep working without manual backfill — admins can promote later.
ALTER TABLE public.therapist_profiles
    ADD COLUMN IF NOT EXISTS tier public.therapist_tier
        NOT NULL DEFAULT 'practitioner';

-- 3. Partial indexes for the non-default tiers (most therapists will
--    be 'practitioner', so a normal btree index would be wasted space).
CREATE INDEX IF NOT EXISTS therapist_profiles_tier_trainer_idx
    ON public.therapist_profiles(tier)
    WHERE tier = 'trainer';

CREATE INDEX IF NOT EXISTS therapist_profiles_tier_supervisor_idx
    ON public.therapist_profiles(tier)
    WHERE tier = 'supervisor';

-- 4. Add `tier` to the admin-only protected columns.
--    Re-declare the latest version of the function (from
--    20260408113500_security_lint_cleanup.sql) with `tier` appended.
CREATE OR REPLACE FUNCTION public.protect_therapist_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role'
        AND current_setting('app.allow_therapist_review_submit', true) != 'true'
        AND current_setting('app.allow_therapist_rating_update', true) != 'true'
    THEN
        NEW.is_approved := OLD.is_approved;
        NEW.approval_status := OLD.approval_status;
        NEW.is_verified := OLD.is_verified;
        NEW.average_rating := OLD.average_rating;
        NEW.total_reviews := OLD.total_reviews;
        NEW.stripe_connected_account_id := OLD.stripe_connected_account_id;
        NEW.stripe_account_status := OLD.stripe_account_status;
        NEW.tier := OLD.tier;
    END IF;

    RETURN NEW;
END;
$$;
