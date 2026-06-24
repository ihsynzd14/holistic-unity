import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/bookings/[id]/complete
 *
 * Marks a booking as `completed`. Called when the therapist clicks
 * "End session" inside the video call page.
 *
 * Server-side checks (NOT trusting only RLS):
 *   1. Auth: must be logged in.
 *   2. Authorisation: caller must be the booking's `therapist_id`. The
 *      client cannot complete sessions \u2014 that would let an authenticated
 *      user short-circuit the payout escrow window by marking arbitrary
 *      bookings completed if they guessed the UUID, AND would let a
 *      client prematurely end (and trigger payout for) a future session
 *      that hasn't actually been delivered.
 *   3. State machine: booking must be `confirmed` or `in_progress`. We
 *      refuse `pending`, `pending_payment`, `cancelled`, `no_show`, or
 *      already `completed`.
 *
 * Mirrors `client-webapp/src/app/api/bookings/[id]/complete/route.ts`
 * exactly so both portals close sessions the same way. Earlier the
 * therapist-webapp version was more permissive (accepted client_id OR
 * therapist_id) \u2014 that asymmetry was the actual bug; the client-webapp
 * route has always been therapist-only.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: bookingId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: booking, error: lookupErr } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (lookupErr || !booking) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  // Authorisation: only the booking's therapist may complete it.
  // Returning 404 (not 403) prevents probing whether a given booking
  // UUID exists when the caller isn't the assigned therapist.
  if (booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  const COMPLETABLE = new Set(["confirmed", "in_progress"]);
  if (!COMPLETABLE.has(booking.status)) {
    return NextResponse.json(
      { error: "Stato non valido per completamento" },
      { status: 409 },
    );
  }

  // Optimistic-locked update \u2014 only flip from confirmed/in_progress to
  // completed. Prevents marking a cancelled booking as completed
  // (which would unlock the payout escrow on a refunded session).
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({ status: "completed" })
    .eq("id", booking.id)
    .in("status", Array.from(COMPLETABLE))
    .select("id")
    .maybeSingle();

  if (updateErr) {
    console.error("[bookings/complete] update failed:", updateErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Lo stato della prenotazione \u00e8 cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true });
}
