# 12 — Reviews

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Production
**Owner:** Marcello

## Purpose

After a completed session, client rates the therapist 1-5 stars + leaves text. Therapist can reply. Aggregates (`average_rating`, `total_reviews`) are computed by trigger and shown on therapist cards.

## Preconditions

- Booking `status = completed`
- Client is the booking's `client_id`
- No existing review for this `booking_id` (one review per booking)

## Happy path — Client submits review

1. After a session ends, iOS prompts review (push + in-app card in `SessionsView`)
2. `WriteReviewView.swift:60` opens with therapist + booking context
3. `WriteReviewViewModel` at lines 7-56 validates: `rating > 0` AND `text.length >= 10` (`canSubmit` at line 22)
4. Submit → `DIContainer.shared.reviewRepository.submitReview(review)` at `WriteReviewView.swift:44`
5. `SupabaseReviewRepository.swift:63-74`:
   - Pre-check: query for existing review with same `booking_id` + `client_id` (lines 65-70)
   - If exists → throw `ReviewError.duplicateReview`
   - Otherwise INSERT into `reviews` table
6. DB trigger (in migration `20260406203000_booking_review_guards`) recomputes `therapist_profiles.average_rating` and `total_reviews`
7. Review visible in therapist's `TherapistProfileView` and `/dashboard/reviews`

## Happy path — Therapist replies

1. Therapist opens `/dashboard/reviews` page → `therapist-webapp/src/app/dashboard/reviews/page.tsx`
2. For each review without `therapist_reply`: click "Reply" → textarea appears (line 326-352)
3. Submit → updates `reviews.therapist_reply` + `reviews.therapist_reply_date` (line 118-120)
4. iOS client sees reply in `TherapistProfileView` under the review

## Invariants

- One review per booking (`reviews.booking_id` UNIQUE)
- Only the client of that booking can submit (RLS: `auth.uid() = client_id`)
- Only the reviewed therapist can reply (RLS: `auth.uid() = therapist_id`)
- `rating ∈ [1, 5]` (CHECK constraint)
- Review cannot be deleted by user (retained for therapist history, moderation possible via admin)
- `therapist_profiles.average_rating` is ALWAYS consistent with SUM(rating) / COUNT from reviews (via trigger)

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Duplicate review attempt | Step 5 | `ReviewError.duplicateReview` thrown, UI shows "Already reviewed" |
| Rating out of range | Client-side validation + DB CHECK | UI prevents, DB rejects if bypassed |
| Text < 10 chars | `canSubmit` check | Submit button disabled |
| Booking not yet completed | Shouldn't reach submit | Prompt wouldn't show; if tampered, RLS allows but no business rule prevents (TODO) |
| Reply after already replied | Reply button hidden if `therapist_reply` set | UI prevents, DB UPDATE would overwrite if bypassed |

## Test checklist

- [ ] Complete a session → review prompt appears on iOS
- [ ] Submit 5 stars + 50 chars → `reviews` row created, `total_reviews + 1`, `average_rating` updated
- [ ] Try to submit again for same booking → error "Already reviewed"
- [ ] Therapist dashboard shows new review with 5 stars
- [ ] Therapist replies → `therapist_reply` populated, client sees reply in profile
- [ ] Therapist tries to reply twice → Reply button hidden
- [ ] Rating = 1 text shows warning banner on dashboard (TODO: alert for low ratings)

## Related

- `05-booking-single.md` (review requires completed booking)
- `08-refund-cancellation.md` (cancelled bookings can't be reviewed)
- `platform/data-model.md` (reviews schema + trigger)

## Known gaps

- No edit window for client after submit (TODO: 24h edit, then locked)
- No admin flag-for-moderation UI (just DB level)
- No aggregate "last 6 months" rating display — lifetime only
- No review prompt reminder if client dismisses first time (could send 24h push)
- Therapist can't report abusive review (V1.1)
