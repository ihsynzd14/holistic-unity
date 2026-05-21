-- =====================================================
-- Holistic Unity — Supabase Database Schema
-- =====================================================
-- Run this SQL in the Supabase SQL Editor to create all
-- tables, indexes, RLS policies, and storage buckets.
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. USERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT NOT NULL,
    photo_url TEXT,
    phone_number TEXT,
    role TEXT CHECK (role IN ('therapist', 'client')),
    city TEXT,
    country TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    auth_provider TEXT NOT NULL DEFAULT 'email',
    is_email_verified BOOLEAN DEFAULT FALSE,
    fcm_token TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- =====================================================
-- 2. THERAPIST PROFILES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.therapist_profiles (
    id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    photo_url TEXT,
    years_experience INTEGER DEFAULT 0,
    categories TEXT[] DEFAULT '{}',
    languages TEXT[] DEFAULT '{English}',
    video_intro_url TEXT,
    gallery_image_urls TEXT[] DEFAULT '{}',
    cancellation_policy TEXT DEFAULT 'flexible',
    city TEXT,
    country TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    average_rating DOUBLE PRECISION DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    profile_completeness INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    approval_status TEXT DEFAULT 'draft' CHECK (approval_status IN ('draft', 'pending_review', 'approved', 'changes_requested')),
    stripe_connected_account_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_therapist_profiles_approved ON public.therapist_profiles(is_approved);
CREATE INDEX IF NOT EXISTS idx_therapist_profiles_rating ON public.therapist_profiles(average_rating DESC);
CREATE INDEX IF NOT EXISTS idx_therapist_profiles_location ON public.therapist_profiles(latitude, longitude);

-- =====================================================
-- 3. THERAPIST SERVICES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.therapist_services (
    id TEXT PRIMARY KEY,
    therapist_id TEXT NOT NULL REFERENCES public.therapist_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('in_person', 'virtual', 'both')),
    category TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_therapist_services_therapist ON public.therapist_services(therapist_id);

-- =====================================================
-- 4. CERTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.certifications (
    id TEXT PRIMARY KEY,
    therapist_id TEXT NOT NULL REFERENCES public.therapist_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    issuing_organization TEXT NOT NULL,
    year_obtained INTEGER NOT NULL,
    document_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_certifications_therapist ON public.certifications(therapist_id);

-- =====================================================
-- 5. AVAILABILITY TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.availability (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    therapist_id TEXT NOT NULL REFERENCES public.therapist_profiles(id) ON DELETE CASCADE,
    day_of_week TEXT CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
    start_time TEXT NOT NULL, -- "HH:mm"
    end_time TEXT NOT NULL,   -- "HH:mm"
    is_exception BOOLEAN DEFAULT FALSE,
    exception_date DATE,
    is_available BOOLEAN DEFAULT TRUE,
    timezone TEXT DEFAULT 'UTC'
);

CREATE INDEX IF NOT EXISTS idx_availability_therapist ON public.availability(therapist_id);

-- =====================================================
-- 6. BOOKINGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.bookings (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES public.users(id),
    therapist_id TEXT NOT NULL REFERENCES public.users(id),
    service_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    duration INTEGER NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    scheduled_at TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    format TEXT NOT NULL CHECK (format IN ('in_person', 'virtual', 'both')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
    cancellation_reason TEXT,
    video_room_id TEXT,
    stripe_payment_intent_id TEXT,
    platform_fee DOUBLE PRECISION DEFAULT 0,
    therapist_payout DOUBLE PRECISION DEFAULT 0,
    promo_code TEXT,
    discount DOUBLE PRECISION,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_client ON public.bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_therapist ON public.bookings(therapist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled ON public.bookings(scheduled_at);

-- =====================================================
-- 7. CONVERSATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.conversations (
    id TEXT PRIMARY KEY,
    last_message_text TEXT,
    last_message_sender_id TEXT,
    last_message_timestamp TEXT,
    last_message_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- =====================================================
-- 8. CONVERSATION PARTICIPANTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.conversation_participants (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.users(id),
    unread_count INTEGER DEFAULT 0,
    UNIQUE(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_convo ON public.conversation_participants(conversation_id);

-- =====================================================
-- 9. MESSAGES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES public.users(id),
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'voice', 'image', 'system', 'session_link')),
    text_content TEXT,
    media_url TEXT,
    media_duration DOUBLE PRECISION,
    booking_id TEXT,
    read_at TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at DESC);

-- =====================================================
-- 10. REVIEWS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.reviews (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES public.bookings(id),
    client_id TEXT NOT NULL REFERENCES public.users(id),
    therapist_id TEXT NOT NULL REFERENCES public.users(id),
    client_name TEXT NOT NULL,
    client_photo_url TEXT,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    text TEXT,
    therapist_reply TEXT,
    therapist_reply_date TEXT,
    is_flagged BOOLEAN DEFAULT FALSE,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_therapist ON public.reviews(therapist_id);
CREATE INDEX IF NOT EXISTS idx_reviews_client ON public.reviews(client_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON public.reviews(rating);

-- =====================================================
-- 11. NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    booking_id TEXT,
    conversation_id TEXT,
    therapist_id TEXT,
    client_id TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(user_id, is_read);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.therapist_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.therapist_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users: can read all, update own
CREATE POLICY "Users can view all profiles" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid()::text = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid()::text = id);
CREATE POLICY "Users can delete own profile" ON public.users FOR DELETE USING (auth.uid()::text = id);

-- Therapist Profiles: anyone can read approved, therapist can manage own
CREATE POLICY "Anyone can view approved therapist profiles" ON public.therapist_profiles FOR SELECT USING (is_approved = true OR auth.uid()::text = id);
CREATE POLICY "Therapists can insert own profile" ON public.therapist_profiles FOR INSERT WITH CHECK (auth.uid()::text = id);
CREATE POLICY "Therapists can update own profile" ON public.therapist_profiles FOR UPDATE USING (auth.uid()::text = id);

-- Therapist Services: anyone can read, therapist manages own
CREATE POLICY "Anyone can view services" ON public.therapist_services FOR SELECT USING (true);
CREATE POLICY "Therapists can manage own services" ON public.therapist_services FOR INSERT WITH CHECK (auth.uid()::text = therapist_id);
CREATE POLICY "Therapists can update own services" ON public.therapist_services FOR UPDATE USING (auth.uid()::text = therapist_id);
CREATE POLICY "Therapists can delete own services" ON public.therapist_services FOR DELETE USING (auth.uid()::text = therapist_id);

-- Certifications: anyone can read, therapist manages own
CREATE POLICY "Anyone can view certifications" ON public.certifications FOR SELECT USING (true);
CREATE POLICY "Therapists can manage own certifications" ON public.certifications FOR INSERT WITH CHECK (auth.uid()::text = therapist_id);
CREATE POLICY "Therapists can update own certifications" ON public.certifications FOR UPDATE USING (auth.uid()::text = therapist_id);
CREATE POLICY "Therapists can delete own certifications" ON public.certifications FOR DELETE USING (auth.uid()::text = therapist_id);

-- Availability: anyone can read, therapist manages own
CREATE POLICY "Anyone can view availability" ON public.availability FOR SELECT USING (true);
CREATE POLICY "Therapists can manage own availability" ON public.availability FOR INSERT WITH CHECK (auth.uid()::text = therapist_id);
CREATE POLICY "Therapists can update own availability" ON public.availability FOR UPDATE USING (auth.uid()::text = therapist_id);
CREATE POLICY "Therapists can delete own availability" ON public.availability FOR DELETE USING (auth.uid()::text = therapist_id);

-- Bookings: participants can read their own, create, update
CREATE POLICY "Users can view own bookings" ON public.bookings FOR SELECT USING (auth.uid()::text = client_id OR auth.uid()::text = therapist_id);
CREATE POLICY "Clients can create bookings" ON public.bookings FOR INSERT WITH CHECK (auth.uid()::text = client_id);
CREATE POLICY "Participants can update bookings" ON public.bookings FOR UPDATE USING (auth.uid()::text = client_id OR auth.uid()::text = therapist_id);

-- Conversations: participants only
CREATE POLICY "Participants can view conversations" ON public.conversations FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = id AND user_id = auth.uid()::text)
);
CREATE POLICY "Authenticated users can create conversations" ON public.conversations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Participants can update conversations" ON public.conversations FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = id AND user_id = auth.uid()::text)
);

-- Conversation Participants
CREATE POLICY "Users can view own participation" ON public.conversation_participants FOR SELECT USING (user_id = auth.uid()::text);
CREATE POLICY "Authenticated users can add participants" ON public.conversation_participants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own participation" ON public.conversation_participants FOR UPDATE USING (user_id = auth.uid()::text);

-- Messages: conversation participants can read/write
CREATE POLICY "Participants can view messages" ON public.messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()::text)
);
CREATE POLICY "Participants can send messages" ON public.messages FOR INSERT WITH CHECK (
    auth.uid()::text = sender_id AND
    EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()::text)
);
CREATE POLICY "Participants can update messages" ON public.messages FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()::text)
);

