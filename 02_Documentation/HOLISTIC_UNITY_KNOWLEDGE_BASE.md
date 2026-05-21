# Holistic Unity — Project Knowledge Base

**Last Updated:** March 25, 2026 (Session 2 — Final Update)
**Owner:** Armand (Armand@stormxdigital.com) — STORM X DIGITAL S.R.L.
**Launch Date:** May 1, 2026

---

## 1. What Is Holistic Unity?

A holistic wellness therapy marketplace iOS app. Clients discover and book sessions with verified holistic therapists (Reiki, yoga, meditation, breathwork, etc.) via video or in-person. Therapists onboard, list services, receive bookings, and get paid through Stripe Connect.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| iOS App | Swift / SwiftUI (Xcode) |
| Backend | Supabase (Auth, Database, Edge Functions, Storage) |
| Payments | Stripe Connect Express |
| Video Calls | LiveKit |
| Chat | Stream Chat |
| Push Notifications | APNs (Apple Push Notification service) |
| Website | Static HTML/CSS/JS on Vercel |
| Error Monitoring | Sentry (integrated in iOS app) |
| Contact Form | FormSubmit.co |
| Domain | holisticunity.app |

---

## 3. Credentials & Keys

### Supabase
- **Project Ref:** `bqyqkvkzkemiwyqjkbna`
- **Dashboard:** https://supabase.com/dashboard/project/bqyqkvkzkemiwyqjkbna
- **Supabase PAT (CLI):** `sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d`
- **SQL queries can be run via Management API:**
  ```bash
  curl -s -X POST "https://api.supabase.com/v1/projects/bqyqkvkzkemiwyqjkbna/database/query" \
    -H "Authorization: Bearer sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d" \
    -H "Content-Type: application/json" \
    -d '{"query": "YOUR SQL HERE"}'
  ```

### Stripe
- **Test Secret Key:** `sk_test_51TDV1A3b7e3tbHaWjR6jCommuvF7SKLQtD5FTh1ugJYD75eZoUhDaKqlz37EGt01GpPy71LTHmkZwAJqBujQ8CoY00jYl4RfRN`
- **Webhook Endpoint ID:** `we_1TEkrz3b7e3tbHaWTeABTeXw`
- **Webhook Signing Secret:** `whsec_hits2Xa22F3JSxUCv3qfSgpJwDC2Mg5O` (also stored in Supabase secrets as `STRIPE_WEBHOOK_SECRET`)
- **Webhook URL:** `https://bqyqkvkzkemiwyqjkbna.supabase.co/functions/v1/stripe-webhook`
- **Webhook is Connect-enabled** (`connect=true`) — receives events from connected accounts
- **Subscribed events:** `account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
- **Platform country:** Italy (affects default Connect onboarding country)

### Vercel
- **Deploy Token:** `vcp_6a4v3T3lfvNuiV6u9mkqHVYSJELALeyHW6QH8dS1wH4Mj4p2Uj42ONE7`
- **Live URL:** https://holisticunity.app

### Sentry
- **DSN:** `https://7d073437356f8076a95d9e68e43a980d@o4511101583163392.ingest.de.sentry.io/4511101589192784`
- **Integrated in iOS app** — catches crashes, errors, slow network calls, UI freezes
- **Free tier:** 5,000 errors/month
- **To test:** Add `SentrySDK.capture(message: "test")` in the app, then check sentry.io → Issues tab

### Supabase Secrets (all set on project)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` → `whsec_hits2Xa22F3JSxUCv3qfSgpJwDC2Mg5O`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `APNS_BUNDLE_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_TEAM_ID`
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `STREAM_API_KEY`, `STREAM_API_SECRET`

---

## 4. Deployment Commands

### Edge Functions (all use --no-verify-jwt)
**4 functions with local code (can redeploy anytime):**
```bash
cd "/Users/marcello/Desktop/Apps/Holistic Unity"

SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d npx supabase functions deploy create-payment-intent --project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt

SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d npx supabase functions deploy create-connect-account --project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt

SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d npx supabase functions deploy connect-dashboard --project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt

SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d npx supabase functions deploy stripe-webhook --project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt
```

**4 additional functions deployed separately (DO NOT redeploy without source code):**
- `send-push-notification` — push notification delivery
- `livekit-token` — video call token generation
- `stream-token` — chat token generation
- `connect-redirect` — Stripe OAuth redirect handler

