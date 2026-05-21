# Holistic Unity — Deployment Guide

## Prerequisites

- Node.js installed (for `npx` commands)
- Supabase CLI (`npx supabase` works without global install)
- Vercel CLI (`npx vercel` works without global install)
- Access to Stripe Dashboard (test mode)
- Xcode (for iOS app builds)

---

## Edge Functions Deployment

All Edge Functions are deployed with `--no-verify-jwt` because each function handles its own authentication internally.

### Functions with Local Source Code (4)

These can be redeployed anytime from the local repo:

```bash
cd "/Users/marcello/Desktop/Apps/Holistic Unity"

# Payment intent creation
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase functions deploy create-payment-intent \
--project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt

# Stripe Connect account creation
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase functions deploy create-connect-account \
--project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt

# Stripe Express Dashboard access
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase functions deploy connect-dashboard \
--project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt

# Stripe webhook handler
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase functions deploy stripe-webhook \
--project-ref bqyqkvkzkemiwyqjkbna --no-verify-jwt
```

### Functions Deployed Separately (4) — DO NOT REDEPLOY WITHOUT SOURCE

These were deployed from a different context. Source code is NOT in the local project:

| Function | Supabase ID | Purpose |
|---|---|---|
| `send-push-notification` | `02c805ca-2826-46fe-8ba1-50bb5f053852` | APNs push delivery |
| `livekit-token` | `36951378-7450-42a7-918a-f2bd293c4f1a` | Video call tokens |
| `stream-token` | `cbd333d0-5f1b-4e15-b833-8e7614c963b8` | Chat tokens |
| `connect-redirect` | `6e125b1c-8aac-49af-86e0-f9d17a7b630f` | Stripe OAuth redirect |

---

## Website Deployment (Vercel)

```bash
cd "/path/to/holistic-unity-website"
npx vercel deploy --prod --yes --token=vcp_6a4v3T3lfvNuiV6u9mkqHVYSJELALeyHW6QH8dS1wH4Mj4p2Uj42ONE7
```

**Live URL:** https://holisticunity.app

### Website Pages
- `index.html` — Main landing page
- `cookie-policy.html` — Cookie policy
- `privacy-policy.html` — Privacy policy
- `terms-clients.html` — Client terms & conditions
- `terms-therapists.html` — Therapist terms & conditions

All pages support trilingual switching (English, Italian, Portuguese-BR).

---

## Database Migration

The full migration can be run via the Supabase SQL Editor or the Management API:

### Via SQL Editor
1. Go to https://supabase.com/dashboard/project/bqyqkvkzkemiwyqjkbna
2. Click SQL Editor → New Query
3. Paste contents of `supabase_migration.sql`
4. Click Run

### Via Management API
```bash
# For simple queries:
curl -s -X POST "https://api.supabase.com/v1/projects/bqyqkvkzkemiwyqjkbna/database/query" \
  -H "Authorization: Bearer sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT table_name FROM information_schema.tables WHERE table_schema = '\''public'\'' ORDER BY table_name;"}'

# For large SQL files, use Python to build the JSON payload:
python3 -c "
import json
with open('supabase_migration.sql', 'r') as f:
    sql = f.read()
with open('payload.json', 'w') as f:
    json.dump({'query': sql}, f)
" && curl -s -X POST "https://api.supabase.com/v1/projects/bqyqkvkzkemiwyqjkbna/database/query" \
  -H "Authorization: Bearer sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

The migration is idempotent (uses `IF NOT EXISTS` and `ON CONFLICT DO NOTHING`).

---

## Supabase Secrets Management

### List current secrets
```bash
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase secrets list --project-ref bqyqkvkzkemiwyqjkbna
```

### Set a secret
```bash
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase secrets set SECRET_NAME=secret_value --project-ref bqyqkvkzkemiwyqjkbna
```

---

## Stripe Webhook Management

### List endpoints
```bash
curl -s "https://api.stripe.com/v1/webhook_endpoints" \
  -u "sk_test_51TDV1A3b7e3tbHaWjR6jCommuvF7SKLQtD5FTh1ugJYD75eZoUhDaKqlz37EGt01GpPy71LTHmkZwAJqBujQ8CoY00jYl4RfRN:"
```

### Create new endpoint
```bash
curl -s -X POST "https://api.stripe.com/v1/webhook_endpoints" \
  -u "sk_test_...:" \
  -d "url=https://bqyqkvkzkemiwyqjkbna.supabase.co/functions/v1/stripe-webhook" \
  -d "enabled_events[]=account.updated" \
  -d "enabled_events[]=payment_intent.succeeded" \
  -d "enabled_events[]=payment_intent.payment_failed" \
  -d "enabled_events[]=charge.refunded" \
  -d "connect=true"
```

**Important:** Only ONE endpoint should point to a given URL. Multiple endpoints with different signing secrets cause signature verification failures.

---

## Going Live Checklist

1. [ ] Replace Stripe test key (`sk_test_...`) with live key (`sk_live_...`) in Supabase secrets
2. [ ] Update `STRIPE_WEBHOOK_SECRET` with the live webhook signing secret
3. [ ] Create a live Stripe webhook endpoint (same events as test)
4. [ ] Update `StripeConfig.swift` in the iOS app with the live publishable key
5. [ ] Register Apple Merchant ID for Apple Pay (optional)
6. [ ] Verify Sentry is capturing events in production
7. [ ] Submit to App Store — see `APP_STORE_SUBMISSION_WALKTHROUGH.md`