-- Reviews: anyone can read, clients write, therapists reply
CREATE POLICY "Anyone can view reviews" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Clients can submit reviews" ON public.reviews FOR INSERT WITH CHECK (auth.uid()::text = client_id);
CREATE POLICY "Therapists can reply to reviews" ON public.reviews FOR UPDATE USING (auth.uid()::text = therapist_id);

-- Notifications: users see own only
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "System can insert notifications" ON public.notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid()::text = user_id);

-- =====================================================
-- REALTIME
-- =====================================================
-- Enable real-time on messages and conversations tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- =====================================================
-- STORAGE BUCKETS
-- =====================================================
-- Run these in the Supabase Dashboard > Storage, or via the API:
-- 1. profile-photos (public)
-- 2. certificates (private)
-- 3. chat-media (private)
-- 4. video-intros (public)

INSERT INTO storage.buckets (id, name, public) VALUES ('profile-photos', 'profile-photos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('certificates', 'certificates', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-media', 'chat-media', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('video-intros', 'video-intros', true) ON CONFLICT (id) DO NOTHING;

-- Storage Policies
CREATE POLICY "Public profile photos" ON storage.objects FOR SELECT USING (bucket_id = 'profile-photos');
CREATE POLICY "Users can upload own profile photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update own profile photos" ON storage.objects FOR UPDATE USING (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Public video intros" ON storage.objects FOR SELECT USING (bucket_id = 'video-intros');
CREATE POLICY "Users can upload own video intros" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'video-intros' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own certificates" ON storage.objects FOR SELECT USING (bucket_id = 'certificates' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload own certificates" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'certificates' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Chat participants can view media" ON storage.objects FOR SELECT USING (bucket_id = 'chat-media' AND auth.uid() IS NOT NULL);
CREATE POLICY "Chat participants can upload media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-media' AND auth.uid() IS NOT NULL);
