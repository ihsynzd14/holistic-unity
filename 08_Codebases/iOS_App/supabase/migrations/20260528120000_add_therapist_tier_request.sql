-- ============================================================
-- Migration: therapist tier self-declaration + admin review queue
-- Date: 2026-05-28
-- Purpose: Let therapists declare what tier they qualify for during
--          onboarding without making that declaration public. Admin
--          reviews and either promotes the live `tier` column to the
--          requested value or rejects. Clients always see the verified
--          `tier`, never the unverified `requested_tier`.
--
-- Builds on 20260526120000_add_therapist_tier.sql (which added the
-- `therapist_tier` enum + `tier` column + protection on `tier`).
--
-- Idempotent: uses IF NOT EXISTS on the new enum, columns, and index.
-- ============================================================

-- 1. Enum for the admin's decision on a tier request.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'therapist_tier_request_status') THEN
        CREATE TYPE public.therapist_tier_request_status AS ENUM (
            'pending',
            'approved',
            'rejected'
        );
    END IF;
END
$$;

-- 2. Two new columns on therapist_profiles.
--    - requested_tier: what the therapist claims (writable by them).
--    - tier_request_status: admin's decision on that claim (admin-only).
ALTER TABLE public.therapist_profiles
    ADD COLUMN IF NOT EXISTS requested_tier public.therapist_tier;

ALTER TABLE public.therapist_profiles
    ADD COLUMN IF NOT EXISTS tier_request_status public.therapist_tier_request_status;

-- 3. Partial index for the admin review queue. The vast majority of
--    rows will have NULL status (no request yet) so a full index would
--    waste space — partial keeps lookups instant for the queue UI.
CREATE INDEX IF NOT EXISTS therapist_profiles_tier_request_pending_idx
    ON public.therapist_profiles(tier_request_status)
    WHERE tier_request_status = 'pending';

-- 4. Extend the admin-only protection so therapists can't approve
--    their own request. `requested_tier` is intentionally NOT protected
--    here — the therapist needs to be able to write it from onboarding.
--    `tier_request_status` IS protected: only admin / service_role can
--    set 'approved' or 'rejected'. The therapist can set it to 'pending'
--    when they submit, which we allow because the trigger only blocks
--    CHANGES — the initial NULL → 'pending' transition isn't reversed
--    here (we'll see why below).
--
--    Wait, the trigger as-written reverts ANY change. We need to allow
--    the therapist to flip NULL → 'pending' (initial submission) AND
--    'rejected' → 'pending' (resubmission after fixing certs). But we
--    must block 'pending' → 'approved' from the therapist side.
--
--    Solution: allow the change only when the NEW value is 'pending'
--    (therapist can request/re-request) but block 'approved' and
--    'rejected' which are admin-only.
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

        -- Therapists can flip tier_request_status to 'pending' (submit
        -- or re-submit a request) but NOT to 'approved' / 'rejected'.
        -- If they try, silently revert to the old value.
        IF NEW.tier_request_status IS DISTINCT FROM OLD.tier_request_status
            AND NEW.tier_request_status <> 'pending'
        THEN
            NEW.tier_request_status := OLD.tier_request_status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
