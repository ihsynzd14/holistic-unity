-- ============================================================
-- Migration: early-access lead capture (pre-launch landing page)
-- Date: 2026-05-28
-- Purpose: Persist cold-traffic leads from the /early landing page
--          (holistic-unity-website/early_access.html) so we can:
--            1. Recover abandoners — email is captured BEFORE the quiz.
--            2. Run intent matching from the 6 onboarding answers.
--            3. Send the June 7 "your operator is ready" email to
--               people who saved specific operators.
--
--          Written to ONLY by the `save-early-access-lead` edge
--          function (service role). No anon/authenticated access:
--          RLS is enabled with zero policies, so the table is invisible
--          to the public PostgREST API. The service-role key bypasses
--          RLS, so the edge function can still read/write freely.
--
-- Idempotent: IF NOT EXISTS on table + index, DROP/CREATE on trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.early_access_leads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT NOT NULL,                      -- stored lowercased by the edge fn
    source              TEXT,                               -- 'hero' | 'sticky'
    quiz_answers        JSONB,                              -- { q1_state, q2_focus:[...], q3_modality, ... }
    saved_operators     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ id, name, tier, saved_at }]
    quiz_completed_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Upsert key: one row per person. The hero + sticky forms and page
    -- refreshes all re-fire the capture call, so we dedupe on email.
    CONSTRAINT early_access_leads_email_unique UNIQUE (email)
);

-- Export / dashboard ordering for the June 7 send.
CREATE INDEX IF NOT EXISTS early_access_leads_created_at_idx
    ON public.early_access_leads (created_at DESC);

-- updated_at auto-touch. Reuses the shared trigger function defined in
-- 20260408113500_security_lint_cleanup.sql (set search_path = '').
DROP TRIGGER IF EXISTS set_early_access_leads_updated_at
    ON public.early_access_leads;
CREATE TRIGGER set_early_access_leads_updated_at
    BEFORE UPDATE ON public.early_access_leads
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Lock it down: RLS on, no policies. anon + authenticated see nothing;
-- the edge function's service-role key bypasses RLS entirely.
ALTER TABLE public.early_access_leads ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.early_access_leads IS
    'Pre-launch lead capture from the /early landing page. Email + 6-question intent + saved operators for the June 7 outreach. Written only by the save-early-access-lead edge function (service role); RLS blocks all public access.';
