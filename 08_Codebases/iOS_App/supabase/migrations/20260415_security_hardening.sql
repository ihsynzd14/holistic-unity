-- Security hardening: fix launch-blocking vulnerabilities found in audit
-- Date: 2026-04-15

-- Fix 1: conversation_participants — any authenticated user could join any conversation
DROP POLICY IF EXISTS "Authenticated users can insert participants" ON public.conversation_participants;
-- The "Users can add themselves as participants" policy (auth.uid() = user_id) remains

-- Fix 2: notifications — any authenticated user could send notifications to anyone
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
-- The "Users can insert own notifications" policy (auth.uid() = user_id) remains

-- Fix 3: conversations — any authenticated user could create conversations
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;

-- Fix 4: Price constraints — prevent negative/invalid prices
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_price_non_negative CHECK (price >= 0);

ALTER TABLE public.therapist_services
  ADD CONSTRAINT services_price_non_negative CHECK (price >= 0);
