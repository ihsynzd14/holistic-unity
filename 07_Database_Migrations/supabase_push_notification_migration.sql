-- Push Notification Migration
-- NOTE: The device_tokens table and notifications webhook were already created
-- manually in Supabase. This file documents the schema for reference.
-- Only the user_notification_preferences table below may still need to be created.

-- Device tokens table (ALREADY CREATED in Supabase)
-- CREATE TABLE IF NOT EXISTS public.device_tokens (
--     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
--     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
--     token TEXT NOT NULL,
--     platform TEXT NOT NULL DEFAULT 'ios',
--     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
--     UNIQUE(user_id, token)
-- );

-- Notification preferences table
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    push_enabled BOOLEAN NOT NULL DEFAULT true,
    push_booking_reminders BOOLEAN NOT NULL DEFAULT true,
    push_new_messages BOOLEAN NOT NULL DEFAULT true,
    push_session_reminders BOOLEAN NOT NULL DEFAULT true,
    push_promotional BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own notification preferences"
    ON public.user_notification_preferences
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