### Website (Vercel)
```bash
cd "/sessions/kind-eager-cerf/mnt/Holistic Unity Project/holistic-unity-website" && npx vercel deploy --prod --yes --token=vcp_6a4v3T3lfvNuiV6u9mkqHVYSJELALeyHW6QH8dS1wH4Mj4p2Uj42ONE7
```

### Stripe API (useful for managing webhooks, accounts, etc.)
```bash
curl -s "https://api.stripe.com/v1/webhook_endpoints" \
  -u "sk_test_51TDV1A3b7e3tbHaWjR6jCommuvF7SKLQtD5FTh1ugJYD75eZoUhDaKqlz37EGt01GpPy71LTHmkZwAJqBujQ8CoY00jYl4RfRN:"
```

---

## 5. Edge Functions — Complete Inventory

**Total deployed: 8 functions** (all with `--no-verify-jwt`)

### Auth Pattern (used by create-connect-account, create-payment-intent, connect-dashboard)
```typescript
const jwt = authHeader.replace("Bearer ", "");
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const { data: { user }, error } = await supabaseAdmin.auth.getUser(jwt);
```
This replaced the old fragile user-scoped client pattern that caused 401 errors.

### 1. create-connect-account
- Creates Stripe Connect Express account for therapists
- Generates onboarding link (account_onboarding type)
- Saves `stripe_connected_account_id` and sets `stripe_account_status = "onboarding_pending"`
- Default return URLs: `holisticunity://stripe-return` / `holisticunity://stripe-refresh`
- Currently does NOT pass `country` to Stripe (defaults to Italy) — see Known Issues
- Uses `interval: "manual"` for payouts — incompatible with Brazil
- Local code in: `supabase/functions/create-connect-account/index.ts`

### 2. create-payment-intent
- Creates Stripe PaymentIntent for booking sessions
- Reads booking metadata (client_id, therapist_id, booking_id)
- Uses admin client for DB lookups
- Local code in: `supabase/functions/create-payment-intent/index.ts`

### 3. connect-dashboard
- Generates Stripe Express Dashboard login link for therapists
- Therapists can view payouts, account details via this link
- Local code in: `supabase/functions/connect-dashboard/index.ts`

### 4. connect-redirect
- Handles OAuth redirect flow for Stripe Connect
- Deployed but NOT in local code folder — was deployed separately
- Supabase ID: `6e125b1c-8aac-49af-86e0-f9d17a7b630f`

### 5. stripe-webhook
- Deployed with `--no-verify-jwt` (uses Stripe signature verification instead)
- Handles 4 event types:
  - `account.updated` → updates `therapist_profiles.stripe_account_status` (onboarding_pending → active/restricted)
  - `payment_intent.succeeded` → creates transaction record, confirms booking, saves payment method
  - `payment_intent.payment_failed` → logs failed transaction
  - `charge.refunded` → updates transaction to refunded/partially_refunded, cancels booking on full refund
- Platform fee: 20% (`PLATFORM_FEE_PERCENT = 0.20`)
- CORS headers include `stripe-signature`
- Local code in: `supabase/functions/stripe-webhook/index.ts`

### 6. send-push-notification
- Sends APNs push notifications to user devices
- Triggered automatically by database trigger `send_push_on_notification_insert` on INSERT to `notifications` table
- Uses APNs keys from Supabase secrets (`APNS_BUNDLE_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_TEAM_ID`)
- Supabase ID: `02c805ca-2826-46fe-8ba1-50bb5f053852`
- NOT in local code folder — was deployed separately

