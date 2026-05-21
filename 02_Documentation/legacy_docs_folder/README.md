# Holistic Unity — Flow Documentation

**Last updated:** 2026-04-17

This folder is the **source of truth for intent**. Each MD file describes one flow or one cross-cutting concern.

## Platform at a glance (V1)

- **iOS app — client-only.** Therapists get a redirect screen, no therapist UI.
- **Therapist webapp** (`therapistportal.holisticunity.app`) — therapist-only. Full profile management, services, availability, Stripe Connect, bookings, messages, earnings.
- **Admin dashboard** — admin-only. Two-factor admin check (`ADMIN_EMAILS` env whitelist **AND** `users.is_admin=true`) via `requireAdmin()` helper.
- **Supabase** — single source of truth for auth, data, Edge Functions, storage.
- **Stripe Connect Destination Charges** — payments routed via platform, therapist payout delay 14 days.
- **All sessions virtual (LiveKit).** No in-person format option.
- **Refund policy (three-tier):** ≥48h=100%, 24h–48h=50%, <24h=0%.
- **Multi-language iOS V1:** EN + IT auto-detected from device locale.
- **Typography:** Fraunces serif (display) + SF Pro (body) on iOS. Berry #7B2252 brand colour.

### Security hardening deployed 2026-04-17 (pre-TestFlight)

Phase 1 + 2 (baseline):
- **Distributed rate limiting** via Postgres RPC `check_rate_limit()` — shared across all Edge Function and Next.js serverless instances. See `platform/security.md` "Rate limiting".
- **Admin defense-in-depth** — `users.is_admin` column + `public.is_admin()` RPC + `_guard_user_is_admin_updates` trigger blocks self-escalation.
- **Zod validation** on 4 hot edge functions (`create-booking-with-payment`, `livekit-token`, `request-refund`, `detach-payment-method`).
- **`search_path = ''`** on all 23 SECURITY DEFINER functions (prevents privilege escalation via schema shadowing).
- **iOS biometric gate** — `BiometricLock` + `BiometricLockView` overlay on background → foreground transitions when enabled in Settings.
- **iOS TLS pinning** — TrustKit pinning Supabase + Stripe SPKI hashes, currently in **reporting mode** (7-day soak before enforcement).
- **Screen recording protection** — `ScreenCaptureMonitor` blurs video call when `UIScreen.isCaptured == true`.

Phase 3 (defense-in-depth, same day):
- **Deep-link strict allowlist** — `DeepLinkRouter.swift` replaces silent-fallthrough handling; rejected URLs logged to Sentry with scheme+host only (never the token-bearing payload).
- **CSP nonce-based** — per-request nonce in edge middleware on therapist-webapp + admin-dashboard; `'unsafe-inline'` + `'unsafe-eval'` removed from `script-src`; admin dashboard CSP added from scratch.
- **Jailbreak detector scaffold** — `JailbreakDetector.swift` wired in behind `#if canImport(IOSSecuritySuite)`; activation is single SPM-add away. Soft-fail policy: flags to Sentry, never hard-blocks.

Phase 4 (automated scanning + monitoring, same day):
- **gitleaks CI** — `.github/workflows/gitleaks.yml` + custom `.gitleaks.toml` in all three web repos; scans history on every push, PR, and weekly cron; posts SARIF to the repo's Security tab.
- **npm audit CI** — daily + per-commit; fails build on high/critical in production deps.
- **Dependabot** — weekly grouped PRs per ecosystem; stream-chat major blocked pending V1.1 upgrade track.
- **Manual scanner runbook** at `platform/scanning-runbook.md` — MobSF (IPA), OWASP ZAP (webapps), testssl.sh (all production hosts), ggshield (belt-and-suspenders secret scan).
- **Alert rules** at `platform/monitoring.md` — 5 Sentry rules (deep-link spike, jailbreak, RL cascade, admin-denied, crash-rate) + 7 Supabase log queries.

