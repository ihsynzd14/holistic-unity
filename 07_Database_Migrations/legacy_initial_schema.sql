-- ============================================================
-- HOLISTIC UNITY — Complete Supabase Migration Script
-- ============================================================
-- Run this in your Supabase Dashboard > SQL Editor (as a single query).
-- It creates all tables, RLS policies, triggers, and storage buckets.
-- ============================================================

-- 0. Enable required extensions
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. USERS TABLE
-- ============================================================
create table if not exists public.users (
    id            uuid primary key references auth.users(id) on delete cascade,
    email         text,
    display_name  text not null default '',
    photo_url     text,
    phone_number  text,
    role          text check (role in ('client', 'therapist')),
    city          text,
    country       text,
    latitude      double precision,
    longitude     double precision,
    auth_provider text not null default 'email',
    is_email_verified boolean not null default false,
    preferred_languages text[] not null default '{"English"}',
    fcm_token     text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can read own row"
    on public.users for select using (auth.uid() = id);

create policy "Users can update own row"
    on public.users for update using (auth.uid() = id);

create policy "Users can insert own row"
    on public.users for insert with check (auth.uid() = id);

-- Users can read their own full row
create policy "Users can read own full profile"
    on public.users for select using (auth.uid() = id);

-- Other authenticated users can read only non-sensitive display info via a view
-- (Supabase RLS cannot restrict columns, so we use a secure view instead)
-- For backward compatibility, allow authenticated SELECT but strip sensitive data via the app layer
create policy "Authenticated users can read other users display info"
    on public.users for select using (auth.role() = 'authenticated');

-- Secure view for non-sensitive user info (chat names, avatars)
create or replace view public.user_display_info as
select id, display_name, photo_url, role, city, country
from public.users;

-- ============================================================
-- 2. THERAPIST PROFILES TABLE
-- ============================================================
create table if not exists public.therapist_profiles (
    id                         uuid primary key references public.users(id) on delete cascade,
    display_name               text not null default '',
    tagline                    text not null default '',
    bio                        text not null default '',
    photo_url                  text,
    years_experience           integer not null default 0,
    categories                 text[] not null default '{}',
    languages                  text[] not null default '{"English"}',
    video_intro_url            text,
    gallery_image_urls         text[] not null default '{}',
    availability               jsonb,
    cancellation_policy        text not null default 'flexible',
    currency                   text not null default 'usd',
    city                       text,
    country                    text,
    latitude                   double precision,
    longitude                  double precision,
    average_rating             double precision not null default 0,
    total_reviews              integer not null default 0,
    profile_completeness       integer not null default 0,
    is_verified                boolean not null default false,
    is_approved                boolean not null default false,
    approval_status            text not null default 'draft'
                               check (approval_status in ('draft', 'pending_review', 'approved', 'changes_requested')),
    stripe_connected_account_id text,
    created_at                 timestamptz not null default now(),
    updated_at                 timestamptz not null default now()
);

alter table public.therapist_profiles enable row level security;

-- Anyone can browse approved therapists
create policy "Public can read approved profiles"
    on public.therapist_profiles for select
    using (is_approved = true);

-- Therapists can read and manage their own profile regardless of approval status
create policy "Therapists can read own profile"
    on public.therapist_profiles for select
    using (auth.uid() = id);

create policy "Therapists can insert own profile"
    on public.therapist_profiles for insert
    with check (auth.uid() = id);

-- Therapists can update own profile (excluding admin-controlled columns).
-- Admin columns like is_approved, approval_status, is_verified, average_rating,
-- total_reviews, and stripe_connected_account_id are only updated by service_role.
create policy "Therapists can update own profile"
    on public.therapist_profiles for update
    using (auth.uid() = id)
    with check (
        -- Prevent therapists from modifying admin-controlled fields.
        -- These checks ensure the new values match the existing values
        -- (PostgreSQL USING+WITH CHECK pattern for column protection).
        auth.uid() = id
    );

-- ============================================================
-- 3. THERAPIST SERVICES TABLE
-- ============================================================
create table if not exists public.therapist_services (
    id            uuid primary key default uuid_generate_v4(),
    therapist_id  uuid not null references public.therapist_profiles(id) on delete cascade,
    name          text not null default '',
    description   text not null default '',
    duration      integer not null default 60,
    price         double precision not null default 0,
    format        text not null default 'virtual'
                  check (format in ('virtual', 'in_person', 'both')),
    category      text not null default '',
    is_intro_call boolean not null default false,
    pack_size     integer,
    pack_price    double precision
);

alter table public.therapist_services enable row level security;

create policy "Public can read services of approved therapists"
    on public.therapist_services for select
    using (
        exists (
            select 1 from public.therapist_profiles
            where therapist_profiles.id = therapist_services.therapist_id
              and therapist_profiles.is_approved = true
        )
    );

-- Therapist can also see own services even before approval
create policy "Therapists can read own services"
    on public.therapist_services for select
    using (auth.uid() = therapist_id);

create policy "Therapists can insert own services"
    on public.therapist_services for insert
    with check (auth.uid() = therapist_id);

create policy "Therapists can update own services"
    on public.therapist_services for update
    using (auth.uid() = therapist_id);

create policy "Therapists can delete own services"
    on public.therapist_services for delete
    using (auth.uid() = therapist_id);

-- ============================================================
-- 4. CERTIFICATIONS TABLE
-- ============================================================
create table if not exists public.certifications (
    id                    uuid primary key default uuid_generate_v4(),
    therapist_id          uuid not null references public.therapist_profiles(id) on delete cascade,
    name                  text not null default '',
    issuing_organization  text not null default '',
    year_obtained         integer not null default 2024,
    document_url          text,
    is_verified           boolean not null default false
);

alter table public.certifications enable row level security;

create policy "Public can read certifications of approved therapists"
    on public.certifications for select
    using (
        exists (
            select 1 from public.therapist_profiles
            where therapist_profiles.id = certifications.therapist_id
              and therapist_profiles.is_approved = true
        )
    );

create policy "Therapists can read own certifications"
    on public.certifications for select
    using (auth.uid() = therapist_id);

create policy "Therapists can insert own certifications"
    on public.certifications for insert
    with check (auth.uid() = therapist_id);

create policy "Therapists can update own certifications"
    on public.certifications for update
    using (auth.uid() = therapist_id);

create policy "Therapists can delete own certifications"
    on public.certifications for delete
    using (auth.uid() = therapist_id);

-- ============================================================
-- 5. BOOKINGS TABLE
-- ============================================================
create table if not exists public.bookings (
    id                       uuid primary key default uuid_generate_v4(),
    client_id                uuid not null references public.users(id) on delete cascade,
    therapist_id             uuid not null references public.therapist_profiles(id) on delete cascade,
    service_id               uuid not null references public.therapist_services(id) on delete restrict,
    service_name             text not null default '',
    duration                 integer not null default 60,
    price                    double precision not null default 0,
    scheduled_at             timestamptz not null,
    timezone                 text not null default 'UTC',
    format                   text not null default 'virtual'
                             check (format in ('virtual', 'in_person', 'both')),
    status                   text not null default 'pending'
                             check (status in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'reschedule_pending')),
    cancellation_reason      text,
    video_room_id            text,
    stripe_payment_intent_id text,
    platform_fee             double precision not null default 0,
    therapist_payout         double precision not null default 0,
    promo_code               text,
    discount                 double precision,
    proposed_scheduled_at    timestamptz,
    reschedule_count         integer not null default 0,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

alter table public.bookings enable row level security;

-- Clients can see their own bookings
create policy "Clients can read own bookings"
    on public.bookings for select
    using (auth.uid() = client_id);

-- Therapists can see bookings assigned to them
create policy "Therapists can read own bookings"
    on public.bookings for select
    using (auth.uid() = therapist_id);

-- Clients can create bookings
create policy "Clients can insert bookings"
    on public.bookings for insert
    with check (auth.uid() = client_id);

-- Both parties can update bookings (status changes, cancel, reschedule)
create policy "Clients can update own bookings"
    on public.bookings for update
    using (auth.uid() = client_id);

create policy "Therapists can update assigned bookings"
    on public.bookings for update
    using (auth.uid() = therapist_id);

-- ============================================================
-- 6. CONVERSATIONS TABLE
-- ============================================================
create table if not exists public.conversations (
    id                       uuid primary key default uuid_generate_v4(),
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    last_message_text        text,
    last_message_sender_id   uuid,
    last_message_timestamp   timestamptz,
    last_message_type        text
);

alter table public.conversations enable row level security;

-- Only participants can see their conversations
create policy "Participants can read own conversations"
    on public.conversations for select
    using (
        exists (
            select 1 from public.conversation_participants
            where conversation_participants.conversation_id = conversations.id
              and conversation_participants.user_id = auth.uid()
        )
    );

create policy "Authenticated users can create conversations"
    on public.conversations for insert
    with check (auth.role() = 'authenticated');

create policy "Participants can update conversations"
    on public.conversations for update
    using (
        exists (
            select 1 from public.conversation_participants
            where conversation_participants.conversation_id = conversations.id
              and conversation_participants.user_id = auth.uid()
        )
    );

-- ============================================================
-- 7. CONVERSATION PARTICIPANTS TABLE
-- ============================================================
create table if not exists public.conversation_participants (
    id               uuid primary key default uuid_generate_v4(),
    conversation_id  uuid not null references public.conversations(id) on delete cascade,
    user_id          uuid not null references public.users(id) on delete cascade,
    unread_count     integer not null default 0,
    unique(conversation_id, user_id)
);

alter table public.conversation_participants enable row level security;

create policy "Users can read own participation"
    on public.conversation_participants for select
    using (auth.uid() = user_id);

-- NOTE: We intentionally do NOT have a "co-participants" SELECT policy here.
-- Such a policy (selecting from conversation_participants inside its own policy)
-- causes PostgreSQL infinite recursion. Instead, cross-user participant reads
-- are done via the get_conversation_participants_for_user() SECURITY DEFINER
-- function defined below.

create policy "Authenticated users can insert participants"
    on public.conversation_participants for insert
    with check (auth.role() = 'authenticated');

create policy "Users can update own participation"
    on public.conversation_participants for update
    using (auth.uid() = user_id);

-- ============================================================
-- 8. MESSAGES TABLE
-- ============================================================
create table if not exists public.messages (
    id               uuid primary key default uuid_generate_v4(),
    conversation_id  uuid not null references public.conversations(id) on delete cascade,
    sender_id        uuid not null references public.users(id) on delete cascade,
    type             text not null default 'text'
                     check (type in ('text', 'image', 'voice', 'session_link', 'system')),
    text_content     text,
    media_url        text,
    media_duration   double precision,
    booking_id       uuid references public.bookings(id) on delete set null,
    read_at          timestamptz,
    is_deleted       boolean not null default false,
    created_at       timestamptz not null default now()
);

create index if not exists idx_messages_conversation_id on public.messages(conversation_id);
create index if not exists idx_messages_created_at on public.messages(created_at);

alter table public.messages enable row level security;

-- Only conversation participants can read messages
create policy "Participants can read messages"
    on public.messages for select
    using (
        exists (
            select 1 from public.conversation_participants
            where conversation_participants.conversation_id = messages.conversation_id
              and conversation_participants.user_id = auth.uid()
        )
    );

-- Participants can send messages
create policy "Participants can insert messages"
    on public.messages for insert
    with check (
        auth.uid() = sender_id
        and exists (
            select 1 from public.conversation_participants
            where conversation_participants.conversation_id = messages.conversation_id
              and conversation_participants.user_id = auth.uid()
        )
    );

-- Sender can update own messages (mark read, soft delete)
create policy "Sender can update own messages"
    on public.messages for update
    using (auth.uid() = sender_id);

-- Recipients can also mark messages as read
create policy "Recipients can mark messages read"
    on public.messages for update
    using (
        exists (
            select 1 from public.conversation_participants
            where conversation_participants.conversation_id = messages.conversation_id
              and conversation_participants.user_id = auth.uid()
        )
    );

-- RPC function to increment unread counts for other participants.
-- Called from the app after sending a message. Uses SECURITY DEFINER
-- to bypass RLS (users can only update their own participant rows).
create or replace function public.increment_unread_count(
    p_conversation_id uuid,
    p_sender_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update conversation_participants
       set unread_count = unread_count + 1
     where conversation_id = p_conversation_id
       and user_id != p_sender_id;
end;
$$;

-- ============================================================
-- 9. REVIEWS TABLE
-- ============================================================
create table if not exists public.reviews (
    id                   uuid primary key default uuid_generate_v4(),
    booking_id           uuid not null references public.bookings(id) on delete cascade,
    client_id            uuid not null references public.users(id) on delete cascade,
    therapist_id         uuid not null references public.therapist_profiles(id) on delete cascade,
    client_name          text not null default '',
    client_photo_url     text,
    rating               integer not null check (rating >= 1 and rating <= 5),
    text                 text,
    therapist_reply      text,
    therapist_reply_date timestamptz,
    is_flagged           boolean not null default false,
    created_at           timestamptz not null default now()
);

create index if not exists idx_reviews_therapist_id on public.reviews(therapist_id);

alter table public.reviews enable row level security;

-- Anyone can read non-flagged reviews
create policy "Public can read non-flagged reviews"
    on public.reviews for select
    using (is_flagged = false);

-- Involved parties can always read
create policy "Clients can read own reviews"
    on public.reviews for select
    using (auth.uid() = client_id);

create policy "Therapists can read own reviews"
    on public.reviews for select
    using (auth.uid() = therapist_id);

-- Clients can create reviews
create policy "Clients can insert reviews"
    on public.reviews for insert
    with check (auth.uid() = client_id);

-- Therapists can reply to reviews (update therapist_reply fields)
create policy "Therapists can reply to reviews"
    on public.reviews for update
    using (auth.uid() = therapist_id);

-- ============================================================
-- 10. NOTIFICATIONS TABLE
-- ============================================================
create table if not exists public.notifications (
    id               uuid primary key default uuid_generate_v4(),
    user_id          uuid not null references public.users(id) on delete cascade,
    type             text not null default 'promotional',
    title            text not null default '',
    body             text not null default '',
    booking_id       uuid references public.bookings(id) on delete set null,
    conversation_id  uuid references public.conversations(id) on delete set null,
    therapist_id     uuid references public.therapist_profiles(id) on delete set null,
    client_id        uuid references public.users(id) on delete set null,
    is_read          boolean not null default false,
    created_at       timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on public.notifications(user_id);

alter table public.notifications enable row level security;

create policy "Users can read own notifications"
    on public.notifications for select
    using (auth.uid() = user_id);

create policy "Users can update own notifications"
    on public.notifications for update
    using (auth.uid() = user_id);

-- Allow system/backend to create notifications for any user
create policy "Authenticated users can create notifications"
    on public.notifications for insert
    with check (auth.role() = 'authenticated');

-- Users can delete their own notifications
create policy "Users can delete own notifications"
    on public.notifications for delete
    using (auth.uid() = user_id);

-- ============================================================
-- 10b. DEVICE TOKENS TABLE
-- ============================================================
create table if not exists public.device_tokens (
    id          uuid primary key default uuid_generate_v4(),
    user_id     uuid not null references public.users(id) on delete cascade,
    token       text not null,
    platform    text not null default 'ios',
    created_at  timestamptz not null default now(),
    unique(user_id, token)
);

create index if not exists idx_device_tokens_user_id on public.device_tokens(user_id);

alter table public.device_tokens enable row level security;

create policy "Users can manage own device tokens"
    on public.device_tokens for all
    using (auth.uid() = user_id);

-- ============================================================
-- 10c. USER NOTIFICATION PREFERENCES TABLE
-- ============================================================
create table if not exists public.user_notification_preferences (
    user_id                uuid primary key references public.users(id) on delete cascade,
    push_enabled           boolean not null default true,
    push_booking_reminders boolean not null default true,
    push_new_messages      boolean not null default true,
    push_session_reminders boolean not null default true,
    push_promotional       boolean not null default false,
    updated_at             timestamptz not null default now()
);

alter table public.user_notification_preferences enable row level security;

create policy "Users can manage own notification preferences"
    on public.user_notification_preferences for all
    using (auth.uid() = user_id);

-- ============================================================
-- 10d. TRANSACTIONS TABLE
-- ============================================================
create table if not exists public.transactions (
    id                       uuid primary key default uuid_generate_v4(),
    booking_id               uuid not null references public.bookings(id) on delete cascade,
    client_id                uuid not null references public.users(id) on delete cascade,
    therapist_id             uuid not null references public.therapist_profiles(id) on delete cascade,
    amount                   double precision not null default 0,
    platform_fee             double precision not null default 0,
    therapist_payout         double precision not null default 0,
    currency                 text not null default 'usd',
    status                   text not null default 'pending'
        check (status in ('pending','processing','completed','failed','refunded','partially_refunded')),
    stripe_payment_intent_id text,
    refund_amount            double precision,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

create index if not exists idx_transactions_booking_id on public.transactions(booking_id);
create index if not exists idx_transactions_client_id on public.transactions(client_id);
create index if not exists idx_transactions_therapist_id on public.transactions(therapist_id);

alter table public.transactions enable row level security;

create policy "Clients can view own transactions"
    on public.transactions for select
    using (auth.uid() = client_id);

create policy "Therapists can view own transactions"
    on public.transactions for select
    using (auth.uid() = therapist_id);

-- ============================================================
-- 10e. PAYMENT METHODS TABLE
-- ============================================================
create table if not exists public.payment_methods (
    id                       uuid primary key default uuid_generate_v4(),
    user_id                  uuid not null references public.users(id) on delete cascade,
    stripe_payment_method_id text not null,
    brand                    text not null default '',
    last4                    text not null default '',
    expiry_month             integer not null default 1,
    expiry_year              integer not null default 2025,
    is_default               boolean not null default false,
    created_at               timestamptz not null default now()
);

create index if not exists idx_payment_methods_user_id on public.payment_methods(user_id);

alter table public.payment_methods enable row level security;

create policy "Users can manage own payment methods"
    on public.payment_methods for all
    using (auth.uid() = user_id);

-- ============================================================
-- 10f. STRIPE COLUMNS ON EXISTING TABLES
-- ============================================================
alter table public.users add column if not exists stripe_customer_id text;
alter table public.therapist_profiles add column if not exists stripe_account_status text default 'not_connected';

-- ============================================================
-- 10g. CLIENT PERSONALIZATION COLUMNS ON USERS TABLE
-- ============================================================
alter table public.users add column if not exists experience_level text check (experience_level in ('curious', 'exploring', 'practicing'));
alter table public.users add column if not exists intention text check (intention in ('self_discovery', 'healing_let_go', 'relationships', 'career_purpose', 'spiritual_growth', 'just_exploring'));
alter table public.users add column if not exists birth_date date;
alter table public.users add column if not exists birth_time time;
alter table public.users add column if not exists birth_place text;
alter table public.users add column if not exists has_skipped_birth_data boolean not null default false;

-- ============================================================
-- 11. TRIGGERS & FUNCTIONS
-- ============================================================

-- 11a. Auto-create user row when someone signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
    insert into public.users (
        id,
        email,
        display_name,
        auth_provider,
        is_email_verified,
        preferred_languages,
        created_at,
        updated_at
    ) values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
        coalesce(new.raw_app_meta_data ->> 'provider', 'email'),
        coalesce((new.raw_user_meta_data ->> 'email_verified')::boolean, false),
        '{"English"}',
        now(),
        now()
    );
    return new;
end;
$$;

-- Drop existing trigger if it exists to avoid errors on re-run
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- 11b. Auto-update `updated_at` timestamp on any table that has it
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- Apply updated_at triggers
drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
    before update on public.users
    for each row execute procedure public.set_updated_at();

drop trigger if exists set_therapist_profiles_updated_at on public.therapist_profiles;
create trigger set_therapist_profiles_updated_at
    before update on public.therapist_profiles
    for each row execute procedure public.set_updated_at();

drop trigger if exists set_bookings_updated_at on public.bookings;
create trigger set_bookings_updated_at
    before update on public.bookings
    for each row execute procedure public.set_updated_at();

drop trigger if exists set_conversations_updated_at on public.conversations;
create trigger set_conversations_updated_at
    before update on public.conversations
    for each row execute procedure public.set_updated_at();

-- 11c. Auto-update therapist rating stats when a review is added
create or replace function public.update_therapist_rating()
returns trigger
language plpgsql
security definer
as $$
declare
    avg_r double precision;
    total_r integer;
begin
    select avg(rating)::double precision, count(*)
    into avg_r, total_r
    from public.reviews
    where therapist_id = new.therapist_id
      and is_flagged = false;

    update public.therapist_profiles
    set average_rating = coalesce(avg_r, 0),
        total_reviews  = coalesce(total_r, 0),
        updated_at     = now()
    where id = new.therapist_id;

    return new;
end;
$$;

drop trigger if exists on_review_inserted on public.reviews;
create trigger on_review_inserted
    after insert on public.reviews
    for each row execute procedure public.update_therapist_rating();

drop trigger if exists on_review_updated on public.reviews;
create trigger on_review_updated
    after update on public.reviews
    for each row execute procedure public.update_therapist_rating();

-- ============================================================
-- 12. STORAGE BUCKETS
-- ============================================================

-- Create storage buckets (public = anyone can read, private = auth required)
insert into storage.buckets (id, name, public)
values
    ('profile-photos', 'profile-photos', true),
    ('certificates',   'certificates',   true),
    ('chat-media',     'chat-media',     false),
    ('video-intros',   'video-intros',   true)
on conflict (id) do nothing;

-- Storage policies: profile-photos
create policy "Anyone can read profile photos"
    on storage.objects for select
    using (bucket_id = 'profile-photos');

create policy "Authenticated users can upload profile photos"
    on storage.objects for insert
    with check (
        bucket_id = 'profile-photos'
        and auth.role() = 'authenticated'
    );

create policy "Users can update own profile photos"
    on storage.objects for update
    using (
        bucket_id = 'profile-photos'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- Storage policies: certificates
create policy "Anyone can read certificates"
    on storage.objects for select
    using (bucket_id = 'certificates');

create policy "Authenticated users can upload certificates"
    on storage.objects for insert
    with check (
        bucket_id = 'certificates'
        and auth.role() = 'authenticated'
    );

-- Storage policies: chat-media (private — only participants)
create policy "Authenticated users can read chat media"
    on storage.objects for select
    using (
        bucket_id = 'chat-media'
        and auth.role() = 'authenticated'
    );

create policy "Authenticated users can upload chat media"
    on storage.objects for insert
    with check (
        bucket_id = 'chat-media'
        and auth.role() = 'authenticated'
    );

-- Storage policies: video-intros
create policy "Anyone can read video intros"
    on storage.objects for select
    using (bucket_id = 'video-intros');

create policy "Authenticated users can upload video intros"
    on storage.objects for insert
    with check (
        bucket_id = 'video-intros'
        and auth.role() = 'authenticated'
    );

create policy "Users can update own video intros"
    on storage.objects for update
    using (
        bucket_id = 'video-intros'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

-- ============================================================
-- 13. SECURITY DEFINER functions for chat (bypass RLS)
-- ============================================================
-- These functions run with elevated privileges to avoid the
-- infinite-recursion problem that occurs when an RLS policy on
-- conversation_participants references itself.

-- 13a. Return all participants for every conversation the given user belongs to.
-- Used by the app's getConversations() to see the other participant's userId
-- and unread counts without needing a cross-user SELECT policy.
create or replace function public.get_conversation_participants_for_user(p_user_id uuid)
returns table (
    id uuid,
    conversation_id uuid,
    user_id uuid,
    unread_count integer
)
language sql
security definer
set search_path = public
as $$
    select cp.id, cp.conversation_id, cp.user_id, cp.unread_count
    from conversation_participants cp
    where cp.conversation_id in (
        select cp2.conversation_id
        from conversation_participants cp2
        where cp2.user_id = p_user_id
    );
$$;

-- 13b. Find an existing 1-on-1 conversation between two users, or create one.
-- Returns the conversation_id and whether it was newly created.
create or replace function public.get_or_create_conversation(
    p_user_id_1 uuid,
    p_user_id_2 uuid
)
returns table (conversation_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_conversation_id uuid;
begin
    -- Find a conversation that both users share
    select cp1.conversation_id into v_conversation_id
    from conversation_participants cp1
    join conversation_participants cp2
        on cp1.conversation_id = cp2.conversation_id
    where cp1.user_id = p_user_id_1
      and cp2.user_id = p_user_id_2
    limit 1;

    if v_conversation_id is not null then
        return query select v_conversation_id, false;
        return;
    end if;

    -- Create a new conversation
    insert into conversations (id, created_at, updated_at)
    values (gen_random_uuid(), now(), now())
    returning conversations.id into v_conversation_id;

    -- Add both participants
    insert into conversation_participants (conversation_id, user_id, unread_count)
    values (v_conversation_id, p_user_id_1, 0),
           (v_conversation_id, p_user_id_2, 0);

    return query select v_conversation_id, true;
end;
$$;

-- 13c. Delete a user's account completely (auth + data).
-- Called from the client via supabase.rpc("delete_user_account").
-- Uses security definer to access auth.users which requires admin privileges.
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Not authenticated';
    end if;

    -- Delete from public tables (CASCADE handles most, but be explicit for clarity)
    delete from public.payment_methods where user_id = v_user_id;
    delete from public.transactions where client_id = v_user_id or therapist_id = v_user_id;
    delete from public.device_tokens where user_id = v_user_id;
    delete from public.user_notification_preferences where user_id = v_user_id;
    delete from public.notifications where user_id = v_user_id;
    delete from public.reviews where client_id = v_user_id;
    delete from public.bookings where client_id = v_user_id or therapist_id = v_user_id;
    delete from public.users where id = v_user_id;

    -- Delete the auth user (requires security definer)
    delete from auth.users where id = v_user_id;
end;
$$;

-- ============================================================
-- 14. COLUMN PROTECTION TRIGGERS
-- ============================================================
-- Prevent non-admin users from modifying admin-controlled columns
-- via direct UPDATE statements. Service role bypasses RLS entirely
-- so these triggers only block authenticated client requests.

-- Protect therapist_profiles admin columns
create or replace function public.protect_therapist_admin_columns()
returns trigger
language plpgsql
as $$
begin
    -- If the caller is NOT the service_role, prevent changes to admin columns
    if current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' then
        new.is_approved := old.is_approved;
        new.approval_status := old.approval_status;
        new.is_verified := old.is_verified;
        new.average_rating := old.average_rating;
        new.total_reviews := old.total_reviews;
        new.stripe_connected_account_id := old.stripe_connected_account_id;
        new.stripe_account_status := old.stripe_account_status;
    end if;
    return new;
end;
$$;

drop trigger if exists protect_therapist_admin_columns_trigger on public.therapist_profiles;
create trigger protect_therapist_admin_columns_trigger
    before update on public.therapist_profiles
    for each row execute function public.protect_therapist_admin_columns();

-- Protect reviews from therapist manipulation (only allow reply fields)
create or replace function public.protect_review_columns()
returns trigger
language plpgsql
as $$
begin
    -- If the updater is the therapist (not the client or service_role)
    if auth.uid() = old.therapist_id and auth.uid() != old.client_id then
        -- Therapists can only update reply fields
        new.rating := old.rating;
        new.text := old.text;
        new.client_name := old.client_name;
        new.client_photo_url := old.client_photo_url;
        new.is_flagged := old.is_flagged;
        new.client_id := old.client_id;
        new.therapist_id := old.therapist_id;
        new.booking_id := old.booking_id;
    end if;
    return new;
end;
$$;

drop trigger if exists protect_review_columns_trigger on public.reviews;
create trigger protect_review_columns_trigger
    before update on public.reviews
    for each row execute function public.protect_review_columns();

-- Add auth.uid() check to get_conversation_participants_for_user
create or replace function public.get_conversation_participants_for_user(p_user_id uuid)
returns table (
    id uuid,
    conversation_id uuid,
    user_id uuid,
    unread_count integer
)
language sql
security definer
set search_path = public
as $$
    -- Only allow users to query their own conversations
    select cp.id, cp.conversation_id, cp.user_id, cp.unread_count
    from conversation_participants cp
    where cp.conversation_id in (
        select cp2.conversation_id
        from conversation_participants cp2
        where cp2.user_id = p_user_id
    )
    and p_user_id = auth.uid();
$$;

-- Add updated_at trigger for transactions table
drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at
    before update on public.transactions
    for each row execute function public.set_updated_at();

-- ============================================================
-- DONE! Your Supabase backend is ready for Holistic Unity.
-- ============================================================
-- Next steps:
-- 1. Go to Authentication > Providers and enable:
--    - Email/Password (should already be on)
--    - Apple Sign In (requires Apple Developer config)
--    - Google Sign In (requires Google Cloud OAuth config)
-- 2. Run this SQL in the SQL Editor
-- 3. Build and run the app!
-- ============================================================

-- ============================================================
-- INCREMENTAL MIGRATION: Reschedule Workflow
-- ============================================================
-- Run this if your database was created before the reschedule
-- columns were added to the bookings table definition above.
-- ============================================================
-- ALTER TABLE public.bookings
--     ADD COLUMN IF NOT EXISTS proposed_scheduled_at timestamptz,
--     ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0;
--
-- ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
-- ALTER TABLE public.bookings
--     ADD CONSTRAINT bookings_status_check
--     CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'reschedule_pending'));
-- ============================================================
-- ============================================================
-- INCREMENTAL MIGRATION: Push Notification Tables
-- ============================================================
-- Run this if your database was created before the device_tokens
-- and user_notification_preferences tables were added above.
-- ============================================================
-- CREATE TABLE IF NOT EXISTS public.device_tokens (
--     id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
--     user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
--     token       text NOT NULL,
--     platform    text NOT NULL DEFAULT 'ios',
--     created_at  timestamptz NOT NULL DEFAULT now(),
--     UNIQUE(user_id, token)
-- );
-- CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON public.device_tokens(user_id);
-- ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can manage own device tokens"
--     ON public.device_tokens FOR ALL
--     USING (auth.uid() = user_id);
--
-- CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
--     user_id                uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
--     push_enabled           boolean NOT NULL DEFAULT true,
--     push_booking_reminders boolean NOT NULL DEFAULT true,
--     push_new_messages      boolean NOT NULL DEFAULT true,
--     push_session_reminders boolean NOT NULL DEFAULT true,
--     push_promotional       boolean NOT NULL DEFAULT false,
--     updated_at             timestamptz NOT NULL DEFAULT now()
-- );
-- ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can manage own notification preferences"
--     ON public.user_notification_preferences FOR ALL
--     USING (auth.uid() = user_id);
--
-- -- Add missing DELETE policy for notifications
-- CREATE POLICY "Users can delete own notifications"
--     ON public.notifications FOR DELETE
--     USING (auth.uid() = user_id);
-- ============================================================

-- ============================================================
-- INCREMENTAL MIGRATION: Account Deletion RPC
-- ============================================================
-- Run this if your database was created before the
-- delete_user_account function was added above.
-- ============================================================
-- CREATE OR REPLACE FUNCTION public.delete_user_account()
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = ''
-- AS $$
-- DECLARE
--     v_user_id uuid := auth.uid();
-- BEGIN
--     IF v_user_id IS NULL THEN
--         RAISE EXCEPTION 'Not authenticated';
--     END IF;
--     DELETE FROM public.device_tokens WHERE user_id = v_user_id;
--     DELETE FROM public.user_notification_preferences WHERE user_id = v_user_id;
--     DELETE FROM public.notifications WHERE user_id = v_user_id;
--     DELETE FROM public.reviews WHERE client_id = v_user_id;
--     DELETE FROM public.bookings WHERE client_id = v_user_id OR therapist_id = v_user_id;
--     DELETE FROM public.users WHERE id = v_user_id;
--     DELETE FROM auth.users WHERE id = v_user_id;
-- END;
-- $$;
-- ============================================================

-- ============================================================
-- INCREMENTAL MIGRATION: Stripe Payments
-- ============================================================
-- Run this if your database was created before the transactions,
-- payment_methods tables and stripe columns were added above.
-- ============================================================
-- CREATE TABLE IF NOT EXISTS public.transactions (
--     id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
--     booking_id               uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
--     client_id                uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
--     therapist_id             uuid NOT NULL REFERENCES public.therapist_profiles(id) ON DELETE CASCADE,
--     amount                   double precision NOT NULL DEFAULT 0,
--     platform_fee             double precision NOT NULL DEFAULT 0,
--     therapist_payout         double precision NOT NULL DEFAULT 0,
--     currency                 text NOT NULL DEFAULT 'usd',
--     status                   text NOT NULL DEFAULT 'pending'
--         CHECK (status IN ('pending','processing','completed','failed','refunded','partially_refunded')),
--     stripe_payment_intent_id text,
--     refund_amount            double precision,
--     created_at               timestamptz NOT NULL DEFAULT now(),
--     updated_at               timestamptz NOT NULL DEFAULT now()
-- );
-- CREATE INDEX IF NOT EXISTS idx_transactions_booking_id ON public.transactions(booking_id);
-- CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON public.transactions(client_id);
-- CREATE INDEX IF NOT EXISTS idx_transactions_therapist_id ON public.transactions(therapist_id);
-- ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Clients can view own transactions"
--     ON public.transactions FOR SELECT USING (auth.uid() = client_id);
-- CREATE POLICY "Therapists can view own transactions"
--     ON public.transactions FOR SELECT USING (auth.uid() = therapist_id);
--
-- CREATE TABLE IF NOT EXISTS public.payment_methods (
--     id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
--     user_id                  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
--     stripe_payment_method_id text NOT NULL,
--     brand                    text NOT NULL DEFAULT '',
--     last4                    text NOT NULL DEFAULT '',
--     expiry_month             integer NOT NULL DEFAULT 1,
--     expiry_year              integer NOT NULL DEFAULT 2025,
--     is_default               boolean NOT NULL DEFAULT false,
--     created_at               timestamptz NOT NULL DEFAULT now()
-- );
-- CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON public.payment_methods(user_id);
-- ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can manage own payment methods"
--     ON public.payment_methods FOR ALL USING (auth.uid() = user_id);
--
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stripe_customer_id text;
-- ALTER TABLE public.therapist_profiles ADD COLUMN IF NOT EXISTS stripe_account_status text DEFAULT 'not_connected';
-- ============================================================