### 7. livekit-token
- Generates LiveKit access tokens for video call sessions
- Used when client/therapist joins a video therapy session
- Uses `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from Supabase secrets
- Supabase ID: `36951378-7450-42a7-918a-f2bd293c4f1a`
- NOT in local code folder — was deployed separately

### 8. stream-token
- Generates Stream Chat tokens for the messaging system
- Used when users connect to the chat feature
- Uses `STREAM_API_KEY` and `STREAM_API_SECRET` from Supabase secrets
- Supabase ID: `cbd333d0-5f1b-4e15-b833-8e7614c963b8`
- NOT in local code folder — was deployed separately

---

## 6. Database Schema

### Tables (15 total)
1. **users** — core user accounts (linked to auth.users), includes `stripe_customer_id`
2. **therapist_profiles** — profile data, approval status, `stripe_connected_account_id`, `stripe_account_status`
3. **therapist_services** — services offered (name, price, duration, format: virtual/in_person/both)
4. **certifications** — therapist credentials with verification status
5. **bookings** — session bookings with status flow: pending → confirmed → in_progress → completed/cancelled/no_show
6. **conversations** — chat conversation containers
7. **conversation_participants** — who's in each conversation, with unread_count
8. **messages** — individual chat messages (text, image, voice, session_link, system)
9. **reviews** — client reviews with therapist reply capability, auto-updates average rating
10. **notifications** — in-app notifications (booking reminders, messages, promotional)
11. **device_tokens** — APNs push tokens per device
12. **user_notification_preferences** — push notification settings per user
13. **transactions** — payment records: amount, platform_fee, therapist_payout, status, refund tracking
14. **payment_methods** — saved cards (brand, last4, expiry)
15. **user_display_info** (VIEW) — non-sensitive user data for chat (id, display_name, photo_url, role, city, country)

### Key Columns to Remember
- `therapist_profiles.stripe_account_status`: `not_connected` → `onboarding_pending` → `active` / `restricted`
- `therapist_profiles.approval_status`: `draft` → `pending_review` → `approved` / `changes_requested`
- `bookings.status`: `pending` → `confirmed` → `in_progress` → `completed` / `cancelled` / `no_show` / `reschedule_pending`
- `transactions.status`: `pending` → `processing` → `completed` / `failed` / `refunded` / `partially_refunded`

### Database Functions (9 total)
- `handle_new_user()` — trigger on `auth.users` INSERT: auto-creates user row with display_name from email
- `delete_user_account()` — RPC: full account deletion including auth.users (App Store compliance)
- `get_or_create_conversation()` — RPC: finds or creates 1-on-1 chat between two users (SECURITY DEFINER)
- `get_conversation_participants_for_user()` — RPC: bypasses RLS for chat participant lookup (with auth.uid() security check, SECURITY DEFINER)
- `increment_unread_count()` — RPC: bumps unread count for other participants in a conversation (SECURITY DEFINER)
- `update_therapist_rating()` — trigger on `reviews` INSERT/UPDATE: recalculates average_rating and total_reviews
- `protect_therapist_admin_columns()` — trigger on `therapist_profiles` UPDATE: prevents non-service-role from editing is_approved, stripe fields, ratings
- `protect_review_columns()` — trigger on `reviews` UPDATE: therapists can only update therapist_reply fields
- `set_updated_at()` — trigger on UPDATE for users, therapist_profiles, bookings, conversations, transactions

### Database Triggers Summary
| Trigger | Table | Event | Purpose |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` | INSERT | Auto-create public.users row |
| `set_users_updated_at` | `users` | UPDATE | Auto-update updated_at |
| `set_therapist_profiles_updated_at` | `therapist_profiles` | UPDATE | Auto-update updated_at |
| `set_bookings_updated_at` | `bookings` | UPDATE | Auto-update updated_at |
| `set_conversations_updated_at` | `conversations` | UPDATE | Auto-update updated_at |
| `set_transactions_updated_at` | `transactions` | UPDATE | Auto-update updated_at |
| `on_review_inserted` | `reviews` | INSERT | Recalculate therapist rating |
| `on_review_updated` | `reviews` | UPDATE | Recalculate therapist rating |
| `protect_therapist_admin_columns_trigger` | `therapist_profiles` | UPDATE | Block non-admin column edits |
| `protect_review_columns_trigger` | `reviews` | UPDATE | Block therapist from editing review content |
| `send_push_on_notification_insert` | `notifications` | INSERT | Calls `send-push-notification` Edge Function via pg_net |

### Required PostgreSQL Extensions
- `uuid-ossp` — UUID generation
- `pg_net` — HTTP requests from database (used by push notification trigger)

### Storage Buckets
- `profile-photos` (public read, auth upload, owner update)
- `certificates` (public read, auth upload)
- `chat-media` (private — auth read/upload only)
- `video-intros` (public read, auth upload, owner update)

### Migration File
- Full migration: `supabase_migration.sql` (uploaded to project)
- Uses `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING` — safe to re-run
- All tables have RLS enabled with appropriate policies
- The migration was fully applied on March 25, 2026

---

## 7. Stripe Webhook Configuration

**Endpoint:** `https://bqyqkvkzkemiwyqjkbna.supabase.co/functions/v1/stripe-webhook`
**Endpoint ID:** `we_1TEkrz3b7e3tbHaWTeABTeXw`
**Signing Secret:** `whsec_hits2Xa22F3JSxUCv3qfSgpJwDC2Mg5O`
**Connect-enabled:** Yes (receives events from connected therapist accounts)
**API Version:** 2023-10-16

