import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Audit log helper for admin actions.
 *
 * Call from any admin-only API route AFTER the action succeeds. Writes
 * a structured row to public.admin_actions so the audit-log viewer
 * (/dashboard/audit) can replay who did what and when. Useful for:
 *   - Investor due-diligence ("show me the audit trail")
 *   - Forensics if an admin account is compromised
 *   - Compliance reporting (GDPR Art. 30, processing log)
 *
 * The function is best-effort — failures are logged but don't propagate
 * (we'd rather complete the user-visible action than lose it because
 * audit failed).
 */
export async function logAdminAction({
  request,
  adminUserId,
  adminEmail,
  action,
  targetTable,
  targetId,
  details,
}: {
  request?: NextRequest;
  adminUserId: string;
  adminEmail?: string | null;
  action: string;
  targetTable?: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const ip = extractIp(request);
    const ua = request?.headers.get("user-agent") ?? null;
    await admin.from("admin_actions").insert({
      admin_user_id: adminUserId,
      admin_email: adminEmail ?? null,
      action,
      target_table: targetTable ?? null,
      target_id: targetId ?? null,
      details: details ?? {},
      ip_address: ip,
      user_agent: ua,
    });
  } catch (err) {
    // Don't surface to the caller — audit logging is best-effort.
    console.error("[audit] failed to log admin action:", err);
  }
}

/**
 * Extract the client IP from common headers Vercel/Cloudflare set.
 * Falls back to null. NEVER trust client-set headers (X-Forwarded-For
 * can be spoofed when not behind a known proxy, but on Vercel it's
 * set by their edge so it's trustworthy).
 */
function extractIp(request?: NextRequest): string | null {
  if (!request) return null;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}
