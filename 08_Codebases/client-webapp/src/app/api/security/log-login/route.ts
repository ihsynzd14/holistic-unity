import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const APP_NAME = "client-webapp";

/**
 * POST /api/security/log-login
 *
 * Records a successful sign-in to public.login_events. Called by the
 * login page right after supabase.auth.signInWithPassword resolves.
 *
 * What we capture:
 *   - user_id (from the just-created session)
 *   - role (from public.users.role; defaults to 'client'/'therapist'/'admin'
 *     based on which app called this)
 *   - ip + user-agent (from request headers — Vercel sets x-forwarded-for)
 *   - is_new_device flag: true if (ip, ua) tuple isn't seen in the user's
 *     last 50 logins. False otherwise.
 *
 * Privacy: stored only in DB, RLS limits read to the user themselves +
 * admin. No third-party analytics.
 *
 * Future: when is_new_device=true, send an email via the existing
 * send-brevo-email Edge Function. Hook in below where commented.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Soft-fail — caller may have called us right after a sign-in that
    // didn't actually create a session.
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const ip = extractIp(request);
  const ua = request.headers.get("user-agent");

  const admin = createAdminClient();

  // Look up role for the row (best-effort)
  const { data: userRow } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // Compare to the user's recent logins to flag new devices
  const { data: recent } = await admin
    .from("login_events")
    .select("ip_address, user_agent")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const knownTuples = new Set(
    (recent ?? []).map((r) => `${r.ip_address ?? ""}|${r.user_agent ?? ""}`),
  );
  const currentTuple = `${ip ?? ""}|${ua ?? ""}`;
  const isNewDevice = !knownTuples.has(currentTuple);

  await admin.from("login_events").insert({
    user_id: user.id,
    user_role: userRow?.role ?? null,
    ip_address: ip,
    user_agent: ua,
    app: APP_NAME,
    is_new_device: isNewDevice,
  });

  // TODO (post-launch): when isNewDevice && Brevo template is set up,
  // fire send-brevo-email here with template_id=NEW_DEVICE_LOGIN.

  return NextResponse.json({ ok: true, is_new_device: isNewDevice });
}

function extractIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}