**Subscribed Events:**
- `account.updated` — therapist completes/updates Stripe onboarding
- `payment_intent.succeeded` — client payment goes through
- `payment_intent.payment_failed` — client payment fails
- `charge.refunded` — refund processed

**Important:** Only ONE webhook endpoint should point to this URL. Multiple endpoints with different signing secrets will cause signature verification failures. Old duplicate endpoint `we_1TEYi13b7e3tbHaWOBis65nH` was deleted.

**Note:** This is a Connect webhook. For platform-level payment events (when using destination charges), you may need a separate non-Connect webhook endpoint with its own signing secret. If payment events aren't being received, this is likely the cause — create a second endpoint without `connect=true`.

---

## 8. Website Structure

**Location:** `/holistic-unity-website/`
**Hosted at:** https://holisticunity.app (Vercel)

### Pages
- `index.html` — main landing page (~1400+ lines)
- `cookie-policy.html` — cookie policy
- `privacy-policy.html` — privacy policy
- `terms-clients.html` — terms & conditions for clients
- `terms-therapists.html` — terms & conditions for therapists
- `robots.txt`, `sitemap.xml`

### Trilingual System (EN / IT / PT-BR)
- **Main page + privacy + terms:** Uses `data-en`, `data-it`, `data-pt` attributes on elements. JS swaps `innerHTML` based on selected language.
- **Cookie policy:** Uses class-based system (`.text-en`, `.text-it`, `.text-pt`) with show/hide via `display` style. JS also sets `data-lang` on both `html` and `body` elements.
- **Terms pages:** JS `setLanguage()` toggles `body.lang-it`/`body.lang-pt` CSS classes AND swaps text content from `data-${lang}` attributes.
- Language preference saved to `localStorage` as `holisticunity-lang`.

### Contact Form
- Service: FormSubmit.co
- Endpoint: `https://formsubmit.co/ajax/support@holisticunity.app`
- Sends JSON via `fetch()` with `Content-Type: application/json` and `Accept: application/json`
- Includes phone number field (optional, for therapist callbacks)
- Hidden fields: `_subject`, `_captcha=false`, `_template=table`, `_honey` (honeypot)
- Note: FormSubmit requires email activation on first submission (confirmation link sent to support@holisticunity.app)

---

## 9. Brand Guidelines

| Element | Value |
|---|---|
| Berry (Primary) | #8B2252 |
| Gold (Accent) | #C9A96E |
| Cream (Background) | #FDF6F0 |
| Soft Pink | #F0DFE5 |
| Charcoal (Text) | #2D2D2D |
| Display Font | Cormorant Garamond |
| Body Font | Inter |
| Company | STORM X DIGITAL S.R.L. |

---

## 10. Known Issues & Solutions

### Stripe Connect — Brazil / USA Not Showing in Onboarding
- **Root cause:** `create-connect-account` doesn't pass `country` to `stripe.accounts.create()`. Stripe defaults to platform country (Italy).
- **Fix needed:** Accept `country` param from iOS app (ISO 3166-1 alpha-2: "BR", "US", "IT"), pass it to Stripe.
- **Brazil payout issue:** `interval: "manual"` is not supported in Brazil. Must use automatic daily payouts for BR, MY, TH, IN.
- **Status:** NOT YET IMPLEMENTED. A fix was briefly deployed and reverted at Armand's request. The fix involved: reading `country` from request body, falling back to `profile.country`, and conditionally skipping manual payout settings for auto-payout countries.

### 401 Auth Errors on Edge Functions (FIXED)
- **Root cause:** User-scoped Supabase client pattern was fragile.
- **Fix:** Switched to admin client with `getUser(jwt)`. All functions deployed with `--no-verify-jwt`.

### Onboarding Status Stuck at "onboarding_pending" (FIXED)
- **Root cause:** No Stripe webhook endpoint was configured. `account.updated` events weren't reaching the function.
- **Fix:** Created webhook endpoint via Stripe API with `connect=true`. Updated `STRIPE_WEBHOOK_SECRET` in Supabase secrets.

### Mobile Horizontal Scroll on iPhone (FIXED)
- **Fix:** `html, body { overflow-x: hidden; width: 100%; max-width: 100vw; }` and `overflow-x: clip` on section containers.
- CSS reveal animations with `translateX(±60px)` were extending beyond viewport.

