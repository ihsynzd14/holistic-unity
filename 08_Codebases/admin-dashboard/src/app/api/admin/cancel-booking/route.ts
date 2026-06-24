import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { logAdminAction } from "@/lib/auth/audit";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/cancel-booking
 * Admin emergency cancellation of a booking.
 * Body: { bookingId: string }
 */
export async function POST(request: NextRequest) {
  // Defense-in-depth: ADMIN_EMAILS env whitelist AND users.is_admin DB flag.
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = await request.json();
  const { bookingId } = body;

  if (!bookingId) {
    return NextResponse.json(
      { error: "bookingId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Read scheduled_at for the cancellation_notice_hrs audit field
  // before flipping. Best-effort — if the row is gone we still attempt
  // the cancel for idempotency.
  const { data: existing } = await admin
    .from("bookings")
    .select("scheduled_at")
    .eq("id", bookingId)
    .maybeSingle();
  const noticeHrs = existing?.scheduled_at
    ? Math.max(
        0,
        Math.floor(
          (new Date(existing.scheduled_at).getTime() - Date.now()) /
            (60 * 60 * 1000),
        ),
      )
    : null;

  const { error } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: "Cancelled by admin",
      cancelled_by: "admin",
      cancelled_at: new Date().toISOString(),
      cancellation_notice_hrs: noticeHrs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .in("status", ["pending", "pending_payment", "confirmed", "reschedule_pending"]);

  if (error) {
    console.error("Cancel booking error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit trail — admin emergency cancellations must be traceable.
  await logAdminAction({
    request,
    adminUserId: auth.user.id,
    adminEmail: auth.user.email,
    action: "booking.cancel",
    targetTable: "bookings",
    targetId: bookingId,
    details: { reason: "Cancelled by admin", notice_hrs: noticeHrs },
  });

  return NextResponse.json({ success: true });
}
