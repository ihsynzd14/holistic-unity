import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Enforces that the current request is made by an authenticated admin.
 *
 * Defense-in-depth: BOTH of these must be true:
 *   (a) the user's email is in the ADMIN_EMAILS env whitelist, AND
 *   (b) their `users.is_admin` DB flag is true (via SECURITY DEFINER RPC
 *       `public.is_admin()`).
 *
 * Either check alone is insufficient:
 *   - env-only would be bypassed by a forged JWT with spoofed email.
 *   - DB-only would be bypassed if an admin's credentials leak and an
 *     attacker can't change env but can modify their own is_admin row
 *     (guarded by trigger, but env adds another moat).
 *
 * Returns:
 *   - { user, supabase } on success — caller proceeds.
 *   - { response } with 401/403 on failure — caller must return it.
 */
export async function requireAdmin(): Promise<
  | { user: User; supabase: SupabaseClient; response?: never }
  | { response: NextResponse; user?: never; supabase?: never }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Gate 1: ADMIN_EMAILS whitelist (static env-based)
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!adminEmails.includes(user.email?.toLowerCase() || "")) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  // Gate 2: DB is_admin flag (RPC — SECURITY DEFINER, fresh per request)
  const { data: isAdmin, error } = await supabase.rpc("is_admin");

  if (error) {
    // Failing closed: if the RPC is unavailable, deny rather than fall through.
    console.error("[requireAdmin] is_admin() RPC error:", error.message);
    return {
      response: NextResponse.json(
        { error: "Admin verification failed" },
        { status: 503 }
      ),
    };
  }

  if (!isAdmin) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { user, supabase };
}
