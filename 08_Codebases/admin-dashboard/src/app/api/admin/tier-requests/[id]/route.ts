import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { logAdminAction } from "@/lib/auth/audit";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/tier-requests/[id]
 *
 * Approves or rejects a therapist's self-declared tier request.
 * Body: { action: "approve" | "reject" }
 *
 * - approve → sets `tier = requested_tier`, `tier_request_status = 'approved'`
 *   (this is the moment the new badge becomes visible to clients)
 * - reject  → sets `tier_request_status = 'rejected'`, leaves `tier` and
 *   `requested_tier` untouched so the therapist can see what they had
 *   requested and resubmit after fixing certifications.
 *
 * Both writes use service-role to bypass the `protect_therapist_admin_columns`
 * trigger that otherwise blocks non-admin writes to `tier` and
 * `tier_request_status`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id: therapistId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(therapistId)) {
    return NextResponse.json({ error: "Invalid therapist id" }, { status: 400 });
  }

  const body = await request.json();
  const action = body?.action as "approve" | "reject" | undefined;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Read existing request so we can audit the before/after state and
  // refuse if there's nothing to act on.
  const { data: existing, error: readErr } = await admin
    .from("therapist_profiles")
    .select("requested_tier, tier, tier_request_status")
    .eq("id", therapistId)
    .maybeSingle();

  if (readErr) {
    console.error("[tier-requests] read failed:", readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!existing || !existing.requested_tier) {
    return NextResponse.json(
      { error: "No tier request found for this therapist" },
      { status: 404 },
    );
  }
  if (existing.tier_request_status !== "pending") {
    return NextResponse.json(
      { error: `Request already ${existing.tier_request_status}` },
      { status: 409 },
    );
  }

  const update =
    action === "approve"
      ? { tier: existing.requested_tier, tier_request_status: "approved" }
      : { tier_request_status: "rejected" };

  const { error: writeErr } = await admin
    .from("therapist_profiles")
    .update(update)
    .eq("id", therapistId);

  if (writeErr) {
    console.error("[tier-requests]", action, "write failed:", writeErr);
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  await logAdminAction({
    request,
    adminUserId: auth.user.id,
    adminEmail: auth.user.email,
    action: action === "approve" ? "tier_request.approve" : "tier_request.reject",
    targetTable: "therapist_profiles",
    targetId: therapistId,
    details: {
      from_tier: existing.tier,
      requested_tier: existing.requested_tier,
      to_tier: action === "approve" ? existing.requested_tier : existing.tier,
    },
  });

  return NextResponse.json({ success: true });
}
