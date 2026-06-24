import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/security/backup-codes/count
 * Returns the number of unused backup codes for the authenticated user.
 * Used by the settings page to show "N codici rimanenti".
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("mfa_backup_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("used_at", null);
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  return NextResponse.json({ remaining: count ?? 0 });
}
