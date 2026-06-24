# Mandatory MFA for Therapists + Backup Codes Recovery

**Date:** 2026-04-25
**Author:** Marcello + Claude
**Status:** Approved, ready for implementation
**Repo:** `therapist-webapp`

## Problem

MFA infrastructure (Supabase Auth TOTP) is fully built and **mandatory for
admin** (admin layout redirects to `/enroll-mfa` if not enrolled), but
**optional for therapists** (currently a settings link). Therapists handle
client video calls + earnings + commission flows, so an unprotected
account is a high-value target. Compromise = unauthorized session takeover,
fraudulent payouts, client data exfiltration.

We make MFA mandatory for therapists with a forced-onboarding UX and add
self-recovery via backup codes (so a lost phone doesn't mean a support
ticket).

## Decisions

1. **Force immediate at next login** — dashboard layout redirects
   non-enrolled therapists to `/enroll-mfa`. No grace period.
2. **Friendly onboarding UX** — 4-step wizard (install authenticator app
   → scan QR → verify code → save backup codes) with explanatory copy.
3. **Backup codes (8 single-use)** — generated at enrollment, hashed
   with bcrypt, stored in `mfa_backup_codes`. User downloads `.txt`
   and acknowledges via checkbox before reaching dashboard.
4. **Backup code use → invalidates TOTP factor** — assumes phone
   lost/compromised. Forces re-enrollment of new TOTP + new backup
   codes immediately.
5. **Admin override remains** — for users who lose both phone AND
   backup codes. Admin disables MFA via service_role + audit log.

## Security additions (confirmed)

| # | Item | Why |
|---|---|---|
| 1 | 16 hex chars `XXXX-XXXX-XXXX-XXXX` (64 bit entropy) | Stronger than the 12-alphanumeric initial proposal |
| 2 | Rate limit: max 5 backup-code attempts / 15 min / user | Brute-force defence on recovery endpoint |
| 3 | Atomic `UPDATE ... WHERE used_at IS NULL` | Race-condition-safe single-use |
| 4 | New `mfa_audit_log` table | Compliance + breach forensics |
| 5 | Email notifications on critical events | User detection of unauthorized actions |
| 6 | RLS deny-all on `mfa_backup_codes` for clients (service_role only) | No client read of hashes |
| 7 | AAL2 required to regenerate backup codes | Defence vs unauthorized regen |
| 8 | bcrypt cost=12 hash (or argon2id if drop-in available) | Standard hashing |

## Architecture

### Auth flow

```
NEW THERAPIST              EXISTING THERAPIST          LOST PHONE RECOVERY
─────────────              ──────────────────          ───────────────────
register                   login (next session)        login →
  ↓                          ↓                          /verify-mfa →
email confirm                dashboard layout           "Hai perso accesso?"
  ↓                          checks MFA status          → backup-code form →
auto-login → /dashboard      ↓ !enrolled                input XXXX-XXXX-XXXX-XXXX
  ↓                          → /enroll-mfa               ↓
dashboard layout             4-step wizard              server: verify hash +
checks MFA status            ↓                          atomic UPDATE used_at
  ↓ !enrolled                /dashboard at AAL2          ↓
→ /enroll-mfa                                            disableMfa(userId) +
4-step wizard                                            delete remaining codes
  ↓                                                      ↓
/dashboard at AAL2                                       redirect /dashboard
                                                          ↓ layout sees !enrolled
                                                         → /enroll-mfa (forced)
                                                          ↓
                                                         new TOTP + new 8 codes
```

### Files to create / modify

| # | Path | Action | Notes |
|---|---|---|---|
| 1 | `supabase/migrations/<timestamp>_mfa_backup_codes.sql` | CREATE | Tables + RLS policies |
| 2 | `src/lib/auth/backup-codes.ts` | CREATE | `generateCodes()`, `hashCode()`, `verifyCode()` |
| 3 | `src/lib/auth/mfa.ts` | MODIFY | Add `verifyBackupCodeAndDisable()` helper |
| 4 | `src/app/api/security/backup-codes/route.ts` | CREATE | POST regenerate (AAL2 required), PUT verify-and-recover (rate-limited) |
| 5 | `src/app/dashboard/layout.tsx` | MODIFY | Add MFA gate (mirror admin layout pattern) |
| 6 | `src/app/enroll-mfa/page.tsx` | MODIFY | 4-step wizard UX + backup-codes step + acknowledgment checkbox |
| 7 | `src/app/verify-mfa/page.tsx` | MODIFY | Add "Usa codice di backup" toggle/link |
| 8 | `src/app/dashboard/settings/security/page.tsx` | CREATE (or modify existing settings) | Show remaining-codes count + "Rigenera codici" button (AAL2 gated) |
| 9 | `src/lib/auth/rateLimit.ts` | VERIFY | Check existing API is compatible with backup-code endpoint |

### Database schema

