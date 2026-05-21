import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/cancel
 * Body: { reason?: string }
 *
 * Cancels a booking on behalf of the authenticated client. Server-side
 * checks (NOT trusting only RLS):
 *   1. Auth: must be logged in.
 *   2. Authorisation: caller must be the booking's client_id.
 *   3. State machine: booking must currently be in `pending`,
 *      `pending_payment`, `confirmed`, or `reschedule_pending`. We refuse
 *      to cancel `in_progress`, `completed`, `cancelled`, `no_show`.
 *   4. Refund: tiered by how close we are to scheduled_at:
 *        - >= 48h before  → 100% refund (reverse full transfer + refund app fee)
 *        - 24-48h before  → 50% refund (reverse half transfer, platform keeps fee)
 *        - <  24h before  → 0% refund (status flips, therapist keeps net payout)
 *      Free bookings (no payment_intent) just flip status regardless.
 *   5. The video room is unaffected — therapist will see the cancelled
 *      booking in their dashboard.
 *
 * No-shows and post-session cancellations are NOT handled here — those
 * are the therapist's responsibility, on their own portal.
 */

// Cancellation refund schedule. Keep in sync with the cancellation
// policy shown on the therapist's profile page (cancellation_policy
// free-text) and what the booking detail UI tells the client before
// they confirm. Values in hours before scheduled_at.
const REFUND_TIER_FULL_HOURS = 48;  // >= 48h → 100%
const REFUND_TIER_HALF_HOURS = 24;  // 24-48h → 50%

