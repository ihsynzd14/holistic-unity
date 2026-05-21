# Holistic Unity — Developer Onboarding Guide

Welcome to the Holistic Unity project. This guide will get you up to speed quickly.

---

## Quick Start

1. Read `01_ARCHITECTURE.md` to understand the system
2. Read `03_CREDENTIALS.md` (sensitive — don't share)
3. Read `04_DATABASE_SCHEMA.md` for the data model
4. Read `05_STATUS_TRACKER.md` to see what's done and what's pending

---

## Project Structure

```
Holistic Unity/
├── [iOS App]                                  # Swift/SwiftUI Xcode project
│   └── StripeConfig.swift                     # Contains Stripe publishable key
│
├── supabase/functions/                        # Edge Function source code (4 of 8)
│   ├── create-connect-account/index.ts
│   ├── create-payment-intent/index.ts
│   ├── connect-dashboard/index.ts
│   └── stripe-webhook/index.ts
│
├── holistic-unity-website/                    # Static website (Vercel)
│   ├── index.html
│   ├── cookie-policy.html
│   ├── privacy-policy.html
│   ├── terms-clients.html
│   └── terms-therapists.html
│
├── Project Handoff/                           # THIS FOLDER — documentation
│   ├── 01_ARCHITECTURE.md
│   ├── 02_DEPLOYMENT_GUIDE.md
│   ├── 03_CREDENTIALS.md
│   ├── 04_DATABASE_SCHEMA.md
│   ├── 05_STATUS_TRACKER.md
│   └── 06_DEVELOPER_ONBOARDING.md
│
├── HOLISTIC_UNITY_KNOWLEDGE_BASE.md           # AI session continuity file
├── supabase_migration.sql                     # Full database migration
└── [Various docs, decks, screenshots]
```

---

## Key Technical Decisions

### Why --no-verify-jwt on all Edge Functions?
The Supabase gateway's built-in JWT verification was rejecting valid tokens before the function code could run. Instead, each function extracts the JWT from the Authorization header and verifies it using the admin client (`supabaseAdmin.auth.getUser(jwt)`). This gives us more control over error handling and avoids the gateway 401 issue.

### Why admin client instead of user-scoped client?
The original pattern created a Supabase client scoped to the user's session. This was fragile — if the token was slightly stale or the client was misconfigured, it failed silently. The admin client pattern uses the service role key for database operations and separately verifies the JWT. It's more reliable and gives better error messages.

### Why FormSubmit.co instead of Formspree?
The original website used Formspree with a placeholder ID. FormSubmit.co was chosen because it's free, requires no account setup (just email activation), and supports AJAX JSON submissions. Note: first submission triggers a confirmation email to support@holisticunity.app.

### Why Connect webhook with connect=true?
The `account.updated` event for therapist Stripe Connect onboarding only fires through Connect webhooks. Without `connect=true`, the webhook endpoint would never receive the event that updates the therapist's `stripe_account_status` from "onboarding_pending" to "active".

### Platform Fee
20% of each transaction goes to the platform. This is hardcoded as `PLATFORM_FEE_PERCENT = 0.20` in `stripe-webhook/index.ts`.

---

## Common Tasks

### Deploy an Edge Function
```bash
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase functions deploy FUNCTION_NAME \
--project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt
```

### Deploy the website
```bash
cd holistic-unity-website
npx vercel deploy --prod --yes --token=vcp_6a4v3T3lfvNuiV6u9mkqHVYSJELALeyHW6QH8dS1wH4Mj4p2Uj42ONE7
```

### Run a SQL query on the database
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/bqyqkvkzkemiwyqjkbna/database/query" \
  -H "Authorization: Bearer sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT count(*) FROM public.users;"}'
```

### Check Edge Function logs
Go to: https://supabase.com/dashboard/project/bqyqkvkzkemiwyqjkbna/functions

### Check Stripe webhook delivery
```bash
curl -s "https://api.stripe.com/v1/webhook_endpoints/we_1TEkrz3b7e3tbHaWTeABTeXw" \
  -u "sk_test_51TDV1A3b7e3tbHaWjR6jCommuvF7SKLQtD5FTh1ugJYD75eZoUhDaKqlz37EGt01GpPy71LTHmkZwAJqBujQ8CoY00jYl4RfRN:"
```

---

## Working with Claude AI

This project uses Claude (via Cowork mode) for development assistance. To resume context in a new session:

> "Read the file HOLISTIC_UNITY_KNOWLEDGE_BASE.md in my project folder. That has all the context you need about my project."

To update the knowledge base after making changes:

> "Update the knowledge base."

---

## Contacts

| Role | Name | Email |
|---|---|---|
| Project Owner | Armand | Armand@stormxdigital.com |
| Company | STORM X DIGITAL S.R.L. | |
| Support Email | | support@holisticunity.app |
