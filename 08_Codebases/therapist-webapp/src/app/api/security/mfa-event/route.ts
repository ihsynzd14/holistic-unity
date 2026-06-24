import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logMfaEvent, type MfaAuditAction } from "@/lib/auth/audit";

const ALLOWED_ACTIONS: MfaAuditAction[] = ["verified", "disabled"];

/**
 * POST /api/security/mfa-event
 * Body: { action: "verified" | "disabled" }
 *
 * Lightweight fire-and-forget endpoint for client-side success paths
 * to record an audit event. Other actions (enrolled, backup_code_used,
 * backup_codes_regenerated, admin_override) are logged from their
 * respective server flows directly — keep this endpoint narrow.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (!body?.action || !ALLOWED_ACTIONS.includes(body.action as MfaAuditAction)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const admin = createAdminClient();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logMfaEvent(admin, {
    userId: user.id,
    action: body.action as MfaAuditAction,
    ip,
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
