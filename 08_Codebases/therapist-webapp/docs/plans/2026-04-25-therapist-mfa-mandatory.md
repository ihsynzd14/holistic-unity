# MFA Mandatory + Backup Codes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce MFA enrollment for therapists at dashboard load with friendly forced-onboarding wizard, plus self-recovery via 8 single-use bcrypt-hashed backup codes.

**Architecture:** Server-side MFA gate in `dashboard/layout.tsx` mirrors existing admin layout pattern. Backup codes stored in new `mfa_backup_codes` table (RLS deny-all, service_role only). Recovery flow at `/verify-mfa` validates code → calls service_role to disable TOTP factor → forced re-enrollment via layout gate. All security events logged to `mfa_audit_log`.

**Tech Stack:** Next.js 16 App Router (RSC), Supabase Auth TOTP, Supabase service_role for admin ops, bcrypt cost 12, Postgres RLS, Brevo (or fallback to no-email V1.1).

**Source spec:** `docs/specs/2026-04-25-therapist-mfa-mandatory.md`

**Verification approach:** This repo has no Vitest/Jest/Playwright. Confidence gates per task = TypeScript `tsc --noEmit` + `next build` + manual browser walkthrough on `npm run dev`. Logical commits at task boundaries.

---

## Phase 1 — Database + lib foundations

### Task 1: SQL migration for backup codes + audit log

**Files:**
- Create: `supabase/migrations/20260425100000_mfa_backup_codes.sql`

- [ ] **Step 1: Verify migrations directory exists**

```bash
ls "/Users/marcello/Desktop/Holistic Unity/therapist-webapp/supabase" 2>/dev/null || mkdir -p "/Users/marcello/Desktop/Holistic Unity/therapist-webapp/supabase/migrations"
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260425100000_mfa_backup_codes.sql`:

```sql
-- 2026-04-25: MFA backup codes + MFA audit log
-- Enables self-recovery for therapists who lose their authenticator device.

CREATE TABLE IF NOT EXISTS public.mfa_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_backup_codes_user_unused_idx
  ON public.mfa_backup_codes (user_id) WHERE used_at IS NULL;

ALTER TABLE public.mfa_backup_codes ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all for authenticated/anon. Service_role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.mfa_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN (
    'enrolled',
    'verified',
    'disabled',
    'backup_code_used',
    'backup_codes_regenerated',
    'admin_override'
  )),
  ip          inet,
  user_agent  text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_audit_log_user_created_idx
  ON public.mfa_audit_log (user_id, created_at DESC);

ALTER TABLE public.mfa_audit_log ENABLE ROW LEVEL SECURITY;
-- Same: deny-all for authenticated/anon.
```

- [ ] **Step 3: Apply migration in Supabase Studio**

Open the project in Supabase Studio → SQL Editor → paste the migration → Run. Confirm via Table Editor that both tables exist with the expected columns.

- [ ] **Step 4: Smoke test RLS**

In SQL Editor as `authenticated` role (use a test user JWT or impersonate):

```sql
SET ROLE authenticated;
SELECT * FROM public.mfa_backup_codes;  -- expect: 0 rows + permission denied OR 0 rows visible
SELECT * FROM public.mfa_audit_log;     -- same
RESET ROLE;
```

Expected: empty result with RLS-blocked indication.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260425100000_mfa_backup_codes.sql
git commit -m "feat(mfa): add backup codes + audit log tables with deny-all RLS"
```

---

### Task 2: Install bcrypt + add backup codes lib

**Files:**
- Create: `src/lib/auth/backup-codes.ts`
- Modify: `package.json` (add bcrypt deps)

- [ ] **Step 1: Install bcrypt**

```bash
cd "/Users/marcello/Desktop/Holistic Unity/therapist-webapp"
npm install bcrypt
npm install --save-dev @types/bcrypt
```

Expected: `package.json` has `bcrypt` in `dependencies` and `@types/bcrypt` in `devDependencies`.

- [ ] **Step 2: Write backup-codes.ts**

Create `src/lib/auth/backup-codes.ts`:

```typescript
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";

const COUNT = 8;
const BCRYPT_COST = 12;

/**
 * Generate `COUNT` cryptographically random backup codes.
 * Format: 16 hex chars grouped 4-4-4-4 (e.g. "A3F2-9C81-04B5-EE6D").
 * Returns plaintext codes — caller must show to user once and persist
 * only the bcrypt hash via `hashCode()`.
 *
 * Entropy: 64 bits (16 hex chars). Combined with bcrypt cost 12 and
 * rate-limited recovery endpoint, this is well above the brute-force
 * threshold for the 8 unused codes outstanding at any time.
 */
export function generateCodes(): string[] {
  return Array.from({ length: COUNT }, () => {
    const hex = randomBytes(8).toString("hex").toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
  });
}

/**
 * Normalise a code (strip hyphens, uppercase) before hashing or
 * comparison so users can re-type with or without hyphens.
 */
function normalize(code: string): string {
  return code.replace(/-/g, "").toUpperCase();
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(normalize(code), BCRYPT_COST);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalize(code), hash);
}
```

- [ ] **Step 3: Type-check**

```bash
cd "/Users/marcello/Desktop/Holistic Unity/therapist-webapp"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Quick smoke via Node REPL**