### Cookie Policy Portuguese Toggle (FIXED)
- **Root cause:** `<body data-lang="en">` was hardcoded, JS only updated `document.documentElement`.
- **Fix:** Added `document.body.setAttribute('data-lang', lang)` plus inline style manipulation.

### Terms Pages Portuguese Not Switching (FIXED)
- **Root cause:** JS only toggled CSS classes but HTML used data attributes for content.
- **Fix:** Added `data-${lang}` attribute text-swap logic to `setLanguage()`.

### Portuguese Translation Quality (FIXED)
- Fixed literal translations to natural Brazilian Portuguese across all 5 pages.
- Examples: "holisticamente verificados" → "holísticos verificados", "Candidata-se" → "Candidate-se", month names lowercased per PT grammar.

---

## 11. Pending / Future Tasks

### Critical (Before Launch)
- [ ] **Stripe Connect country support** — update `create-connect-account` to accept country param + handle auto-payout countries (Brazil, Malaysia, Thailand, India). The fix code exists (was briefly deployed then reverted) — see Session 2 notes.
- [ ] **Non-Connect webhook** — may need a second webhook endpoint (without `connect=true`) to receive platform-level `payment_intent` events if using destination charges. Test this: make a test payment and check if `payment_intent.succeeded` reaches the webhook.
- [ ] **Replace Stripe test key** with live key in StripeConfig.swift before App Store submission
- [ ] **Sentry verification** — trigger test event (`SentrySDK.capture(message: "test")`) to confirm error reporting works
- [ ] **App Store submission** — see `APP_STORE_SUBMISSION_WALKTHROUGH.md` and `Pre_Submission_Checklist.md`

### Nice to Have
- [ ] **Register Apple Merchant ID** for Apple Pay (optional for initial testing)
- [ ] **Payment provider for Brazil** — evaluate alternatives if Stripe Connect limitations persist. Options: Adyen (premium, international), Payoneer (cross-border), local Brazilian providers. See also: Mollie + GoCardless (merged Dec 2025).
- [ ] **Back up Edge Function source code** — 4 functions (`send-push-notification`, `livekit-token`, `stream-token`, `connect-redirect`) are deployed to Supabase but their source code is NOT in the local project folder. If they ever need to be redeployed, the source would need to be retrieved or rewritten.

---

## 12. File Map

```
Holistic Unity Project/
├── holistic-unity-website/                    # Vercel-deployed website
│   ├── index.html                             # Main landing page (trilingual)
│   ├── cookie-policy.html                     # Cookie policy (trilingual)
│   ├── privacy-policy.html                    # Privacy policy (trilingual)
│   ├── terms-clients.html                     # Client T&C (trilingual)
│   ├── terms-therapists.html                  # Therapist T&C (trilingual)
│   ├── images/                                # Website images
│   ├── robots.txt
│   └── sitemap.xml
├── supabase-edge-functions/                   # Reference copies of edge functions
├── HOLISTIC_UNITY_KNOWLEDGE_BASE.md           # THIS FILE
├── Holistic_Unity_Xcode_Implementation_Prompt.md
├── Therapist_Onboarding_Flow_Xcode_Prompt.md
├── APP_STORE_SUBMISSION_WALKTHROUGH.md
├── Pre_Submission_Checklist.md
├── App_Store_Metadata.md
├── App_Review_Notes.md
├── supabase_migration.sql                     # Full DB migration (all tables, RLS, triggers)
├── stripe_incremental_migration.sql           # Stripe-specific DB additions
├── Holistic_Unity_Therapist_Pitch_Deck.pptx
├── Holistic_Unity_Launch_Plan_May2026.docx
├── Holistic_Unity_Payment_Invoicing_Model.docx
├── Holistic_Unity_AppStore_Guide.docx
├── ZenKlub_Competitive_Analysis_Report.docx
├── ElevenLabs_Illustration_Prompts.md
├── Facebook_Ad_Creative_Prompts.md
├── Instagram_Content_Calendar_April2026.md
├── Instagram_Launch_Prompts.md
├── Images Categories/                         # Category images for the app
├── App Store Screenshots/                     # App Store submission screenshots
└── Simulator Screenshot - iPhone 17 - *.png   # Various simulator screenshots
```

---

## 13. Session History

