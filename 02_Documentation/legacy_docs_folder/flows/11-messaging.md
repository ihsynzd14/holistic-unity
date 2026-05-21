# 11 — Messaging (Stream Chat)

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🟡 Important
**Owner:** Marcello

## Purpose

In-app 1:1 messaging between client and therapist, backed by **Stream Chat** (GetStream.io). The same Stream tenant is used by all 4 surfaces — iOS app, client webapp, therapist webapp, and admin moderation tools. Channels are deterministic (created on first interaction), media attachments are scoped via Supabase Storage RLS, and a "Prenota sessione" CTA is rendered into every chat header to drive the chat → booking conversion path.

## Preconditions

- `STREAM_API_KEY` (public) and `STREAM_API_SECRET` (server-only) configured in Supabase secrets, Vercel env vars (`NEXT_PUBLIC_STREAM_API_KEY` + `STREAM_API_SECRET`), and `.env.local`.
- iOS StreamChatSwiftUI SDK installed; web uses `stream-chat-react` v12.
- Storage bucket `chat-media` has RLS policy from migration `20260414100100_chat_media_rls_participant_scope.sql` restricting reads to `conversation_participants`.
- User authenticated via Supabase Auth (any role — clients and therapists both connect to Stream).

## Sequence

### A. Token issuance (web)

1. Client mounts `/dashboard/messages` (`client-webapp/src/app/dashboard/messages/page.tsx:67`).
2. Page POSTs `/api/stream/token` (`client-webapp/src/app/api/stream/token/route.ts:6`) with the user's Supabase session cookie.
3. Route checks auth (`route.ts:9`), applies rate limit `stream-token` 60/h/user (`route.ts:19`), then calls `StreamChat.getInstance(apiKey, apiSecret).createToken(user.id)` (`route.ts:42`).
4. Returns `{ token, userId }` — apiKey is NOT in the response (clients have it via `NEXT_PUBLIC_STREAM_API_KEY`).
5. Page connects with `chatClient.connectUser({id, name, image}, token)` (`page.tsx:111`). The `image` field is `users.photo_url` if present, else a `ui-avatars.com` fallback in brand berry.

The therapist-webapp follows the same pattern with its own `/api/stream/token/route.ts`.

### B. Token issuance (iOS)

`StreamChatService.fetchToken()` invokes the Supabase edge function `stream-token` (`iOS App/supabase/functions/stream-token/index.ts`). Returns `{ token, userId }` shape compatible with the web routes.

### C. Channel creation — deep-link (`?to=`)

When a client lands on `/dashboard/messages?to=<therapist_uuid>` (typically from the "Scrivi all'operatore" button on `/checkout/success`):

1. `AutoOpenChannel` component runs once Stream connects (`page.tsx:376`).
2. Builds a deterministic short channel id by sorting the two user UUIDs and taking the first 8 chars of each: `dm-${x.slice(0,8)}-${y.slice(0,8)}` (`page.tsx:399`). Stream channel IDs are capped at 64 chars; full UUIDs would overflow.
3. `client.channel("messaging", channelId, { members: [a, b] })` — Stream's create is idempotent.
4. `channel.watch()` to subscribe.
5. `setActiveChannel(channel)` to surface in the UI.
6. `router.replace("/dashboard/messages")` strips the `?to=` so a refresh doesn't re-trigger creation.

### D. Sending a message

1. User types in `MessageInput` → `MessageList` updates optimistically.
2. SDK persists to Stream's API + broadcasts to the other party's WebSocket.
3. iOS uses `StreamChatRepository.sendMessage(channelId, text)`.

### E. Custom header with "Prenota" CTA

`CustomChannelHeader` (`client-webapp/src/app/dashboard/messages/page.tsx:302`) replaces Stream's default header for 1:1 DMs:
- Other member's avatar + display_name + presence dot (online/offline).
- "Prenota sessione" button linking to `/dashboard/therapists/{otherUserId}#prenota` — the highest-value conversion path on this page (chat → booking) was missing in the default header.

### F. Media attachment

