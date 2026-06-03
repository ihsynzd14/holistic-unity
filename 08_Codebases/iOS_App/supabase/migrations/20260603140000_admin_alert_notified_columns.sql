-- Admin alert tracking (A1 + A2 from the pre-launch email audit).
--
-- A1: alert the platform admin when a therapist enters `pending_review`.
-- A2: alert the platform admin when a user submits a `report`.
--
-- Both events are written by direct, client-side inserts (therapist
-- signup from the web app; report submission from iOS), so there is no
-- server code path to hook. Instead a periodic cron
-- (admin-dashboard → /api/cron/admin-alerts) scans for rows where
-- `admin_notified_at IS NULL`, emails the admin via send-brevo-email,
-- then stamps the column. This mirrors the existing cron pattern
-- (billing-reminders / monthly-invoices) and avoids putting secrets in
-- SQL (no pg_net trigger needed).

-- ── Tracking columns ────────────────────────────────────────────────
alter table public.therapist_profiles
  add column if not exists admin_notified_at timestamptz;

alter table public.reports
  add column if not exists admin_notified_at timestamptz;

-- ── Backfill existing rows ──────────────────────────────────────────
-- Stamp everything that exists today so the FIRST cron run only alerts
-- on genuinely new events (otherwise the admin would get flooded with
-- every historical pending therapist / past report on first run).
update public.therapist_profiles
  set admin_notified_at = now()
  where admin_notified_at is null;

update public.reports
  set admin_notified_at = now()
  where admin_notified_at is null;

-- ── Partial indexes ─────────────────────────────────────────────────
-- Keep the cron's "not yet notified" scan cheap (only un-notified rows
-- are indexed, so the index stays tiny).
create index if not exists idx_therapist_profiles_admin_unnotified
  on public.therapist_profiles (approval_status)
  where admin_notified_at is null;

create index if not exists idx_reports_admin_unnotified
  on public.reports (created_at)
  where admin_notified_at is null;

-- ── Re-alert on re-submission ───────────────────────────────────────
-- When a therapist re-submits for review after "changes requested",
-- clear admin_notified_at so the cron alerts the admin again. (The
-- initial signup path leaves the column NULL by default, so it is
-- already covered.) This is the only transition INTO pending_review
-- that an already-notified profile can make.
create or replace function public.submit_therapist_profile_for_review()
returns public.therapist_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id text := auth.uid()::text;
    v_profile public.therapist_profiles;
begin
    if v_user_id is null then
        raise exception 'Not authenticated';
    end if;

    perform set_config('app.allow_therapist_review_submit', 'true', true);

    update public.therapist_profiles
    set
        approval_status = 'pending_review',
        admin_notified_at = null,
        updated_at = now()
    where id::text = v_user_id
      and approval_status in ('draft', 'changes_requested', 'pending_review')
    returning * into v_profile;

    if not found then
        raise exception 'Therapist profile not found or cannot be submitted for review';
    end if;

    return v_profile;
end;
$$;

grant execute on function public.submit_therapist_profile_for_review() to authenticated;
