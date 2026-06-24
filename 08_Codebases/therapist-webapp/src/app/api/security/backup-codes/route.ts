import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCodes, hashCode } from "@/lib/auth/backup-codes";
import { logMfaEvent } from "@/lib/auth/audit";
import { getMfaStatus } from "@/lib/auth/mfa";
import { verifyBackupCodeAndDisable } from "@/lib/auth/mfa-server";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/security/backup-codes
 * Regenerate (replace) backup codes for the authenticated user.
 * Requires AAL2 session — current TOTP must be working. Used both
 * during initial enrollment (right after TOTP verify) and from the
 * settings page when the user wants to roll codes.
 *
 * Returns the 8 plaintext codes (one-time, never shown again).
 */
export async function POST(req: NextRequest) {
  void req;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = await getMfaStatus(supabase);
  if (status.aal !== "aal2") {
    return NextResponse.json({ error: "aal2_required" }, { status: 403 });
  }

  const admin = createAdminClient();
  const ua = req.headers.get("user-agent");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const codes = generateCodes();
  const hashes = await Promise.all(codes.map((c) => hashCode(c)));
  const rows = hashes.map((h) => ({ user_id: user.id, code_hash: h }));

  // Insert FIRST, then delete the old rows. The reverse order
  // (delete-then-insert) used to leave the user with zero usable
  // backup codes if the insert failed for any reason — locking them out
  // of MFA recovery. We accept the brief window where both old AND new
  // codes are valid because the alternative is a hard lock-out.
  // The delete here filters by `id NOT IN <newly-inserted ids>` to be
  // explicit about which rows to remove, and is best-effort: even if
  // the cleanup fails, the user still has the new working set.
  const { data: inserted, error: insErr } = await admin
    .from("mfa_backup_codes")
    .insert(rows)
    .select("id");
  if (insErr) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  const newIds = (inserted ?? []).map((r) => r.id as string);
  if (newIds.length > 0) {
    await admin
      .from("mfa_backup_codes")
      .delete()
      .eq("user_id", user.id)
      .not("id", "in", `(${newIds.map((id) => `"${id}"`).join(",")})`);
  }

  await logMfaEvent(admin, {
    userId: user.id,
    action: "backup_codes_regenerated",
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ codes });
}

/**
 * PUT /api/security/backup-codes
 * Body: { code: string }
 *
 * Verifies a backup code, disables current TOTP factor + remaining codes,
 * and logs the event. Rate-limited 5 / 15min / userId.
 *
 * Acceptable from AAL1 sessions (recovery happens before AAL2 challenge).
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
  const limit = await withRateLimit(req, {
    key: "mfa-backup-recovery",
    max: 5,
    windowSec: 15 * 60,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const admin = createAdminClient();
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