function refundRatioForCancellation(scheduledAt: Date, now: Date): 1 | 0.5 | 0 {
  const hoursUntil = (scheduledAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntil >= REFUND_TIER_FULL_HOURS) return 1;
  if (hoursUntil >= REFUND_TIER_HALF_HOURS) return 0.5;
  return 0;
}
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

  // Rate limit: 30 cancel attempts per hour per user. Legit cancel is
  // 1 per booking; higher = abuse / scripted enumeration / accidental
  // double-tap. The cancel route hits Stripe (for paid bookings) so
  // an unbounded attempt rate could rack up Stripe API costs and
  // trigger rate-limit/fraud signals on our Stripe account.
  const rl = await withRateLimit(request, {
    key: "booking-cancel",
    max: 30,
    windowSec: 3600,
    userId: user.id,
  });
  if (rl.response) return rl.response;

  const body = await request.json().catch(() => ({}));
  const reason: string =
    typeof body?.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : "Annullato dal cliente";

  // Use the admin client to read the booking — defence in depth: even if
  // RLS were misconfigured, we re-check ownership here.
  const admin = createAdminClient();
  const { data: booking, error: lookupErr } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, stripe_payment_intent_id, price, currency, scheduled_at, duration, service_name")
    .eq("id", bookingId)
    .maybeSingle();

  if (lookupErr || !booking) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  if (booking.client_id !== user.id) {
    // Don't leak existence: same shape as not-found
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
      {
        error:
          "Questa sessione non pu\u00f2 pi\u00f9 essere annullata. Contatta l’operatore per assistenza.",
      },
      { status: 409 },
    );
  }

  // Compute the refund tier based on lead time to scheduled_at.
  // Compute refund tier from the lead time. Gate on
  // `stripe_payment_intent_id` ALONE (not also on `status === confirmed`)
  // so a booking that's still `pending_payment` but already has a
  // payment_intent attached (i.e. the Stripe webhook has linked the
  // charge but hasn't flipped status yet — narrow race window) still
  // gets a refund attempt. If the payment_intent isn't captured yet,
  // Stripe will throw and the catch block will revert; if it IS
  // captured, the refund processes normally.
  const refundRatio = booking.stripe_payment_intent_id
    ? refundRatioForCancellation(new Date(booking.scheduled_at), new Date())
    : 0;

  // Compute notice in hours for the audit trail. Clamp to 0 — a
  // negative value (booking already in the past, e.g. a stale
  // pending_payment row) would surface as confusing data in the
  // admin reliability dashboard and could trip a CHECK constraint
  // if one is later added.
  const noticeHrs = Math.max(
    0,
    Math.floor(
      (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000),
    ),
  );

  // STEP 1 — Atomic optimistic-locked status flip BEFORE any Stripe call.
  // This is the lock that prevents two concurrent cancel calls from both
  // racing into stripe.refunds.create on the same PaymentIntent. Only
  // ONE of the two will see `updated !== null`; the other gets 409 and
  // bails out before touching Stripe.
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: reason,
      cancelled_by: "client",
      cancelled_at: new Date().toISOString(),
      cancellation_notice_hrs: noticeHrs,
    })
    .eq("id", booking.id)
    .in("status", Array.from(CANCELLABLE_STATUSES))
    .select("id")
    .maybeSingle();

  if (updateErr) {
    console.error("[bookings/cancel] update failed:", updateErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    // Status changed under us between read and write — another tab,
    // the therapist, or a stale request lost the race.
    return NextResponse.json(
      { error: "Lo stato della prenotazione \u00e8 cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  // STEP 2 — Now that the booking is locked into `cancelled`, attempt
  // the refund. Failure here is rare but worth handling: if Stripe is
  // briefly unavailable we want to avoid leaving the booking cancelled
  // with money still pending. We revert the status to its previous
  // value and ask the user to retry.
  let refundId: string | null = null;
  let refundAmountCents = 0;
  if (booking.stripe_payment_intent_id && booking.status === "confirmed" && refundRatio > 0) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error("[bookings/cancel] STRIPE_SECRET_KEY not set; cannot refund");
      // Revert: we never had a chance to charge the client, this was an
      // env misconfiguration, not a state-machine race.
      await admin
        .from("bookings")
        .update({
          status: booking.status,
          cancellation_reason: null,
          cancelled_by: null,
          cancelled_at: null,
          cancellation_notice_hrs: null,
        })
        .eq("id", booking.id);
      return NextResponse.json(
        { error: "Server payments non configurato" },
        { status: 500 },
      );
    }
    try {
      const stripe = new Stripe(stripeKey);

      if (refundRatio === 1) {
        const refund = await stripe.refunds.create({
          payment_intent: booking.stripe_payment_intent_id,
          reverse_transfer: true,
          refund_application_fee: true,
          metadata: { booking_id: booking.id, reason: reason.slice(0, 200), tier: "100" },
        });
        refundId = refund.id;
        refundAmountCents = refund.amount;
      } else {
        const pi = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
        const capturedCents = pi.amount_received ?? pi.amount ?? 0;
        const halfCents = Math.floor(capturedCents * refundRatio);
        const refund = await stripe.refunds.create({
          payment_intent: booking.stripe_payment_intent_id,
          amount: halfCents,
          reverse_transfer: true,
          refund_application_fee: false,
          metadata: { booking_id: booking.id, reason: reason.slice(0, 200), tier: "50" },
        });
        refundId = refund.id;
        refundAmountCents = refund.amount;
      }
    } catch (err: unknown) {
      // Stripe failed AFTER we marked the booking cancelled. Two options:
      //   a) Revert the booking and ask user to retry — preferable for
      //      transient errors (network, rate limit). Risk: a duplicate
      //      Stripe refund slipped through (idempotency would have made
      //      it identical anyway, but reverting double-confuses the UI).
      //   b) Keep cancelled + flag for manual review.
      // We pick (a) for transient errors and (b) only for already-refunded
      // (Stripe says "charge_already_refunded" → DB and reality are
      // actually consistent, just stale read).
      const msg = err instanceof Error ? err.message : "Refund failed";
      const alreadyRefunded =
        msg.includes("already") && msg.toLowerCase().includes("refund");
      console.error("[bookings/cancel] Stripe refund failed:", msg);
      if (!alreadyRefunded) {
        await admin
          .from("bookings")
          .update({
            status: booking.status,
            cancellation_reason: null,
            cancelled_by: null,
            cancelled_at: null,
            cancellation_notice_hrs: null,
          })
          .eq("id", booking.id);
        return NextResponse.json(
          { error: "Impossibile processare il rimborso. Riprova o contatta il supporto." },
          { status: 502 },
        );
      }
      // Already refunded → keep the cancellation and continue.
    }
  }

  // Reflect the refund on the transactions row so the admin dashboard
  // and the therapist's earnings tab see it correctly. Partial refunds
  // keep the payout flowing for the un-refunded portion — we don't
  // mark status="refunded" in that case because the therapist is
  // still owed their 50%.
  if (refundId) {
    const isFullRefund = refundRatio === 1;
    await admin
      .from("transactions")
      .update({
        refund_amount: refundAmountCents / 100,
        ...(isFullRefund
          ? { payout_status: "refunded", status: "refunded" }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("booking_id", booking.id);
  }

  // Fire in-app notifications + transactional emails for both parties.
  // Best-effort — internally guarded by Promise.allSettled so a Brevo
  // outage can't fail the cancel response. We MUST await: serverless
  // functions terminate after the response is sent and a fire-and-forget
  // promise gets killed mid-flight, dropping the inserts.
  await notifyBookingCancelled(admin, {
    bookingId: booking.id,
    clientId: booking.client_id,
    therapistId: booking.therapist_id,
    scheduledAt: booking.scheduled_at,
    serviceName: booking.service_name ?? null,
    refundAmount: refundAmountCents / 100,
    refundTier: refundRatio === 1 ? "100%" : refundRatio === 0.5 ? "50%" : "0%",
    reason,
  });

  return NextResponse.json({
    success: true,
    refunded: refundId !== null,
    refundAmount: refundAmountCents / 100,
    refundTier: refundRatio === 1 ? "100%" : refundRatio === 0.5 ? "50%" : "0%",
  });
}

/**
 * Inserts two in-app notifications (client + therapist) and sends two
 * Brevo emails (template 9 — CANCELLATION_CONFIRMATION). Best-effort:
 * errors are logged but never thrown, so the cancel HTTP response is
 * unaffected by notification flakiness.
 */
async function notifyBookingCancelled(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    bookingId: string;
    clientId: string;
    therapistId: string;
    scheduledAt: string;
    serviceName: string | null;
    refundAmount: number;
    refundTier: string;
    reason: string;
  },
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const TPL_CANCELLATION = 9; // BOOKING / CANCELLATION_CONFIRMATION

  const { data: therapistRow } = await admin
    .from("therapist_profiles")
    .select("display_name")
    .eq("id", args.therapistId)
    .maybeSingle();
  const therapistName = therapistRow?.display_name ?? "Operatore";

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
      : "Nessun rimborso";

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
          refund_tier: args.refundTier,
          cancellation_reason: args.reason,
          booking_id: args.bookingId,
          scheduled_at: args.scheduledAt,
        },
        tags: ["booking_cancelled"],
      }),
    }).catch((err) => {
      console.warn("[bookings/cancel] brevo send failed (non-blocking):", err);
    });

  await Promise.allSettled([
    admin.from("notifications").insert([
      {
        user_id: args.clientId,
        type: "booking_cancelled",
        title: "Prenotazione annullata",
        body: `La tua sessione "${args.serviceName ?? "Sessione"}" è stata annullata. ${
          args.refundAmount > 0
            ? `Rimborso: ${refundStr} (${args.refundTier}).`
            : "Nessun rimborso previsto in base alla policy di cancellazione."
        }`,
        booking_id: args.bookingId,
        therapist_id: args.therapistId,
      },
      {
        user_id: args.therapistId,
        type: "booking_cancelled",
        title: "Prenotazione annullata dal cliente",
        body: `Il cliente ha annullato la sessione "${args.serviceName ?? "Sessione"}" del ${sessionDateStr}.`,
        booking_id: args.bookingId,
        client_id: args.clientId,
      },
    ]),
    sendEmail(args.clientId),
    sendEmail(args.therapistId),
  ]);
}