```bash
node --input-type=module -e "
const { generateCodes, hashCode, verifyCode } = await import('./src/lib/auth/backup-codes.ts');
const codes = generateCodes();
console.log('codes:', codes);
console.log('count:', codes.length);
console.log('format ok:', codes.every(c => /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(c)));
const h = await hashCode(codes[0]);
console.log('verify same:', await verifyCode(codes[0], h));
console.log('verify wrong:', await verifyCode('AAAA-BBBB-CCCC-DDDD', h));
"
```

Expected: 8 codes, all match format, verify same = true, verify wrong = false.

If `node` rejects the .ts import, copy the file to a `.mjs` temporarily for the smoke test.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/auth/backup-codes.ts
git commit -m "feat(mfa): backup-codes lib (generate/hash/verify) with bcrypt cost 12"
```

---

### Task 3: Add `verifyBackupCodeAndDisable` to mfa.ts

**Files:**
- Modify: `src/lib/auth/mfa.ts`

- [ ] **Step 1: Add import for service_role admin ops**

The existing `mfa.ts` uses a regular `SupabaseClient`. The new helper needs service-role access — but we don't put service_role in client-side code. So this helper takes an *admin* client (created server-side from the service_role key) as a parameter. Caller (the API route) supplies it.

- [ ] **Step 2: Append the new helper at end of `src/lib/auth/mfa.ts`**

Add (do NOT remove existing functions):

```typescript
/**
 * Recovery path: verify a plaintext backup code against the user's
 * unused codes, mark the matched code as used (atomic), then delete
 * the user's TOTP factor + remaining backup codes via the admin client.
 *
 * After this call, the user's MFA is fully disabled — the dashboard
 * layout will redirect to /enroll-mfa on next page load, forcing
 * re-enrollment of new TOTP + new backup codes (intentional: assumes
 * device loss/compromise).
 *
 * MUST be called from a server route with service_role access; the
 * `admin` client is `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.
 */
import type { SupabaseClient as SbClient } from "@supabase/supabase-js";
import { verifyCode } from "./backup-codes";

