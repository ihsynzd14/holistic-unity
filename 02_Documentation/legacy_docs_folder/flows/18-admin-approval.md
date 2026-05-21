# 18 — Admin Therapist Approval

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🟡 Important
**Owner:** Marcello

## Purpose

Therapists self-register but cannot accept bookings until an admin reviews their profile (bio, photo, certifications, services) and approves it. Approval flips `therapist_profiles.approval_status` from `pending_review` to `approved` AND `is_approved=true`, sends a Brevo email, and syncs the contact to the `THERAPISTS_APPROVED` Brevo list. Rejection sets `changes_requested` with optional feedback text — therapist edits, re-submits, admin re-reviews.

Two-factor admin auth: `ADMIN_EMAILS` env whitelist AND `users.is_admin=true` DB flag. Both must pass; trigger blocks self-promotion. See `01-auth.md` for the auth bedrock.

## Preconditions

- Admin signed in to `admin.holisticunity.app` with an account in `ADMIN_EMAILS` env AND `users.is_admin=true`.
- Target therapist row exists in `therapist_profiles` with `approval_status='pending_review'` (set on signup).
- `prevent_self_approval` BEFORE UPDATE trigger does NOT block service-role calls (fixed 2026-04-30 — see Recent fixes).

## Sequence

### A. Admin opens therapist queue

Admin dashboard route `/dashboard/therapists` (admin-dashboard) lists all `pending_review` rows with profile preview, services, certifications. Clicking opens detail view.

### B. Approve

POST `/api/therapists/[id]/approve` (`admin-dashboard/src/app/api/therapists/[id]/approve/route.ts:9`).

1. **`requireAdmin()`** — both factors:
   - Caller's email is in `ADMIN_EMAILS` env (comma-separated).
   - `users.is_admin=true` for caller's user_id (via `public.is_admin()` RPC).
   - Either factor failing returns 403.
2. **Service-role UPDATE** of `therapist_profiles` (bypasses RLS + `protect_therapist_admin_columns` trigger):
   ```ts
   { approval_status: 'approved', is_approved: true, updated_at: now() }
   ```
3. **Brevo notifications** (best-effort, `try/catch`):
   - `send-brevo-email` with template **7** (THERAPIST_APPROVED).
   - `sync-brevo-contact` with `event: 'therapist_approved'` — moves contact to list `THERAPISTS_APPROVED` (id 10), removes from `THERAPISTS_PENDING` (id 11).
4. **Audit trail** via `logAdminAction` (`audit.ts`):
   ```
   action: 'therapist.approve',
   targetTable: 'therapist_profiles',
   targetId: <id>,
   details: { from: 'pending_review', to: 'approved' }
   ```
5. Returns `{ success: true, status: 'approved' }`.

### C. Reject (changes_requested)

POST `/api/therapists/[id]/reject` (`admin-dashboard/src/app/api/therapists/[id]/reject/route.ts:6`).

Body: `{ feedback?: string }` — optional admin note explaining what to change.

1. Same `requireAdmin()` two-factor check.
2. UPDATE `therapist_profiles` → `approval_status='changes_requested'`, `is_approved=false`.
3. If `feedback` present: insert in-app notification (`type='profile_update'`, `body: "Your profile needs some changes: ${feedback}"`).
4. Brevo template **8** (THERAPIST_CHANGES_REQUESTED) with `params.feedback` — best-effort.
5. Audit trail with `details.feedback`.
6. Returns `{ success: true, status: 'changes_requested' }`.

### D. Therapist re-submits after `changes_requested`

The therapist's profile editor allows editing while `approval_status='changes_requested'`. On save it calls a separate route (not documented here) that flips `approval_status` back to `pending_review` and notifies admins (Brevo template TBD).

### E. Activation in marketplace

A therapist with `approval_status='approved'` AND `is_approved=true` AND `stripe_account_status='active'` becomes visible in the client marketplace (`/dashboard/therapists` filter). Missing any of the three → invisible to clients.

The therapist can sign in to the dashboard once `approval_status='approved'` even before Stripe is active (the dashboard layout checks at `therapist-webapp/src/app/dashboard/layout.tsx:37`). Stripe activation is a separate flow (see `17-stripe-connect-onboarding.md`).

## Critical assertions

