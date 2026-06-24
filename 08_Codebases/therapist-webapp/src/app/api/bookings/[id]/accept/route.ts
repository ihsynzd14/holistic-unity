import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/accept
 *
 * Therapist accepts an incoming booking that's currently in `pending`.
 * Replaces the previous client-side direct-DB update which had no
 * server-side validation, no audit trail, and no notification side
 * effects (the client never knew the booking was accepted unless they
 * polled their dashboard).
 *
 * Server-side checks:
 *   1. Auth: must be the booking's therapist
 *   2. State: only `pending` can be accepted; once a booking is paid
 *      it's already `confirmed` (Edge Function flips it via Stripe
 *      webhook), so accepting an already-confirmed booking is a no-op.
 *   3. Atomic optimistic-locked UPDATE so a double-tap doesn't fire
 *      two client notifications.
 *
 * Side effects:
 *   - Generates `video_room_id` if missing (deterministic from
 *     bookingId so we don't break the rare race with Edge Function
 *     `payment_intent.succeeded` writing the same room id).
 *   - Inserts a `notifications` row for the client ("Sessione confermata").
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: bookingId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const limit = await withRateLimit(request, {
    key: "therapist-accept-booking",
    max: 30,
    windowSec: 3600,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, video_room_id, scheduled_at, service_name, duration")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }
  if (booking.status !== "pending") {
    return NextResponse.json(
      { error: "Questa sessione non può essere accettata in questo stato" },
      { status: 409 },
    );
  }

  const videoRoom =
    booking.video_room_id ?? `hu-${bookingId.replace(/-/g, "").slice(0, 16)}`;

  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({ status: "confirmed", video_room_id: videoRoom })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateErr) {
    console.error("[booking/accept] update failed:", updateErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Lo stato della prenotazione è cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  // Best-effort client notification. Failure here doesn't block —
  // the booking is already accepted in the DB. Earlier code passed a
  // non-existent `metadata` column which silently failed; switched to
  // canonical columns matching the schema (booking_id + therapist_id
  // top-level).
  const { error: notifErr } = await admin.from("notifications").insert({
    user_id: booking.client_id,
    type: "booking_confirmed",
    title: "Sessione confermata",
    body: `La tua sessione è stata accettata dall'operatore.`,
    booking_id: bookingId,
    therapist_id: booking.therapist_id,
  });
  if (notifErr) console.error("[booking/accept] notification insert failed:", notifErr);

  return NextResponse.json({ success: true, video_room_id: videoRoom });
}
