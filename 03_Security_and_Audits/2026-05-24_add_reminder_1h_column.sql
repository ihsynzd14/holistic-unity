ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reminder_1h_sent_at TIMESTAMPTZ;

-- Backfill: mark all past bookings as "already sent" so the new cron
-- doesn't fire retroactively on its first run.
UPDATE public.bookings
SET reminder_1h_sent_at = NOW()
WHERE scheduled_at < NOW() + INTERVAL '1 hour'
  AND reminder_1h_sent_at IS NULL;