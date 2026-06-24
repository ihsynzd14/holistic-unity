import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { logAdminAction } from "@/lib/auth/audit";
import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Defense-in-depth: ADMIN_EMAILS env AND users.is_admin DB flag.
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  // Use service_role to bypass RLS and the protect_therapist_admin_columns trigger
  const admin = createAdminClient();

  const { error } = await admin
    .from("therapist_profiles")
    .update({
      approval_status: "approved",
      is_approved: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("Approve error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Assign the stable public slug now that the therapist is approved.
  // The DB trigger also fills it during the update above; this explicit
  // RPC is idempotent (no-ops when a slug already exists) and returns the
  // value for the audit log + response. Non-fatal — approval already
  // succeeded.
  let slug: string | null = null;
  {
    const { data: slugData, error: slugErr } = await admin.rpc(
      "assign_therapist_slug",
      { p_id: id },
    );
    if (slugErr) {
      console.warn("Slug assignment failed (non-blocking):", slugErr);
    } else {
      slug = (slugData as string | null) ?? null;
    }
  }

  // ─── Brevo: Notify therapist + sync contact (non-blocking) ──────
  try {
    // Send "Therapist Approved" email via send-brevo-email Edge Function
    await fetch(`${SUPABASE_URL}/functions/v1/send-brevo-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: 7, // BREVO_TEMPLATES.THERAPIST_APPROVED
        user_id: id,
        params: { approval_status: "approved" },
        tags: ["therapist_approved"],
      }),
    });

    // Sync contact to Brevo (updates list to THERAPISTS_APPROVED)
    await fetch(`${SUPABASE_URL}/functions/v1/sync-brevo-contact`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: id,
        event: "therapist_approved",
      }),
    });
  } catch (brevoErr) {
    console.warn("Brevo notification failed (non-blocking):", brevoErr);
  }

  // Audit trail — best-effort, doesn't block the response
  await logAdminAction({
    request,
    adminUserId: auth.user.id,
    adminEmail: auth.user.email,
    action: "therapist.approve",
    targetTable: "therapist_profiles",
    targetId: id,
    details: { from: "pending_review", to: "approved", slug },
  });

  return NextResponse.json({ success: true, status: "approved", slug });
}
