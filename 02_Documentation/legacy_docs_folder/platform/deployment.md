# Deployment

**Last verified:** 2026-04-16 by Marcello
**Owner:** Marcello

## Surfaces & their deploy pipelines

| Surface | Stack | Deploy target | Command |
|---------|-------|---------------|---------|
| iOS app | Swift / SwiftUI / Xcode | TestFlight → App Store | `xcodebuild -scheme "Holistic Unity" archive` → Xcode Organizer upload |
| therapist-webapp | Next.js 16 | Vercel | `cd therapist-webapp && vercel --prod` |
| admin-dashboard | Next.js 16 | Vercel | `cd admin-dashboard && vercel --prod` |
| website | Static HTML | (TBD — likely Vercel or Cloudflare Pages) | |
| Supabase Edge Functions | Deno | Supabase platform | `supabase functions deploy <name>` |
| Supabase DB migrations | SQL | Supabase Postgres | `supabase db push --linked` OR Management API direct SQL |

## Pre-deploy checklist (every release)

### For the webapp
- [ ] `npx next build` locally succeeds with no type errors
- [ ] All env vars for new features added to Vercel via `vercel env add`
- [ ] Check migrations: any new `.sql` in `supabase/migrations/` has been pushed to prod DB
- [ ] CSP in `next.config.ts` still includes all third-party domains in use
- [ ] Lighthouse spot-check on `/dashboard` (desktop + mobile)
- [ ] Smoke test: login + sign up + at least one dashboard page

### For iOS
- [ ] `xcodebuild build` passes on iPhone 17 Pro simulator
- [ ] App icon has no alpha channel (App Store rejects transparency)
- [ ] Info.plist has `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`
- [ ] Privacy policy URL set in App Store Connect
- [ ] Increment build number in Xcode project settings
- [ ] Archive + upload to TestFlight → wait for processing → distribute to internal testers
- [ ] Run through at least 3 flow MD test checklists on TestFlight build before submitting for external review

### For Supabase Edge Functions
- [ ] Local test: `supabase functions serve <name>` + curl
- [ ] Secrets reviewed: `supabase secrets list` includes everything the function reads
- [ ] Deploy: `supabase functions deploy <name>`
- [ ] Post-deploy smoke test in production (trigger flow that calls it)

### For DB migrations
- [ ] Migration is **idempotent** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.)
- [ ] Migration is **additive only** (no DROP COLUMN in a release that still has old code reading it)
- [ ] Safe to re-apply (in case previous apply was partial)
- [ ] Test on a local Supabase instance first (`supabase start` + `supabase db reset`)
- [ ] Apply to prod: `supabase db push --linked` OR via Management API:
  ```
  curl -X POST "https://api.supabase.com/v1/projects/bqyqkvkzkemiwyqjkbna/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -Rs '{query: .}' < migration.sql)"
  ```
- [ ] Verify via `information_schema.columns` query

## Rollback

### Webapp (Vercel)
```
vercel rollback
```
Or via Vercel dashboard → Deployments → Promote previous.

### iOS
- TestFlight: reject build in App Store Connect; testers fall back to previous build
- App Store: submit a fix release ASAP; "Expedited Review" if critical bug

### Edge Functions
- Redeploy previous version from git:
  ```
  git checkout <prev_sha> -- supabase/functions/<name>
  supabase functions deploy <name>
  git checkout HEAD -- supabase/functions/<name>
  ```

### DB migrations
- No automatic rollback — write a new migration that reverses the change.
- For destructive changes (RARE), have a backup plan in the PR description before merging.

## Release cadence (proposed)

- **Webapp:** continuous deployment on `main` branch push → auto-deploy to Vercel prod
- **iOS:** weekly TestFlight builds Monday → external review Friday → release if approved
- **Edge Functions:** deployed with whatever change they accompany
- **DB migrations:** deployed immediately before the code that depends on them (usually same PR)

## Monitoring post-deploy

- **Sentry** — check for new error types within 15 min of deploy
- **Stripe Dashboard** — check for anomalous failed payments
- **Supabase Logs** — check Edge Function error rate
- **Vercel Analytics** — check LCP / FID / CLS for regressions

## Known gaps

- No automated CI pipeline yet (GitHub Actions TBD)
- No blue/green deploy for iOS (App Store doesn't support)
- No canary rollout on Vercel (all users hit new deploy)
- No automated migration verification in CI
- Release notes are ad-hoc in `SESSION_HANDOFF.md` — should move to `CHANGELOG.md`