```sql
-- File: supabase/migrations/<timestamp>_mfa_backup_codes.sql

CREATE TABLE mfa_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mfa_backup_codes_user_id_unused
  ON mfa_backup_codes (user_id) WHERE used_at IS NULL;

ALTER TABLE mfa_backup_codes ENABLE ROW LEVEL SECURITY;
-- No policies defined → deny-all for authenticated/anon
-- Service_role bypasses RLS

CREATE TABLE mfa_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN (
    'enrolled', 'verified', 'disabled', 'backup_code_used',
    'backup_codes_regenerated', 'admin_override'
  )),
  ip          inet,
  user_agent  text,
  details     jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mfa_audit_log_user_id_created_at
  ON mfa_audit_log (user_id, created_at DESC);

ALTER TABLE mfa_audit_log ENABLE ROW LEVEL SECURITY;
-- Service_role only
```

### Backup code generation

```typescript
// src/lib/auth/backup-codes.ts

import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";

const COUNT = 8;
const BCRYPT_COST = 12;

export function generateCodes(): string[] {
  return Array.from({ length: COUNT }, () => {
    const hex = randomBytes(8).toString("hex").toUpperCase();
    // 16 hex chars → group as 4-4-4-4 for readability
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
  });
}

export async function hashCode(code: string): Promise<string> {
  // Strip hyphens before hashing — user might re-type without them
  const normalized = code.replace(/-/g, "").toUpperCase();
  return bcrypt.hash(normalized, BCRYPT_COST);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  const normalized = code.replace(/-/g, "").toUpperCase();
  return bcrypt.compare(normalized, hash);
}
```

### API route

```typescript
// src/app/api/security/backup-codes/route.ts

// POST  /api/security/backup-codes  → regenerate (AAL2 required, returns 8 plaintext once)
// PUT   /api/security/backup-codes  → verify recovery code (AAL1 acceptable, rate-limited)
```

### Layout gate

```typescript
// src/app/dashboard/layout.tsx — server component

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMfaStatus } from "@/lib/auth/mfa";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = user.user_metadata?.role;
  if (role === "therapist") {
    const mfa = await getMfaStatus(supabase);
    if (!mfa.enrolled) redirect("/enroll-mfa");
    if (mfa.aal !== "aal2") redirect("/verify-mfa");
  }

  // Render dashboard
  return <>{children}</>;
}
```

### Email notifications

Use existing Brevo integration (per `docs/platform/compliance.md` § 2.1).

Templates needed:
- `mfa-enabled` — sent immediately after enrollment
- `mfa-backup-code-used` — sent immediately after a backup code is used (alert!)
- `mfa-backup-codes-regenerated` — sent after regen
- `mfa-admin-disabled` — sent after admin override (rare, high-priority)

All templates: short, transactional tone, no marketing. Subject: clear ("Codice di backup MFA usato sul tuo account").

**Fallback if Brevo integration is not ready at implementation time**:
ship the security flow without notifications and add them as a follow-up.
The audit log captures all events regardless, so detection is still
possible — notifications are user-facing convenience, not the primary
detection mechanism. Mark this as an explicit V1.1 task if deferred.

## UX flows

### Onboarding wizard (`/enroll-mfa` redesigned)

**Step 1 — Install an authenticator app**
- 3 cards (Google Authenticator, 1Password, Authy) with download links + screenshots
- Detect mobile vs desktop, surface appropriate links
- Copy: *"Per attivare MFA serve un'app authenticator sul tuo telefono. Ne basta una. Se ne hai già una (1Password, Authy, Google Auth), salta al prossimo step."*
- "Avanti" button

**Step 2 — Scan the QR code**
- Show QR code + manual secret in `<details>`
- Copy: *"Apri l'app authenticator e scansiona il QR. Apparirà 'Holistic Unity' tra i tuoi account."*

**Step 3 — Verify the code**
- 6-digit code input (existing UX)
- Copy: *"Inserisci il codice a 6 cifre che vedi nell'app. Cambia ogni 30 secondi."*

**Step 4 — Save backup codes** (NEW)
- Display all 8 codes in monospace, large text
- Buttons: "Scarica .txt", "Copia tutti", "Stampa"
- Strong warning box: *"Salva questi codici ora. Se perdi il telefono, ti permettono di recuperare l'accesso senza contattare il supporto. NON verranno mai mostrati di nuovo."*
- Required checkbox: ☐ *"Ho salvato i miei codici di backup in un posto sicuro"*
- Submit button enabled only when checkbox is ticked → POSTs acknowledgment, redirects to `/dashboard`

### Recovery flow (`/verify-mfa` enhanced)

- Default: 6-digit TOTP input (existing)
- Below: link *"Hai perso l'accesso al tuo authenticator? Usa un codice di backup"*
- Click → input replaced with backup-code field (`XXXX-XXXX-XXXX-XXXX` placeholder, 19-char input including hyphens)
- Submit → API PUT `/api/security/backup-codes`
  - Server validates code against unused codes for this user
  - Atomic UPDATE marks code used
  - Calls `disableMfa(userId)` via service_role
  - Deletes remaining unused backup codes
  - Logs to `mfa_audit_log` (action=`backup_code_used`)
  - Sends email "Codice di backup usato"
