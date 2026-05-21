-- GDPR Marketing Consent: Add opt-in marketing consent fields to users table.
-- marketing_consent defaults to false (opt-in, not opt-out) per GDPR requirements.
-- marketing_consent_date records WHEN consent was given/revoked for audit trail.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS marketing_consent_date TIMESTAMPTZ;

-- Allow authenticated users to update their own marketing consent
-- (This is already covered by the existing RLS policy that lets users update their own row)

COMMENT ON COLUMN public.users.marketing_consent IS 'GDPR: user opted in to receive marketing emails, promotions, and vouchers';
COMMENT ON COLUMN public.users.marketing_consent_date IS 'GDPR: timestamp of last consent change (for audit trail)';
