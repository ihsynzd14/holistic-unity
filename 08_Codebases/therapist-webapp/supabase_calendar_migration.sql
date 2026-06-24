-- ============================================================
-- Calendar Integration: therapist_calendar_integrations table
-- Run this migration in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.therapist_calendar_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    therapist_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    calendar_email TEXT,
    calendar_id TEXT DEFAULT 'primary',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(therapist_id, provider)
);

-- RLS policies
ALTER TABLE public.therapist_calendar_integrations ENABLE ROW LEVEL SECURITY;

-- Therapists can read/update/delete their own integrations
CREATE POLICY "therapist_read_own_integrations"
    ON public.therapist_calendar_integrations FOR SELECT
    USING (auth.uid() = therapist_id);

CREATE POLICY "therapist_insert_own_integrations"
    ON public.therapist_calendar_integrations FOR INSERT
    WITH CHECK (auth.uid() = therapist_id);

CREATE POLICY "therapist_update_own_integrations"
    ON public.therapist_calendar_integrations FOR UPDATE
    USING (auth.uid() = therapist_id);

CREATE POLICY "therapist_delete_own_integrations"
    ON public.therapist_calendar_integrations FOR DELETE
    USING (auth.uid() = therapist_id);

-- Index for fast lookups
CREATE INDEX idx_calendar_integrations_therapist
    ON public.therapist_calendar_integrations(therapist_id);
