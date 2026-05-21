# Holistic Unity — Flow documentation

Project memory for the marketplace platform. Each flow file is a standalone source-of-truth that traces a user-visible action from trigger to side effects, with code references at file:line precision. Use this to:

- Onboard new contributors without re-reading the entire codebase
- Diff "what should happen" against "what's happening" when debugging
- Avoid regressions during refactors (cross-check against the **Critical assertions** section before merging)

**Last full audit:** 2026-05-04 (post GDPR sprint + cross-flow logic audit; 7 bugs found and fixed)

> **For first-time readers:** start with `../PLATFORM_MAP.md` (single-page overview). Drill into the numbered files below only when you need detail on a specific flow.

## Architecture at a glance

| Surface | Tech | URL | Audience |
|---|---|---|---|
| client-webapp | Next.js 16 + React 19 | `app.holisticunity.app` | Clients |
| therapist-webapp | Next.js 16 | `therapistportal.holisticunity.app` | Therapists |
| admin-dashboard | Next.js 16 | `admin.holisticunity.app` | Internal admins |
| iOS App | SwiftUI | App Store | Clients only |
| Backend | Supabase (Postgres + Auth + Edge Functions Deno) | `bqyqkvkzkemiwyqjkbna.supabase.co` | All |
| Payments | Stripe Connect Express (destination charges) | — | Therapists onboarded via OAuth |
| Email | Brevo (transactional + lists) | — | All transactional flows |
| Video | LiveKit Cloud | `wss://holistic-unity-7cj033ty.livekit.cloud` | Sessions |
| Chat | Stream Chat SaaS | — | 1-to-1 client/therapist |
| E-invoicing | FattureInCloud + SDI | — | Italian therapists |

## Flow index

Legend: 🔴 Critical (touch financial / auth / fiscal compliance) · 🟡 Important · 🟢 Secondary

### Authentication & onboarding
| File | Flow | Crit |
|---|---|---|
| `01-auth.md` | Authentication (Supabase Auth, OAuth Apple/Google iOS, MFA gate, RLS + admin guards) | 🔴 |
| `02-therapist-onboarding.md` | Therapist registration → email confirm → /enroll-mfa → /enroll-payments → pending review | 🔴 |
| `03-client-onboarding.md` | Client registration → email confirm → /welcome (7-step) → /dashboard | 🟡 |
| `14-mfa.md` | TOTP enrollment + backup codes + AAL2 layer enforcement | 🔴 |

### Discovery & booking
| File | Flow | Crit |
|---|---|---|
| `04-therapist-discovery.md` | Marketplace browse, sort algorithm (cold-start friendly), filter, profile detail | 🟡 |
| `05-booking-single.md` | Slot picker → service select → booking creation (pending_payment) | 🔴 |
| `06-booking-pack.md` | Pack of 4/6/8/10 sessions, single payment, session credits | 🟡 |
| `10-calendar-sync.md` | Google/Microsoft OAuth, freebusy intervals, iCal feed | 🟡 |

### Money flow (Stripe + invoicing)
| File | Flow | Crit |
|---|---|---|
| `07-payment.md` | Stripe destination charge, fee math, application_fee_amount, transfer_data | 🔴 |
| `08-refund-cancellation.md` | 3-tier refund (≥48h: 100%, 24-48h: 50%, <24h: 0%), reverse_transfer logic | 🔴 |
| `16-fattura-monthly.md` | FattureInCloud cron (1° 03:00 UTC), 9 tax modes, SDI submission | 🔴 |
| `17-stripe-connect-onboarding.md` | Express account creation, onboarding link, status sync race fix | 🔴 |
| `19-admin-refund.md` | Admin-initiated refund (Edge Function bridge, audit trail) | 🔴 |
| `23-vat-validation.md` | VIES + HMRC validation, weekly INCOMPLETE billing reminder cron | 🟡 |

### Sessions & communication
| File | Flow | Crit |
|---|---|---|
| `09-video-call.md` | LiveKit token mint, join window 15min-pre/3h-post, status flips | 🔴 |
| `11-messaging.md` | Stream Chat token, channel creation `dm-{a8}-{b8}`, deep-link `?to=` | 🟡 |
| `12-reviews.md` | Server-mediated review insert, DB trigger normalize_review_identity | 🟡 |
| `13-reschedule.md` | 4 reschedule paths (therapist/client × propose/respond) + abuse cap | 🔴 |

### Notifications & comms
| File | Flow | Crit |
|---|---|---|
| `15-notifications-emails.md` | In-app `notifications` + Brevo templates (3,4,9,10,26,27,etc.) | 🟡 |

