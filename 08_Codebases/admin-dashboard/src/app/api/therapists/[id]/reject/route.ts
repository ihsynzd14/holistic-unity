import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { logAdminAction } from "@/lib/auth/audit";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Defense-in-depth: ADMIN_EMAILS env AND users.is_admin DB flag.
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));

  // Use service_role to bypass RLS and the protect_therapist_admin_columns trigger
  const admin = createAdminClient();

  const { error } = await admin
    .from("therapist_profiles")
    .update({
      approval_status: "changes_requested",
      is_approved: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("Reject error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Optionally send a notification to the therapist with feedback
  if (body.feedback) {
    try {
      await admin.from("notifications").insert({
        user_id: id,
        type: "profile_update",
        title: "Profile Review Update",
        body: `Your profile needs some changes: ${body.feedback}`,
        therapist_id: id,
      });
    } catch {
      // Non-critical, continue
    }
  }

  // ─── Brevo: Send "Changes Requested" email (non-blocking) ──────
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    await fetch(`${supabaseUrl}/functions/v1/send-brevo-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: 8, // BREVO_TEMPLATES.THERAPIST_CHANGES_REQUESTED
        user_id: id,
        params: {
          feedback: body.feedback || "Please review and update your profile.",
          approval_status: "changes_requested",
        },
        tags: ["therapist_changes_requested"],
      }),
    });
  } catch (brevoErr) {
    console.warn("Brevo notification failed (non-blocking):", brevoErr);
  }

  // Audit trail — best-effort
  await logAdminAction({
    request,
    adminUserId: auth.user.id,
    adminEmail: auth.user.email,
    action: "therapist.reject",
    targetTable: "therapist_profiles",
    targetId: id,
    details: { feedback: body.feedback ?? null },
  });

  return NextResponse.json({ success: true, status: "changes_requested" });
}
