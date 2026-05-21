# 14 — MFA (Therapist 2FA)

**Last verified:** 2026-05-03 by code review
**Status:** ✅ Production
**Criticality:** 🔴 Critical
**Owner:** Marcello

## Purpose

Mandatory TOTP two-factor authentication for therapists. Enforced at the dashboard layout level: any therapist signing in is bounced through `/enroll-mfa` (4-step wizard) on first dashboard visit, then through `/verify-mfa` on every subsequent session until they hit AAL2. Backup codes (8 per user, bcrypt-hashed) provide self-recovery if the authenticator device is lost.

Why mandatory for therapists and not clients? Therapists hold the keys to client PII (chat messages, session notes, health-related context), Stripe payouts, and a public marketplace presence. A compromised therapist account can drain pending payouts, defame the platform, and breach GDPR. Clients have less blast radius and a higher onboarding-friction sensitivity, so MFA is opt-in there (V1.1).

Admins use a separate enforcement path (admin-dashboard layout has its own check); this doc covers the therapist-webapp implementation.

## Preconditions

- Supabase Auth project has `auth.mfa.enabled = true` (default since 2024).
- `mfa_backup_codes` and `mfa_audit_log` tables exist (migration `20260425100000_mfa_backup_codes.sql`).
- `therapist_profiles.has_mfa` boolean column exists for fast read-side checks.
- User has signed in with email + password (AAL1) and reached `/dashboard`.

## Sequence

### A. Enrollment (4-step wizard)

`therapist-webapp/src/app/enroll-mfa/page.tsx`

1. **Init (`page.tsx:42`)**: page mounts → `getMfaStatus` reads `auth.mfa.listFactors()`. If a verified TOTP factor already exists, redirect to `/dashboard` (or `/verify-mfa` if AAL still aal1). Otherwise call `enrollFactor()` which returns `{ factorId, qrCode (base64 SVG), secret }` from `auth.mfa.enroll({ factorType: 'totp' })`.
2. **Step `install`**: links + suggestions for authenticator apps (Google Authenticator, 1Password, Authy, etc.). Pure copy.
3. **Step `scan`**: QR rendered via `<Image src={qrCode}>` plus the raw `secret` displayed for manual entry. User opens authenticator app, scans, sees the 6-digit rolling code.
4. **Step `verify`**: form submit → `verifyEnrollment(supabase, factorId, code)` calls `auth.mfa.challenge({ factorId })` then `auth.mfa.verify({ factorId, challengeId, code })`. On success the session is upgraded to AAL2 and the factor is marked `verified`.
5. **Side-effects after verify**:
   - POST `/api/security/mfa-status` to flip `therapist_profiles.has_mfa = true` (best-effort).
   - POST `/api/security/backup-codes` (`backup-codes/route.ts:19`) → 8 plaintext codes returned to the page; each was bcrypt-hashed before storage in `mfa_backup_codes`. Requires AAL2 (which we just upgraded to in step 4).
6. **Step `backup`**: codes shown ONCE (page warns "Salvali ora. Non potrai vederli di nuovo"). User must click an acknowledgement checkbox + button to proceed to `/dashboard`.

### B. Verification on each subsequent sign-in

`therapist-webapp/src/app/verify-mfa/page.tsx`

1. User signs in with email + password (AAL1).
2. Dashboard layout (`therapist-webapp/src/app/dashboard/layout.tsx:42-58`) checks:
   ```
   const { data: factors } = await supabase.auth.mfa.listFactors();
   const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
   const hasVerifiedFactor = factors.totp.some(f => f.status === 'verified');
   const aal = aalData.currentLevel;
   if (!hasVerifiedFactor) redirect('/enroll-mfa');
   if (aal !== 'aal2') redirect('/verify-mfa');
   ```
3. `/verify-mfa` shows a 6-digit input → `auth.mfa.challenge` then `auth.mfa.verify`. Session upgrades to AAL2.
4. Redirect to `/dashboard`. The layout re-checks; passes; renders.

### C. Backup code recovery (lost device)

`PUT /api/security/backup-codes` (`therapist-webapp/src/app/api/security/backup-codes/route.ts:81`).

1. User signs in with email + password (AAL1) but cannot complete TOTP.
2. From the verify-mfa page, "Hai perso il dispositivo?" → recovery form.
3. PUT `{ code: "ABCD-EFGH" }`. Rate-limit `mfa-backup-recovery` 5/15min/user (deliberately tight; brute force = lockout).
4. `verifyBackupCodeAndDisable(admin, user.id, code)`:
   - Hashes the input + bcrypt-compares against unused `mfa_backup_codes` rows.
   - On match: marks the code `used_at = now()`, **disables the current TOTP factor**, deletes remaining unused codes.
5. Logs `backup_code_used` to `mfa_audit_log`.
6. User now signs in fresh + re-enrolls TOTP via `/enroll-mfa`.

### D. Backup code regeneration (still has device)

`POST /api/security/backup-codes` from settings page. Requires AAL2 (current TOTP must be working). Returns 8 new codes; old codes deleted via INSERT-then-DELETE pattern (`route.ts:46-60`) — important: insert the new rows FIRST, then delete the old ones, so a failed insert doesn't leave the user with zero codes (lockout).

