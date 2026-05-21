-- ─────────────────────────────────────────────────────────────────────────
-- Journal entries — per-session private reflections written by the client.
--
-- Apply once via Supabase dashboard → SQL Editor.
--
-- The body is rendered as italic Cormorant inside the Cammino timeline
-- (when booking_id is set) and as a long-form note on /dashboard/journal.
-- RLS scopes every operation to auth.uid() — neither therapists nor admins
-- can read these (they're the client's private diary).
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

create table if not exists public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  booking_id  uuid references public.bookings(id) on delete set null,
  mood        text check (mood in (
    'stressed','tender','lighter','calm','curious','empty','grateful'
  )),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index if not exists journal_entries_user_created
  on public.journal_entries (user_id, created_at desc);

-- Bookings lookup for the Cammino timeline join (one entry per booking is
-- the common case but not strictly enforced — clients can write multiple
-- notes for one session).
create index if not exists journal_entries_booking
  on public.journal_entries (booking_id)
  where booking_id is not null;

alter table public.journal_entries enable row level security;

drop policy if exists "client_can_read_own_journal" on public.journal_entries;
create policy "client_can_read_own_journal" on public.journal_entries
  for select using (auth.uid() = user_id);

drop policy if exists "client_can_insert_own_journal" on public.journal_entries;
create policy "client_can_insert_own_journal" on public.journal_entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "client_can_update_own_journal" on public.journal_entries;
create policy "client_can_update_own_journal" on public.journal_entries
  for update using (auth.uid() = user_id);

drop policy if exists "client_can_delete_own_journal" on public.journal_entries;
create policy "client_can_delete_own_journal" on public.journal_entries
  for delete using (auth.uid() = user_id);