export async function verifyBackupCodeAndDisable(
  admin: SbClient,
  userId: string,
  submittedCode: string,
): Promise<{ ok: boolean; reason?: "not_found" | "no_codes" | "no_factors" }> {
  // 1. Fetch all unused codes for this user.
  const { data: rows, error: fetchErr } = await admin
    .from("mfa_backup_codes")
    .select("id, code_hash")
    .eq("user_id", userId)
    .is("used_at", null);
  if (fetchErr) throw fetchErr;
  if (!rows || rows.length === 0) return { ok: false, reason: "no_codes" };

  // 2. Find the row whose hash matches the submitted code (bcrypt is
  //    constant-time per-compare; we loop through all candidates).
  let matchedId: string | null = null;
  for (const r of rows) {
    if (await verifyCode(submittedCode, r.code_hash)) {
      matchedId = r.id;
      break;
    }
  }
  if (!matchedId) return { ok: false, reason: "not_found" };

  // 3. Atomic: mark this row used IFF still unused. If two requests
  //    race, only one wins.
  const { data: updated, error: updErr } = await admin
    .from("mfa_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matchedId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (updErr) throw updErr;
  if (!updated) return { ok: false, reason: "not_found" }; // raced + lost

  // 4. Delete the user's MFA factor(s) — forces re-enrollment on next
  //    page load. Supabase admin API accepts deleteFactor by id.
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
  const totpFactors = (factors?.factors ?? []).filter(f => f.factor_type === "totp");
  if (totpFactors.length === 0) {
    // Edge case: code was valid but no factor existed. Still consider it
    // a successful recovery — caller will redirect to enroll anyway.
    return { ok: true };
  }
  for (const f of totpFactors) {
    await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
  }

  // 5. Delete remaining unused backup codes (compromise assumption).
  await admin
    .from("mfa_backup_codes")
    .delete()
    .eq("user_id", userId)
    .is("used_at", null);

  return { ok: true };
}
```

- [ ] **Step 3: Verify Supabase admin API surface**

The Supabase JS SDK `auth.admin.mfa` namespace was added in v2.40+. Confirm:

```bash
grep -A2 '"@supabase/supabase-js"' package.json
```

Expected: version ≥ 2.40. If older, either upgrade or fall back to direct REST calls (`PUT /auth/v1/admin/users/{id}/factors/{factor_id}` etc.).

If the namespace is missing at runtime, replace the admin call with a fetch to:

```
DELETE {SUPABASE_URL}/auth/v1/admin/users/{userId}/factors/{factorId}
Headers: Authorization: Bearer {SERVICE_ROLE_KEY}, apikey: {SERVICE_ROLE_KEY}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/mfa.ts
git commit -m "feat(mfa): verifyBackupCodeAndDisable helper with atomic single-use"
```

---

### Task 4: Audit log helper

**Files:**
- Create: `src/lib/auth/audit.ts`

- [ ] **Step 1: Write audit helper**

Create `src/lib/auth/audit.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export type MfaAuditAction =
  | "enrolled"
  | "verified"
  | "disabled"
  | "backup_code_used"
  | "backup_codes_regenerated"
  | "admin_override";

/**
 * Insert a row into mfa_audit_log. Caller must pass an `admin` client
 * (service_role) since the table is RLS deny-all.
 *
 * `actorId` defaults to `userId` for self-actions; pass a different
 * id for admin overrides.
 */
export async function logMfaEvent(
  admin: SupabaseClient,
  args: {
    userId: string;
    action: MfaAuditAction;
    actorId?: string;
    ip?: string | null;
    userAgent?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("mfa_audit_log").insert({
    user_id: args.userId,
    actor_id: args.actorId ?? args.userId,
    action: args.action,
    ip: args.ip ?? null,
    user_agent: args.userAgent ?? null,
    details: args.details ?? {},
  });
  if (error) {
    // Audit failures must not break the main flow — log to Sentry
    // (already configured) and continue.
    console.error("[mfa.audit] failed to log event", error);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/audit.ts
git commit -m "feat(mfa): audit log helper (best-effort, non-blocking)"
```

---

## Phase 2 — API routes

### Task 5: Backup-codes API route — POST regenerate

**Files:**
- Create: `src/app/api/security/backup-codes/route.ts`

- [ ] **Step 1: Write the route file with POST handler**

Create `src/app/api/security/backup-codes/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { generateCodes, hashCode } from "@/lib/auth/backup-codes";
import { logMfaEvent } from "@/lib/auth/audit";
import { getMfaStatus, verifyBackupCodeAndDisable } from "@/lib/auth/mfa";
import { rateLimit } from "@/lib/auth/rateLimit";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createAdmin(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * POST /api/security/backup-codes
 * Regenerate (replace) backup codes for the authenticated user.
 * Requires AAL2 session — current TOTP must be working.
 * Returns the 8 plaintext codes (one-time, never shown again).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // AAL2 gate
  const status = await getMfaStatus(supabase);
  if (status.aal !== "aal2") {
    return NextResponse.json({ error: "aal2_required" }, { status: 403 });
  }

  const admin = adminClient();
  const ua = req.headers.get("user-agent");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Generate new codes
  const codes = generateCodes();
  const hashes = await Promise.all(codes.map((c) => hashCode(c)));

  // Replace: delete existing rows for user, insert new ones
  await admin.from("mfa_backup_codes").delete().eq("user_id", user.id);
  const rows = hashes.map((h) => ({ user_id: user.id, code_hash: h }));
  const { error: insErr } = await admin.from("mfa_backup_codes").insert(rows);
  if (insErr) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  await logMfaEvent(admin, {
    userId: user.id,
    action: "backup_codes_regenerated",
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ codes });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/security/backup-codes/route.ts
git commit -m "feat(mfa): POST /api/security/backup-codes — regenerate (AAL2)"
```

---

### Task 6: Backup-codes API route — PUT recovery (rate-limited)

**Files:**
- Modify: `src/app/api/security/backup-codes/route.ts` (add PUT)
- Verify: `src/lib/auth/rateLimit.ts` API

- [ ] **Step 1: Read existing rateLimit.ts to confirm signature**

```bash
sed -n '1,30p' "src/lib/auth/rateLimit.ts"
```

Note the exported function name + signature. The plan below assumes a function `rateLimit({ key, max, windowMs })` returning `{ ok, retryAfterMs? }`. If the existing API differs, adapt the call (DO NOT rewrite rateLimit.ts).

- [ ] **Step 2: Append PUT handler in `src/app/api/security/backup-codes/route.ts`**

Add to the same file:

```typescript
/**
 * PUT /api/security/backup-codes
 * Body: { code: string, userId: string }  // userId because this is called
 *                                           // pre-AAL2 (AAL1 session, just
 *                                           // logged in, before TOTP verify)
 *
 * Verifies a backup code, disables current TOTP factor + remaining codes,
 * and logs the event. Rate-limited 5 / 15min / userId.
 */
export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  if (!body?.code || typeof body.code !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Rate limit BEFORE crypto verify to avoid burning CPU on a flood.
  const limit = await rateLimit({
    key: `mfa-backup:${user.id}`,
    max: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limit.retryAfterMs },
      { status: 429 },
    );
  }

  const admin = adminClient();
  const ua = req.headers.get("user-agent");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const result = await verifyBackupCodeAndDisable(admin, user.id, body.code);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "not_found" }, { status: 401 });
  }

  await logMfaEvent(admin, {
    userId: user.id,
    action: "backup_code_used",
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `rateLimit` signature mismatch, adapt the call (smaller scope than rewriting).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/security/backup-codes/route.ts
git commit -m "feat(mfa): PUT /api/security/backup-codes — recovery, rate-limited 5/15min"
```

---

## Phase 3 — Layout gate (forced enrollment)

### Task 7: Modify dashboard layout to force MFA

**Files:**
- Modify: `src/app/dashboard/layout.tsx`

- [ ] **Step 1: Read current layout to understand structure**

```bash
cat "src/app/dashboard/layout.tsx"
```

Note imports + structure.

- [ ] **Step 2: Add the MFA gate**

Wrap the existing render in MFA-status checks. The exact diff depends on what's there now, but the new logic block at the top of the component should be:

```typescript
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMfaStatus } from "@/lib/auth/mfa";

// inside the async server component (DashboardLayout):
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");

const role = (user.user_metadata as { role?: string } | null)?.role;
if (role === "therapist") {
  const mfa = await getMfaStatus(supabase);
  if (!mfa.enrolled) redirect("/enroll-mfa");
  if (mfa.aal !== "aal2") redirect("/verify-mfa");
}

// then continue with existing render
```

If the file isn't a server component yet, convert it (remove `"use client"` if present, make the function `async`).

- [ ] **Step 3: Verify enroll-mfa is reachable for non-enrolled user**

`enroll-mfa/page.tsx` already exists — confirm it does NOT also redirect non-enrolled users back to `/dashboard`, which would cause a redirect loop.

```bash
grep -n "redirect\|router.push" src/app/enroll-mfa/page.tsx
```

The current file (per spec recon) calls `router.push("/dashboard")` after enrollment success — that's correct (success path). It does NOT redirect on entry. Good.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npx next build
```

Expected: clean.

- [ ] **Step 5: Manual smoke test**

Start dev: `npm run dev`. With a therapist account that has NO MFA factor:
1. Go to `/dashboard` → should redirect to `/enroll-mfa`.
2. With same account but MFA enrolled at AAL1 → redirect to `/verify-mfa`.
3. With AAL2 → renders dashboard.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/layout.tsx
git commit -m "feat(mfa): therapist dashboard layout enforces MFA enrolled + aal2"
```

---

## Phase 4 — Enrollment UX (4-step wizard)

### Task 8: Refactor enroll-mfa into a step-aware page

**Files:**
- Modify: `src/app/enroll-mfa/page.tsx`

- [ ] **Step 1: Add step state and explicit navigation**

The existing page has 2 implicit phases (loading → QR + verify). New: 4 explicit steps with prev/next nav.

Replace `useState` block at top of the component with:

```tsx
type WizardStep = "install" | "scan" | "verify" | "backup";
const [step, setStep] = useState<WizardStep>("install");
const [enrollData, setEnrollData] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
const [code, setCode] = useState("");
const [verifying, setVerifying] = useState(false);
const [error, setError] = useState("");
const [backupCodes, setBackupCodes] = useState<string[]>([]);
const [acknowledged, setAcknowledged] = useState(false);
const [submitting, setSubmitting] = useState(false);
```

- [ ] **Step 2: Render switch by step**

Replace the existing render body (the JSX inside the outer wrapper) with a step-switch renderer. The wrapper styling (gradient background, card) stays the same — only the inner content changes.

```tsx
<div className="rounded-[22px] border border-white/60 bg-white/90 p-8 ...">
  <StepHeader step={step} />
  {step === "install" && <Step1Install onNext={() => setStep("scan")} />}
  {step === "scan" && (
    <Step2Scan
      data={enrollData}
      loading={!enrollData}
      onBack={() => setStep("install")}
      onNext={() => setStep("verify")}
    />
  )}
  {step === "verify" && (
    <Step3Verify
      code={code}
      setCode={setCode}
      verifying={verifying}
      error={error}
      onBack={() => setStep("scan")}
      onSubmit={onVerifySubmit}
    />
  )}
  {step === "backup" && (
    <Step4Backup
      codes={backupCodes}
      acknowledged={acknowledged}
      setAcknowledged={setAcknowledged}
      submitting={submitting}
      onSubmit={onFinish}
    />
  )}
</div>
```

- [ ] **Step 3: Implement `onVerifySubmit`**

Replace the existing `submitCode` function with a step-aware version that, on success, fetches backup codes and advances to step "backup":

```typescript
async function onVerifySubmit(e: React.FormEvent) {
  e.preventDefault();
  if (!enrollData) return;
  setVerifying(true);
  setError("");
  try {
    const supabase = createClient();
    await verifyEnrollment(supabase, enrollData.factorId, code.trim());
    // sync therapist_profiles.has_mfa
    try { await fetch("/api/security/mfa-status", { method: "POST" }); } catch {}
    // generate backup codes (now AAL2 — the regen endpoint requires it)
    const res = await fetch("/api/security/backup-codes", { method: "POST" });
    if (!res.ok) throw new Error("backup_codes_failed");
    const { codes } = await res.json();
    setBackupCodes(codes);
    setStep("backup");
  } catch (err) {
    setError(err instanceof Error ? err.message : "Codice non valido");
  } finally {
    setVerifying(false);
  }
}

async function onFinish() {
  if (!acknowledged) return;
  setSubmitting(true);
  router.push("/dashboard");
  router.refresh();
}
```

- [ ] **Step 4: Header component**

Add at the bottom of the file:

```tsx
function StepHeader({ step }: { step: WizardStep }) {
  const labels: Record<WizardStep, string> = {
    install: "1. Installa un'app authenticator",
    scan: "2. Scansiona il QR",
    verify: "3. Inserisci il codice",
    backup: "4. Salva i codici di backup",
  };
  const idx = ["install", "scan", "verify", "backup"].indexOf(step) + 1;
  return (
    <div className="mb-6">
      <p className="text-xs font-medium text-charcoal-muted">Step {idx} di 4</p>
      <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
        {labels[step]}
      </h1>
    </div>
  );
}
```

- [ ] **Step 5: Type-check + build**

```bash
npx tsc --noEmit
npx next build
```

Expected: build fails because Step1/Step2/Step3/Step4 components are not yet defined. That's intentional — Tasks 9-12 add them.

- [ ] **Step 6: Skip commit (build broken until Task 12 lands)**

Don't commit yet. Continue to Task 9. The next 4 tasks form a logical commit unit.

---

### Task 9: Step 1 — Install authenticator app

**Files:**
- Modify: `src/app/enroll-mfa/page.tsx`

- [ ] **Step 1: Add Step1Install component at the bottom of the file**

```tsx
function Step1Install({ onNext }: { onNext: () => void }) {
  return (
    <>
      <p className="text-sm text-charcoal-light">
        Per attivare MFA serve un'app authenticator sul tuo telefono. Ne basta una. Se ne hai già una (1Password, Authy, Google Authenticator), salta al prossimo step.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AppCard
          name="Google Authenticator"
          ios="https://apps.apple.com/app/google-authenticator/id388497605"
          android="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2"
        />
        <AppCard
          name="1Password"
          ios="https://apps.apple.com/app/1password-7-password-manager/id1333542190"
          android="https://play.google.com/store/apps/details?id=com.onepassword.android"
        />
        <AppCard
          name="Authy"
          ios="https://apps.apple.com/app/twilio-authy/id494168017"
          android="https://play.google.com/store/apps/details?id=com.authy.authy"
        />
      </div>

      <button
        type="button"
        onClick={onNext}
        className="mt-6 w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark"
      >
        Avanti
      </button>
    </>
  );
}

function AppCard({ name, ios, android }: { name: string; ios: string; android: string }) {
  return (
    <div className="rounded-2xl border border-berry-subtle bg-white/60 p-4">
      <p className="text-sm font-semibold text-charcoal">{name}</p>
      <div className="mt-2 flex flex-col gap-1">
        <a
          href={ios}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-berry hover:text-berry-dark underline-offset-2 hover:underline"
        >iOS</a>
        <a
          href={android}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-berry hover:text-berry-dark underline-offset-2 hover:underline"
        >Android</a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: No commit yet (multi-task unit)**

---

### Task 10: Step 2 — Scan QR

**Files:**
- Modify: `src/app/enroll-mfa/page.tsx`

- [ ] **Step 1: Add Step2Scan component**

```tsx
function Step2Scan({
  data,
  loading,
  onBack,
  onNext,
}: {
  data: { factorId: string; qrCode: string; secret: string } | null;
  loading: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <p className="text-sm text-charcoal-light">
        Apri l'app authenticator e scansiona il QR. Apparirà <strong>Holistic Unity</strong> tra i tuoi account.
      </p>

      {loading || !data ? (
        <div className="my-12 flex justify-center">
          <Loader />
        </div>
      ) : (
        <>
          <div className="mt-6 flex justify-center rounded-2xl bg-white p-4 shadow-inner">
            <Image src={data.qrCode} alt="QR per autenticatore" width={200} height={200} unoptimized />
          </div>
          <details className="mt-3 text-xs text-charcoal-muted">
            <summary className="cursor-pointer hover:text-charcoal">Non riesci a scansionare? Inserimento manuale</summary>
            <p className="mt-2 break-all rounded-lg bg-cream-dark/30 p-3 font-mono text-[11px] text-charcoal">
              {data.secret}
            </p>
          </details>
        </>
      )}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-full border border-berry/20 py-3 font-medium text-charcoal hover:bg-berry/5"
        >
          Indietro
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!data}
          className="flex-1 rounded-full bg-berry py-3 font-semibold text-white shadow-md hover:bg-berry-dark disabled:opacity-50"
        >
          Avanti
        </button>
      </div>
    </>
  );
}

function Loader() {
  return (
    <svg className="h-8 w-8 animate-spin text-berry" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
```

- [ ] **Step 2: No commit yet**

---

### Task 11: Step 3 — Verify code

**Files:**
- Modify: `src/app/enroll-mfa/page.tsx`

- [ ] **Step 1: Add Step3Verify component**

```tsx
function Step3Verify({
  code,
  setCode,
  verifying,
  error,
  onBack,
  onSubmit,
}: {
  code: string;
  setCode: (v: string) => void;
  verifying: boolean;
  error: string;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <p className="text-sm text-charcoal-light">
        Inserisci il codice a 6 cifre che vedi nell'app. Cambia ogni 30 secondi.
      </p>

      <div className="mt-5">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          autoFocus
          required
          className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
      </div>

      {error && <p className="mt-3 text-center text-sm text-error">{error}</p>}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-full border border-berry/20 py-3 font-medium text-charcoal hover:bg-berry/5"
        >
          Indietro
        </button>
        <button
          type="submit"
          disabled={verifying || code.length !== 6}
          className="flex-1 rounded-full bg-berry py-3 font-semibold text-white shadow-md hover:bg-berry-dark disabled:opacity-50"
        >
          {verifying ? "Verifica…" : "Conferma"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: No commit yet**

---

### Task 12: Step 4 — Backup codes display + acknowledgment

**Files:**
- Modify: `src/app/enroll-mfa/page.tsx`

- [ ] **Step 1: Add Step4Backup component**

```tsx
function Step4Backup({
  codes,
  acknowledged,
  setAcknowledged,
  submitting,
  onSubmit,
}: {
  codes: string[];
  acknowledged: boolean;
  setAcknowledged: (v: boolean) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  function downloadTxt() {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "holisticunity-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyAll() {
    await navigator.clipboard.writeText(codes.join("\n"));
  }

  return (
    <>
      <div className="rounded-2xl border-2 border-warning bg-warning/10 p-4 text-sm text-charcoal">
        <strong>Salva questi codici ora.</strong> Se perdi il telefono, ti permettono di
        recuperare l'accesso senza contattare il supporto. <em>NON verranno mostrati di nuovo.</em>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-cream-dark/30 p-4">
        {codes.map((c) => (
          <code key={c} className="font-mono text-sm text-charcoal text-center py-1">
            {c}
          </code>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={downloadTxt}
          className="flex-1 rounded-full border border-berry/20 py-2 text-xs font-medium text-charcoal hover:bg-berry/5"
        >
          Scarica .txt
        </button>
        <button
          type="button"
          onClick={copyAll}
          className="flex-1 rounded-full border border-berry/20 py-2 text-xs font-medium text-charcoal hover:bg-berry/5"
        >
          Copia tutti
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex-1 rounded-full border border-berry/20 py-2 text-xs font-medium text-charcoal hover:bg-berry/5"
        >
          Stampa
        </button>
      </div>

      <label className="mt-5 flex items-start gap-2 text-sm text-charcoal">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-berry/20 text-berry focus:ring-berry/20"
        />
        <span>Ho salvato i miei codici di backup in un posto sicuro.</span>
      </label>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!acknowledged || submitting}
        className="mt-5 w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 hover:bg-berry-dark disabled:opacity-50"
      >
        {submitting ? "Apro la dashboard…" : "Vai alla dashboard"}
      </button>
    </>
  );
}
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npx next build
```

Expected: clean. The 4 step components are now defined.

- [ ] **Step 3: Manual smoke test**

`npm run dev`. As a therapist account with NO MFA:
1. `/dashboard` → redirect to `/enroll-mfa`
2. Step 1 → Avanti → Step 2 (QR loads)
3. Indietro → Step 1 → Avanti → Step 2
4. Avanti → Step 3
5. Open authenticator (real phone), scan QR, type code, submit
6. Step 4 shows 8 codes
7. Try clicking "Vai alla dashboard" without checkbox → blocked
8. Tick checkbox → button enables → click → land on `/dashboard`
9. Confirm DB: `mfa_factors` row, 8 `mfa_backup_codes` rows, 2+ `mfa_audit_log` rows (`enrolled`, `backup_codes_regenerated`).

- [ ] **Step 4: Commit (multi-task unit landed)**

```bash
git add src/app/enroll-mfa/page.tsx
git commit -m "feat(mfa): 4-step enrollment wizard with backup codes"
```

---

## Phase 5 — Recovery UX

### Task 13: Modify verify-mfa page to support backup-code recovery

**Files:**
- Modify: `src/app/verify-mfa/page.tsx`

- [ ] **Step 1: Add mode toggle state**

At the top of the component, add:

```tsx
const [mode, setMode] = useState<"totp" | "backup">("totp");
const [backupCode, setBackupCode] = useState("");
```

- [ ] **Step 2: Add a toggle link below the TOTP form**

Below the existing TOTP submit button, add:

```tsx
{mode === "totp" && (
  <button
    type="button"
    onClick={() => { setMode("backup"); setError(""); }}
    className="mt-4 block w-full text-center text-xs font-medium text-charcoal-muted hover:text-charcoal underline underline-offset-2"
  >
    Hai perso l'accesso? Usa un codice di backup
  </button>
)}
```

- [ ] **Step 3: Conditionally render the backup form when `mode === "backup"`**

Replace (or wrap) the TOTP form section so only the relevant one renders:

```tsx
{mode === "totp" ? (
  // existing TOTP form
) : (
  <form onSubmit={onSubmitBackup}>
    <p className="text-sm text-charcoal-light">
      Inserisci uno dei codici di backup salvati al momento dell'attivazione MFA. Verrà invalidato dopo l'uso.
    </p>
    <input
      type="text"
      value={backupCode}
      onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
      placeholder="XXXX-XXXX-XXXX-XXXX"
      maxLength={19}
      autoComplete="one-time-code"
      className="mt-4 w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-center font-mono text-lg tracking-wider text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
    />
    {error && <p className="mt-3 text-center text-sm text-error">{error}</p>}
    <button
      type="submit"
      disabled={verifying || backupCode.replace(/-/g, "").length !== 16}
      className="mt-5 w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 hover:bg-berry-dark disabled:opacity-50"
    >
      {verifying ? "Verifica…" : "Recupera accesso"}
    </button>
    <button
      type="button"
      onClick={() => { setMode("totp"); setError(""); }}
      className="mt-3 block w-full text-center text-xs text-charcoal-muted hover:text-charcoal"
    >
      Torna al codice TOTP
    </button>
  </form>
)}
```

- [ ] **Step 4: Implement `onSubmitBackup`**

```typescript
async function onSubmitBackup(e: React.FormEvent) {
  e.preventDefault();
  setVerifying(true);
  setError("");
  try {
    const res = await fetch("/api/security/backup-codes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: backupCode.trim() }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.error === "rate_limited") {
        setError("Troppi tentativi. Riprova più tardi.");
      } else {
        setError("Codice non valido.");
      }
      return;
    }
    // Success: TOTP factor was deleted server-side. Dashboard layout will
    // redirect to /enroll-mfa for fresh enrollment.
    router.push("/dashboard");
    router.refresh();
  } catch {
    setError("Errore di rete. Riprova.");
  } finally {
    setVerifying(false);
  }
}
```

- [ ] **Step 5: Type-check + build**

```bash
npx tsc --noEmit
npx next build
```

Expected: clean.

- [ ] **Step 6: Manual smoke test**

`npm run dev`. As a therapist with active MFA + at least 1 backup code:
1. Login → `/verify-mfa` shows TOTP form.
2. Click "Hai perso l'accesso? Usa un codice di backup" → form swaps.
3. Enter a wrong backup code → "Codice non valido".
4. Enter the correct backup code → redirect to `/dashboard` → immediate redirect to `/enroll-mfa` (because TOTP factor was deleted).
5. Confirm DB: matched code has `used_at`, other backup codes deleted, `mfa_factors` empty for this user, `mfa_audit_log` has `backup_code_used`.

- [ ] **Step 7: Commit**

```bash
git add src/app/verify-mfa/page.tsx
git commit -m "feat(mfa): backup-code recovery on /verify-mfa"
```

---

## Phase 6 — Settings + audit hooks

### Task 14: Settings security page (regenerate codes)

**Files:**
- Create or Modify: `src/app/dashboard/settings/security/page.tsx` (depends on whether the path exists)

- [ ] **Step 1: Check existing settings structure**

```bash
ls "src/app/dashboard/settings/" 2>/dev/null
```

If no `security/` exists, create it. If a settings index exists, add a card linking to `/dashboard/settings/security`.

- [ ] **Step 2: Write the page**

Create `src/app/dashboard/settings/security/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SecurityPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [aal, setAal] = useState<"aal1" | "aal2" | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [showNewCodes, setShowNewCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const supabase = createClient();
    const [{ data: factors }, { data: aalData }, codesRes] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      fetch("/api/security/backup-codes/count"),
    ]);
    const verified = (factors?.totp ?? []).some((f) => f.status === "verified");
    setEnrolled(verified);
    setAal((aalData?.currentLevel ?? "aal1") as "aal1" | "aal2");
    if (codesRes.ok) {
      const j = await codesRes.json();
      setRemaining(j.remaining);
    }
  }

  async function regenerate() {
    if (aal !== "aal2") {
      setError("Devi essere in sessione AAL2 (TOTP attivo) per rigenerare.");
      return;
    }
    if (!confirm("Vuoi rigenerare i codici? I codici attuali smetteranno di funzionare immediatamente.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/security/backup-codes", { method: "POST" });
      if (!res.ok) throw new Error("regen_failed");
      const { codes } = await res.json();
      setShowNewCodes(codes);
      setAcknowledged(false);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  }

  if (enrolled === null) return <p>Caricamento…</p>;

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">Sicurezza</h1>

      <section className="rounded-2xl border border-berry/10 bg-white p-6">
        <h2 className="font-semibold">MFA</h2>
        <p className="mt-1 text-sm text-charcoal-light">
          {enrolled ? "Attivo" : "Non attivo"} · Sessione AAL{aal === "aal2" ? "2 (TOTP verificato)" : "1"}
        </p>
        {enrolled && (
          <p className="mt-1 text-sm text-charcoal-light">
            Codici di backup rimanenti: <strong>{remaining ?? "—"} su 8</strong>
          </p>
        )}

        {showNewCodes ? (
          <div className="mt-4 rounded-xl border-2 border-warning bg-warning/10 p-4">
            <p className="text-sm font-semibold">Nuovi codici (mostrati una volta sola):</p>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {showNewCodes.map((c) => (
                <code key={c} className="font-mono text-sm">{c}</code>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              Ho salvato i nuovi codici.
            </label>
            <button
              type="button"
              disabled={!acknowledged}
              onClick={() => setShowNewCodes(null)}
              className="mt-3 rounded-full bg-berry px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Chiudi
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || !enrolled || aal !== "aal2"}
            onClick={regenerate}
            className="mt-4 rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Rigenerazione…" : "Rigenera codici"}
          </button>
        )}
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Add count endpoint**

Create `src/app/api/security/backup-codes/count/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdmin(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { count, error } = await admin
    .from("mfa_backup_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("used_at", null);
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  return NextResponse.json({ remaining: count ?? 0 });
}
```

- [ ] **Step 4: Type-check + build + smoke test**

```bash
npx tsc --noEmit
npx next build
```

`npm run dev` → log in as therapist with MFA active → visit `/dashboard/settings/security` → confirm count + regenerate flow.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/settings/security/page.tsx src/app/api/security/backup-codes/count/route.ts
git commit -m "feat(mfa): settings page with codes count + regenerate (AAL2 gated)"
```

---

### Task 15: Hook audit log into existing enrollment + verify flows

**Files:**
- Modify: `src/lib/auth/mfa.ts` (add audit calls inside helpers)
- Modify: `src/app/api/security/mfa-status/route.ts` (if exists — verify event)

- [ ] **Step 1: Audit on enrollment success**

In the wizard's `onVerifySubmit` (Task 8), after `verifyEnrollment` succeeds, add a call to log the event. Since this is client-side, route through a server endpoint:

Create or extend `src/app/api/security/mfa-status/route.ts` POST handler to log `enrolled`:

```typescript
// At top of POST handler, AFTER verifying user + flipping has_mfa flag:
const admin = createAdmin(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
const ua = req.headers.get("user-agent");
await logMfaEvent(admin, { userId: user.id, action: "enrolled", ip, userAgent: ua });
```

(If the route doesn't exist yet, create it now — minimal handler that flips `therapist_profiles.has_mfa = true` and logs.)

- [ ] **Step 2: Verify the existing /verify-mfa client calls also produce audit**

In the verify-mfa client TOTP success path, fire-and-forget POST to `/api/security/mfa-event` with `{action: "verified"}`. To avoid scope creep, add a tiny generic endpoint:

Create `src/app/api/security/mfa-event/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logMfaEvent } from "@/lib/auth/audit";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (!body?.action || !["verified", "disabled"].includes(body.action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const admin = createAdmin(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logMfaEvent(admin, {
    userId: user.id,
    action: body.action as "verified" | "disabled",
    ip,
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Wire fire-and-forget call in verify-mfa client**

After successful TOTP verify in `/verify-mfa/page.tsx`:

```typescript
fetch("/api/security/mfa-event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "verified" }),
}).catch(() => {});
```

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npx next build
```

- [ ] **Step 5: Smoke test full audit trail**

Walk through enroll → verify → backup recovery. Query `mfa_audit_log` in Supabase Studio:

```sql
SELECT user_id, action, created_at FROM mfa_audit_log ORDER BY created_at DESC LIMIT 20;
```

Expected: rows for `enrolled`, `backup_codes_regenerated`, `verified`, `backup_code_used`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/security/mfa-event/route.ts src/app/api/security/mfa-status/route.ts src/app/verify-mfa/page.tsx
git commit -m "feat(mfa): audit log hooks for enrolled/verified/disabled events"
```

---

## Phase 7 — Email notifications (V1 best-effort)

### Task 16: Wire Brevo transactional emails or document V1.1 deferral

**Files:**
- Conditional: `src/lib/email/brevo.ts` if Brevo is connected; otherwise skip and document.

- [ ] **Step 1: Determine Brevo readiness**

```bash
grep -rn "BREVO_API_KEY\|brevo\|sendinblue" src/ docs/ 2>/dev/null
```

If a Brevo client + API key exist → continue with Step 2. If not → log a follow-up TODO in `docs/specs/2026-04-25-therapist-mfa-mandatory.md` ("Email notifications deferred to V1.1") and skip to commit.

- [ ] **Step 2 (if Brevo ready): Add transactional helper**

Use the existing Brevo client to send 4 transactional templates:
- `mfa-enabled` — fired in `mfa-status` POST after enrollment success
- `mfa-backup-code-used` — fired in PUT `backup-codes` after success
- `mfa-backup-codes-regenerated` — fired in POST `backup-codes`
- `mfa-admin-disabled` — fired by admin override flow (deferred unless admin tool exists)

Each call is fire-and-forget (no `await` blocks the user response):

```typescript
sendBrevoTransactional({ to: user.email!, template: "mfa-backup-code-used" }).catch(() => {});
```

- [ ] **Step 3 (if deferred): document the deferral**

Append to spec under "Out of scope V1":

> Email notifications deferred to V1.1 — audit log captures all events; users with email-based detection needs should follow up.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-04-25-therapist-mfa-mandatory.md src/lib/email/ 2>/dev/null
git commit -m "feat(mfa): wire Brevo email notifications (or document V1.1 deferral)"
```

---

## Phase 8 — Production deploy + announcement

### Task 17: Pre-deploy announcement to existing therapists (out-of-band)

- [ ] **Step 1: Send email to existing therapists**

Out of code scope, but a recommended operational step:

> Subject: Da [data], MFA obbligatorio sul portale therapist
> Body: 7-day notice + 3-step instructions on which authenticator to install.

(If <5 therapists, skip — do it 1:1 instead.)

### Task 18: Deploy

- [ ] **Step 1: Final build**

```bash
npx next build
```

Expected: clean.

- [ ] **Step 2: Deploy to Vercel**

```bash
vercel --prod --yes
```

- [ ] **Step 3: Post-deploy verification (per spec verification plan)**

Run all 5 E2E scenarios from `docs/specs/2026-04-25-therapist-mfa-mandatory.md` § "Verification plan". Use the production app at `app.holisticunity.app` (therapist subdomain — confirm exact URL during deploy).

- [ ] **Step 4: Tag release**

```bash
git tag -a mfa-mandatory-v1 -m "MFA mandatory + backup codes V1"
git push --tags
```

---

## Self-review checklist

The plan author runs this checklist after writing — no separate agent.

- [x] **Spec coverage:** Every section in `docs/specs/2026-04-25-therapist-mfa-mandatory.md` maps to at least one task. Force-enrollment (Task 7), backup codes infra (1-6), wizard UX (8-12), recovery (13), settings (14), audit (15), email (16). ✓
- [x] **No placeholders:** No "TBD" / "implement later" / vague "handle errors". Each step has exact code or exact command. ✓
- [x] **Type consistency:** `verifyBackupCodeAndDisable` defined in Task 3 is called in Task 6 with the same signature. `MfaAuditAction` defined in Task 4 is referenced in Task 15. Action values (`enrolled`, `verified`, etc.) match the SQL CHECK constraint in Task 1. ✓
- [x] **File paths:** All `src/...` paths spelled out exactly. ✓
- [x] **Verification gates:** Every commit-step is preceded by `tsc --noEmit` and/or `next build` + manual smoke test where UI is involved. ✓
- [x] **Order-dependent tasks:** Task 7 (layout gate) precedes Task 8 (wizard refactor) — but the wizard must compile before gate is meaningful. Build is broken between Task 8 and Task 12; all 4 land in one commit unit. ✓

---

## Out of scope (per spec)

- 2FA for clients (`client-webapp`)
- WebAuthn / passkeys
- SMS recovery
- Hardware keys
- Geographic anomaly detection
- Backup-code prefix display ("XXXX-****-****-****")
- Auto-enrollment for admins (already mandatory)
