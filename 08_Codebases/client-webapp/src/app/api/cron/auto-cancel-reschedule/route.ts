import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/auto-cancel-reschedule
 *
 * Hourly cron (configured in vercel.json) that processes
 * `reschedule_pending` bookings whose 24h window has expired without
 * the client responding. For each: full refund + status -> cancelled
 * with `cancelled_by='system'`.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We
 * compare in constant time. Without this guard anyone hitting the
 * URL could mass-cancel pending bookings.
 *
 * Idempotency: each booking is updated with an optimistic lock
 * (.eq("status", "reschedule_pending")) so a double-fire of the cron
 * cannot double-refund.
 */

const RESCHEDULE_TTL_HOURS = 24;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  // Auth check — Vercel Cron sends the header automatically when
  // configured via vercel.json. Manual triggers from a browser will
  // 401 because they lack the header.
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !timingSafeEqual(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - RESCHEDULE_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Find expired reschedule_pending. Limit batch size to keep the
  // cron run under Vercel's serverless timeout (~10s on Hobby).
  const { data: expired, error: lookupErr } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, scheduled_at, stripe_payment_intent_id, reschedule_proposed_at")
    .eq("status", "reschedule_pending")
    .lt("reschedule_proposed_at", cutoff)
    .limit(50);

  if (lookupErr) {
    console.error("[cron/auto-cancel-reschedule] lookup failed:", lookupErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ processed: 0, refunded: 0, errors: 0 });
  }

  const stripe = new Stripe(stripeKey);
  let refundedCount = 0;
  let errorCount = 0;

  for (const booking of expired) {
    try {
      // Refund first — if status flip succeeds but refund fails the
      // money is stuck, which is worse than refunding without flipping
      // (idempotent: Stripe rejects duplicate refunds on same PI).
      let refundId: string | null = null;
      let refundAmountCents = 0;
      if (booking.stripe_payment_intent_id) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: booking.stripe_payment_intent_id,
            reverse_transfer: true,
            refund_application_fee: true,
            metadata: {
              booking_id: booking.id,
              cancelled_by: "system",
              context: "reschedule_window_expired",
            },
          });
          refundId = refund.id;
          refundAmountCents = refund.amount;
        } catch (err: unknown) {
          // Treat "already refunded" as success — the booking can still
          // be flipped to cancelled. Without this special case the cron
          // would loop forever on bookings whose refund landed via
          // another path (e.g. admin manual refund) but whose status
          // never got updated.
          const msg = err instanceof Error ? err.message : "";
          const alreadyRefunded =
            msg.includes("already") && msg.toLowerCase().includes("refund");
          if (!alreadyRefunded) throw err;
          console.warn(
            `[auto-cancel-reschedule] booking ${booking.id} already refunded — flipping status anyway`,
          );
        }
      }

      const noticeHrs = Math.floor(
        (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000),
      );

      const { data: cancelled } = await admin
        .from("bookings")
        .update({
          status: "cancelled",
          cancellation_reason: "Auto-cancellata: il cliente non ha risposto entro 24h alla proposta di riprogrammazione",
          cancellation_category: "conflitto_agenda",
          cancelled_by: "system",
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

      if (refundId && cancelled) {
        await admin
          .from("transactions")
          .update({
            refund_amount: refundAmountCents / 100,
            payout_status: "refunded",
            status: "refunded",
            updated_at: new Date().toISOString(),
          })
          .eq("booking_id", booking.id);
        refundedCount++;
      }
    } catch (err) {
      errorCount++;
      console.error(
        `[cron/auto-cancel-reschedule] booking ${booking.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    processed: expired.length,
    refunded: refundedCount,
    errors: errorCount,
  });
}