- **Two-factor admin enforcement.** `ADMIN_EMAILS` env alone is not sufficient since 2026-04-17. The DB `users.is_admin` flag is also required, AND the BEFORE UPDATE trigger `_guard_user_is_admin_updates` blocks all user-JWT writes to that column (only service-role can flip it). See `01-auth.md`.
- **`prevent_self_approval` trigger NULLs `auth.uid()` for service-role calls.** Originally rejected ALL calls without a user JWT (including service-role). Fixed 2026-04-30 by checking `auth.uid() IS NULL` (i.e. service-role) and skipping the self-approval check in that case. Without the fix, the API route would 500 on every approve/reject.
- **`is_approved=true` is denormalized.** `approval_status='approved'` is the source of truth; `is_approved` is a fast filter for marketplace queries. They MUST stay in sync — both routes set them together.
- **Audit logging is best-effort but runs on every action.** `logAdminAction` writes to `admin_action_log` with admin user_id, email, IP, user-agent, and action details. Failures are swallowed (don't block the response) but logged to console.
- **Service-role UPDATE bypasses RLS by design.** The `protect_therapist_admin_columns` trigger exists to block users from self-editing `approval_status`/`is_approved`; service-role is exempt. The `requireAdmin()` check is the only gate.
- **Brevo failures are non-blocking.** A Brevo outage cannot stall approval. The email + list sync are wrapped in `try/catch` — admin sees `success:true` even if Brevo failed; therapist still sees the status flip in their dashboard.
- **In-app notification for rejection** (only when feedback provided) gives the therapist a starting point to edit. Empty feedback → no notification (just the email).

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Caller in env but `is_admin=false` | `requireAdmin` | 403; admin must self-promote (impossible by design) |
| Caller has `is_admin=true` but not in env | `requireAdmin` | 403; env ALSO required |
| Caller is the therapist being approved | `prevent_self_approval` (pre-fix) | 500 — the trigger fires even on service-role. Post-fix: works (admin can theoretically approve themselves if they're also a therapist, gated by other checks) |
| `protect_therapist_admin_columns` trigger | Blocks user-JWT writes to `approval_status` | 403 if a non-service-role tries; service-role bypasses |
| Brevo template missing | `send-brevo-email` returns 200 with skip | No-op; admin sees success |
| Audit log table missing | `logAdminAction` swallows | Logged to console, response unaffected |

## Files

- `admin-dashboard/src/app/api/therapists/[id]/approve/route.ts`
- `admin-dashboard/src/app/api/therapists/[id]/reject/route.ts`
- `admin-dashboard/src/lib/auth/requireAdmin.ts` — two-factor check
- `admin-dashboard/src/lib/auth/audit.ts` — `logAdminAction`
- `admin-dashboard/src/lib/supabase/admin.ts` — service-role client
- `iOS App/supabase/functions/sync-brevo-contact/index.ts` — list-membership sync
- `iOS App/supabase/functions/send-brevo-email/index.ts` — template dispatcher
- Migration with `prevent_self_approval` and `protect_therapist_admin_columns` triggers (in `iOS App/supabase/migrations/...security_hardening.sql`)
- Migration `20260417120000_admin_role.sql` — `users.is_admin` column + `is_admin()` RPC + `_guard_user_is_admin_updates` trigger

## Recent fixes / known issues

- **`prevent_self_approval` trigger blocked service-role calls (2026-04-30 fix).** The trigger checked `if NEW.id = auth.uid()` to prevent a therapist from approving themselves. But service-role calls have `auth.uid() = NULL`, so the comparison `NULL = X` is NULL (falsy in SQL), which made the trigger pass. **Original bug (pre-fix):** earlier version of the trigger rejected the UPDATE when `auth.uid()` was NULL, treating it as suspicious. Every admin approve/reject 500'd. Fix: explicit `if auth.uid() IS NOT NULL AND NEW.id = auth.uid() then RAISE`. Service-role passes through cleanly.
- **`is_admin` column added 2026-04-17.** Migrating from env-only to env+DB closed the attack vector where a leaked `ADMIN_EMAILS` env value could give code-level access without DB-level authorization.
- **`_guard_user_is_admin_updates` trigger** prevents any user-JWT write to `users.is_admin`. Only service-role can flip it. Plus there's no admin UI to flip it — must be done via direct DB ops with audit.
- **Known gap:** no admin UI to view audit log. `admin_action_log` table is populated; admin must SQL-query it directly.
- **Known gap:** no SLA on therapist queue — no notification to admins when someone has been pending > 48h.
- **Known gap:** no bulk approve UI; one at a time. Acceptable while volumes are low.
- **Known gap:** `changes_requested` flow has no automated re-submit notification to admin — admin manually polls the queue.
