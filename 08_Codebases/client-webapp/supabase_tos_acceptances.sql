-- ─────────────────────────────────────────────────────────────────────────
-- ToS Acceptance Tracking — required for art. 1341/1342 c.c. enforceability.
--
-- Apply once via Supabase dashboard → SQL Editor.
-- Then bump TOS_VERSION in the webapp when terms change; users will be
-- redirected to /accept-terms by middleware until they acknowledge.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

create table if not exists public.tos_acceptances (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  user_role           text not null check (user_role in ('client', 'therapist')),
  tos_version         text not null,
  general_accept      boolean not null,
  vessatorie_accept   boolean not null,
  privacy_accept      boolean not null,
  accepted_at         timestamptz not null default now(),
  ip_address          inet,
  user_agent          text,
  document_hash       text,
  unique (user_id, tos_version)
);

create index if not exists tos_acceptances_user_idx
  on public.tos_acceptances (user_id);

create index if not exists tos_acceptances_version_idx
  on public.tos_acceptances (tos_version);

-- RLS — users can read their own acceptances + insert new ones.
alter table public.tos_acceptances enable row level security;

drop policy if exists "tos_acceptances_select_own" on public.tos_acceptances;
create policy "tos_acceptances_select_own"
  on public.tos_acceptances
  for select
  using (auth.uid() = user_id);

drop policy if exists "tos_acceptances_insert_own" on public.tos_acceptances;
create policy "tos_acceptances_insert_own"
  on public.tos_acceptances
  for insert
  with check (auth.uid() = user_id);

-- No update / delete from client — once accepted, the record is immutable
-- (audit trail). Only service role / admin can touch existing rows.

-- Helper view: latest acceptance per user.
create or replace view public.tos_acceptances_latest as
  select distinct on (user_id)
    user_id, user_role, tos_version, general_accept, vessatorie_accept,
    privacy_accept, accepted_at, ip_address
  from public.tos_acceptances
  order by user_id, accepted_at desc;

grant select on public.tos_acceptances_latest to authenticated;

comment on table public.tos_acceptances is
  'Audit trail of Terms acceptances — required for art. 1341/1342 c.c. enforceability of onerous clauses (vessatorie). Includes timestamp, IP, user agent and document hash for non-repudiation.';
