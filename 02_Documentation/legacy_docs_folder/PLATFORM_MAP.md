# Holistic Unity — Platform Map

**Last verified:** 2026-05-04 (post GDPR sprint + 7-bug fix-sprint, all deployed)
**Purpose:** Single-page reference. Read this first; drill into `flows/01-23.md` only if you need detail on a specific flow.

> **Why this document exists.** The platform has 4 codebases, 18+ Edge Functions, 8 cron jobs, 5 third-party SaaS, a 12-state booking machine, a tiered refund policy, a 9-mode tax system, and a GDPR consent pipeline. Anyone who needs to understand "how does X work end-to-end" without reading 3,000 lines of flow docs reads this page.

---

## 1. The 60-second summary

Marketplace that pairs **clients** with **therapists** for paid wellness sessions (counselling, naturopathy, ayurveda, astrology, human design, family constellation, numerology). Italian-incorporated (Storm X Digital S.R.L., Bisceglie). Operates EU-wide + UK + ROW. Generates Art. 9 GDPR data (health-related), so consent + retention bars are high.

**Money model:** client pays `session price + 2.9% + €0.30 service fee`; therapist always nets exactly **80%** of session price; platform retains 20% commission (IVA-included for IT, reverse-charge for EU/UK, out-of-scope for US/ROW). Stripe Connect destination charges move funds to the therapist's connected account at charge time, held in 14-day escrow before bank payout. Monthly the platform issues a fattura riepilogativa to each therapist for the 20% commission via FattureInCloud → SDI (for IT) or email (cross-border).

**Auth model:** clients via iOS-only sign-in (email/Apple/Google) or web (email + Turnstile + breach-check). Therapists via therapist webapp only, gated by mandatory TOTP MFA + AAL2 layer. Admin via admin dashboard with 2-factor check (`ADMIN_EMAILS` env AND `users.is_admin=true` DB flag). All triggers + RLS layered as defense-in-depth even where app routes already do explicit checks.

---

## 2. Architecture at a glance

| Surface | Tech | URL | Audience |
|---|---|---|---|
| `holistic-unity-website` | Static HTML + JS | `holisticunity.app` | Public marketing |
| `client-webapp` | Next.js 16 + React 19 | `app.holisticunity.app` | Clients |
| `therapist-webapp` | Next.js 16 | `therapistportal.holisticunity.app` | Therapists |
| `admin-dashboard` | Next.js 16 | `admin.holisticunity.app` | Internal admins |
| iOS App | SwiftUI | App Store | Clients only |
| Backend | Supabase (Postgres + Auth + Edge Functions Deno) | `bqyqkvkzkemiwyqjkbna.supabase.co` | All |
| Payments | Stripe Connect Express (destination charges) | — | Therapists onboarded via OAuth |
| Email | Brevo (transactional + lists) | — | All transactional flows |
| Video | LiveKit Cloud | `wss://holistic-unity-7cj033ty.livekit.cloud` | Sessions |
| Chat | Stream Chat SaaS | — | 1-to-1 client/therapist |
| E-invoicing | FattureInCloud + SDI | — | Italian therapists (B2B + B2C IT modes) |

**Surface ↔ user role one-to-one.** iOS = clients only (a therapist who installs the app gets `TherapistWebAppRedirectView`). Web therapist portal rejects `role != therapist`. Admin dashboard rejects without env+DB double check.

---

## 3. User journeys (read these in order)

### 3.1 Client journey (the happy path)

```
sign-up (iOS or web)            → 03-client-onboarding.md
   │
   ├─ web: email/password + 4 consents (privacy, terms, vessatorie, Art.9)
   ├─ web: Turnstile + HIBP breach check
   └─ iOS: email/Apple/Google + 4 consents (post 2026-05-04)
   │
   ▼
email confirmation               → /auth/callback exchanges code → /welcome
   │
   ▼
/welcome 7-step wizard           → matchmaking, sets preferences
   │
   ▼
browse marketplace               → 04-therapist-discovery.md
   │  (sort algorithm: cold-start friendly, mixes verified + new)
   │
   ▼
pick therapist + slot            → 05-booking-single.md OR 06-booking-pack.md
   │  (slot picker → service select → booking row created `pending_payment`)
   │
   ▼
pay via Stripe Checkout (web) or PaymentSheet (iOS) → 07-payment.md
   │  (destination charge: app fee + transfer_data.destination=therapist)
   │
   ▼
webhook fires `payment_intent.succeeded` → 21-webhooks.md
   │  (race-resolved: stripe_webhook_events PRIMARY KEY + INSERT-then-UPDATE)
   │  → bookings.status='confirmed', transactions row inserted, video_room_id minted
   │
   ▼
optional: chat with therapist    → 11-messaging.md (Stream Chat dm-{a8}-{b8})
   │
   ▼
session day                      → 09-video-call.md
   │  (LiveKit token mint, join window 15min-pre/3h-post)
   │
   ▼
session ends                     → auto-complete cron flips status to `completed`
   │
   ▼
review prompt                    → 12-reviews.md
   │  (server-mediated insert; normalize_review_identity trigger)
   │
   ▼
14 days later                    → process-pending-payouts cron flips
                                    payout_status='paid' (Stripe already moved $)
```

**Off-happy-path branches:**
- Cancel any time → `08-refund-cancellation.md` (3-tier: 100%/50%/0%)
- Reschedule → `13-reschedule.md` (4 paths × proposer × responder)
- Account deletion → `22-account-deletion.md` (GDPR Art. 17)

### 3.2 Therapist journey

