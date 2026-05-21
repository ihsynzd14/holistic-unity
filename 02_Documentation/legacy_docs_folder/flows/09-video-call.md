# 09 — Video Call (LiveKit)

**Last verified:** 2026-04-17 by Marcello
**Status:** ✅ Production (+ screen recording protection added 2026-04-17)
**Owner:** Marcello

## Purpose

Therapist and client meet in a LiveKit WebRTC room linked to a booking. Supports screen sharing (therapist → client), rejoin after network drop, and opens in a dedicated browser tab to avoid navigation breaking the call.

> **Platform is virtual-only V1.** Every booking has a video room. There is no in-person format — the `format` column was removed from the DB on 2026-04-16.

## Preconditions

- Booking `status ∈ {confirmed, in_progress, reschedule_pending}`
- Current time is within the join window: **15 min before `scheduled_at`** through **`scheduled_at + duration + 3h grace`** (enforced server-side in the LiveKit token route)
- LiveKit credentials configured: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- iOS/webapp have granted camera + microphone permissions

## Happy path — iOS client joining

1. User taps "Join Session" in `SessionsView`
2. iOS asks the server for a token; the SERVER decides whether the join window is open. The 15-min-pre / 3h-post-end policy lives in `livekit-token/index.ts:76` (Edge Function) and the client-webapp / therapist-webapp `/api/livekit/token` routes; clients do not enforce timing, they just attempt and surface server errors.
3. iOS calls edge function `livekit-token` passing booking ID + participant info
4. Edge function at `supabase/functions/livekit-token/index.ts`:
   - Validates user is client or therapist of the booking (line ~91)
   - Validates booking status ∈ {confirmed, in_progress, reschedule_pending}
   - Validates current time is within `[scheduled_at - 15min, scheduled_at + duration + 3h]`
   - Returns signed JWT for a **deterministic** LiveKit room id `hu-${bookingId.replace('-','').slice(0,16)}` — same id on both sides of the call so client and therapist land in the same room. The earlier "salted SHA256" room name was abandoned because both parties need to derive the same id without coordinating, and a salt would have required server round-trips on each derivation.
5. `VideoCallService.swift` connects; `VideoCallView.swift` renders (wrapped in `.protectAgainstScreenCapture()` modifier — see Screen recording protection below)
6. If therapist starts screen sharing, iOS renders screen share full-screen and camera in PiP at `VideoCallView.swift` (uses `remoteScreenShareTrack`)

## Happy path — Webapp therapist joining

1. Therapist clicks "Join" in `/dashboard/sessions` → `window.open('/call/${bookingId}', '_blank')`
2. Standalone page `therapist-webapp/src/app/call/[bookingId]/page.tsx` opens WITHOUT dashboard sidebar
3. Fetches LiveKit token from `/api/livekit/token`
4. Renders `CustomVideoLayout` with always-visible controls (mic / camera / screen share toggle / end session)
5. `beforeunload` handler warns before closing tab
6. **Separate handlers** for explicit end (`handleEndSession` → marks booking `completed`) vs accidental disconnect (`handleDisconnected` → shows "Reconnect?" prompt, does NOT mark completed)

## Invariants

- Join window: **15 min before `scheduled_at`** through **`scheduled_at + duration + 3h`**. Server-enforced in the LiveKit token routes (Edge Function + Vercel mirrors). Clients do not check timing — they request, and surface server errors.
- Room name is **deterministic per booking** (`hu-${booking.id.replace('-','').slice(0,16)}`). Bookings IDs are UUIDv4, so the trimmed first 16 hex chars give 64 bits of entropy — sufficient against guessing while letting both parties derive the same room id without round-tripping. The earlier "salted SHA-256" scheme was abandoned because the salt would have needed server coordination on every derivation.
- Only booking parties (client + therapist of that exact booking) can get a valid token — enforced server-side in the token route.
- `booking.status = completed` only on EXPLICIT end by the **therapist** (POST `/api/bookings/[id]/complete`, restricted to `therapist_id === user.id`), NEVER on accidental disconnect, and NEVER by the client. Earlier the therapist-webapp version of the complete route accepted both client_id and therapist_id — that was the actual bug; both webapp routes now enforce therapist-only.
- Screen share is one-way (therapist → client) in V1
- No recording enabled (privacy)
- **iOS screen recording + mirroring are blocked visually** — if `UIScreen.isCaptured == true` or `UIScreen.main.mirrored`, video call contents are blurred and covered by an opaque "Screen recording not allowed" panel (attacker's recording captures only the panel, not the participant)

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Token 401 | Step 3 edge function | iOS/webapp shows "Session unavailable" |
| Booking not confirmed | Token edge function check | 403, user told to check booking status |
| Network drop | LiveKit client | Auto-reconnect up to 15s, then prompts "Reconnect?" |
| Therapist navigates to /dashboard/messages mid-call | V1 broken (fixed: now opens in new tab) | Call stays alive in original tab |
| Screen share denied by OS | LiveKit enable call | Error surfaced, toggle reverts |

## Screen recording protection

**File:** `Holistic Unity/Features/VideoCall/ScreenCaptureProtection.swift`

Observer-based guard for iOS clients. `ScreenCaptureMonitor` subscribes to `UIScreen.capturedDidChangeNotification` + `UIScreen.didConnectNotification` / `didDisconnectNotification`, and sets `isCaptured = true` whenever the device is being recorded, AirPlay-mirrored, or connected to an external monitor.

The `.protectAgainstScreenCapture()` view modifier composes:
1. Content (`VideoCallView`)
2. `.blur(radius: 40)` when `isCaptured`
3. Opaque panel overlay with 🚫 + localized "Screen recording not allowed / stop recording to continue"

Applied only to `VideoCallView` (the sensitive surface — therapist + client faces). Chat messages, profile photos, and public content are NOT protected.

> **Limitation:** screen capture cannot be fully *blocked* on iOS without private API. This is a visual mitigation — an attacker who records gets only the blur + panel, not the video stream. Audio is still captured.

## Test checklist

- [ ] Join 15 min before session start → both parties see each other
- [ ] Join 2h after session start → still works (within day window)
- [ ] Therapist toggles screen share → iOS client sees screen as main video
- [ ] Therapist toggles screen share off → iOS reverts to camera
- [ ] Therapist opens /dashboard/messages tab while in call → call continues in its tab
- [ ] Toggle airplane mode during call → reconnect prompt, call NOT marked completed
- [ ] Therapist clicks "End Session" → booking status `completed` + review prompt on iOS next app open
- [ ] Attempt join with wrong bookingId from URL tampering → 403
- [ ] **iOS: Start screen recording from Control Center during call → video blurs + panel appears**
- [ ] **iOS: AirPlay mirror to Apple TV during call → blur + panel appears**
- [ ] **iOS: Stop screen recording → blur + panel disappear, call resumes normally**

## Related

- `05-booking-single.md` (booking creation)
- `10-calendar-sync.md` (external calendar events include join link)
- `platform/security.md` (LiveKit token scope, room naming)

## Known gaps

- No waiting room (both parties land in room simultaneously without "host is ready" UX)
- No chat overlay during call (users can use Stream Chat in separate screen)
- No recording/transcription
- ~~No screen-recording protection on iOS (`H12` from security audit)~~ — **closed 2026-04-17** via `.protectAgainstScreenCapture()` modifier
- Audio is still captured during screen recording (visual-only protection)
- Session duration timer is informational — doesn't end call when duration exceeded
- Webapp therapist side has no equivalent protection (browser screen-capture API not universally blockable)
