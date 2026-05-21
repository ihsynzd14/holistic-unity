import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/reschedule/respond
 * Body: { action: 'accept' | 'reject' }
 *
 * Client responds to a therapist-proposed reschedule. The booking
 * was put into `reschedule_pending` by the therapist with a
 * `proposed_scheduled_at` set; this route either:
 *   - **accept**: moves `scheduled_at = proposed_scheduled_at`,
 *     status -> `confirmed`, increments `reschedule_count`. The
 *     payment intent stays put (no money changes hands — the same
 *     session, just at a different time).
 *   - **reject**: triggers full-refund cancellation (same logic as
 *     therapist cancel: 100% refund, status -> cancelled, audit
 *     fields recorded with `cancelled_by='client'` because *the
 *     client* explicitly chose to cancel rather than accept the new
 *     time, BUT cancellation_category='conflitto_agenda' so admin
 *     can trace it back to a therapist-initiated reschedule).
 *
 * If the client never responds, a separate pg_cron job (24h after
 * `reschedule_proposed_at`) auto-cancels with `cancelled_by='system'`.
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

  const rl = await withRateLimit(request, {
    key: "reschedule-respond",
    max: 30,
    windowSec: 3600,
    userId: user.id,
  });
  if (rl.response) return rl.response;

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json(
      { error: "Azione non valida (accept | reject)" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(
      "id, client_id, therapist_id, status, scheduled_at, proposed_scheduled_at, reschedule_count, stripe_payment_intent_id, service_name",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.client_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  if (booking.status !== "reschedule_pending") {
    return NextResponse.json(
      { error: "Questa sessione non ha una proposta di riprogrammazione attiva" },
      { status: 409 },
    );
  }

  if (action === "accept") {
    if (!booking.proposed_scheduled_at) {
      return NextResponse.json(
        { error: "Nessun nuovo orario proposto" },
        { status: 409 },
      );
    }
    const { data: updated, error: updateErr } = await admin
      .from("bookings")
      .update({
        status: "confirmed",
        scheduled_at: booking.proposed_scheduled_at,
        reschedule_count: (booking.reschedule_count ?? 0) + 1,
        proposed_scheduled_at: null,
        reschedule_proposed_by: null,
        reschedule_proposed_at: null,
      })
      .eq("id", booking.id)
      .eq("status", "reschedule_pending")
      .select("id, scheduled_at")
      .maybeSingle();

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: "Aggiornamento fallito" },
        { status: 500 },
      );
    }

    // Notify the therapist (in-app + email) that the client accepted.
    await notifyTherapistOfRescheduleResponse(admin, {
      bookingId: booking.id,
      clientId: booking.client_id,
      therapistId: booking.therapist_id,
      action: "accepted",
      newScheduledAt: updated.scheduled_at,
      serviceName: booking.service_name ?? null,
    });

    return NextResponse.json({ success: true, action: "accepted", new_scheduled_at: updated.scheduled_at });
  }

  // ── action === "reject" → full refund + cancel ──
  // Same race-safe pattern as /api/bookings/[id]/cancel: UPDATE FIRST
  // so two concurrent rejects can't both call stripe.refunds.create.
  // Only the winning UPDATE proceeds to Stripe; loser gets 409.
  const noticeHrs = Math.max(
    0,
    Math.floor(
      (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000),
    ),
  );

  const { data: cancelled, error: cancelErr } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: "Cliente ha rifiutato la proposta di riprogrammazione",
      cancellation_category: "conflitto_agenda",
      cancelled_by: "client",
      cancelled_at: new Date().toISOString(),
      cancellation_notice_hrs: noticeHrs,
      proposed_scheduled_at: null,
      reschedule_proposed_by: null,
      reschedule_proposed_at: null,
    })
    .eq("id", booking.id)
    .eq("status", "reschedule_pending")
    .select("id")
    .maybeSingle();

  if (cancelErr) {
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!cancelled) {
    return NextResponse.json(
      { error: "Lo stato della prenotazione \u00e8 cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  // Helper to revert the cancellation if Stripe fails for transient
  // reasons. We restore the original `reschedule_pending` state so the
  // client can retry without losing the proposal.
  async function revertReschedulePending() {
    await admin
      .from("bookings")
      .update({
        status: "reschedule_pending",
        cancellation_reason: null,
        cancellation_category: null,
        cancelled_by: null,
        cancelled_at: null,
        cancellation_notice_hrs: null,
        proposed_scheduled_at: booking!.proposed_scheduled_at,
        // Note: reschedule_proposed_by and reschedule_proposed_at are
        // not restored — they were consumed by the original therapist
        // proposal. The booking reverts to the same proposal state
        // because proposed_scheduled_at carries the proposed time.
      })
      .eq("id", booking!.id);
  }

  let refundId: string | null = null;
  let refundAmountCents = 0;
  if (booking.stripe_payment_intent_id) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      await revertReschedulePending();
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
          booking_id: booking.id,
          cancelled_by: "client",
          category: "conflitto_agenda",
          context: "rejected_therapist_reschedule",
        },
      });
      refundId = refund.id;
      refundAmountCents = refund.amount;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Refund failed";
      const alreadyRefunded =
        msg.includes("already") && msg.toLowerCase().includes("refund");
      console.error("[client/reschedule-respond] Stripe refund failed:", msg);
      if (!alreadyRefunded) {
        await revertReschedulePending();
        return NextResponse.json(
          { error: "Impossibile processare il rimborso. Contatta il supporto." },
          { status: 502 },
        );
      }
      // Already refunded → DB and Stripe consistent; keep cancellation.
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
      .eq("booking_id", booking.id);
  }

  // Notify the therapist (in-app + email) that the client rejected and
  // the booking has been cancelled with full refund.
  await notifyTherapistOfRescheduleResponse(admin, {
    bookingId: booking.id,
    clientId: booking.client_id,
    therapistId: booking.therapist_id,
    action: "rejected",
    newScheduledAt: null,
    serviceName: booking.service_name ?? null,
    refundAmount: refundAmountCents / 100,
  });

  return NextResponse.json({
    success: true,
    action: "rejected",
    refunded: refundId !== null,
    refundAmount: refundAmountCents / 100,
  });
}

