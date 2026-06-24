-- 2026-04-25: Credit notes for refunded sessions post-invoice
-- Daily cron in admin-dashboard issues nota di credito elettronica via
-- FIC for transactions refunded after the monthly commission invoice
-- has been issued.

-- Track which refunded transactions have been credited (commissione
-- stornata via nota di credito). NULL = pending or pre-invoice refund.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credited_at timestamptz;

-- Partial index for the cron's hot path: scan only uncredited rows.
CREATE INDEX IF NOT EXISTS transactions_uncredited_refunded_idx
  ON public.transactions (therapist_id, created_at)
  WHERE credited_at IS NULL AND status = 'refunded';

-- One row per credit note issued
CREATE TABLE IF NOT EXISTS public.therapist_invoice_credits (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_invoice_id      uuid NOT NULL REFERENCES public.therapist_invoices(id) ON DELETE RESTRICT,
  refunded_gross           numeric(10, 2) NOT NULL,    -- somma sessioni rimborsate (gross_collected style)
  commission_credited      numeric(10, 2) NOT NULL,    -- 20% IVA inclusa
  imponibile               numeric(10, 2) NOT NULL,
  iva                      numeric(10, 2) NOT NULL,
  fic_credit_note_id       bigint NOT NULL,
  fic_credit_note_number   text NOT NULL,
  fic_pdf_url              text,
  sdi_status               text NOT NULL DEFAULT 'pending',
  sdi_status_updated_at    timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS therapist_invoice_credits_therapist_idx
  ON public.therapist_invoice_credits (therapist_id, created_at DESC);

CREATE INDEX IF NOT EXISTS therapist_invoice_credits_invoice_idx
  ON public.therapist_invoice_credits (original_invoice_id);

ALTER TABLE public.therapist_invoice_credits ENABLE ROW LEVEL SECURITY;

-- Therapists read their own credit notes
DROP POLICY IF EXISTS therapist_invoice_credits_select_own
  ON public.therapist_invoice_credits;
CREATE POLICY therapist_invoice_credits_select_own
  ON public.therapist_invoice_credits FOR SELECT
  TO authenticated
  USING (therapist_id = auth.uid());
