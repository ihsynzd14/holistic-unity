-- C9: Restrict chat-media storage RLS to conversation participants only.
--
-- BEFORE: Any authenticated user could read/upload any file in the chat-media
-- bucket — a privacy violation where User A could access User B's chat media.
--
-- AFTER:
--   READ:   Owner (uid = first folder component) OR a user who shares at
--           least one conversation with the file owner.
--   INSERT: Only to the user's own folder (uid = first folder component).

-- Drop all 5 overly broad legacy policies
DROP POLICY IF EXISTS "Authenticated users can read chat media" ON storage.objects;
DROP POLICY IF EXISTS "Chat participants can view media" ON storage.objects;
DROP POLICY IF EXISTS "Chat media owners can view" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Chat participants can upload media" ON storage.objects;

-- New SELECT policy: owner + conversation co-participants
CREATE POLICY "Chat media visible to conversation participants"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND (
      -- Owner can always view own files
      (select auth.uid())::text = (storage.foldername(name))[1]
      OR
      -- Co-participant: requesting user shares a conversation with file owner
      EXISTS (
        SELECT 1
        FROM public.conversation_participants cp1
        JOIN public.conversation_participants cp2
          ON cp1.conversation_id = cp2.conversation_id
        WHERE cp1.user_id = (select auth.uid())
          AND cp2.user_id = ((storage.foldername(name))[1])::uuid
      )
    )
  );

-- New INSERT policy: users can only upload to their own folder
CREATE POLICY "Users can upload own chat media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );
