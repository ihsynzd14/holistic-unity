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
 *
 * Audit failures must NOT break the main flow — log to console
 * (Sentry instrumentation already wraps server) and continue.
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
    console.error("[mfa.audit] failed to log event", error);
  }
}