### Admin & operations
| File | Flow | Crit |
|---|---|---|
| `18-admin-approval.md` | Therapist approve/reject + DB trigger `prevent_self_approval` (service-role bypass) | 🔴 |
| `20-cron-jobs.md` | Catalog of all Vercel cron + pg_cron schedules with auth model | 🔴 |
| `21-webhooks.md` | Stripe → Vercel + Edge Function dual handling, idempotency, race protection | 🔴 |
| `22-account-deletion.md` | Edge Function delete-user-account orchestrator | 🟡 |

## Recent timeline (changes that affect docs)

- **2026-05-03**: Fattura mensile end-to-end shipped after 14 sequential bug fixes (cron filter, payout cron unscheduled, NULL payout_after, Edge Function auth, cron auth alignment, middleware blocking, FIC payload errors x6, entity name override). See `16-fattura-monthly.md` for full chronology.
- **2026-04-30**: `prevent_self_approval` trigger service-role bypass added (was rejecting admin route updates).
- **2026-04-29**: `normalize_review_identity` trigger added (defense-in-depth for iOS direct insert).
- **2026-04-28**: Calendar OAuth env fix (client-webapp had empty/corrupted `GOOGLE_CLIENT_ID`).
- **2026-04-27**: Webhook v2 — INSERT-then-UPDATE pattern + `alreadyProcessed` derived from UPDATE result + idempotency table `stripe_webhook_events`. Reschedule notification routes added (4 paths × Brevo). Cancel route notify added.
- **2026-04-25**: Tiered refund policy verified (0%, 50%, 100% paths all tested live).
- **2026-04-17**: MFA enroll wizard + AAL2 gate.
- **2026-04-16**: Initial flow docs (01-10) — these are kept as-is for context but **superseded by the May audit** for any conflict.

## Conventions

- **State machine on `bookings.status`**: `pending` (legacy iOS) → `pending_payment` (Stripe Checkout open) → `confirmed` (paid, video room provisioned) → `in_progress` → `completed`. Branches: `cancelled` (any state), `no_show` (post-session), `reschedule_pending` (with `proposed_scheduled_at`).
- **`status` on transactions**: `pending` → `processing` → `completed` (charge succeeded) → `refunded`/`partially_refunded`. `payout_status` is independent: `pending` (in 14-day escrow) → `paid` (Stripe transferred) → `refunded` (reversed).
- **DB triggers** are the last line of defense. Most app routes do BOTH explicit ownership checks AND optimistic-locked UPDATEs, but the triggers `protect_booking_columns`, `protect_therapist_admin_columns`, `prevent_self_approval`, `protect_review_columns`, `protect_stripe_financial_columns`, `normalize_review_identity` are present so a misconfigured RLS or a bypass route still can't break invariants.
- **Cron jobs** authenticate via `CRON_SECRET` env var, never user JWTs. Vercel cron and pg_cron use the same secret. Edge Functions accept either the legacy service-role JWT or the new `sb_secret_*` format or `CRON_SECRET` for back-compat.
- **Idempotency**: Stripe operations use `bookingId` as the idempotency key. Webhook delivery dedup is via `stripe_webhook_events.event_id` PRIMARY KEY.

## Audit status (2026-05-03)

| File | Status | Notes |
|---|---|---|
| `01-auth.md` | ✅ Audited 2026-05-03 | MFA mandate + AAL2 added; cross-refs to 14, 18, 22 added |
| `02-therapist-onboarding.md` | ⚠️ Pre-audit (2026-04-16) | Captures the `/enroll-mfa` → `/enroll-payments` step order; consistent with current flow but should be re-read against 14-mfa.md and 17-stripe-connect-onboarding.md |
| `03-client-onboarding.md` | ⚠️ Pre-audit (2026-04-16) | Welcome wizard 7-step still current |
| `04-therapist-discovery.md` | ⚠️ Pre-audit (2026-04-16) | Sort algorithm unchanged; cold-start logic still valid |
| `05-booking-single.md` | ⚠️ Pre-audit (2026-04-16) | State-machine `pending_payment` was added later; refer to 07-payment.md for canonical |
| `06-booking-pack.md` | ⚠️ Pre-audit (2026-04-16) | Pack credits flow unchanged |
| `07-payment.md` | ✅ Audited 2026-05-03 | Fees corrected (2.9% + €0.30), webhook v2 INSERT-then-UPDATE, validate-promo gap clarified |
| `08-refund-cancellation.md` | ✅ Audited 2026-05-03 | 3-tier verified live, all 5 entry points listed |
| `09-video-call.md` | ⚠️ Pre-audit (2026-04-17) | LiveKit join window still current |
| `10-calendar-sync.md` | ⚠️ Pre-audit (2026-04-16) | Re-read alongside Apr-28 OAuth env fix note in timeline |
| `11-messaging.md` through `23-vat-validation.md` | ✅ Authored 2026-05-03 | Reference-grade for the May audit |

Default rule when in doubt: the May 2026 audit version takes precedence over any older content.
