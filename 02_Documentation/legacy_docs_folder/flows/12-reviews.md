# 12 — Reviews

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🟡 Important
**Owner:** Marcello

## Purpose

After a completed session, the client rates the therapist 1-5 stars and (optionally) leaves up to 1000 chars of text. Reviews appear on the therapist's public profile (last 12 in marketplace card; full list in profile detail). Therapist can reply once per review; aggregate `average_rating` + `total_reviews` are kept in sync via DB trigger.

Until 2026-04-27 the iOS client and the webapp inserted directly into `public.reviews` via the Supabase SDK. That trusted client-supplied `client_name` / `client_photo_url`, had no rate limit, and depended entirely on a DB trigger for booking-state validation. The webapp now goes through `/api/reviews`; the iOS path still inserts directly but is protected by the `normalize_review_identity` trigger that overwrites identity columns server-side.

## Preconditions

- Booking `status = completed`.
- Caller is the booking's `client_id`.
- No prior review for this `(booking_id, client_id)` (UNIQUE constraint).

## Sequence

### A. Webapp client submits a review

1. Client opens "Le mie sessioni" (`client-webapp/src/app/dashboard/bookings/page.tsx`). Each completed booking without an existing review shows a "Lascia recensione" button.
2. Click opens `ReviewModal` with rating stars + text area (max 1000 chars enforced client-side).
3. Submit → `POST /api/reviews` (`client-webapp/src/app/api/reviews/route.ts:35`) with `{ bookingId, rating: 1..5, text? }`.
4. Route runs server-side checks (`route.ts:36-114`):
   - Auth (`getUser`) → 401 if not logged in.
   - Rate limit `reviews-create` 10/h/user (`route.ts:47`).
   - JSON shape validation: `bookingId` matches UUID regex, `rating` is integer 1-5, `text` trimmed + sliced to 1000.
   - Booking lookup via service-role admin client. Booking must exist AND `client_id = user.id` AND `status = 'completed'`. Errors return as 404 (not-found shape) to avoid leaking existence on tampering.
   - Server-side resolution of `client_name` + `client_photo_url` from `public.users` (NEVER trusted from request body). `display_name` sliced to 80 chars; falls back to `"Cliente"` if missing.
5. Service-role INSERT into `public.reviews` (`route.ts:116`).
6. On 23505 unique violation → 409 "Hai già pubblicato una recensione per questa sessione".
7. On success → 200; UI refetches the booking list to swap "Lascia recensione" for "Recensione pubblicata".

### B. iOS client submits a review

iOS still uses `SupabaseReviewRepository.submitReview()` directly. The `normalize_review_identity` BEFORE INSERT trigger overrides `NEW.client_name` and `NEW.client_photo_url` from `public.users` so the iOS client cannot spoof identity fields, even though it bypasses the API route. Validation otherwise mirrors the API (rating 1-5, text length, booking state).

### C. Therapist replies

1. Therapist opens `/dashboard/reviews` (`therapist-webapp/src/app/dashboard/reviews/page.tsx`).
2. For each review without `therapist_reply`: click "Reply" → textarea (line 326-352).
3. Submit → UPDATE `reviews.therapist_reply` + `therapist_reply_date` (line 118-120).
4. RLS: `auth.uid() = therapist_id`. Reply button is hidden once `therapist_reply` is set.

### D. Aggregate recompute

`therapist_profiles.average_rating` and `total_reviews` are updated by a trigger (migration `20260406203000_booking_review_guards`) on every review INSERT/UPDATE. Always consistent with `SUM(rating) / COUNT(*)`.

### E. Display on therapist profile

- Profile detail (`client-webapp/src/app/dashboard/therapists/[id]/page.tsx`) renders the **last 12 reviews** ordered by `created_at DESC`.
- Each review shows star rating, text, client display_name + photo, and the therapist's reply (if any).
- Average + count are read from `therapist_profiles` cache (not aggregated on each render).

## Critical assertions

- **One review per (booking_id, client_id)** — UNIQUE constraint at DB level. Code-level pre-check exists but the DB is the source of truth (23505 → 409).
- **Server-mediated identity (webapp).** `client_name` and `client_photo_url` are looked up server-side from `public.users` and cannot be spoofed by the client.
- **Server-mediated identity (iOS).** `normalize_review_identity` BEFORE INSERT trigger overwrites these columns regardless of what the SDK sent.
- **Rating ∈ [1, 5]** — both client-side (`canSubmit`), API (`route.ts:75`), and DB CHECK constraint.
- **Booking ownership AND state checked server-side.** RLS `auth.uid() = client_id` plus `status = 'completed'` guard. Booking not found is returned with 404 even on permission failure to avoid leaking which IDs exist.
- **Rate limit 10/h/user** prevents brute-force review spam against a competitor (the per-booking UNIQUE prevents double-submit on the same booking).
- **Text capped at 1000 chars** — client cap matches; server enforces defensively.
- **Review cannot be deleted by the user** — preserves moderation history; admin can soft-delete via DB.
- **`therapist_profiles.average_rating` is ALWAYS consistent** with `SUM(rating)/COUNT(*)` thanks to the trigger.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Duplicate review attempt | DB UNIQUE | 23505 → 409 "Hai già pubblicato una recensione" |
| Rating out of range | client + API + DB CHECK | UI prevents; API returns 400; DB rejects if bypassed |
| Text < 10 chars (iOS) | `canSubmit` | Submit disabled |
| Booking not yet completed | `route.ts:102` | 409 "Puoi recensire solo sessioni completate" |
| Reply after reply already set | UI hides button | Backend would let it overwrite if hit directly (no UNIQUE on reply) — V1.1 hardening |
| Spoofed `client_name` from iOS | `normalize_review_identity` trigger | Overwritten with `users.display_name` |
| Cancelled booking | `status != completed` check | Cannot review cancelled sessions |

## Files

- `client-webapp/src/app/api/reviews/route.ts` — server-mediated insert (web)
- `client-webapp/src/app/dashboard/bookings/page.tsx` — `ReviewModal` entry point
- `client-webapp/src/app/dashboard/therapists/[id]/page.tsx` — review rendering on profile
- `therapist-webapp/src/app/dashboard/reviews/page.tsx` — reply UI
- `iOS App/Holistic Unity/Features/Reviews/WriteReviewView.swift` — iOS write UI
- `iOS App/Holistic Unity/Data/Repositories/SupabaseReviewRepository.swift` — iOS direct insert
- Migration `20260406203000_booking_review_guards` — UNIQUE, CHECK, aggregate trigger
- Migration with `normalize_review_identity` trigger — BEFORE INSERT identity override

## Recent fixes / known issues

- **Server-mediated insert (2026-04-27):** webapp `ReviewModal` switched from direct Supabase insert to `POST /api/reviews`. Closed identity spoofing where any user could pose as anyone else's name/photo on a public review.
- **`normalize_review_identity` trigger (2026-04-27):** iOS still inserts directly via SDK; trigger ensures the server is the source of truth for `client_name`/`client_photo_url` regardless of submission path.
- **Rate limit 10/h (2026-04-27):** added to mitigate users brute-forcing reviews across multiple bookings (e.g. flooding a competitor with 1-stars after sock-puppet bookings).
- **Known gap:** no edit window — once submitted a review is final. Plan: 24h edit window then locked.
- **Known gap:** no admin flag-for-moderation UI; manual DB ops only.
- **Known gap:** lifetime average only — no "last 6 months" rolling rating.
- **Known gap:** therapist cannot report abusive review (V1.1).
