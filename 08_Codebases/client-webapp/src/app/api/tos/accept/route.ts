import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  CLIENT_TOS_VERSION,
  THERAPIST_TOS_VERSION,
} from "@/lib/tos/version";

/**
 * Persists a Terms-of-Service acceptance event to the audit table.
 *
 * Called from:
 *   - /welcome  — promotes the user_metadata.tos_pending_* fields set by
 *     /register into a durable row right after email confirmation.
 *   - /accept-terms — when an existing user accepts a new TOS version.
 *
 * IP and user-agent are captured server-side from request headers so the
 * client cannot forge them. Document hash is the SHA-256 of the version
 * string; if we later store the actual HTML body we can swap it for that.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: {
    general?: boolean;
    vessatorie?: boolean;
    privacy?: boolean;
    health_data?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // SECURITY: derive role from server-side user metadata, NEVER from the
  // request body. A client could otherwise spoof role=therapist and pollute
  // the audit-trail with a wrong role attribution. Real role-based access
  // control happens against user_metadata.role elsewhere; this read just
  // mirrors that single source of truth.
  const metaRole = (user.user_metadata as { role?: string } | null)?.role;
  const role: "client" | "therapist" =
    metaRole === "therapist" ? "therapist" : "client";
  const tosVersion =
    role === "therapist" ? THERAPIST_TOS_VERSION : CLIENT_TOS_VERSION;

  // Four explicit booleans — server will reject the row if any required
  // approval is false (the constraint catches it client-side too, but
  // defence in depth: a dev-tools tinkered request still gets blocked).
  //
  // `health_data` is the Art. 9(2)(a) GDPR explicit consent for processing
  // special-category data (data concerning health). Required for clients
  // because every booking generates such data; required for therapists too
  // (they will read clients' health-related context). The check applies
  // uniformly so a malformed payload missing the field is a 400, not a
  // silent NULL row.
  if (!body.general || !body.privacy || !body.vessatorie || !body.health_data) {
    return NextResponse.json(
      { error: "all four approvals are required (general, privacy, vessatorie, health_data)" },
      { status: 400 },
    );
  }

  // SECURITY: prefer `x-real-ip` (Vercel edge sets this to the actual
  // remote address — clients cannot inject it). Fall back to the first
  // entry of `x-forwarded-for` only off-Vercel (dev / other hosts);
  // Vercel rewrites X-Forwarded-For to drop client-supplied values, so
  // either source is safe in production. The IP is for civil audit only,
  // not authentication, so a best-effort capture is acceptable.
  const realIp = request.headers.get("x-real-ip");
  const fwd = request.headers.get("x-forwarded-for") || "";
  const ip = realIp || fwd.split(",")[0]?.trim() || null;
  const userAgent = request.headers.get("user-agent") || null;

  // SHA-256 of the version string is enough for tamper-detection of which
  // contract was on screen; if the version changes the hash changes.
  const enc = new TextEncoder().encode(tosVersion);
  const hashBuf = await crypto.subtle.digest("SHA-256", enc);
  const documentHash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error } = await supabase.from("tos_acceptances").insert({
    user_id: user.id,
    user_role: role,
    tos_version: tosVersion,
    general_accept: !!body.general,
    vessatorie_accept: !!body.vessatorie,
    privacy_accept: !!body.privacy,
    health_data_accept: !!body.health_data,
    ip_address: ip,
    user_agent: userAgent,
    document_hash: documentHash,
  });

  if (error) {
    // Unique constraint hit means the user already accepted this version —
    // make this idempotent: a second click should succeed silently rather
    // than break the redirect dance back to the dashboard.
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, idempotent: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, version: tosVersion });
}
