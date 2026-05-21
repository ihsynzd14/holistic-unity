-- ============================================================
-- SESSION CREDITS TABLE
-- Tracks remaining sessions from pack purchases.
-- When a client buys a pack of N sessions, the first session is
-- booked immediately; the remaining N-1 sessions become credits
-- tied to that client × therapist × service combination.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.session_credits (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    therapist_id        UUID NOT NULL REFERENCES public.therapist_profiles(id) ON DELETE CASCADE,
    service_id          UUID NOT NULL REFERENCES public.therapist_services(id) ON DELETE RESTRICT,
    pack_booking_id     UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    sessions_total      INTEGER NOT NULL CHECK (sessions_total > 0),
    sessions_remaining  INTEGER NOT NULL CHECK (sessions_remaining >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT remaining_lte_total CHECK (sessions_remaining <= sessions_total)
);

CREATE INDEX IF NOT EXISTS idx_session_credits_client_id ON public.session_credits(client_id);
CREATE INDEX IF NOT EXISTS idx_session_credits_therapist_id ON public.session_credits(therapist_id);

ALTER TABLE public.session_credits ENABLE ROW LEVEL SECURITY;

-- Clients can read their own credits
CREATE POLICY "Clients can read own credits"
    ON public.session_credits FOR SELECT
    USING (auth.uid() = client_id);

-- Clients can insert their own credits (via the app on pack purchase)
CREATE POLICY "Clients can insert own credits"
    ON public.session_credits FOR INSERT
    WITH CHECK (auth.uid() = client_id);

-- Clients can update their own credits (decrement sessions_remaining)
CREATE POLICY "Clients can update own credits"
    ON public.session_credits FOR UPDATE
    USING (auth.uid() = client_id);

-- Therapists can read credits assigned to them
CREATE POLICY "Therapists can read credits for their clients"
    ON public.session_credits FOR SELECT
    USING (auth.uid() = therapist_id);

-- ============================================================
-- Add pack_booking_id column to bookings table
-- Links a credit-use booking back to the original pack purchase.
-- ============================================================

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS pack_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL;
