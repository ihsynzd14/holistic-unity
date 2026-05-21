# Environment Configuration

**Last verified:** 2026-04-16 by Marcello
**Owner:** Marcello

All environment variables, where they live, and how to rotate them.

## Hosting surfaces

| Surface | Config location | Notes |
|---------|-----------------|-------|
| iOS app | `Holistic Unity/*.xcconfig` (not committed) | Keys read at runtime via `Bundle.main.infoDictionary` |
| therapist-webapp (Vercel) | `.env.local` (dev) + Vercel env vars (prod/preview) | Next.js `process.env` |
| admin-dashboard (Vercel) | Same pattern | |
| Supabase Edge Functions | Supabase Dashboard → Settings → Edge Functions → Secrets | Accessed via `Deno.env.get()` |
| Supabase Auth providers | Dashboard → Authentication → Providers | Apple / Google client config |

## Variables inventory

### Supabase (public, safe in client)

| Var | Scope | Location |
|-----|-------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | webapps + iOS | `.env.local` / Vercel / xcconfig |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | webapps + iOS | Same |
| `SUPABASE_URL` | Edge Functions | Auto-injected by Supabase |

### Supabase (secret, server-only)

| Var | Scope | Location | Rotation |
|-----|-------|----------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | admin-dashboard + edge functions | Vercel prod env / Supabase Edge secret | On compromise |

### Stripe

| Var | Scope | Location | Rotation |
|-----|-------|----------|----------|
| `STRIPE_PUBLISHABLE_KEY` | iOS + webapp | Public config | On project reset |
| `STRIPE_SECRET_KEY` | Edge Functions (`create-booking-with-payment`, `stripe-webhook`, `request-refund`) | Supabase Edge secret | Yearly |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` function | Supabase Edge secret | On endpoint URL change |

### Google OAuth (Calendar)

| Var | Scope | Location | Rotation |
|-----|-------|----------|----------|
| `GOOGLE_CLIENT_ID` | webapp | Vercel + `.env.local` | On Google policy |
| `GOOGLE_CLIENT_SECRET` | webapp | Vercel + `.env.local` | ~2 years (Google rotates periodically) |
| `GOOGLE_REDIRECT_URI` | webapp | Same | On domain change |

### Microsoft OAuth (Calendar)

| Var | Scope | Location | Rotation |
|-----|-------|----------|----------|
| `MICROSOFT_CLIENT_ID` | webapp | Vercel + `.env.local` | On app registration change |
| `MICROSOFT_CLIENT_SECRET` | webapp | Vercel + `.env.local` | Max 24mo (Azure limit). Runbook: `../../MICROSOFT_OUTLOOK_SECRET_REGEN.md` |
| `MICROSOFT_REDIRECT_URI` | webapp | Same | |

### Stream Chat

| Var | Scope | Location | Rotation |
|-----|-------|----------|----------|
| `NEXT_PUBLIC_STREAM_API_KEY` | webapp + iOS | Public | On project reset |
| `STREAM_API_SECRET` | webapp `/api/stream/token`, Supabase `stream-token` | Server-only | Yearly |

### LiveKit

| Var | Scope | Location | Rotation |
|-----|-------|----------|----------|
| `LIVEKIT_URL` | iOS + webapp | Config | On project reset |
| `LIVEKIT_API_KEY` | Edge Function `livekit-token` | Supabase Edge secret | Yearly |
| `LIVEKIT_API_SECRET` | Same | Same | Yearly |

### Sentry

| Var | Scope | Location | Notes |
|-----|-------|----------|-------|
| `SENTRY_DSN` | iOS + webapp | Config | Public DSN; org-restricted |

### Admin dashboard

| Var | Scope | Location | Notes |
|-----|-------|----------|-------|
| `ADMIN_EMAILS` | admin-dashboard | Vercel | Comma-separated whitelist |

### Platform secrets

| Var | Scope | Location | Rotation |
|-----|-------|----------|----------|
| `ICAL_SECRET` | webapp iCal route + token generator | Vercel + `.env.local` | Yearly or on leak |

## Per-environment snapshot

### Local dev (`.env.local`)
Copy `.env.local.template`, fill in secrets from 1Password (or regenerate):
- Supabase URL + anon key
- Stripe test keys (prefix `sk_test_` + `pk_test_`)
- Google + Microsoft OAuth client credentials (point redirect URI to `http://localhost:3000`)
- Stream dev project

### Production (Vercel prod env)
All variables via `vercel env add`. Redirect URIs point to `https://therapistportal.holisticunity.app`.

### Preview (Vercel preview env)
Optional. When enabled, OAuth requires adding preview URLs to Google/Microsoft redirect whitelist.

## Rotation runbooks

1. **Stripe secret key**
   - Stripe dashboard → Developers → API keys → Roll key
   - Update `STRIPE_SECRET_KEY` in Supabase Edge Functions secrets
   - Redeploy functions (`supabase functions deploy --no-verify-jwt`)

2. **Microsoft client secret**
   - See `../../MICROSOFT_OUTLOOK_SECRET_REGEN.md`

3. **Google client secret**
   - Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Reset Secret
   - Update in Vercel env + `.env.local`
   - `vercel --prod` to redeploy

4. **Supabase service_role**
   - Supabase Dashboard → Settings → API → Reset service_role key
   - Update wherever used (admin-dashboard .env + Edge secrets)
   - Redeploy

5. **Stream API secret**
   - Stream Dashboard → Rotate secret
   - Update Supabase Edge secret + Vercel env
   - Redeploy

## Known gaps

- No secret scanning in CI (TODO: GitGuardian / truffleHog)
- No automatic reminder for upcoming rotations — calendar reminders manual
- No HSM or AWS Secrets Manager — all secrets via Vercel + Supabase native secret storage
- `.env.local.template` should list ALL required vars — audit before release
