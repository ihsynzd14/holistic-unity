import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/reschedule-request
 * Body: {
 *   proposed_scheduled_at: string  (ISO timestamp, must be >= 24h from now),
 *   reason?: string                (optional context for the therapist)
 * }
 *
 * Client-initiated reschedule. Mirror of the therapist /reschedule
 * endpoint with these differences:
 *   1. **Auth**: caller must be the booking's `client_id`.
 *   2. **No reliability gate** — clients don't accumulate the 30d
 *      cancellation rate metric that gates therapists.
 *   3. **>= 24h advance notice** instead of >= 1h. Reason: a <24h
 *      reschedule would let the client dodge the 50% cancellation fee
 *      that kicks in 24-48h before session (see
 *      docs/flows/08-refund-cancellation.md). Forcing 24h closes that
 *      loophole.
 *   4. **Timeout = revert, not cancel**. If the therapist doesn't
 *      respond within 24h, the booking REVERTS to `confirmed` (the
 *      original time still stands). It is NOT auto-cancelled with a
 *      100% refund — that would let clients game free cancellations
 *      by proposing impossible times. If the client really can't make
 *      the original slot, they cancel under the standard tiered policy.
 *      The cron that does this is in
 *      `supabase/migrations/20260427120000_reschedule_pending_lifecycle.sql`.
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

  // Rate limit: 10 reschedule attempts per hour per client.
  // Genuine need is rare (1-2 per booking max); higher = abuse OR a
  // confused user. The shared `reschedule_count < 3` per-booking gate
  // below is the real anti-abuse — this is just an extra safety net.
  const limit = await withRateLimit(request, {
    key: "client-reschedule-request",
    max: 10,
    windowSec: 3600,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const body = await request.json().catch(() => ({}));
  const proposedAtRaw = body?.proposed_scheduled_at;
  if (!proposedAtRaw || typeof proposedAtRaw !== "string") {
    return NextResponse.json(
      { error: "Indica il nuovo orario proposto" },
      { status: 400 },
    );
  }
  const proposedAt = new Date(proposedAtRaw);
  if (isNaN(proposedAt.getTime())) {
    return NextResponse.json({ error: "Orario non valido" }, { status: 400 });
  }
  // 24h minimum: aligns with the cancellation-policy threshold so
  // clients can't use reschedule to bypass the 50% fee.
  if (proposedAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "Il nuovo orario deve essere almeno 24 ore nel futuro" },
      { status: 400 },
    );
  }

  const reason = typeof body?.reason === "string"
    ? body.reason.trim().slice(0, 500)
    : "";

  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, scheduled_at, reschedule_count")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.client_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  // `confirmed` only — cannot stack on top of an existing
  // reschedule_pending (resolve that one first), and cannot reschedule
  // a not-yet-paid booking.
  if (booking.status !== "confirmed") {
    return NextResponse.json(
      { error: "Puoi richiedere la riprogrammazione solo su prenotazioni confermate" },
      { status: 409 },
    );
  }

  // Shared with therapist endpoint — total reschedules across both
  // parties cannot exceed 3 per booking. Beyond that the booking is
  // probably broken; cancel and re-book.
  if ((booking.reschedule_count ?? 0) >= 3) {
    return NextResponse.json(
      {
        error:
          "Questa sessione \u00e8 gi\u00e0 stata riprogrammata 3 volte. Cancella e prendi un nuovo appuntamento.",
      },
      { status: 409 },
    );
  }

  // Atomic transition: confirmed -> reschedule_pending with proposed time
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "reschedule_pending",
      proposed_scheduled_at: proposedAt.toISOString(),
      reschedule_proposed_by: "client",
      reschedule_proposed_at: new Date().toISOString(),
      cancellation_reason: reason || null,
    })
    .eq("id", booking.id)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: "Aggiornamento fallito o stato gi\u00e0 cambiato" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    proposed_scheduled_at: proposedAt.toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
}