Phase 5 (compliance + incident response, same day):
- **Incident response runbook** at `../INCIDENT_RESPONSE.md` — severity matrix, per-provider secret rotation (8 providers), GDPR Art 33 breach response, Supabase PITR procedure, Stripe dispute path, outage playbook, post-mortem template.
- **GDPR erasure pipeline** — new migration `20260417150000_gdpr_erasure_pipeline.sql` with soft-delete + 30-day retention + tombstone pattern; new edge function `delete-user-account` orchestrating Stripe + Stream cleanup before DB anonymization; iOS `deleteAccount()` rewired to use it.
- **Expanded data export** — iOS Settings → "Export my data" now covers 7 tables (users, bookings, reviews, transactions, session_credits, device_tokens, conversation_participants) with clear disclaimer about 3rd-party processor data.
- **Compliance status** at `platform/compliance.md` — sub-processor gap analysis (LiveKit/Stream/Brevo/Sentry missing from privacy policy), App Store 5.1.1(v) verification checklist, GDPR Article-by-Article coverage, Records-of-Processing skeleton.
- **Abuse hardening roadmap** at `platform/abuse-hardening-roadmap.md` — hCaptcha activation plan (5 steps), bug-bounty / VDP launch guidance, trade-offs on alternative anti-abuse measures, explicit NO list.

## Structure

```
docs/
├── README.md                (this file — index + conventions)
├── TEMPLATE.md              (copy this when adding a new flow)
├── flows/                   (end-to-end user flows)
│   ├── 01-auth.md
│   ├── 02-therapist-onboarding.md
│   ├── 03-client-onboarding.md
│   ├── 04-therapist-discovery.md
│   ├── 05-booking-single.md
│   ├── 06-booking-pack.md
│   ├── 07-payment.md
│   ├── 08-refund-cancellation.md
│   ├── 09-video-call.md
│   ├── 10-calendar-sync.md
│   ├── 11-messaging.md
│   └── 12-reviews.md
└── platform/                (cross-cutting concerns)
    ├── security.md
    ├── data-model.md
    ├── env-config.md
    ├── i18n.md
    ├── deployment.md
    ├── scanning-runbook.md  (Phase 4 — Docker scanner one-liners)
    ├── monitoring.md        (Phase 4 — Sentry + Supabase alert rules)
    ├── compliance.md        (Phase 5 — GDPR coverage + App Store 5.1.1(v))
    └── abuse-hardening-roadmap.md  (Phase 5 — CAPTCHA + bug bounty V1.1 plan)
```

## Rules for keeping these docs alive

1. **`Last verified` header** — every MD must have a date at the top. If it's older than 60 days, treat with suspicion until re-verified.
2. **Link to `file:line`, don't duplicate code** — if the code moves, the link breaks and you spot the drift immediately.
3. **PR must update doc if flow changes** — this is a team agreement, not automated. See `docs/CONTRIBUTING-DOCS.md` (TODO).
4. **Release checklist** — before each release, run the manual "Test checklist" of every flow touched by the release.
5. **Dogfood with AI** — when asking Claude/Codex to change a flow, always paste the relevant MD first. If the AI finds incongruence between MD and code, update the MD in the same PR.

## Reading order for new devs

1. `platform/data-model.md` — understand the schema
2. `platform/security.md` — understand auth + RLS
3. `flows/01-auth.md` + `02-therapist-onboarding.md` + `03-client-onboarding.md`
4. `flows/05-booking-single.md` + `07-payment.md` — core business
5. The rest by relevance

## Related top-level docs (legacy / adjacent)

- `../PAYMENT_MODEL.md` — v3.0 pricing rules (more detailed than 07-payment.md)
- `../THERAPIST_PROFILE_MAPPING.md` — dashboard ↔ iOS field mapping
- `../SECURITY_AUDIT.md` — periodic security review
- `../SESSION_HANDOFF.md` — working notes for continuing sessions
- `../MICROSOFT_OUTLOOK_SECRET_REGEN.md` — Azure secret rotation runbook

Those remain the source of truth for their topic; the `docs/` folder summarizes and links to them.
