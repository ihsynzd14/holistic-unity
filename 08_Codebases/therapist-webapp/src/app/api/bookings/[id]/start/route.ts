import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

const STARTABLE_STATUSES = ["confirmed", "reschedule_pending"] as const;

/**
 * POST /api/bookings/[id]/start
 *
 * Therapist marks a booking as `in_progress` when entering the video
 * call. Replaces the previous client-side direct DB update from
 * `/dashboard/sessions/page.tsx` which had:
 *   - no auth check (relied solely on RLS — defense-in-depth gap)
 *   - no rate limit
 *   - no optimistic locking (`eq("status", "confirmed")` was missing,
 *     so a `completed` or `cancelled` row could be flipped back to
 *     `in_progress`)
 *   - no audit trail
 *
 * Server-side checks:
 *   1. Auth: must be logged in.
 *   2. Authorisation: caller must be the booking's `therapist_id`.
 *   3. State machine: only `confirmed` or `reschedule_pending` bookings
 *      can be flipped to `in_progress`. Already `in_progress` is a no-op
 *      (200 with the same video_room_id) so the UI can re-arm without an error.
 *   4. video_room_id is preserved if already set; only filled in if
 *      missing (legacy bookings created before the webhook backfilled).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: bookingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    return NextResponse.json({ error: "Invalid booking id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const rl = await withRateLimit(request, {
    key: "booking-start",
    max: 60,
    windowSec: 3600,
    userId: user.id,
  });
  if (rl.response) return rl.response;

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, therapist_id, status, video_room_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  // Idempotent for already-in-progress bookings.
  if (booking.status === "in_progress") {
    return NextResponse.json({
      success: true,
      already_in_progress: true,
      video_room_id: booking.video_room_id,
    });
  }

  if (!STARTABLE_STATUSES.includes(booking.status as (typeof STARTABLE_STATUSES)[number])) {
    return NextResponse.json(
      { error: `Stato non valido per avviare la sessione: ${booking.status}` },
      { status: 409 },
    );
  }

  const room =
    booking.video_room_id || `hu-${booking.id.replace(/-/g, "").slice(0, 16)}`;

  const { data: updated, error: upErr } = await admin
    .from("bookings")
    .update({
      status: "in_progress",
      video_room_id: room,
      proposed_scheduled_at: null,
      reschedule_proposed_at: null,
      reschedule_proposed_by: null,
    })
    .eq("id", booking.id)
    .in("status", [...STARTABLE_STATUSES])
    .select("id, video_room_id")
    .maybeSingle();

  if (upErr) {
    console.error("[booking/start] update failed:", upErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Lo stato della sessione è cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    video_room_id: updated.video_room_id,
  });
}