### Session 1 (compacted)
- Set up Edge Functions with admin client auth pattern
- Fixed contact form (Formspree → FormSubmit.co)
- Added phone number field to contact form
- Full trilingual translation audit (5 pages, EN/IT/PT-BR)
- Fixed Portuguese translation quality (natural Brazilian Portuguese)
- Fixed mobile horizontal scroll for iPhone
- Fixed cookie policy and terms page language toggles
- Deployed website to Vercel

### Session 2 (March 25, 2026)
- Redeployed all 4 local Edge Functions with `--no-verify-jwt` (multiple times during debugging)
- Applied full SQL migration to Supabase database via Management API
  - Added missing table: `user_notification_preferences`
  - Added functions: `delete_user_account`, `protect_therapist_admin_columns`, `protect_review_columns`
  - Added storage buckets + policies, `user_display_info` view
  - Confirmed all 15 tables, 9 functions, 4 buckets are in place
- Discussed Sentry integration — already added to iOS app, DSN recorded
- Explained how Sentry works, how to test it, and the free tier limits
- Investigated Stripe Connect country issue (Brazil/USA not showing in onboarding)
  - Root cause: no `country` param passed to Stripe, defaults to Italy
  - Brazil also incompatible with `interval: "manual"` payouts
  - Briefly deployed country-aware `create-connect-account` then reverted at Armand's request
- Created Stripe webhook endpoint via Stripe API
  - Endpoint: `we_1TEkrz3b7e3tbHaWTeABTeXw` with `connect=true`
  - Events: account.updated, payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
  - Updated `STRIPE_WEBHOOK_SECRET` in Supabase secrets
  - Cleaned up duplicate endpoints (deleted `we_1TEYi1...` and a second non-Connect endpoint)
- Discovered 4 additional deployed Edge Functions not in local code:
  - `send-push-notification`, `livekit-token`, `stream-token`, `connect-redirect`
- Confirmed push notification trigger already exists (`send_push_on_notification_insert` on `notifications` table)
- Discussed ElevenLabs API capabilities (voice/audio, not images/video)
- Discussed alternative payment providers for Brazil (Adyen, Payoneer, Mollie+GoCardless)
- Created and iteratively updated this knowledge base

---

## 14. Architecture Notes

### Payment Flow
1. Client selects a service and time slot → booking created with status `pending`
2. iOS app calls `create-payment-intent` Edge Function → returns Stripe clientSecret
3. Client completes payment via Stripe SDK in the app
4. Stripe fires `payment_intent.succeeded` webhook → Edge Function creates `transactions` record, updates booking to `confirmed`
5. Payment method is automatically saved to `payment_methods` table for future use

### Therapist Onboarding Flow
1. Therapist signs up → `handle_new_user` trigger creates `users` row
2. Therapist fills profile → creates `therapist_profiles` row with `approval_status: "draft"`
3. Therapist submits for review → `approval_status: "pending_review"`
4. Admin approves → `approval_status: "approved"`, `is_approved: true` (via service_role)
5. Therapist sets up payments → iOS app calls `create-connect-account` → opens Stripe Express onboarding
6. Therapist completes Stripe onboarding → `account.updated` webhook updates `stripe_account_status: "active"`
7. Therapist can now receive bookings and payments

### Push Notification Flow
1. App/backend inserts row into `notifications` table
2. Database trigger `send_push_on_notification_insert` fires
3. Trigger uses `pg_net` to call `send-push-notification` Edge Function
4. Edge Function looks up device token from `device_tokens` table
5. Sends APNs push notification to the user's iPhone

### Chat Flow
1. Client/therapist opens chat → app calls `get_or_create_conversation()` RPC
2. Messages sent → inserted into `messages` table, `increment_unread_count()` called
3. Stream Chat SDK handles real-time delivery, `stream-token` Edge Function provides auth tokens

### Video Session Flow
1. Booking reaches scheduled time → app requests token from `livekit-token` Edge Function
2. Both participants join the LiveKit room for the video therapy session

---

## 15. How to Resume a Session

If context resets, tell Claude:

> "Read the file HOLISTIC_UNITY_KNOWLEDGE_BASE.md in my project folder. That has all the context you need about my project."

This will bring Claude up to speed on the entire project without needing to re-explain everything. Ask Claude to update this file at the end of each session or before context gets long.

**Tip:** If you say "update the knowledge base" at any point, Claude will add whatever new information has been discussed.

---

*Updated by Claude — March 25, 2026 (Session 2 — Final Update)*
