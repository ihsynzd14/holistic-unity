# 10 — Calendar Sync (Google, Outlook, iCal)

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Google working / ✅ Outlook working (post 2026-04-16 secret rotation) / ✅ iCal working
**Owner:** Marcello

## Purpose

Therapist connects their external calendar (Google and/or Outlook). The platform uses it for two things:
- **Read (freebusy)** — exclude busy slots when generating availability for clients
- **Write (events)** — auto-create calendar events on each confirmed booking

iCal read-only URL is also offered (token-signed, no OAuth) for passive calendar apps.

## Preconditions

- Env vars set in Vercel + `.env.local`:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`
  - `ICAL_SECRET` (for HMAC token generation)
- Google Cloud project has Calendar API enabled
- Azure app registration has `Calendars.ReadWrite` + `offline_access` + `User.Read` permissions

## Happy path — Google Connect

1. Therapist clicks "Connect Google" in `/dashboard/settings` → redirects to `/api/calendar/google/authorize`
2. Authorize endpoint generates OAuth state (timestamped, 15min TTL) + redirects to Google OAuth
3. User grants → Google redirects to `/api/calendar/google/callback/route.ts`
4. Callback at `route.ts`:
   - Parses + validates state (15min expiry check at line 39)
   - Verifies `decoded.therapistId === currentUser.id` at line 49 (CSRF defense)
   - Exchanges code for tokens
   - Fetches Google user email via `/oauth2/v2/userinfo`
   - Upserts `therapist_calendar_integrations` with provider=google, access_token, refresh_token, token_expires_at, calendar_email
5. Redirect to `/dashboard/settings?calendar=google&status=connected`

## Happy path — Outlook Connect

Same flow at `/api/calendar/microsoft/callback/route.ts` (line 30-55 for same validations). Fetches profile via Microsoft Graph `/me`.

## Happy path — Slot generation (iOS client)

1. iOS requests slots for date → edge function `supabase/functions/get-available-slots/index.ts`
2. Edge function:
   - Loads therapist's `availability` JSONB (recurring schedule + exceptions)
   - For each connected calendar integration: refreshes access_token if expired → calls Google/Outlook `freebusy` API for the date range
   - Computes available slots = (recurring slots) − (buffer around existing bookings) − (external calendar busy blocks)
3. Returns list of ISO timestamps
4. iOS renders slots. **No local fallback** — if edge function fails, iOS shows error (prevents showing slots that would conflict with external calendar)

## Happy path — Auto-create event on booking confirmation

1. `stripe-webhook/index.ts` after booking confirmation calls `syncBookingToCalendar(therapistId, bookingData)`
2. For each integration: refreshes token → POSTs event to `calendars/${calendarId}/events` (Google) or `me/events` (Microsoft)
3. Event payload: summary = "Session", start, end, attendees (client email + therapist email)
4. Includes reminders 30 min + 10 min before
5. Non-blocking: errors logged, webhook still succeeds
6. **Privacy:** no client name in iCal SUMMARY (just "Session") — see `H2` in security audit

## Happy path — iCal public URL

1. User generates URL in `/dashboard/settings` → `/api/ical/token` signs URL with `ICAL_SECRET`
2. URL format: `/api/ical/${therapistId}/${HMAC(therapistId, ICAL_SECRET)}`
3. Consumer calendar (Apple Calendar, etc.) hits that URL → returns `.ics` stream with current bookings

## Invariants

- OAuth state is `base64url(payload).HMAC(payload)` where `payload = {therapistId, timestamp, nonce}`. All three layers must match on callback:
  - `timestamp` within 15 minutes of now
  - `therapistId === currentSessionUser.id`
  - `signature` verifies against `OAUTH_STATE_SECRET` (falls back to `ICAL_SECRET`)
  - `nonce` is a `crypto.randomUUID()` — makes the payload non-deterministic for defence in depth against replay inside the TTL window (implemented in `therapist-webapp/src/lib/calendar/tokens.ts`)
- `therapist_calendar_integrations` has composite key `(therapist_id, provider)` — one row per provider per therapist
- `access_token` is refreshed on demand; `refresh_token` never expires (unless revoked)
- iCal token is deterministic HMAC; revoked only if `ICAL_SECRET` is rotated
- Calendar event creation is non-blocking (never fails booking)
- Client names never appear in external calendar SUMMARY

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Microsoft client_secret expired | Token exchange step | 401 "Failed to fetch Microsoft profile" → therapist sees connect failure; see `../MICROSOFT_OUTLOOK_SECRET_REGEN.md` runbook |
| OAuth state expired (> 15min) | Callback step 4 | Redirect to `?status=error&reason=state_expired` |
| State user mismatch | Callback step 4 CSRF check | Redirect to `?status=error&reason=user_mismatch` |
| Refresh token revoked by user | Slot generation | Integration marked disconnected; slots still generated from internal availability only |
| Freebusy API rate limit | Slot generation | Fail the request; iOS shows error |
| Event create 403 | Webhook auto-create | Log, proceed (next booking will retry individually) |

## Test checklist

- [ ] Connect Google → `therapist_calendar_integrations` row created with `calendar_email` populated
- [ ] Connect Outlook → same
- [ ] Book session during slot that overlaps Google event → iOS should NOT show slot
- [ ] Book session → new event appears in Google Calendar within 1 min
- [ ] Book session → new event appears in Outlook within 1 min
- [ ] Tamper OAuth state (change timestamp) → callback rejects
- [ ] Wait 16 min between authorize & callback → callback rejects (expired state)
- [ ] iCal URL → `.ics` downloads with bookings, no client names in SUMMARY
- [ ] Disconnect Google → row deleted → slots revert to internal-only

## Related

- `02-therapist-onboarding.md` (calendar connect is part of setup)
- `05-booking-single.md` (auto event creation is a side effect)
- `platform/security.md` (OAuth state, iCal token)
- `platform/env-config.md` (OAuth secrets)
- `../MICROSOFT_OUTLOOK_SECRET_REGEN.md` (Azure secret rotation)

## Known gaps

- Only default calendar used (`calendar_id = "primary"`); therapist can't choose which calendar
- No 2-way sync: events created externally don't appear in HU bookings (intentional)
- No bulk backfill of past bookings to newly-connected calendar
- Deletion on cancellation NOT implemented — stale events left in external calendar
