import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { isJoinWindowOpen } from "@/lib/booking/join-window";

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
 *   3. State machine: `confirmed` or `reschedule_pending` bookings can
 *      always be flipped to `in_progress`. Already `in_progress` is a
 *      no-op (200 with the same video_room_id) so the UI can re-arm
 *      without an error. A `completed` booking can ALSO be re-entered,
 *      but only inside the same 3h join window as the LiveKit token
 *      route (`isJoinWindowOpen`) — this is what the sessions list's
 *      "Rejoin Session" affordance (`isCompletedWithinGrace`) has
 *      promised since it shipped, but this route never actually
 *      allowed it, so the button 409'd every time someone hit it (e.g.
 *      after ending a session early because the other side hadn't
 *      joined yet). Re-validated server-side, never trusted from the
 *      client.
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
    .select("id, therapist_id, status, video_room_id, scheduled_at")
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

  // A `completed` booking can be re-entered within the same 3h join
  // window everything else respects — covers ending a session early
  // (e.g. the other side hadn't joined yet) and unblocks the "Rejoin
  // Session" button the sessions list already shows for this exact case.
  const canReenterCompleted =
    booking.status === "completed" && isJoinWindowOpen(booking.scheduled_at);

  if (
    !STARTABLE_STATUSES.includes(booking.status as (typeof STARTABLE_STATUSES)[number]) &&
    !canReenterCompleted
  ) {
    const error =
      booking.status === "completed"
        ? "La sessione è stata completata e la finestra di rientro di 3 ore è scaduta."
        : `Stato non valido per avviare la sessione: ${booking.status}`;
    return NextResponse.json({ error }, { status: 409 });
  }

  const room =
    booking.video_room_id || `hu-${booking.id.replace(/-/g, "").slice(0, 16)}`;
  const allowedSourceStatuses = canReenterCompleted
    ? [...STARTABLE_STATUSES, "completed"]
    : [...STARTABLE_STATUSES];

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
    .in("status", allowedSourceStatuses)
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
