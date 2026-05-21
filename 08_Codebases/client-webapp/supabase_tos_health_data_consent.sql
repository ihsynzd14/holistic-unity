-- ─────────────────────────────────────────────────────────────────────────
-- Art. 9 GDPR — Explicit consent for processing health-related data.
--
-- Counselling, naturopathy, ayurveda, and similar wellness consultations
-- generate special-category personal data ("data concerning health" — see
-- Recital 35 + WP29 / EDPB guidance). Lawful basis under Art. 6 alone is
-- insufficient; we MUST also satisfy one of the conditions in Art. 9(2),
-- and the only realistic one for a B2C consumer marketplace is Art. 9(2)(a)
-- — explicit consent, freely given, specific, informed, unambiguous, and
-- separate from the general ToS / privacy acceptance.
--
-- This migration adds a dedicated boolean to `tos_acceptances` so the
-- consent is captured AT SIGN-UP TIME, separately from the general ToS
-- and privacy approvals, with a server-recorded timestamp + IP + UA.
-- A NULL value is treated as "no consent on record" by application
-- code (defensive default for any pre-migration row).
--
-- Apply once via Supabase dashboard → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.tos_acceptances
  add column if not exists health_data_accept boolean;

comment on column public.tos_acceptances.health_data_accept is
  'Art. 9(2)(a) GDPR explicit consent for processing data concerning health (counselling/wellness session content, therapist notes, free-text symptom descriptions in chat). NULL = pre-migration row (treat as missing consent in app code). Must be TRUE before any session is booked.';

-- Helper view stays in sync.
create or replace view public.tos_acceptances_latest as
  select distinct on (user_id)
    user_id, user_role, tos_version, general_accept, vessatorie_accept,
    privacy_accept, health_data_accept, accepted_at, ip_address
  from public.tos_acceptances
  order by user_id, accepted_at desc;

grant select on public.tos_acceptances_latest to authenticated;
