# Holistic Unity — Credentials & Secrets Reference

> **SENSITIVE DOCUMENT — Do not share publicly or commit to version control.**

---

## Supabase

| Key | Value |
|---|---|
| Project Ref | `bqyqkvkzkemiwyqjkbna` |
| Dashboard | https://supabase.com/dashboard/project/bqyqkvkzkemiwyqjkbna |
| PAT (CLI access) | ⚠ **REVOKED** — the value `sbp_6d1805...` no longer authenticates. The previously-active `sbp_ccf81b...` PAT was used for launch-day maintenance and should also be rotated once the launch window closes. Generate a fresh PAT at https://supabase.com/dashboard/account/tokens when needed and record it in your password manager — do NOT write it back into this file. |

---

## Stripe (TEST MODE)

| Key | Value |
|---|---|
| Test Secret Key | `sk_test_51TDV1A3b7e3tbHaWjR6jCommuvF7SKLQtD5FTh1ugJYD75eZoUhDaKqlz37EGt01GpPy71LTHmkZwAJqBujQ8CoY00jYl4RfRN` |
| Webhook Endpoint ID | `we_1TEkrz3b7e3tbHaWTeABTeXw` |
| Webhook Signing Secret | `whsec_hits2Xa22F3JSxUCv3qfSgpJwDC2Mg5O` |
| Webhook URL | `https://bqyqkvkzkemiwyqjkbna.supabase.co/functions/v1/stripe-webhook` |
| Webhook Type | Connect-enabled (`connect=true`) |
| Platform Country | Italy |

---

## Vercel

| Key | Value |
|---|---|
| Deploy Token | `vcp_6a4v3T3lfvNuiV6u9mkqHVYSJELALeyHW6QH8dS1wH4Mj4p2Uj42ONE7` |
| Live URL | https://holisticunity.app |

---

## Sentry

| Key | Value |
|---|---|
| DSN | `https://7d073437356f8076a95d9e68e43a980d@o4511101583163392.ingest.de.sentry.io/4511101589192784` |
| Dashboard | https://sentry.io (Holistic Unity project) |

---

## Supabase Secrets (set on project via CLI)

All of the following are configured as environment variables accessible by Edge Functions:

| Secret Name | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API access |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification (`whsec_hits2Xa22F3JSxUCv3qfSgpJwDC2Mg5O`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin-level database access |
| `SUPABASE_ANON_KEY` | Public anonymous key |
| `SUPABASE_DB_URL` | Direct database connection string |
| `APNS_BUNDLE_ID` | iOS app bundle identifier |
| `APNS_KEY_ID` | Apple Push Notification key ID |
| `APNS_PRIVATE_KEY` | Apple Push Notification private key |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `LIVEKIT_API_KEY` | LiveKit video service key |
| `LIVEKIT_API_SECRET` | LiveKit video service secret |
| `STREAM_API_KEY` | Stream Chat service key |
| `STREAM_API_SECRET` | Stream Chat service secret |

### How to verify secrets are set:
```bash
SUPABASE_ACCESS_TOKEN=sbp_6d1805e8e04f82aabcbc59f32204d04290c7635d \
npx supabase secrets list --project-ref bqyqkvkzkemiwyqjkbna
```
