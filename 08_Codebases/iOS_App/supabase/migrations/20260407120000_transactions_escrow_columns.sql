-- Add escrow/payout tracking columns to transactions table

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_connected_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT;

-- Index to speed up the daily payout job query
CREATE INDEX IF NOT EXISTS idx_transactions_payout
  ON transactions (payout_status, payout_after)
  WHERE payout_status = 'pending' AND status = 'completed';
