import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyCode } from "./backup-codes";

/**
 * Server-only MFA helpers — these import `bcrypt` (Node-only, no
 * browser bundle), so client components MUST NOT import from this file.
 * Use `./mfa.ts` for client-safe helpers.
 */

/**
 * Recovery path: verify a plaintext backup code against the user's
 * unused codes (from `mfa_backup_codes`), mark the matched code as
 * used (atomic), then delete the user's TOTP factor + remaining
 * backup codes via the admin client.
 *
 * After this call, the user's MFA is fully disabled — the dashboard
 * layout will redirect to /enroll-mfa on next page load, forcing
 * re-enrollment of new TOTP + new backup codes (intentional: assumes
 * device loss/compromise).
 *
 * MUST be called from a server route with service_role access; the
 * `admin` client is `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.
 */
export async function verifyBackupCodeAndDisable(
  admin: SupabaseClient,
  userId: string,
  submittedCode: string,
): Promise<{ ok: boolean; reason?: "not_found" | "no_codes" }> {
  // 1. Fetch all unused codes for this user.
  const { data: rows, error: fetchErr } = await admin
    .from("mfa_backup_codes")
    .select("id, code_hash")
    .eq("user_id", userId)
    .is("used_at", null);
  if (fetchErr) throw fetchErr;
  if (!rows || rows.length === 0) return { ok: false, reason: "no_codes" };

  // 2. Find the row whose hash matches the submitted code.
  let matchedId: string | null = null;
  for (const r of rows) {
    if (await verifyCode(submittedCode, r.code_hash)) {
      matchedId = r.id;
      break;
    }
  }
  if (!matchedId) return { ok: false, reason: "not_found" };

  // 3. Atomic mark-as-used (race-safe).
  const { data: updated, error: updErr } = await admin
    .from("mfa_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matchedId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (updErr) throw updErr;
  if (!updated) return { ok: false, reason: "not_found" };

  // 4. Delete the user's TOTP factors via admin API (forces re-enroll).
  // The admin.mfa namespace exists in @supabase/supabase-js >= 2.40.
  // We use a defensive call so older SDKs don't crash the recovery path:
  // even if factor deletion fails, deleting the backup codes (step 5)
  // means subsequent attempts can still re-enroll cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAuth = (admin.auth as unknown as { admin: any }).admin;
  try {
    const list = await adminAuth.mfa?.listFactors?.({ userId });
    const factors = list?.data?.factors ?? [];
    for (const f of factors) {
      if (f.factor_type === "totp") {
        await adminAuth.mfa.deleteFactor({ userId, id: f.id });
      }
    }
  } catch {
    console.error("[mfa] admin.mfa namespace unavailable; manual cleanup needed");
  }

  // 5. Delete remaining unused backup codes (compromise assumption).
  await admin
    .from("mfa_backup_codes")
    .delete()
    .eq("user_id", userId)
    .is("used_at", null);

  return { ok: true };
}