```
register (therapist webapp only) → 02-therapist-onboarding.md
   │
   ▼
email confirm → forced /enroll-mfa (4-step wizard) → 14-mfa.md
   │  TOTP + 8 backup codes (bcrypt-hashed, single-use)
   │
   ▼
/enroll-payments (Stripe Connect Express) → 17-stripe-connect-onboarding.md
   │  weekly Friday + delay_days=14
   │
   ▼
profile setup (bio, photo, services, certifications, calendar)
   │
   ▼
admin approves                 → 18-admin-approval.md
   │  (sets approval_status='approved', is_approved=true, Brevo template 7)
   │
   ▼
becomes visible in marketplace
   │
   ▼
receives bookings (subject to availability + bookings_overlap_guard trigger)
   │
   ▼
delivers sessions, gets paid 80% of session price
   │
   ▼
1st of next month                → 16-fattura-monthly.md
   │  (cron 03:00 UTC → 20% commission fattura riepilogativa)
   │  (IT modes: SDI; cross-border: email PDF)
   │
   ▼
14 days post-session             → process-pending-payouts flips ledger
   │  (Stripe already paid the connected account at charge time)
```

**Periodic obligations:** every sign-in re-prompts AAL2 (TOTP); reschedule abuse cap 3 max; reliability score affects discovery sort + may block reschedule path.

### 3.3 Admin journey

```
sign-in (admin.holisticunity.app)
   │  email/password + ADMIN_EMAILS env match + users.is_admin=true (both required)
   │  middleware redirects /api/cron/* and login flows; rest gated by requireAdmin()
   │
   ▼
therapist queue                 → 18-admin-approval.md
   │  approve / reject (with feedback) → Brevo + audit log
   │
   ▼
booking management              → 19-admin-refund.md
   │  cancel-only OR refund-only (separate routes, audit-logged)
   │
   ▼
manual cron triggers (debug)
   │  POST /api/cron/monthly-invoices with CRON_SECRET → 16-fattura-monthly.md
   │
   ▼
account deletion oversight      → 22-account-deletion.md
   │  (manual restore window 30 days post user-initiated delete)
```

---

## 4. State machines (the source of truth)

### 4.1 `bookings.status`

```
                  ┌─────────┐  (legacy iOS only,
       client     │ pending │   pre pending_payment)
       ──────────►└────┬────┘
                       │
                  pre-stripe path on web      iOS direct PaymentIntent
                       │                            │
                       ▼                            │
              ┌───────────────────┐                 │
              │ pending_payment   │←────────────────┘
              └────────┬──────────┘
                       │
                       │ checkout.session.expired (24h) → cancelled
                       │ payment_intent.succeeded → confirmed
                       │
                       ▼
                  ┌──────────┐
                  │confirmed │◄──── reschedule respond accept (from reschedule_pending)
                  └────┬─────┘◄──── reschedule decline (revert)
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   cancel route   reschedule       auto-complete
   (3-tier)       proposed          cron (15min)
        │              │              │
        ▼              ▼              ▼
   cancelled    reschedule_       ┌───────────┐
                   pending        │in_progress│
                       │          └────┬──────┘
                       │ (2 cron paths)│
                       │  ▼            ▼
                       │  → confirmed  └─► completed
                       │  → cancelled
                       │
                       └─► cancelled (auto-cancel-reschedule, 24h timeout)
```

Branches: `cancelled` (any source: client / therapist / admin / system); `no_show` (post-session, V1.1 manual); `completed` (auto-flip 30min after `scheduled_at + duration`).

### 4.2 `transactions.status` × `payout_status`

```
INSERT (status='completed', payout_status='pending', payout_after = now() + 14d)
                  │
   ┌──────────────┼──────────────┬──────────────────┐
   │              │              │                  │
  100% refund    50% refund     50% refund      14d elapsed
   (any time)    pre-escrow      post-escrow         │
   │              │              │                   ▼
   ▼              ▼              ▼              status='completed'
  status=        status=        status=          payout_status='paid'
  'refunded'     'partially_    'partially_     (process-pending-
  payout=        refunded'      refunded'       payouts cron)
  'refunded'     payout=        payout=
                 'pending'      'partially_
                                refunded'
```

**Critical state values for `payout_status`:**
- `pending` — fresh row, escrow not elapsed
- `paid` — escrow elapsed, internal ledger reflects Stripe's destination charge
- `refunded` — full refund, both `reverse_transfer` and `refund_application_fee` happened
- `partially_refunded` — 50% refund AFTER escrow had already been flipped to `paid`. DB matches Stripe ledger: half the payout actually paid out, half clawed back. Earnings dashboard must show this as a distinct state.

**Pre-escrow 50% refund stays `pending`** because the cron will eventually flip the un-refunded half to `paid` once `payout_after <= now()`. **Post-escrow 50% refund flips to `partially_refunded`** because the cron has already paid the full amount and a clawback occurred.

### 4.3 `therapist_profiles` lifecycle

```
register → approval_status='pending_review', is_approved=false
   │
   ├─► admin approve → 'approved' + is_approved=true → marketplace visible
   ├─► admin reject  → 'changes_requested'  → therapist edits → back to 'pending_review'
   └─► admin reject  → 'rejected'           → terminal
```

`stripe_account_status` is independent: `onboarding_pending → active | restricted`. Marketplace visibility requires BOTH `approval_status='approved'` AND `stripe_account_status='active'`.

### 4.4 Reschedule sub-state