/**
 * Inserts an in-app notification for the therapist and queues a Brevo
 * email (template 12 — RESCHEDULE_RESPONDED). The Brevo template will
 * be configured later; until then the email send fails silently
 * inside Promise.allSettled (no impact on the response).
 */
async function notifyTherapistOfRescheduleResponse(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    bookingId: string;
    clientId: string;
    therapistId: string;
    action: "accepted" | "rejected";
    newScheduledAt: string | null;
    serviceName: string | null;
    refundAmount?: number;
  },
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const TPL_RESCHEDULE_RESPONDED = 27;

  const { data: clientRow } = await admin
    .from("users")
    .select("display_name")
    .eq("id", args.clientId)
    .maybeSingle();
  const clientName = clientRow?.display_name ?? "Il cliente";

  const TZ = "Europe/Rome";
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("it-IT", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: TZ,
      }),
      time: d.toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: TZ,
      }),
    };
  };

  const newFmt = args.newScheduledAt ? fmt(args.newScheduledAt) : null;
  const accepted = args.action === "accepted";

  const title = accepted
    ? "Riprogrammazione accettata"
    : "Riprogrammazione rifiutata";
  const body = accepted
    ? `${clientName} ha accettato la nuova data per "${args.serviceName ?? "la sessione"}": ${newFmt!.date} ${newFmt!.time}.`
    : `${clientName} ha rifiutato la proposta di riprogrammazione per "${args.serviceName ?? "la sessione"}". La sessione è stata cancellata con rimborso del 100%${args.refundAmount ? ` (€${args.refundAmount.toFixed(2).replace(".", ",")})` : ""}.`;

  await Promise.allSettled([
    admin.from("notifications").insert({
      user_id: args.therapistId,
      type: accepted ? "reschedule_accepted" : "reschedule_rejected",
      title,
      body,
      booking_id: args.bookingId,
      client_id: args.clientId,
    }),
    fetch(`${supabaseUrl}/functions/v1/send-brevo-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: TPL_RESCHEDULE_RESPONDED,
        user_id: args.therapistId,
        params: {
          client_name: clientName,
          service_name: args.serviceName ?? "Sessione",
          action: accepted ? "accettata" : "rifiutata",
          new_session_date: newFmt?.date ?? "",
          new_session_time: newFmt?.time ?? "",
          refund_amount: args.refundAmount
            ? `€ ${args.refundAmount.toFixed(2).replace(".", ",")}`
            : "",
          booking_id: args.bookingId,
        },
        tags: ["reschedule_responded"],
      }),
    }).catch((err) => {
      console.warn("[reschedule/respond] brevo send failed (non-blocking):", err);
    }),
  ]);
}