1. Upload to `chat-media/${conversationId}/${uuid}.${ext}` via Supabase Storage.
2. RLS policy ensures only `auth.uid()` in `conversation_participants` for that conversation can read.
3. Each party generates a signed URL server-side when rendering the message.

## Critical assertions

- **Stream apiSecret never leaves the server.** Clients only ever see `apiKey` (public) + a per-user JWT minted by `createToken(userId)`.
- **Channel ids are deterministic** — sorted-pair short hash means client→therapist and therapist→client always resolve to the same channel.
- **`conversation_participants.role`** ∈ `{client, therapist}` — only these 2 can send messages (RLS on Storage bucket).
- **Insert into `conversation_participants` requires `auth.uid() = user_id`** (RLS after migration `20260415_security_hardening`).
- **CSP must allow `wss://*.stream-io-api.com` + `*.stream-io-api.com`** in `connect-src` (`next.config.ts`). Without it the WebSocket fails silently.
- **Rate limit on token issuance** — 60/h/user. Stream itself proactively refreshes tokens; 60/h covers heavy reconnect cycles on flaky networks but caps a malicious client trying to drain the Stream API quota.
- **iOS sign-out disconnects Stream** — `StreamChatService.disconnectUser()` is called from `AuthManager.signOut` to avoid stale connections.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Token fetch 401 | `StreamChatService.fetchToken` | Auto-refresh Supabase session then retry |
| 10s fetch timeout | `page.tsx:64` | AbortController fires; UI shows "Timeout: il server non ha risposto entro 10 secondi" with a Riprova button |
| Stream API rate limit | SDK | Exponential backoff |
| WebSocket blocked by CSP | Browser console | Add `wss://*.stream-io-api.com` to `connect-src` in `next.config.ts` |
| Upload > 100MB | Stream default cap | SDK rejects with size error (no app-level cap in V1) |
| Photo updated, Stream stale | Stream caches user record by id | Self-heals on next page mount because we re-`connectUser` on every visit |
| User has no display_name | First time login | Falls back to `ui-avatars.com` initials avatar in brand berry |

## Files

- `client-webapp/src/app/dashboard/messages/page.tsx` — main UI, AutoOpenChannel, CustomChannelHeader
- `client-webapp/src/app/api/stream/token/route.ts` — web token issuance
- `therapist-webapp/src/app/api/stream/token/route.ts` — therapist webapp token issuance
- `iOS App/supabase/functions/stream-token/index.ts` — iOS token Edge Function
- `iOS App/Holistic Unity/Data/Services/StreamChatService.swift` — iOS connect/disconnect lifecycle
- `iOS App/Holistic Unity/Data/Repositories/SupabaseChatRepository.swift` — iOS message send/receive
- `iOS App/supabase/migrations/20260414100100_chat_media_rls_participant_scope.sql` — Storage RLS

## Recent fixes / known issues

- **Custom header (2026-04-26):** Stream's default `ChannelHeader` showed "2 membri, 1 online" for 1:1 DMs and had no booking CTA. Replaced with `CustomChannelHeader` that surfaces the other party's avatar + name + online dot + "Prenota" link. Chat → booking is the highest-value flow on this page; missing CTA was a major friction point.
- **Real avatars in chat (2026-04-26):** Page now pulls `photo_url` from `users` (not just `display_name`) so Stream renders the user's real photo. Falls back to ui-avatars only when no photo uploaded.
- **Mobile two-pane layout (2026-04-26):** `ResponsivePanes` shows ONE pane at a time on viewports `< lg`: channel list by default, active channel after selection (with back button). Desktop keeps side-by-side.
- **Deep-link `?to=` (2026-04-22):** added so the "Scrivi all'operatore" button on checkout success can land users in the actual conversation, not on an empty inbox.
- **Known gap:** No read receipts / typing indicators surfaced in UI (Stream provides them; not exposed).
- **Known gap:** No moderation tools in admin dashboard — Stream has its own admin panel available separately.
- **Known gap:** No archive state on stale conversations.
