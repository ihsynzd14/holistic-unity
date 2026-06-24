import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/decline
 * Body: { reason?: string }
 *
 * Therapist declines an incoming booking. Replaces the previous
 * client-side direct-DB update which had a critical bug: if the
 * booking was already paid (status="confirmed", which can happen on
 * fast Stripe webhooks before the therapist had a chance to review),
 * the decline would just flip status to `cancelled` WITHOUT issuing
 * a Stripe refund — the client's money would stay stuck in the
 * platform Connect account indefinitely.
 *
 * Behaviour:
 *   - `pending` (no payment yet): just flip status → cancelled
 *   - `confirmed` (paid): atomic UPDATE → 100% Stripe refund (same
 *     logic as the therapist cancel route), with revert on Stripe
 *     failure
 *
 * Side effects:
 *   - Notification to the client (with reason if provided)
 *   - Audit fields recorded (`cancelled_by="therapist"`)
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
    key: "therapist-decline-booking",
    max: 20,
    windowSec: 3600,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const body = await request.json().catch(() => ({}));
  const reason: string =
    typeof body?.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : "Rifiutato dall'operatore";

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, scheduled_at, stripe_payment_intent_id, price")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  // Only pending or already-confirmed (paid) can be declined here. For
  // confirmed bookings further into their lifecycle (in_progress,
  // completed) the therapist has to use the cancel route which has the
  // reliability gate.
  const DECLINABLE = new Set(["pending", "confirmed", "pending_payment"]);
  if (!DECLINABLE.has(booking.status)) {
    return NextResponse.json(
      { error: "Questa sessione non può essere rifiutata in questo stato" },
      { status: 409 },
    );
  }

  const noticeHrs = Math.floor(
    (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000),
  );
  const wasConfirmed = booking.status === "confirmed";

  // Atomic optimistic flip first.
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: reason,
      cancelled_by: "therapist",
      cancelled_at: new Date().toISOString(),
      cancellation_notice_hrs: noticeHrs,
    })
    .eq("id", bookingId)
    .in("status", Array.from(DECLINABLE))
    .select("id")
    .maybeSingle();

  if (updateErr) {
    console.error("[booking/decline] update failed:", updateErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Lo stato della prenotazione è cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  async function revertDecline() {
    await admin
      .from("bookings")
      .update({
        status: booking!.status,
        cancellation_reason: null,
        cancelled_by: null,
        cancelled_at: null,
        cancellation_notice_hrs: null,
      })
      .eq("id", booking!.id);
  }

  // Refund 100% if the booking was already paid.
  let refundId: string | null = null;
  let refundAmountCents = 0;
  if (wasConfirmed && booking.stripe_payment_intent_id) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      await revertDecline();
      return NextResponse.json(
        { error: "Server payments non configurato" },
        { status: 500 },
      );
    }
    try {
      const stripe = new Stripe(stripeKey);
      const refund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: {
          booking_id: bookingId,
          cancelled_by: "therapist",
          context: "decline_pending",
          reason: reason.slice(0, 200),
        },
      });
      refundId = refund.id;
      refundAmountCents = refund.amount;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Refund failed";
      const alreadyRefunded =
        msg.includes("already") && msg.toLowerCase().includes("refund");
      console.error("[booking/decline] Stripe refund failed:", msg);
      if (!alreadyRefunded) {
        await revertDecline();
        return NextResponse.json(
          { error: "Impossibile processare il rimborso. Riprova o contatta il supporto." },
          { status: 502 },
        );
      }
    }
  }

  if (refundId) {
    await admin
      .from("transactions")
      .update({
        refund_amount: refundAmountCents / 100,
        payout_status: "refunded",
        status: "refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("booking_id", bookingId);
  }

  // Best-effort client notification. Schema uses canonical top-level
  // columns (booking_id + therapist_id); the previous `metadata` column
  // didn't exist, so the insert silently failed and the client was
  // never told their booking was rejected.
  const { error: notifErr } = await admin.from("notifications").insert({
    user_id: booking.client_id,
    type: "booking_cancelled",
    title: "Sessione rifiutata",
    body: refundId
      ? `L'operatore ha rifiutato la sessione. Il rimborso è stato processato.`
      : `L'operatore ha rifiutato la sessione.${reason ? ` Motivo: ${reason}` : ""}`,
    booking_id: bookingId,
    therapist_id: booking.therapist_id,
  });
  if (notifErr) console.error("[booking/decline] notification insert failed:", notifErr);

  return NextResponse.json({
    success: true,
    refunded: refundId !== null,
    refundAmount: refundAmountCents / 100,
  });
}
