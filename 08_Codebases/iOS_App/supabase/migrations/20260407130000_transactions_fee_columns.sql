-- Add fee breakdown columns to transactions table
-- These store IVA, service fee, and commission details set by create-payment-intent

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS total_charged     NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_base   NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_amount        NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_applied       BOOLEAN        DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_fee       NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS therapist_country TEXT           DEFAULT '';
