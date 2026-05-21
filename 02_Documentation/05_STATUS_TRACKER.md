# Holistic Unity — Status Tracker & Pending Tasks

**Last Updated:** March 25, 2026
**Launch Target:** May 1, 2026

---

## Completed

- [x] Supabase project setup (auth, database, storage, Edge Functions)
- [x] Full database migration applied (15 tables, 9 functions, 11 triggers, 4 storage buckets)
- [x] 8 Edge Functions deployed and operational
- [x] Stripe Connect Express integration (account creation, dashboard, payment intents)
- [x] Stripe webhook endpoint configured (account.updated, payment events, refunds)
- [x] Push notification system (APNs via database trigger + Edge Function)
- [x] LiveKit video call integration (token generation Edge Function)
- [x] Stream Chat integration (token generation Edge Function)
- [x] Website deployed at holisticunity.app (Vercel)
- [x] Trilingual website (English, Italian, Portuguese-BR) across all 5 pages
- [x] Contact form working (FormSubmit.co → support@holisticunity.app)
- [x] Mobile optimization (horizontal scroll fix for iPhone)
- [x] Edge Function auth pattern fixed (admin client + getUser(jwt))
- [x] Sentry error monitoring integrated in iOS app
- [x] Knowledge base created for session continuity

---

## Critical — Before Launch

- [ ] **Stripe Connect country support**
  - `create-connect-account` needs to accept a `country` parameter from the iOS app
  - Without this, all therapist onboarding defaults to Italy
  - Brazil requires automatic daily payouts (manual payouts fail)
  - Fix code was written, tested, and reverted — ready to re-deploy when iOS app is updated to pass country
  - Countries needing auto-payout: BR, MY, TH, IN

- [ ] **Test webhook event delivery**
  - Current webhook is Connect-enabled (`connect=true`)
  - Platform-level `payment_intent` events (destination charges) may need a separate non-Connect endpoint
  - Action: Make a test payment in the app and verify `payment_intent.succeeded` reaches the webhook

- [ ] **Replace Stripe test keys with live keys**
  - Update `STRIPE_SECRET_KEY` in Supabase secrets
  - Update `STRIPE_WEBHOOK_SECRET` with live webhook signing secret
  - Update publishable key in `StripeConfig.swift` (iOS app)
  - Create live webhook endpoint in Stripe Dashboard

- [ ] **Sentry verification**
  - Add `SentrySDK.capture(message: "Holistic Unity test event")` temporarily
  - Verify it appears at sentry.io → Issues tab
  - Remove test code before App Store submission

- [ ] **App Store submission**
  - See `APP_STORE_SUBMISSION_WALKTHROUGH.md`
  - See `Pre_Submission_Checklist.md`
  - See `App_Store_Metadata.md`
  - See `App_Review_Notes.md`

---

## Nice to Have — Post-Launch

- [ ] **Register Apple Merchant ID** for Apple Pay support
- [ ] **Payment provider for Brazil** — if Stripe Connect limitations are a blocker
  - Options evaluated: Adyen, Payoneer, Mollie + GoCardless (merged Dec 2025)
- [ ] **Back up Edge Function source code** — 4 functions deployed without local source:
  - `send-push-notification`
  - `livekit-token`
  - `stream-token`
  - `connect-redirect`
- [ ] **Admin dashboard** — for approving therapist profiles, viewing transactions, managing flagged reviews

---

## Known Issues (Resolved)

| Issue | Root Cause | Fix Applied |
|---|---|---|
| 401 auth errors on Edge Functions | User-scoped Supabase client pattern | Switched to admin client + getUser(jwt) |
| Onboarding status stuck at "onboarding_pending" | No Stripe webhook endpoint configured | Created webhook via Stripe API |
| Mobile horizontal scroll on iPhone | overflow-x only on body, CSS animations extending past viewport | Added overflow-x:hidden to html+body, overflow-x:clip on sections |
| Cookie policy Portuguese not showing | Body had hardcoded data-lang="en", JS only updated html element | Added body.setAttribute('data-lang', lang) |
| Terms pages Portuguese not switching | JS only toggled CSS classes but HTML used data attributes | Added text-swap logic to setLanguage() |
| Awkward Portuguese translations | Literal translations from Italian/English | Rewrote all PT-BR content for natural Brazilian Portuguese |
| Contact form errors | Placeholder Formspree ID in action URL | Switched to FormSubmit.co with AJAX endpoint |
| Duplicate webhook endpoints | Multiple endpoints with different signing secrets | Cleaned up to single Connect endpoint |
