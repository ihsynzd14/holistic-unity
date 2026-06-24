import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logMfaEvent } from "@/lib/auth/audit";

/**
 * POST /api/security/mfa-status
 *
 * Resyncs `therapist_profiles.has_mfa` with the user's actual factor
 * status in auth.users. Called by the therapist-webapp after a successful
 * enroll OR disable, so the public profile badge reflects reality.
 * Also writes an mfa_audit_log entry (`enrolled` or `disabled`) so we
 * have a forensic trail of every MFA state change.
 *
 * Server-side trust model:
 *   - We fetch factors via the user's session (anon client + JWT) — they
 *     can't lie about their own factors.
 *   - We update therapist_profiles.has_mfa using service-role (bypasses
 *     the column-level write protection RLS may have).
 *   - We re-validate ownership (user.id === therapist_profile.id) before
 *     writing.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Read factors from the authenticated session — Supabase guarantees
  // these belong to the current user.
  const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
  if (factorsErr) {
    return NextResponse.json({ error: factorsErr.message }, { status: 500 });
  }
  const hasMfa = (factors?.totp ?? []).some((f) => f.status === "verified");

  // Confirm the caller is the owner of the therapist_profiles row
  // we're about to update.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("therapist_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    // Not a therapist — silently no-op (clients don't have a profile row)
    return NextResponse.json({ ok: true, has_mfa: hasMfa, updated: false });
  }

  // Detect transition: was MFA off and now on (enrolled), or off (disabled)?
  const { data: prev } = await admin
    .from("therapist_profiles")
    .select("has_mfa")
    .eq("id", user.id)
    .maybeSingle();
  const wasMfa = !!prev?.has_mfa;

  await admin
    .from("therapist_profiles")
    .update({ has_mfa: hasMfa, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  // Audit log on actual state change (skip noise when called repeatedly).
  if (wasMfa !== hasMfa) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await logMfaEvent(admin, {
      userId: user.id,
      action: hasMfa ? "enrolled" : "disabled",
      ip,
      userAgent: req.headers.get("user-agent"),
    });
  }

  return NextResponse.json({ ok: true, has_mfa: hasMfa, updated: true });
}
