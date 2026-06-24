import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/cancel
 * Body: {
 *   category: 'emergenza_salute' | 'imprevisto_familiare' | 'conflitto_agenda' | 'forza_maggiore' | 'altro',
 *   reason:   string  (>= 30 chars, mandatory friction so the therapist thinks before clicking),
 * }
 *
 * Therapist-initiated cancellation. Differs from the client cancel
 * route in 3 important ways:
 *   1. **Always 100% refund** to the client, regardless of how close
 *      we are to scheduled_at. The client didn't cause this — the
 *      therapist did — so they shouldn't bear any cost.
 *   2. **Reliability gate**: if the therapist's 30-day cancellation
 *      rate is >= 20% (`reliability_tier = 'high'` or `'critical'`),
 *      the cancel is rejected and they're told to contact support.
 *      This is the platform's anti-abuse mechanism — see Sez. 7.1 of
 *      the therapist contract on "unavailability".
 *   3. **Audit trail**: writes `cancelled_by='therapist' + cancelled_at
 *      + cancellation_notice_hrs + cancellation_category + reason` so
 *      admin can spot patterns (e.g. always cancelling <1h before).
 *
 * Notes:
 *   - Free bookings (no payment_intent) just flip status, no refund.
 *   - Pack bookings: only this single session is refunded; the rest
 *     of the pack stays. The client can rebook with anyone.
 *   - The video room is unaffected — the booking still exists in
 *     `cancelled` state for both portals.
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

  // Rate limit: 10 cancel attempts per hour per therapist. Genuine
  // need is 0-3/month; higher = abuse OR something is wrong (UI bug?
  // Therapist double-clicking?). The reliability gate below is the
  // real anti-abuse — this is just an extra safety net.
  const limit = await withRateLimit(request, {
    key: "therapist-cancel",
    max: 10,
    windowSec: 3600,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const body = await request.json().catch(() => ({}));
  const VALID_CATEGORIES = [
    "emergenza_salute",
    "imprevisto_familiare",
    "conflitto_agenda",
    "forza_maggiore",
    "altro",
  ] as const;
  const category = body?.category;
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: "Seleziona una categoria valida per la cancellazione" },
      { status: 400 },
    );
  }
  const rawReason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (rawReason.length < 30) {
    return NextResponse.json(
      { error: "Spiega brevemente il motivo (almeno 30 caratteri)" },
      { status: 400 },
    );
  }
  const reason = rawReason.slice(0, 1000);

  const admin = createAdminClient();

  // Look up the booking + verify ownership FIRST. We do this before the
  // reliability gate so the gate's response (which leaks the therapist's
  // own reliability tier) doesn't fire on bookings they don't own — that
  // would let a therapist probe arbitrary booking UUIDs to see their own
  // tier without referring to a real session of theirs.
  const { data: booking, error: lookupErr } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, stripe_payment_intent_id, price, currency, scheduled_at, duration, service_name")
    .eq("id", bookingId)
    .maybeSingle();

  if (lookupErr || !booking) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  if (booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  const CANCELLABLE_STATUSES = new Set([
    "pending",
    "pending_payment",
    "confirmed",
    "reschedule_pending",
  ]);
  if (!CANCELLABLE_STATUSES.has(booking.status)) {
    return NextResponse.json(
      { error: "Questa sessione non pu\u00f2 essere cancellata in questo stato." },
      { status: 409 },
    );
  }

  // Reliability gate — block if 30d cancel rate >= 20%. Runs AFTER the
  // ownership check so the response only fires for the therapist's own
  // bookings (see comment above). LIVE function instead of the
  // materialized view so we see the latest state.
  const { data: reliabilityRows } = await admin
    .rpc("get_therapist_reliability", { p_therapist_id: user.id });
  const reliability = reliabilityRows?.[0];
  if (reliability && (reliability.reliability_tier === "high" || reliability.reliability_tier === "critical")) {
    return NextResponse.json(
      {
        error:
          "Hai superato la soglia di cancellazioni consentite (20% negli ultimi 30 giorni). " +
          "Per cancellare questa sessione contatta il supporto a support@holisticunity.app — " +
          "valuteremo insieme la situazione.",
        reliability,
      },
      { status: 403 },
    );
  }

  // Notice in hours: positive = preavviso, negative = past start.
  const noticeHrs = Math.floor(
    (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000),
  );

  // STEP 1 — Atomic optimistic-locked status flip BEFORE any Stripe call.
  // This locks the booking so two concurrent cancel requests can't both
  // race into stripe.refunds.create. Without the early lock, the second
  // request gets a duplicate-refund error from Stripe and returns 502
  // even though the cancellation logically succeeded.
  // We initially write `requires_manual_refund=false`; if the refund
  // detection logic later flags it, we update those columns separately.
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: reason,
      cancellation_category: category,
      cancelled_by: "therapist",
      cancelled_at: new Date().toISOString(),
      cancellation_notice_hrs: noticeHrs,
    })
    .eq("id", booking.id)
    .in("status", Array.from(CANCELLABLE_STATUSES))
    .select("id")
    .maybeSingle();

  if (updateErr) {
    console.error("[therapist/cancel] update failed:", updateErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Lo stato della prenotazione \u00e8 cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  // Helper: revert the atomic flip if refund fails for transient reasons.
  // Audit columns are cleared so we don't leave a half-cancelled record.
  async function revertCancellation() {
    await admin
      .from("bookings")
      .update({
        status: booking!.status,
        cancellation_reason: null,
        cancellation_category: null,
        cancelled_by: null,
        cancelled_at: null,
        cancellation_notice_hrs: null,
      })
      .eq("id", booking!.id);
  }

  // STEP 2 — Therapist always refunds 100%. Failure here is rare; if it
  // happens we revert the atomic cancellation and tell the user to retry
  // (unless the failure is "already refunded", in which case DB and
  // Stripe are actually consistent — keep the cancellation).
  let refundId: string | null = null;
  let refundAmountCents = 0;
  let requiresManualRefund = false;
  let manualRefundNote: string | null = null;
  if (booking.stripe_payment_intent_id && booking.status === "confirmed") {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error("[therapist/cancel] STRIPE_SECRET_KEY not set; cannot refund");
      await revertCancellation();
      return NextResponse.json(
        { error: "Server payments non configurato" },
        { status: 500 },
      );
    }
    try {
      const stripe = new Stripe(stripeKey);

      // Detect post-payout window before refund. PaymentIntent.created
      // is Stripe-authoritative.
      const pi = await stripe.paymentIntents.retrieve(
        booking.stripe_payment_intent_id,
      );
      const chargeAgeDays =
        (Date.now() - pi.created * 1000) / (24 * 60 * 60 * 1000);
      const PAYOUT_HOLD_DAYS = 14;
      const isPostPayout = chargeAgeDays > PAYOUT_HOLD_DAYS;

      const refund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: {
          booking_id: booking.id,
          cancelled_by: "therapist",
          category,
          notice_hrs: String(noticeHrs),
          reason: reason.slice(0, 200),
          charge_age_days: chargeAgeDays.toFixed(1),
        },
      });
      refundId = refund.id;
      refundAmountCents = refund.amount;

      // Flag manual review for post-payout, non-success status, or short refund.
      const expectedCents = Math.round(Number(booking.price) * 100);
      if (isPostPayout) {
        requiresManualRefund = true;
        manualRefundNote =
          `Refund issued ${chargeAgeDays.toFixed(1)} days after charge ` +
          `(payout-hold window is ${PAYOUT_HOLD_DAYS}d). Verify the ` +
          `connected account did not end up with a negative balance.`;
      } else if (refund.status !== "succeeded") {
        requiresManualRefund = true;
        manualRefundNote = `Stripe refund status is "${refund.status}" — verify completion.`;
      } else if (refund.amount < expectedCents) {
        requiresManualRefund = true;
        manualRefundNote =
          `Refunded ${refund.amount}¢ but client paid ${expectedCents}¢ — ` +
          `${expectedCents - refund.amount}¢ short. Verify partial refund.`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Refund failed";
      const alreadyRefunded =
        msg.includes("already") && msg.toLowerCase().includes("refund");
      console.error("[therapist/cancel] Stripe refund failed:", msg);
      if (!alreadyRefunded) {
        await revertCancellation();
        return NextResponse.json(
          { error: "Impossibile processare il rimborso. Riprova o contatta il supporto." },
          { status: 502 },
        );
      }
      // already_refunded: DB and Stripe are consistent. Continue without
      // touching transactions.refund_amount (preserve whatever was there).
    }
  }

  // Update the manual-refund flags now that the refund completed.
  if (requiresManualRefund) {
    await admin
      .from("bookings")
      .update({
        requires_manual_refund: true,
        manual_refund_note: manualRefundNote,
      })
      .eq("id", booking.id);
  }

  // Reflect the refund on the transactions row so the admin dashboard
  // and the client/therapist earnings views see it as fully refunded.
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

  // Fire in-app notifications + transactional emails for both parties.
  // Mirrors notifyBookingCancelled() in client-webapp/cancel/route.ts —
  // therapist-initiated cancellation gets the client a "your therapist
  // cancelled" message and the therapist a self-service receipt. Best-
  // effort: errors logged but never thrown, so the HTTP response is
  // unaffected by Brevo/DB flakiness. We MUST await (not fire-and-forget)
  // because serverless functions kill in-flight promises after the
  // response is sent, dropping the notification inserts.
  await notifyTherapistInitiatedCancellation(admin, {
    bookingId: booking.id,
    clientId: booking.client_id,
    therapistId: booking.therapist_id,
    scheduledAt: booking.scheduled_at,
    serviceName: booking.service_name ?? null,
    refundAmount: refundAmountCents / 100,
    category,
    reason,
    noticeHrs,
  });

  // Re-fetch reliability AFTER the cancellation so the response can
  // tell the therapist their new rate (used by the UI to show "this
  // was your N-th cancellation, your rate is now X%").
  const { data: postReliabilityRows } = await admin
    .rpc("get_therapist_reliability", { p_therapist_id: user.id });
  const postReliability = postReliabilityRows?.[0];

  return NextResponse.json({
    success: true,
    refunded: refundId !== null,
    refundAmount: refundAmountCents / 100,
    notice_hrs: noticeHrs,
    reliability: postReliability,
  });
}

