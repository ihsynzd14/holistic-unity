# 02 — Therapist Onboarding & Approval

**Last verified:** 2026-04-16 by Marcello
**Status:** ✅ Production
**Owner:** Marcello

## Purpose

A therapist registers on the **webapp only** (`therapistportal.holisticunity.app`) — or is created manually by an admin — fills out profile + services + availability + Stripe Connect, then submits for admin approval. Only `is_approved = true` therapists are visible to clients.

> **iOS is client-only.** There is no therapist sign-up or dashboard on iOS. A therapist who installs the iOS app and logs in sees `TherapistWebAppRedirectView` with a link to the web portal.

## Preconditions

- User account exists in `users` table with `role = "therapist"`
- Therapist can log in to `therapistportal.holisticunity.app` (webapp)
- Storage bucket `profile-photos` exists and is public

## Happy path

1. **Profile** → `therapist-webapp/src/app/dashboard/profile/page.tsx`
   - Fill displayName, tagline, bio (max 500), city, country, yearsExperience, categories, languages, videoIntroUrl
   - Upload profile photo to `profile-photos/${userId}/avatar.{ext}` at `profile/page.tsx:245-289`
   - Upload gallery images (max 6) to `profile-photos/${userId}/gallery/${uuid}.{ext}` at `profile/page.tsx:291-354`
   - Add certifications → inserts into `certifications` table at `profile/page.tsx:356-370`

2. **Services** → `therapist-webapp/src/app/dashboard/services/page.tsx`
   - Create ≥1 active service with name, description, duration, price, category, optional pack
   - All sessions are **virtual** (V1 platform default — no in-person option)
   - Must include 1 intro call service (free, 15-30min) for first contact

3. **Availability** → `therapist-webapp/src/app/dashboard/availability/page.tsx`
   - Set timezone (IANA), minNoticeHours, bufferMinutes, weekly recurring schedule, exceptions

4. **Stripe Connect** → `therapist-webapp/src/app/dashboard/settings/page.tsx`
   - Click "Connect Stripe" → calls `/api/stripe/connect` which calls Edge Function `create-connect-account`
   - Redirect to Stripe onboarding → user completes KYC → returns to dashboard
   - Webhook `account.updated` from Stripe updates `therapist_profiles.stripe_account_status`

5. **Submit for review**
   - `profile_completeness >= 80` triggers auto-transition `approval_status: draft → pending_review`
   - Admin reviews in admin-dashboard → sets `is_approved = true` + `approval_status = approved`

6. **Visible to clients** — once `is_approved = true` AND `stripe_account_status = active`, therapist appears in search results

## Invariants

- `therapist_profiles.approval_status` ∈ `{draft, pending_review, approved, changes_requested}`
- Clients only see therapists where `is_approved = true` (filtered at `SupabaseTherapistRepository.searchTherapists`)
- No bookings can be created for a therapist with `stripe_account_status != active` (check in edge function)
- Inactive services (`is_active = false`) are NOT returned to clients (filter in 3 iOS queries)
- At least one **intro call service** (`is_intro_call = true`, price = 0) is expected but not strictly enforced in V1

## Error paths

| Error | Where | Behavior |
|-------|-------|----------|
| Photo upload fails | profile step 1 | Show `uploadError` banner, state not updated |
| Stripe onboarding abandoned | step 4 | `stripe_account_status = incomplete`, therapist can retry |
| Admin rejects | step 5 | `approval_status = changes_requested`, therapist sees blocker banner |
| Submit before 80% complete | implicit | No auto-transition; banner prompts user to complete more fields |

## Test checklist

- [ ] Fill all profile fields → `profile_completeness` reaches 100%
- [ ] Upload profile photo → visible in header + saved to `photo_url`
- [ ] Upload 3 gallery images → visible in scroll + saved to `gallery_image_urls[]`
- [ ] Add 2 certifications → visible in list
- [ ] Create 1 intro call + 1 paid service → both show in `/dashboard/services`
- [ ] Toggle a service `is_active = false` → should NOT appear when iOS fetches therapist profile
- [ ] Complete Stripe onboarding → `stripe_account_status = active`
- [ ] Admin approves → therapist appears in iOS search
- [ ] Admin requests changes → therapist sees blocker banner, can edit and resubmit

## Related

- `07-payment.md` (Stripe Connect onboarding details)
- `platform/data-model.md` (`therapist_profiles` schema)
- `../THERAPIST_PROFILE_MAPPING.md` (field-by-field dashboard ↔ iOS mapping)

## Known gaps

- Auto-transition draft→pending_review is client-computed at save time; a server-side trigger would be more reliable
- No email to therapist when admin approves/rejects (V1.1)
- VAT number validation only on webapp (VIES API) — not re-validated server-side before payouts
