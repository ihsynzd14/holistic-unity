-- 2026-04-25: FattureInCloud integration
-- Storm X Digital S.R.L. issues monthly commission invoices to therapists
-- via FIC API + SDI submission. See docs/specs/2026-04-25-therapist-invoices-fattureincloud.md

-- Single-row table for the platform-wide FIC OAuth credentials
CREATE TABLE IF NOT EXISTS public.fattureincloud_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token    text NOT NULL,
  refresh_token   text NOT NULL,
  expires_at      timestamptz NOT NULL,
  company_id      bigint NOT NULL,
  scope           text,
  connected_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fattureincloud_credentials ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all for authenticated/anon. Service_role bypasses.

-- Per-therapist FIC client mapping + Italian billing identity
ALTER TABLE public.therapist_profiles
  ADD COLUMN IF NOT EXISTS fic_client_id        bigint,
  ADD COLUMN IF NOT EXISTS p_iva                 text,
  ADD COLUMN IF NOT EXISTS codice_fiscale        text,
  ADD COLUMN IF NOT EXISTS codice_destinatario   text,
  ADD COLUMN IF NOT EXISTS pec_email             text,
  ADD COLUMN IF NOT EXISTS billing_address       jsonb;

-- Invoice history (one row per monthly invoice issued by Holistic)
CREATE TABLE IF NOT EXISTS public.therapist_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_month          date NOT NULL,
  sessions_count        integer NOT NULL,
  gross_collected       numeric(10, 2) NOT NULL,
  commission_gross      numeric(10, 2) NOT NULL,
  imponibile            numeric(10, 2) NOT NULL,
  iva                   numeric(10, 2) NOT NULL,
  fic_invoice_id        bigint NOT NULL,
  fic_invoice_number    text NOT NULL,
  fic_pdf_url           text,
  sdi_status            text NOT NULL DEFAULT 'pending',
  sdi_status_updated_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (therapist_id, period_month)
);

CREATE INDEX IF NOT EXISTS therapist_invoices_therapist_period_idx
  ON public.therapist_invoices (therapist_id, period_month DESC);

ALTER TABLE public.therapist_invoices ENABLE ROW LEVEL SECURITY;

-- Therapists read their own invoices
DROP POLICY IF EXISTS therapist_invoices_select_own ON public.therapist_invoices;
CREATE POLICY therapist_invoices_select_own
  ON public.therapist_invoices FOR SELECT
  TO authenticated
  USING (therapist_id = auth.uid());