/**
 * Inserts two in-app notifications (client + therapist) and sends two
 * Brevo emails (template 9 — CANCELLATION_CONFIRMATION) when a therapist
 * cancels a booking. Mirror of client-webapp's notifyBookingCancelled()
 * but with role-aware copy:
 *   - Client gets "Il terapista ha annullato" + 100% refund details.
 *   - Therapist gets a self-service receipt with notice_hrs + category
 *     (useful audit trail when reliability_tier is being reviewed).
 * Best-effort: errors are logged but never thrown, so the cancel HTTP
 * response is unaffected by Brevo / DB notification flakiness.
 */
async function notifyTherapistInitiatedCancellation(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    bookingId: string;
    clientId: string;
    therapistId: string;
    scheduledAt: string;
    serviceName: string | null;
    refundAmount: number;
    category: string;
    reason: string;
    noticeHrs: number;
  },
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const TPL_CANCELLATION = 9; // BOOKING / CANCELLATION_CONFIRMATION

  // Therapist display_name for the client's copy. Falls back to a
  // generic noun so the email never reads "{{ params.therapist_name }}"
  // if the profile row was deleted.
  const { data: therapistRow } = await admin
    .from("therapist_profiles")
    .select("display_name")
    .eq("id", args.therapistId)
    .maybeSingle();
  const therapistName = therapistRow?.display_name ?? "Il terapista";

  // Localised category labels — what shows in the email body + admin
  // dashboard. Must match the VALID_CATEGORIES set in the POST handler.
  const CATEGORY_LABELS: Record<string, string> = {
    emergenza_salute: "Emergenza di salute",
    imprevisto_familiare: "Imprevisto familiare",
    conflitto_agenda: "Conflitto di agenda",
    forza_maggiore: "Causa di forza maggiore",
    altro: "Altro motivo",
  };
  const categoryLabel = CATEGORY_LABELS[args.category] ?? args.category;

  const date = new Date(args.scheduledAt);
  const TZ = "Europe/Rome";
  const sessionDateStr = date.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });
  const sessionTimeStr = date.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
  const refundStr =
    args.refundAmount > 0
      ? `€ ${args.refundAmount.toFixed(2).replace(".", ",")}`
      : "Nessun rimborso (sessione gratuita)";

  const sendEmail = (userId: string) =>
    fetch(`${supabaseUrl}/functions/v1/send-brevo-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: TPL_CANCELLATION,
        user_id: userId,
        params: {
          session_date: sessionDateStr,
          session_time: sessionTimeStr,
          service_name: args.serviceName ?? "Sessione",
          therapist_name: therapistName,
          refund_amount: refundStr,
          refund_tier: "100%",
          cancellation_reason: args.reason,
          cancellation_category: categoryLabel,
          cancelled_by: "therapist",
          booking_id: args.bookingId,
          scheduled_at: args.scheduledAt,
        },
        tags: ["booking_cancelled", "cancelled_by_therapist"],
      }),
    }).catch((err) => {
      console.warn(
        "[therapist/cancel] brevo send failed (non-blocking):",
        err,
      );
    });

  await Promise.allSettled([
    admin.from("notifications").insert([
      {
        user_id: args.clientId,
        type: "booking_cancelled",
        title: "Il terapista ha annullato la sessione",
        body:
          `${therapistName} ha annullato la sessione "${args.serviceName ?? "Sessione"}" del ${sessionDateStr}` +
          (args.refundAmount > 0
            ? `. Ti è stato riconosciuto un rimborso completo di ${refundStr} (100%).`
            : "."),
        booking_id: args.bookingId,
        therapist_id: args.therapistId,
      },
      {
        user_id: args.therapistId,
        type: "booking_cancelled",
        title: "Hai annullato la sessione",
        body: `Hai annullato la sessione "${args.serviceName ?? "Sessione"}" del ${sessionDateStr} con ${args.noticeHrs}h di preavviso. Motivo: ${categoryLabel}.`,
        booking_id: args.bookingId,
        client_id: args.clientId,
      },
    ]),
    sendEmail(args.clientId),
    sendEmail(args.therapistId),
  ]);
}
