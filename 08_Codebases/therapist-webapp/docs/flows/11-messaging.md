# 11 — Messaging (Stream Chat)

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Production
**Owner:** Marcello

## Purpose

In-app chat between client and therapist, backed by **Stream Chat** (GetStream.io). Conversations are 1-on-1, created at first booking. Media attachments are scoped via Supabase Storage RLS so only conversation participants can read them.

## Preconditions

- `STREAM_API_KEY` and `STREAM_API_SECRET` configured in Supabase secrets + `.env.local`
- iOS StreamChatSwiftUI SDK installed
- Storage bucket `chat-media` has RLS policy restricting to `conversation_participants`
- User authenticated

## Happy path — iOS connect

1. After sign-in, `AuthManager.swift:191` calls `StreamChatService.shared.connectUser(userId:name:imageURL:)` at `Data/Services/StreamChatService.swift:43`
2. `StreamChatService.fetchToken()` at line 143 invokes Supabase edge function `stream-token`
3. Edge function returns `{ token, userId }` (NOT `apiKey` — that's public, stays in client)
4. Stream client connects via `chatClient.connectUser(...)`
5. `isConnected = true`, `totalUnreadCount` publishes via Combine (lines 173-198)

## Happy path — Webapp connect

Same pattern at `/api/stream/token/route.ts`. Returns `{ token, userId }`.

## Happy path — Create conversation

1. First booking between client X and therapist Y triggers creation of `conversations` row + 2 `conversation_participants` rows (X, Y) via Supabase insert in the booking flow
2. Stream channel ID = `conversations.id`
3. Either party opens the chat → `StreamChatRepository.sendMessage(channelId,text)` at `StreamChatRepository.swift:52-68` calls `chatClient.channelController(for:).createNewMessage(text:)`

## Happy path — Media attachment

1. Upload file to Supabase Storage bucket `chat-media/${conversationId}/${uuid}.${ext}`
2. RLS policy (from migration `20260414100100_chat_media_rls_participant_scope`) ensures only `auth.uid()` that's in `conversation_participants` for that conversation can read
3. Message stored with media URL pointing to private Supabase Storage → each party generates a signed URL server-side

## Invariants

- Stream tokens expire after N hours (Stream default) — SDK auto-refreshes via token fetch callback
- `apiKey` is public and hardcoded in iOS / env; `apiSecret` NEVER leaves Supabase functions
- `conversation_participants.role` ∈ `{client, therapist}` — only these 2 can send messages
- Inserting into `conversation_participants` requires `auth.uid() = user_id` (RLS after migration `20260415_security_hardening`)
- Chat media RLS prevents cross-conversation access (`C9` from security audit, fixed)
- Push notifications for new messages registered with Stream via APN token at `PushNotificationService.swift:127`

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Token fetch 401 | StreamChatService.fetchToken | Auto-refresh session then retry (lines 154-168) |
| WebSocket blocked by CSP | Browser | Ensure `connect-src` in `next.config.ts` includes `*.stream-io-api.com` + `wss://*.stream-io-api.com` |
| Stream API rate limit | SDK | Exponential backoff, surface "messages delayed" UX |
| User signs out | `AuthManager.signOut` | `StreamChatService.disconnectUser()` called to avoid stale connection |
| Upload > 25MB | V1 not enforced (Stream default 100MB) | Stream SDK rejects, shows error |

## Test checklist

- [ ] Sign in → Stream WebSocket connects, no CSP errors in browser console
- [ ] Open chat with existing conversation → see history, unread badge updates
- [ ] Send text message → appears instantly on other party's client
- [ ] Send image attachment → recipient can download, non-participant cannot (try via another user's session)
- [ ] Sign out → disconnects; next message to user is not received until re-login
- [ ] Push notification arrives when app in background and new message received

## Related

- `01-auth.md` (Stream connection on sign-in)
- `platform/security.md` (RLS on conversation_participants, chat-media bucket)
- `platform/env-config.md` (Stream keys)

## Known gaps

- No read receipts exposed in UI (Stream provides, not surfaced)
- No typing indicators exposed in UI
- No message search beyond Stream's default
- Conversation list doesn't show "archived" state — stale conversations linger
- No moderation tools in admin dashboard (Stream has admin panel available separately)
