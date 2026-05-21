-- Reduce Supabase RLS initplan warnings by evaluating auth helpers once per statement.
-- This preserves each existing policy action/role and changes only USING/WITH CHECK expressions.

alter policy "Clients can insert bookings" on "public"."bookings"
    with check (((select auth.uid()) = client_id));

alter policy "Clients can read own bookings" on "public"."bookings"
    using (((select auth.uid()) = client_id));

alter policy "Clients can update own bookings" on "public"."bookings"
    using (((select auth.uid()) = client_id));

alter policy "Therapists can read own bookings" on "public"."bookings"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can update assigned bookings" on "public"."bookings"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can delete own certifications" on "public"."certifications"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can insert own certifications" on "public"."certifications"
    with check (((select auth.uid()) = therapist_id));

alter policy "Therapists can read own certifications" on "public"."certifications"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can update own certifications" on "public"."certifications"
    using (((select auth.uid()) = therapist_id));

alter policy "Authenticated users can insert participants" on "public"."conversation_participants"
    with check (((select auth.role()) = 'authenticated'::text));

alter policy "Users can add themselves as participants" on "public"."conversation_participants"
    with check (((select auth.uid()) = user_id));

alter policy "Users can read own participation" on "public"."conversation_participants"
    using (((select auth.uid()) = user_id));

alter policy "Users can update own participation" on "public"."conversation_participants"
    using (((select auth.uid()) = user_id));

alter policy "Users can view own participation" on "public"."conversation_participants"
    using (((select auth.uid()) = user_id));

alter policy "Authenticated users can create conversations" on "public"."conversations"
    with check (((select auth.role()) = 'authenticated'::text));

alter policy "Participants can read own conversations" on "public"."conversations"
    using ((EXISTS ( SELECT 1
   FROM conversation_participants
  WHERE ((conversation_participants.conversation_id = conversations.id) AND (conversation_participants.user_id = (select auth.uid()))))));

alter policy "Participants can update conversations" on "public"."conversations"
    using ((EXISTS ( SELECT 1
   FROM conversation_participants
  WHERE ((conversation_participants.conversation_id = conversations.id) AND (conversation_participants.user_id = (select auth.uid()))))));

alter policy "Users can manage own device tokens" on "public"."device_tokens"
    using (((select auth.uid()) = user_id))
    with check (((select auth.uid()) = user_id));

alter policy "Users can manage their own device tokens" on "public"."device_tokens"
    using (((select auth.uid()) = user_id))
    with check (((select auth.uid()) = user_id));

alter policy "Participants can insert messages" on "public"."messages"
    with check ((((select auth.uid()) = sender_id) AND (EXISTS ( SELECT 1
   FROM conversation_participants
  WHERE ((conversation_participants.conversation_id = messages.conversation_id) AND (conversation_participants.user_id = (select auth.uid())))))));

alter policy "Participants can read messages" on "public"."messages"
    using ((EXISTS ( SELECT 1
   FROM conversation_participants
  WHERE ((conversation_participants.conversation_id = messages.conversation_id) AND (conversation_participants.user_id = (select auth.uid()))))));

alter policy "Recipients can mark messages read" on "public"."messages"
    using ((EXISTS ( SELECT 1
   FROM conversation_participants
  WHERE ((conversation_participants.conversation_id = messages.conversation_id) AND (conversation_participants.user_id = (select auth.uid()))))));

alter policy "Sender can update own messages" on "public"."messages"
    using (((select auth.uid()) = sender_id));

alter policy "Senders can update own messages" on "public"."messages"
    using (((select auth.uid()) = sender_id));

alter policy "Authenticated users can create notifications" on "public"."notifications"
    with check (((select auth.role()) = 'authenticated'::text));

alter policy "Users can delete own notifications" on "public"."notifications"
    using (((select auth.uid()) = user_id));

alter policy "Users can insert own notifications" on "public"."notifications"
    with check (((select auth.uid()) = user_id));

alter policy "Users can read own notifications" on "public"."notifications"
    using (((select auth.uid()) = user_id));

alter policy "Users can read their own notifications" on "public"."notifications"
    using (((select auth.uid()) = user_id));

alter policy "Users can update own notifications" on "public"."notifications"
    using (((select auth.uid()) = user_id));

alter policy "Users can update their own notifications" on "public"."notifications"
    using (((select auth.uid()) = user_id))
    with check (((select auth.uid()) = user_id));

alter policy "Users can view own notifications" on "public"."notifications"
    using (((select auth.uid()) = user_id));

alter policy "Users can delete own payment methods" on "public"."payment_methods"
    using (((select auth.uid()) = user_id));

alter policy "Users can manage own payment methods" on "public"."payment_methods"
    with check (((select auth.uid()) = user_id));

alter policy "Users can view own payment methods" on "public"."payment_methods"
    using (((select auth.uid()) = user_id));

alter policy "Clients can insert reviews" on "public"."reviews"
    with check (((select auth.uid()) = client_id));

alter policy "Clients can read own reviews" on "public"."reviews"
    using (((select auth.uid()) = client_id));

alter policy "Therapists can read own reviews" on "public"."reviews"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can reply to reviews" on "public"."reviews"
    using (((select auth.uid()) = therapist_id));

alter policy "Clients can read own credits" on "public"."session_credits"
    using (((select auth.uid()) = client_id));

alter policy "Therapists can read credits for their clients" on "public"."session_credits"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can insert own profile" on "public"."therapist_profiles"
    with check (((select auth.uid()) = id));

alter policy "Therapists can read own profile" on "public"."therapist_profiles"
    using (((select auth.uid()) = id));

alter policy "Therapists can update own profile" on "public"."therapist_profiles"
    using (((select auth.uid()) = id));

alter policy "Therapists can delete own services" on "public"."therapist_services"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can insert own services" on "public"."therapist_services"
    with check (((select auth.uid()) = therapist_id));

alter policy "Therapists can read own services" on "public"."therapist_services"
    using (((select auth.uid()) = therapist_id));

alter policy "Therapists can update own services" on "public"."therapist_services"
    using (((select auth.uid()) = therapist_id));

alter policy "Clients can view own transactions" on "public"."transactions"
    using (((select auth.uid()) = client_id));

alter policy "Therapists can view own transactions" on "public"."transactions"
    using (((select auth.uid()) = therapist_id));

alter policy "Users can view own transactions" on "public"."transactions"
    using ((((select auth.uid()) = client_id) OR ((select auth.uid()) = therapist_id)));

alter policy "Users can manage own notification preferences" on "public"."user_notification_preferences"
    using (((select auth.uid()) = user_id));

alter policy "Authenticated users can read other users display info" on "public"."users"
    using (((select auth.role()) = 'authenticated'::text));

alter policy "Users can insert own row" on "public"."users"
    with check (((select auth.uid()) = id));

alter policy "Users can read own row" on "public"."users"
    using (((select auth.uid()) = id));

alter policy "Users can update own row" on "public"."users"
    using (((select auth.uid()) = id));

alter policy "Authenticated users can read chat media" on "storage"."objects"
    using (((bucket_id = 'chat-media'::text) AND ((select auth.role()) = 'authenticated'::text)));

alter policy "Authenticated users can upload chat media" on "storage"."objects"
    with check (((bucket_id = 'chat-media'::text) AND ((select auth.role()) = 'authenticated'::text)));

alter policy "Authenticated users can upload profile photos" on "storage"."objects"
    with check (((bucket_id = 'profile-photos'::text) AND ((select auth.role()) = 'authenticated'::text)));

alter policy "Authenticated users can upload video intros" on "storage"."objects"
    with check (((bucket_id = 'video-intros'::text) AND ((select auth.role()) = 'authenticated'::text)));

alter policy "Chat media owners can view" on "storage"."objects"
    using (((bucket_id = 'chat-media'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Chat participants can upload media" on "storage"."objects"
    with check (((bucket_id = 'chat-media'::text) AND ((select auth.uid()) IS NOT NULL)));

alter policy "Chat participants can view media" on "storage"."objects"
    using (((bucket_id = 'chat-media'::text) AND ((select auth.uid()) IS NOT NULL)));

alter policy "Users can delete own certificates" on "storage"."objects"
    using (((bucket_id = 'certificates'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Users can update own certificates" on "storage"."objects"
    using (((bucket_id = 'certificates'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])))
    with check (((bucket_id = 'certificates'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Users can update own profile photos" on "storage"."objects"
    using (((bucket_id = 'profile-photos'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Users can update own video intros" on "storage"."objects"
    using (((bucket_id = 'video-intros'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Users can upload own certificates" on "storage"."objects"
    with check (((bucket_id = 'certificates'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Users can upload own profile photos" on "storage"."objects"
    with check (((bucket_id = 'profile-photos'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Users can upload own video intros" on "storage"."objects"
    with check (((bucket_id = 'video-intros'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

alter policy "Users can view own certificates" on "storage"."objects"
    using (((bucket_id = 'certificates'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));