```
confirmed
   │
   ├─ therapist proposes ──► reschedule_pending (proposed_by='therapist')
   │                               │
   │                               ├─ client accept   ──► confirmed (new time)
   │                               ├─ client reject   ──► cancelled + 100% refund
   │                               └─ 24h timeout     ──► cancelled + 100% refund (cron)
   │
   └─ client proposes  ──► reschedule_pending (proposed_by='client')
                                   │
                                   ├─ therapist approve ──► confirmed (new time)
                                   ├─ therapist decline ──► confirmed (revert original)
                                   └─ 24h timeout       ──► confirmed (revert original, cron)
```

**Asymmetry rationale:** therapist-proposed timeout = full refund (therapist initiated, client can't be blamed). Client-proposed timeout = revert (otherwise clients would game free cancellations by proposing impossible times).

---

## 5. Money flow (the single most critical flow)

### 5.1 Fee math (canonical: `client-webapp/src/lib/payments/fee-config.ts`)

```
PLATFORM_FEE_PERCENT = 0.20    # platform commission (20% of session price)
IVA_RATE             = 0.22    # Italian VAT, applied ONLY for IT therapists
SERVICE_FEE_PERCENT  = 0.029   # Stripe pass-through to client (2.9%)
SERVICE_FEE_FIXED    = 30      # Stripe pass-through to client (€0.30)
```

For session price S (cents), country cc:

```
platformFee     = round(S × 0.20)
serviceFee      = round(S × 0.029) + 30
totalCharged    = S + serviceFee                # what client pays
applicationFee  = platformFee + serviceFee      # what platform retains via Stripe
therapistPayout = totalCharged - applicationFee = 0.80 × S
```

For IT therapists:
```
platformFeeNet  = round(platformFee / 1.22)
ivaAmount       = platformFee - platformFeeNet  # accounting only
```

**Invariants:** therapist always gets exactly 80% of session price. Service fee borne by client. IVA never charged to client (it's accounting on the platform's commission).

### 5.2 Webhook v2 race protection (3 layers)

Two webhook handlers can both receive `payment_intent.succeeded` for web checkouts (Edge Function for iOS + Vercel route for web; Stripe sends both):

```
Layer 1 — Event-level dedup
   stripe_webhook_events PRIMARY KEY (event_id)
   INSERT — on 23505 → return 200 deduplicated:true, skip

Layer 2 — Booking flip optimistic lock
   UPDATE bookings WHERE status='pending_payment'
   .select() returns NULL → other handler won → skip notifications

Layer 3 — Transaction INSERT-then-UPDATE
   INSERT transactions
   on 23505 → UPDATE WHERE booking_id (overwrite with canonical fees)
```

### 5.3 Refund tiers (from `08-refund-cancellation.md`)

| Lead time | Refund | App fee | Stripe call shape |
|---|---:|---|---|
| ≥ 48h | 100% | refunded | `reverse_transfer: true, refund_application_fee: true` |
| 24-48h | 50% | platform keeps | `amount: floor(0.5 × captured), reverse_transfer: true` |
| < 24h | 0% | n/a | no Stripe call |
| Therapist-cancel (any time) | 100% | refunded | platform absorbs cost |
| Reschedule timeout (therapist-proposed) | 100% | refunded | system-cancel |

**5 entry points all converge:** client web/iOS, therapist webapp, admin (split: cancel-only + refund-only), system (auto-cancel-reschedule cron). All write the same `bookings` audit fields + Brevo template 9.

### 5.4 Payout (escrow + ledger)

- Stripe destination charge moves therapist's share to connected account at charge time
- Stripe holds funds `pending` for 14d at the connected-account level (`delay_days=14`)
- `transactions.payout_after = now() + 14d` set at insert
- pg_cron `process-pending-payouts-daily` (05:00 UTC) flips `payout_status: pending → paid`
- **The cron does NOT call Stripe Transfer** — funds already with therapist; this is internal ledger only
- Therapist's actual bank deposit happens on Stripe's schedule: weekly Friday for our UK platform

### 5.5 Monthly fattura (after 14 sequential bug fixes, lands 2026-05-03)

`admin-dashboard/src/app/api/cron/monthly-invoices/route.ts`, schedule `0 3 1 * *`:

1. Aggregate `transactions` for previous month, filter ONLY by `status='completed'` (NOT `payout_status` — see fix #1 in `16-fattura-monthly.md`)
2. Resolve tax mode per therapist (9 modes: `B2B_IT`, `B2B_IT_FORF`, `B2C_IT`, `B2B_EU_REVERSE`, `B2B_UK_REVERSE`, `B2C_EU_OSS`, `B2C_UK_VAT`, `EXTRA_EU`, or `INCOMPLETE` → skip)
3. Build FIC entity with country-name mapping (`IT`→`Italia`, etc.), VAT type id from `/info/vat_types`, payment account id from `/info/payment_accounts`
4. Issue invoice with payment-method `MP08` (carta di pagamento)
5. SDI submit if IT mode (`shouldSubmitToSdi`)
6. Insert `therapist_invoices` row (UNIQUE per (therapist_id, period_month))

**Idempotency:** re-runs find existing row, skip with reason `already_invoiced`.

---

## 6. All cron jobs in one table

| Job | Where | Schedule | Purpose | Auth |
|---|---|---|---|---|
| `monthly-invoices` | admin-dashboard | `0 3 1 * *` | 20% commission fattura → SDI/email | CRON_SECRET |
| `daily-credit-notes` | admin-dashboard | `0 4 * * *` | Nota di credito for post-fattura refunds | CRON_SECRET |
| `billing-reminders` | admin-dashboard | `0 9 * * 1` | Email INCOMPLETE-billing therapists | CRON_SECRET |
| `auto-cancel-reschedule` | client-webapp | `15 * * * *` | Cancel + 100% refund therapist-proposed reschedules >24h | CRON_SECRET |
| `cleanup-pending-payment` | client-webapp | `30 * * * *` | Release stuck `pending_payment` bookings >30min | CRON_SECRET |
| `sync-stripe-status` | therapist-webapp | every 15min | Re-fetch Stripe accounts stuck `onboarding_pending` | CRON_SECRET |
| `cleanup-orphaned-bookings` | pg_cron | every 15min | Cancel legacy `pending` bookings >30min | service-role |
| `send-session-reminders-daily` | pg_cron | daily 10:00 UTC | Brevo 24h reminder | service-role |
| `check-dormant-users-weekly` | pg_cron | Mon 09:00 UTC | Brevo CLIENTS_DORMANT list move | service-role |
| `cleanup-stale-reschedule-pending` | pg_cron | every 30min | 2 branches: revert client-proposed, cancel old | service-role |
| `cleanup-rate-limit-buckets` | pg_cron | every 10min | DELETE `rate_limit_buckets` >1h | service-role |
| `hard-purge-deleted-accounts` | pg_cron | daily 03:00 UTC | Hard-delete `users` 30d post `deleted_at` | service-role |
| `auto-complete-expired-bookings` | pg_cron | every 15min | Flip `confirmed → completed` after session end | service-role |
| `process-pending-payouts-daily` | pg_cron | daily 05:00 UTC | Flip `payout_status: pending → paid` after 14d escrow | CRON_SECRET / service-role |
| Database webhook: `notifications` INSERT → `send-push-notification` | Supabase | event-driven | APNs push delivery | service-role |

**Auth notes:** `CRON_SECRET` (Vercel env) and Supabase secret share the same value, rotated together annually. All Vercel routes use `timingSafeEqual` for the Bearer compare. Edge Functions accept the legacy service-role JWT OR the new `sb_secret_*` format OR `CRON_SECRET` for back-compat.

---

## 7. Critical invariants (must always hold)

### Money
- `therapistPayout + applicationFee = totalCharged` (always)
- `therapistPayout = 0.80 × S` (exact, all countries, after rounding)
- `transactions.stripe_payment_intent_id` UNIQUE → no double-insert
- `stripe_webhook_events.event_id` PRIMARY KEY → at-most-once webhook handling
- `stripe_payment_intent_id` on `bookings` is set by the FIRST handler to flip status (race-resolved)
- Refund × payout_status state matrix:
  - 100% refund (any time): both `status` and `payout_status` flip to `refunded`
  - 50% refund pre-escrow: `payout_status` stays `pending` (cron will eventually pay the un-refunded half)
  - 50% refund post-escrow: `payout_status` flips to `partially_refunded` (DB matches Stripe clawback)
- Stripe webhook events deduplicated by both webhook handlers via shared `stripe_webhook_events.event_id` PRIMARY KEY (Vercel + Edge Function both claim before processing)
- Booking creation requires `tos_acceptances_latest.health_data_accept = true` for the client (server-side gate at both checkout-create paths; HTTP 412 on missing)

### Notifications
- Both webhook handlers now insert in-app `notifications` rows on booking confirmation. The Edge Function `stripe-webhook` (handles `payment_intent.succeeded`) and the Vercel `/api/webhooks/stripe/route.ts` (handles `checkout.session.completed`) each do a pre-INSERT existence check on `(booking_id, user_id, type)` for the fast path, AND the DB enforces a **partial unique index** `notifications_booking_user_type_unique ON (booking_id, user_id, type) WHERE booking_id IS NOT NULL` so even concurrent inserts can't duplicate (the second one raises 23505, swallowed as non-blocking warning). Without this, a race where the Edge Function wins (200ms head-start observed on web checkouts) was leaving the user with NO bell-icon notification + NO iOS push (the DB webhook trigger fires on `notifications` INSERT). Brevo emails are sent unconditionally by whichever handler ran first.

### Auth & permissions
- Admin = `ADMIN_EMAILS` env AND `users.is_admin=true` BOTH (env alone insufficient since 2026-04-17)
- `_guard_user_is_admin_updates` BEFORE UPDATE trigger blocks user-JWT writes to `is_admin`
- `prevent_self_approval` trigger has service-role bypass since 2026-04-30
- Therapist webapp dashboard layout redirects AAL1 → `/enroll-mfa` (first time) or `/verify-mfa` (subsequent). The `/login` redirect to `/dashboard` is therefore NEVER the final step for a freshly-authenticated therapist — they always pass through the layout's MFA gate before any data renders.
- iOS app has NO therapist UI — `TherapistWebAppRedirectView` blocks misconfigured users at app launch
- `POST /api/bookings/[id]/complete` is therapist-only on BOTH webapps (since 2026-05-04 evening; the therapist-webapp version was previously permissive — accepted client_id, letting a client unlock payout escrow on a future booking)

### Multi-country therapist onboarding (since 2026-05-06)
- **Stripe Connect country**: chosen by the therapist via a dropdown in `/dashboard/settings` BEFORE the "Connetti Stripe" button. The choice is permanent (Stripe doesn't allow changing the account country after creation). The Edge Function `create-connect-account` validates against `STRIPE_CONNECT_COUNTRIES` (EU + EFTA + UK) and passes `country: "<ISO2>"` to Stripe. Earlier versions silently defaulted to IT, which left non-IT therapists stuck in `restricted` after onboarding (Roberta Pagliani case, 2026-05-06).
- **EU/UK billing form** now exposes `tax_id_foreign` (NIF/NIE for ES, Numéro fiscal for FR, Steuer-IdNr for DE, UTR for GB, etc.) alongside the optional VAT field. Required when no VAT is provided — covers therapists who are not subject to VAT (private/occasional, regime forfettario equivalents abroad, residents of special territories). Server-side validation in `/api/billing/profile/route.ts` enforces "VAT OR Tax ID required" for EU/UK.
- **EU territories outside the EU VAT zone** (Canary Islands, Ceuta, Melilla, Azores, Madeira, French DOM-TOM, Livigno, Campione d'Italia, Heligoland, Büsingen) are detected by postal code prefix in `tax-mode.ts` `isOutsideEuVatZone()` and resolved as `EXTRA_EU` ("fuori campo IVA Art. 7-ter DPR 633/72") instead of `B2C_EU_OSS` (which would charge Italian 22% VAT to a non-VAT-zone resident).

### Marketplace + therapist profile
- Practices "Disponibili ora" vs "In arrivo" partition + per-card "N operatori" badge both key on `practices.slug` (NOT `practices.category_key`). A subtle bug shipped 2026-05-05 where the partition was correct but the badge prop still passed `category_key` so every active card mis-rendered as "In arrivo" — fixed and verified live with Claude in Chrome the same evening.
- Therapist profile chips look up `practices.slug` → display label via a locale-keyed map (`PRACTICE_LABELS` in `client-webapp/src/app/dashboard/therapists/[id]/page.tsx`) and link to `/dashboard/pratiche/<slug>`. Marketplace listing chips use the same `slug → label` map via `prettyCategory` (`/dashboard/therapists/page.tsx`).
- Therapist profile video tile renders a real poster preview: YouTube via deterministic `https://img.youtube.com/vi/{id}/hqdefault.jpg`, Vimeo via the public oEmbed endpoint at `vimeo.com/api/oembed.json?url=…` returning `thumbnail_url` on `i.vimeocdn.com`. Required CSP additions: `img-src` allowlists `img.youtube.com`, `i.ytimg.com`, `*.vimeocdn.com`; `connect-src` allowlists `vimeo.com`. Falls back to the gradient placeholder if both resolution paths fail.

### Data integrity
- `therapist_profiles.categories[]` stores `practices.slug` values (language-neutral identifiers: `theta-healing`, `naturopatia`, `numerologia`, etc.). Enforced by the `validate_therapist_categories` BEFORE INSERT/UPDATE trigger — INSERTs with non-slug values raise 23514 with the canonical valid set listed. The slug is the FK-like identifier across surfaces; UI translates slug → display label per locale (Italian today, EN/PT to come). Migrated from Italian-flavored display strings (`Naturopatia`) to slugs (`naturopatia`) on 2026-05-05 to unblock multilingual onboarding — an English-speaking therapist now picks the same dropdown option as an Italian one (the `value` is the slug, the `label` is locale-dependent). See `client-webapp/supabase_therapist_categories_validation.sql`.
- Booking status transitions are optimistic-locked at every state-changing route (`.eq("status", expectedFromState)`)
- Tombstone UUID `00000000-0000-0000-0000-000000000001` re-points completed-booking `client_id` after deletion (preserves therapist history)
- DB triggers backstop everything: `protect_booking_columns`, `protect_therapist_admin_columns`, `protect_review_columns`, `protect_stripe_financial_columns`, `normalize_review_identity`, `bookings_overlap_guard`
- Idempotency: Stripe ops use `bookingId` as key; webhooks dedup via `stripe_webhook_events.event_id`
- Review reply update uses `.is("therapist_reply", null)` in WHERE so the FIRST reply wins; subsequent attempts surface "already replied" without overwriting (since 2026-05-04 evening)
- Sessions dashboard filter time-bound is `now - 6h` (NOT `startOfDay`) so late-night sessions still inside the LiveKit grace window remain visible after midnight

### GDPR
- `tos_acceptances` row required at signup with all 4 booleans true: `general_accept`, `vessatorie_accept`, `privacy_accept`, `health_data_accept` (added 2026-05-04)
- `marketing_consent` respected at email send time (`send-brevo-email/index.ts:83-118`)
- 30d retention buffer post `deleted_at` before hard purge (admin-restorable window)
- Sentry receives only opaque user IDs, never PII (`AuthManager.swift:279`)
- `delete-user-account` Edge Function fan-outs to Stripe (delete customer) + Stream (anonymize) + DB RPC + `auth.users` admin delete

---

## 8. GDPR posture (post 2026-05-04 sprint)

| Item | Status | Where |
|---|---|---|
| Privacy policy with all sub-processors (Stripe, Supabase, LiveKit, Brevo, Stream, Sentry, Vercel, APNs, Google/MS auth, GA) | ✅ | `holisticunity.app/privacy-policy.html` §7 |
| Cookie banner (granular consent: essential / analytics / marketing) | ✅ | `holistic-unity-website/shared.js`, `client-webapp/src/components/CookieBanner.tsx` |
| GA loaded ONLY after consent | ✅ | `shared.js:139 loadGoogleAnalytics()`; about.html no longer has inline gtag |
| Art. 17 right to erasure (in-app + 30d retention + hard purge cron) | ✅ | `delete-user-account` Edge Function + `delete_user_account()` RPC |
| Art. 15+20 export | ✅ | iOS `SettingsView.swift:979` |
| Art. 16 rectification | ✅ | profile editor pages |
| Art. 9(2)(a) explicit health-data consent | ✅ | `tos_acceptances.health_data_accept` column + register form 4-th checkbox + iOS AuthView 4-th toggle |
| ToS versioning + audit trail | ✅ | `tos_acceptances` table with IP/UA/document_hash |
| MFA mandatory for therapists (TOTP + backup codes) | ✅ | `therapist-webapp` dashboard layout + `mfa_audit_log` |
| Marketing consent tracked + respected | ✅ | `users.marketing_consent` + `send-brevo-email` precheck |
| DPO/contact email published | ✅ | `support@holisticunity.app` (consolidated 2026-05-04) |
| SCC for US transfers (Stripe, Stream, Sentry, Vercel, GA) | ✅ | privacy policy §9.1 |
| iOS deleteAccount calls Edge Function (not bare RPC) | ✅ | fixed 2026-05-04 |
| `validate-vat` role gate | ✅ | fixed 2026-05-04 |
| `charge.refunded` doesn't overwrite cancelled_by audit | ✅ | fixed 2026-05-04 |
| Risk level | **GAP MINORI** (not blockers) — see §9 | |

---

## 9. Known gaps / accepted tech debt

### ✅ Bugs found and fixed during the 2026-05-04 cross-flow audit

All 4 fixed and deployed the same day. Listed for historical reference.

1. **Fee math drift in stale mirror** ✅ FIXED — `iOS App/supabase/functions/_shared/fee-config.ts:219` was using the old reverse-gross-up `ceil((price+30)/(1-0.029))` while the canonical `client-webapp/src/lib/payments/fee-config.ts` and the inline calc in `create-booking-with-payment` both use the linear `round(price × 0.029) + 30`. Synced the mirror to the linear formula. Deployed.

2. **Art. 9 consent had no enforcement gate** ✅ FIXED — added a server-side precheck on `tos_acceptances_latest.health_data_accept = TRUE` to BOTH booking-creation surfaces (`iOS App/.../create-booking-with-payment/index.ts` for iOS, `client-webapp/src/app/api/checkout/create/route.ts` for web). Returns HTTP 412 Precondition Failed with `error: "health_data_consent_required"` when consent is missing or revoked. **Pre-migration users with NULL `health_data_accept` are blocked from booking until they re-consent** — see "Action items" below.

3. **50% refund post-escrow ledger sync** ✅ FIXED — `charge.refunded` handler now reads the existing `payout_status` and, if a partial refund fires after the escrow has already been flipped to `paid`, sets `payout_status='partially_refunded'` (new text value, no schema change since the column was already `text`). DB now matches Stripe ledger after a clawback.

4. **Edge Function webhook idempotency** ✅ FIXED — added the same `stripe_webhook_events` PRIMARY KEY claim that the Vercel side uses. Both handlers now share dedup; first INSERT wins, the loser sees 23505 and returns 200 without re-running notifications.

### Action items from these fixes

- ✅ **Backfilled 2 legacy `tos_acceptances` rows** (Marcello + Sali, both internal `@stormxdigital.com` test accounts) to `health_data_accept = TRUE` on 2026-05-04. Production users currently 0 NULL.
- ✅ **Earnings dashboard handles `payout_status='partially_refunded'`** — distinct status badge (warning color, "Parz. rimborsato" / "Partly refunded") + net-payout calc using `therapist_payout × (1 - refund_amount / total_charged)`. Pending-payouts total now includes pre-escrow partial refunds proportionally.
- ✅ **`process-pending-payouts` cron handles `status='partially_refunded'`** — was filtering only `status='completed'` so pre-escrow partial-refund rows would have stayed `payout_status='pending'` forever. Now flips them to `partially_refunded` once escrow elapses (matching the post-escrow case from the `charge.refunded` webhook handler).
- ⏳ **Build a consent-revoke / re-consent UI** so users (post-launch revokes) can re-consent without going through full re-signup. POST `/api/consent/health-data` route + modal on the booking page when 412 returns. Not urgent (no real users in revoke state today), but needed before high-volume launch.

### High-priority follow-ups (post-launch)
- **DPIA written** — Art. 35 obligation given Art. 9 data + scaling intent. Use ICO/CNIL template, ~1 day.
- **DPA signatures** — request from Stream / LiveKit / Brevo / Sentry sales (Stripe + Supabase + Vercel auto-accepted).
- **Data retention matrix per table** — chat messages, session notes, transactions (10y for tax), bookings completed.
- **Brevo double opt-in** — verify enabled in dashboard.

### Medium-priority code debt
- **`charge.dispute.created` not handled** — chargebacks during 14d escrow flip Stripe state but our DB still marks `paid` via the cron. Add handler + add `.eq("status", "completed")` filter to payouts cron (latter already in place; just needs `'disputed'` status flip).
- **`stripe_webhook_events` cleanup cron missing** — table grows ~3,600 rows/month forever. Add `DELETE WHERE created_at < now() - interval '7 days'` daily.
- **`reschedule-request` route in wrong codebase** — `therapist-webapp/.../reschedule-request/route.ts` checks `client_id` ownership. Move to `client-webapp` for correct routing.
- **`validate-promo` Edge Function still not deployed** — iOS `BookingFlowView.swift:142` calls it; fails silently. Either ship or rip the UI field.
- **Pack mid-pack cancel cash-out** — no admin UI to refund unused pack credits as cash; admin currently does it manually via Stripe API.
- **Per-therapist cancellation policies** — `therapist_profiles.cancellation_policy` column read-only / display-only; refund flow uses fixed 48h/24h tiers.
- **No-show policy** — bookings auto-complete; therapist gets paid even if client never joined. V1.1 needs UI to mark no-show + selective refund.
- **`delete-user-account` Edge Function source in backup folder** — only at `iOS App/untitled folder/Backup 6 Aprile/...`. Move to canonical path before next CI deploy.
- **GDPR migration files in backup folder** — `20260417150000_gdpr_erasure_pipeline.sql` + bugfix idem. Same risk.
- **Apple/Google sign-in path bypasses 4-checkbox consent** — currently only email signup form gates on 4 consents. Apple/Google flows trust user_metadata blank then onboarding. V1.1: add a "first-launch consent screen" before /dashboard.

### Low-priority / accepted
- `Reliability` score for therapists doesn't prune `device_tokens` on APNs 410. Stale tokens accumulate (already implemented per Sept review).
- No 3DS opt-in beyond Stripe defaults.
- Fee math hardcoded EUR; would fail at edge-function for therapists with GBP/USD Connect accounts.

---

## 10. Detail map (where to drill in)

| Topic | File |
|---|---|
| Authentication (all surfaces) | `flows/01-auth.md` |
| Therapist signup → MFA → Stripe → approval | `flows/02-therapist-onboarding.md` |
| Client signup → email confirm → /welcome wizard | `flows/03-client-onboarding.md` |
| Marketplace browse + sort + profile detail | `flows/04-therapist-discovery.md` |
| Single-session booking creation | `flows/05-booking-single.md` |
| Pack of 4/6/8/10 sessions | `flows/06-booking-pack.md` |
| Stripe Connect destination charges + fees + webhook v2 | `flows/07-payment.md` |
| 3-tier refund + 5 entry points + reschedule cron | `flows/08-refund-cancellation.md` |
| LiveKit token mint + join window + status flips | `flows/09-video-call.md` |
| Google/Microsoft OAuth + iCal feed | `flows/10-calendar-sync.md` |
| Stream Chat 1-to-1 + deep links | `flows/11-messaging.md` |
| Server-mediated reviews + identity normalize trigger | `flows/12-reviews.md` |
| 4 reschedule paths × proposer × responder + crons | `flows/13-reschedule.md` |
| TOTP enrollment + backup codes + AAL2 layer | `flows/14-mfa.md` |
| In-app + Brevo email templates 3,4,9,10,26,27,etc | `flows/15-notifications-emails.md` |
| Monthly fattura cron, 9 tax modes, SDI, 14-bug history | `flows/16-fattura-monthly.md` |
| Express account creation + onboarding link + race fix | `flows/17-stripe-connect-onboarding.md` |
| Therapist approve/reject + service-role bypass | `flows/18-admin-approval.md` |
| Admin-initiated refund (Edge Function bridge + audit) | `flows/19-admin-refund.md` |
| Catalog of all crons (Vercel + pg_cron) with auth | `flows/20-cron-jobs.md` |
| Stripe → Vercel + Edge Function dual handling, idempotency | `flows/21-webhooks.md` |
| Account deletion orchestrator (Stripe + Stream + DB + auth) | `flows/22-account-deletion.md` |
| VIES + HMRC validation, weekly INCOMPLETE billing reminder | `flows/23-vat-validation.md` |

---

## 11. Recent timeline (the last month, condensed)

- **2026-05-04 (night)**: Live smoke-test on production (real €1.33 payment Sali → Marcello) revealed one gap: when the Edge Function `stripe-webhook` wins the race against the Vercel handler on `payment_intent.succeeded` (200ms head-start in the test run), the booking was confirmed + Brevo emails fired, BUT the in-app `notifications` row was never inserted (the Vercel side was gated by `alreadyProcessed` and skipped, the Edge Function only sent emails). Fixed: Edge Function now also inserts `notifications` for client + therapist with a pre-INSERT existence check on `(booking_id, user_id, type)` so a re-run never duplicates. Backfilled the missing rows for the test booking `fdd2e876-…`. Also flagged GA marketing property `G-0WEMYZ5DZ0` returning 503 (likely deleted in GA admin) — Google Ads conversions on the marketing site are NOT being recorded; the webapp GA `G-WPVE6Z3V41` works correctly with Consent Mode v2.
- **2026-05-05 (morning)**: Follow-up sanity check found the first Edge notification patch had a scoping bug: the notification block used `client`, `therapist`, and `booking` after they were declared inside the Brevo-only `try` block, so future in-app inserts could fail as non-blocking `ReferenceError`s. Fixed by fetching party/booking details once before Brevo + notifications and reading booking row fields directly (`booking.scheduled_at`, `booking.service_name`). Vercel webhook notification inserts were also aligned with the same pre-check pattern instead of a blind insert.
- **2026-05-04 (late evening)**: Pre-launch external audit batch #2 — 5 more issues addressed:
  1. **P0** charged-but-cancelled race fixed: Stripe Checkout sessions now created with `expires_at = now + 30min` (was Stripe default 24h). Cleanup cron cutoff bumped from 30min to **35min** (5-min buffer beyond Stripe expiry). Webhook `checkout.session.completed` handler gained a defensive **cancelled-but-paid** branch — if a payment lands on a booking that has already been cancelled by the cron, we auto-refund (`reverse_transfer + refund_application_fee`) and Sentry-alert. The previous 30-min cron + 24-h Stripe expiry could leave a charged client with no booking; closed.
  2. **P1** Meta `CompleteRegistration` was only fired on the immediate-session signup path; the email-confirmation path (production default) only fired GA `sign_up` on `/welcome`. Meta therefore mostly saw `Lead` events and ad campaigns lost the verified-account conversion signal. Added `trackCompleteRegistration` to `/welcome` (idempotent via the same `SIGNUP_EVENT_KEY` localStorage marker GA already uses).
  3. **P2** Lint now passes — escaped a stray `'` apostrophe in `checkout/success/page.tsx:232` that was failing `react/no-unescaped-entities`.
  4. **Bonus** `trackViewContent` (Meta) added to therapist profile page so retargeting audiences can be built ("users who viewed a therapist but didn't book").
  5. **Verified GA on prod** — `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-WPVE6Z3V41` is set on Vercel prod env; `GoogleAnalytics` component is mounted in the root layout and uses Consent Mode v2 (loads gtag unconditionally with `analytics_storage='denied'`, promotes to `granted` when the user accepts marketing). Earlier "no GA on prod" report was likely an ad-blocker false negative.
  6. **Scoped to V1.1** (NOT bugs, scope clarification): pack purchase + `session_credits` consumption is **iOS-only in V1**; web `client-webapp` does single-session checkout only. Client-initiated reschedule (client proposes a new time, therapist approves/declines) is **iOS-only in V1**; the route file lives in therapist-webapp historically. Both gaps now documented as deliberate V1 scope in the relevant flow docs (`06-booking-pack.md`, `13-reschedule.md`).
- **2026-05-04 (evening)**: External-audit findings batch — 3 more bugs fixed:
  1. **HIGH** therapist-webapp `complete/route.ts` accepted `client_id || therapist_id`, letting a client prematurely complete a future booking (and unlock the payout escrow). Restricted to therapist-only, matching the client-webapp version that always was correct.
  2. **MEDIUM** therapist sessions list filtered `scheduled_at >= startOfDay AND status IN [confirmed, in_progress, completed]`, hiding (a) late-night sessions still inside the LiveKit grace window after midnight and (b) `reschedule_pending` bookings the platform still treats as joinable. Fixed: lower bound is now `now - 6h` (covers session duration + 3h grace + clock skew) and status filter includes `reschedule_pending`.
  3. **MEDIUM** `submitReply` for review responses awaited the Supabase update but never read the result, then unconditionally mutated local state — phantom replies on RLS / network failure. Fixed: check `error` and `data`, surface errors via a new `replyError` state, and added `.is("therapist_reply", null)` to the WHERE clause as a defense-in-depth against overwriting an existing reply.
  4. **Docs** corrected: `docs/README.md` + `platform/security.md` no longer claim CSP is nonce-only (rolled back to `'unsafe-inline'`); `01-auth.md` now documents the dashboard-layout MFA gate that runs AFTER `/login` redirect; `09-video-call.md` no longer says "midnight-to-midnight session day" (actual policy is `[scheduled_at - 15min, scheduled_at + duration + 3h]`) and no longer says room IDs are salted (they're deterministic `hu-${booking.id.replace('-','').slice(0,16)}`).
- **2026-05-04 (afternoon)**: Cross-flow audit + ledger sweep — 5 logic bugs fixed: fee-config mirror sync, Art. 9 consent enforcement gate (412 on `tos_acceptances.health_data_accept != true`), partial-refund post-escrow ledger sync (`payout_status='partially_refunded'`), Edge Function webhook dedup via `stripe_webhook_events`, `process-pending-payouts` cron now handles `status='partially_refunded'` (was leaving them stuck `pending` forever). Earnings dashboard updated to render the new state. 2 internal `tos_acceptances` rows backfilled. All deployed.
- **2026-05-04 (morning)**: GDPR sprint — Art. 9 explicit consent end-to-end (DB + register + welcome + iOS AuthView); GA inline removed from `about.html` (now gated behind cookie banner via `shared.js`); `dpo@`/`privacy@` consolidated to `support@`.
- **2026-05-03**: Bug-fix sprint — 3 critical fixes (iOS deleteAccount calls Edge Function; `charge.refunded` `.neq("status","cancelled")` audit guard; `validate-vat` role gate). 4 important fixes still pending.
- **2026-05-03**: Fattura mensile end-to-end shipped after 14 sequential bug fixes (cron filter, payout cron unscheduled, NULL payout_after, Edge Function auth, cron auth alignment, middleware blocking, FIC payload errors x6, entity name override).
- **2026-04-30**: `prevent_self_approval` trigger service-role bypass (was rejecting admin route updates).
- **2026-04-29**: `normalize_review_identity` trigger (defense-in-depth for iOS direct insert).
- **2026-04-28**: Calendar OAuth env fix (client-webapp had empty/corrupted `GOOGLE_CLIENT_ID`).
- **2026-04-27**: Webhook v2 — INSERT-then-UPDATE pattern + `alreadyProcessed` derived from UPDATE result + idempotency table `stripe_webhook_events`. Reschedule notification routes added (4 paths × Brevo). Cancel route notify added.
- **2026-04-25**: Tiered refund policy verified (0%, 50%, 100% paths all tested live).
- **2026-04-17**: MFA enroll wizard + AAL2 gate.

---

## 12. What to read next

- **First-time engineer:** §1, §2, §3 (whichever role is yours), §5, then drill into the specific flow file you're touching
- **PM checking a feature behaves correctly:** §3 (user journey) + the relevant `flows/0X-...md`
- **Auditor / DPO review:** §8 + §9 high-priority items + `flows/22-account-deletion.md`, `flows/14-mfa.md`, privacy policy §7, §9, §11
- **Debugging a payment issue:** §5 + `flows/07-payment.md` + `flows/21-webhooks.md` + check `transactions_write_failed_post_confirm` Sentry alert
- **Adding a new cron:** §6 table + `flows/20-cron-jobs.md` (auth pattern + idempotency rules)