## Critical assertions

- **Mandatory for therapists.** The dashboard layout `redirect('/enroll-mfa')` cannot be bypassed by a non-AAL2 session — Supabase `getUser()` returns the session level, and the redirect is a server-component decision (no client JS to hack around).
- **`has_mfa` mirrors actual factor state.** `therapist_profiles.has_mfa` is a denormalized fast-read flag. The AUTHORITATIVE check is `auth.mfa.listFactors()` — `has_mfa` is only used for admin dashboard analytics ("how many therapists are MFA-enrolled?").
- **AAL2 required to mint or rotate backup codes.** A stolen AAL1 session cannot regenerate codes. `backup-codes/route.ts:26` returns 403 if `getMfaStatus().aal !== 'aal2'`.
- **Backup code use disables the current TOTP factor.** Forces re-enrollment so the lost-device's QR cannot be reused by a thief.
- **All MFA actions audited.** Every enroll/verify/disable/backup_code_used/regenerated event is inserted into `mfa_audit_log` with IP, user-agent, and JSONB details. Both tables are RLS deny-all; only service-role accesses them.
- **Bcrypt for backup code hashes.** Plaintext is shown ONCE at generation; hashes are stored. Constant-time comparison handled by bcrypt.compare.
- **Rate limit on recovery is strict.** 5 / 15 min / user. The codes are 8 chars from a constrained alphabet — too high a limit and offline brute-force becomes a worry. The pre-rate-limit-then-crypto-verify ordering at `route.ts:91-98` prevents CPU exhaustion attacks.
- **Backup-code regeneration is INSERT-then-DELETE.** Reverse order (delete-then-insert) used to leave the user with zero usable backup codes if the insert failed for any reason — locking them out of MFA recovery.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Code rejected during verify | `auth.mfa.verify` | Shows "Codice non valido"; user can retry |
| Backup code rate-limit hit | `backup-codes/route.ts:92` | 429 — must wait 15 min |
| Backup-code regen fails on insert | `route.ts:50` | Returns 500 BEFORE deleting old codes; user keeps working set |
| User loses both phone AND backup codes | None | Must contact support@holisticunity.app for admin override (writes `mfa_audit_log` action='admin_override') |
| Therapist signs in on a new device | Dashboard layout | aal=aal1 → redirect to `/verify-mfa` until they enter TOTP |
| MFA enrolled but session expired | Re-sign-in | aal=aal1 → /verify-mfa; existing factor preserved |
| Service-role writes to `mfa_backup_codes` | Tables are deny-all RLS | Only API routes (which use service-role admin client) can write |

## Files

- `therapist-webapp/src/app/enroll-mfa/page.tsx` — 4-step wizard (install, scan, verify, backup)
- `therapist-webapp/src/app/verify-mfa/page.tsx` — TOTP entry on subsequent sign-in
- `therapist-webapp/src/app/dashboard/layout.tsx` — enforcement (redirects to `/enroll-mfa` or `/verify-mfa`)
- `therapist-webapp/src/app/api/security/backup-codes/route.ts` — POST regen, PUT recovery
- `therapist-webapp/src/app/api/security/mfa-status/route.ts` — sync `has_mfa` flag
- `therapist-webapp/src/app/api/security/mfa-event/route.ts` — log events from client-side state changes
- `therapist-webapp/src/lib/auth/mfa.ts` — `enrollFactor`, `verifyEnrollment`, `getMfaStatus` helpers
- `therapist-webapp/src/lib/auth/mfa-server.ts` — `verifyBackupCodeAndDisable`
- `therapist-webapp/src/lib/auth/backup-codes.ts` — `generateCodes`, `hashCode` (bcrypt)
- `therapist-webapp/src/lib/auth/audit.ts` — `logMfaEvent`
- Migration `20260425100000_mfa_backup_codes.sql` — `mfa_backup_codes`, `mfa_audit_log`

## Recent fixes / known issues

- **MFA forced for therapists since 2026-04-25.** Previously optional; flipped to mandatory in dashboard layout. No grandfathering — any returning therapist without a verified factor is sent to `/enroll-mfa` on next dashboard visit.
- **Backup-code regen INSERT-then-DELETE (2026-04-25).** Original implementation deleted-then-inserted. If the insert raced or failed, the user lost recovery codes entirely. Fixed by inserting first and only deleting the old rows after the new IDs are confirmed.
- **Rate-limit BEFORE crypto verify (2026-04-25).** `backup-codes/route.ts:91` puts the rate-limit check before bcrypt compares. Without this ordering, an attacker could flood requests and eat CPU on each bcrypt round even if the rate limiter would eventually 429 them.
- **Known gap:** SMS factor not supported (Supabase has it; we don't expose it). TOTP-only.
- **Known gap:** No "remember this device for 30 days" functionality — every new session requires AAL2. Acceptable trade-off for V1 since therapist sessions are long-lived (tokens auto-refresh until logout).
- **Known gap:** No admin UI to override MFA (e.g. for a therapist who lost device + codes). Manual via direct DB ops + logging the action='admin_override' to `mfa_audit_log`.