- Client redirects to `/dashboard`
- Layout sees `!enrolled` → forced redirect to `/enroll-mfa`
- User enrolls new TOTP + receives new 8 backup codes

### Settings page (`/dashboard/settings/security`)

- "MFA attivo: ✓" + factor name + enrolled date
- "Codici di backup: N rimanenti su 8"
- Button "Rigenera codici" (requires AAL2):
  - Confirms: "Vuoi rigenerare i codici? I codici attuali smetteranno di funzionare immediatamente."
  - On confirm: server invalidates old codes + generates 8 new + shows them once + acknowledgment checkbox
  - Logs to `mfa_audit_log` (action=`backup_codes_regenerated`)
- Button "Disabilita MFA" → not exposed to therapist (only admin override)

## Out of scope V1

- 2FA for **clients** (`client-webapp` keeps optional MFA for now)
- WebAuthn / passkeys (TOTP sufficient for V1; consider for V2)
- SMS recovery (less secure than TOTP — explicitly rejected)
- Hardware security keys (YubiKey, etc.) — V2 if user demand
- Geographic anomaly detection / device fingerprinting — V2
- Backup-code prefix display in UI ("XXXX-****-****-****" for "this code was used") — V1.1
- Auto-enrollment for admins (already covered)

## Threat model

| Scenario | Mitigation |
|---|---|
| Phishing TOTP code | ⚠️ Not covered — TOTP is not phishing-resistant. V2: WebAuthn |
| Brute-force backup code | Rate limit (5/15min/user) + 64-bit entropy + bcrypt |
| Compromised AAL1 session + stolen physical backup codes | RLS prevents reading hashes; physical theft = game over (accepted tradeoff) |
| Race condition double-use of same code | Atomic UPDATE WHERE used_at IS NULL |
| Admin abuse / unauthorized override | Audit log + email notification to user |
| Lost phone + lost codes | Admin override after manual identity verification (out-of-band) |
| MITM on auth flow | HTTPS only (Vercel default) + httpOnly secure sameSite=lax cookies (Supabase default) |
| Replay an old used code | Single-use enforcement + DB constraint |
| Email hijacking → password reset → bypass MFA | Supabase Auth password reset does NOT downgrade MFA — verified in mfa.ts |

## Verification plan

After implementation, end-to-end test these flows:

### New therapist
1. Register new therapist account
2. Confirm email
3. Auto-login → expect redirect to `/enroll-mfa`
4. Walk through 4 steps
5. At step 4, try to skip without checkbox → blocked
6. Tick checkbox + submit → redirect to `/dashboard` at AAL2
7. Verify in DB: `mfa_factors` row exists, `mfa_backup_codes` 8 rows, `mfa_audit_log` entry `enrolled` + `verified`

### Existing therapist (post-deploy)
1. Login with existing therapist account (no MFA)
2. Expect redirect to `/enroll-mfa`
3. Same flow as above

### Recovery
1. Login as therapist with MFA
2. At `/verify-mfa`, click "Usa codice di backup"
3. Enter a valid backup code → expect redirect to `/dashboard` → expect immediate redirect to `/enroll-mfa`
4. Verify: TOTP factor deleted, all remaining backup codes deleted, audit log `backup_code_used`, email received
5. Re-enroll → 8 new codes

### Rate limit
1. Trigger 5 wrong backup codes → expect 6th attempt blocked
2. Verify rate-limit message + email alert

### Regeneration
1. From settings, click "Rigenera codici"
2. Confirm AAL2 challenge
3. View 8 new codes
4. Verify old codes return 401 on attempt
5. Audit log entry `backup_codes_regenerated`

### Admin override
1. As admin, find therapist user
2. Click "Disable MFA for this user"
3. Verify: TOTP factor deleted, backup codes deleted, user notified by email
4. Audit log entry `admin_override` (with admin's actor_id)
5. Therapist's next login → forced /enroll-mfa

## Migration notes

- This change affects **all existing therapist accounts**. They will be
  forced to enroll MFA on next login.
- Pre-deploy: send announcement email to existing therapists 7 days before
  deploy (out of scope for this spec but recommended ops step).
- Rollback: if catastrophic, revert layout gate change first (un-block
  existing therapists) while keeping infrastructure for next attempt.

## Compliance / privacy

- `mfa_backup_codes.code_hash` is bcrypt — irreversible, no PII
- `mfa_audit_log.ip` is personal data under GDPR — retain 90 days, delete
  via cron (similar to existing audit retention pattern)
- Update `docs/platform/security.md` to reflect mandatory MFA for
  therapists post-deploy
- Update `docs/platform/compliance.md` § 2.1 if Brevo template list grows

## Related

- `src/lib/auth/mfa.ts` — existing MFA helpers (TOTP enroll/verify)
- `src/app/enroll-mfa/page.tsx` — current enrollment UX (will be redesigned)
- `src/app/verify-mfa/page.tsx` — current AAL2 challenge UX
- Admin layout (path TBD during impl) — current pattern for mandatory MFA
- `docs/platform/security.md` — threat model document
