import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/cleanup-pending-payment
 *
 * Safety net for `pending_payment` bookings. Stripe Checkout sessions
 * are now created with a 30-minute `expires_at` (set in
 * `/api/checkout/create`); when Stripe expires the session it fires
 * `checkout.session.expired` to our webhook, which flips the booking
 * to `cancelled`. But:
 *   - the user might have closed the tab BEFORE Stripe expired the
 *     session (no event will fire reliably until expiry lands) — the
 *     cron is the deterministic backstop
 *   - the webhook itself could have failed and not been retried
 *     successfully
 *   - the deploy may have been mid-flight when the event arrived
 *
 * This cron releases the held slot so other clients can book it. It
 * runs hourly. It does NOT touch Stripe — Stripe sessions auto-expire
 * on their own; we only update our DB so the slot picker stops
 * filtering it out.
 *
 * Cutoff is **35 minutes** — the Stripe Checkout session's hard
 * `expires_at` is 30 minutes (set in `/api/checkout/create`), and the
 * 5-minute buffer ensures a payment that completes seconds before
 * Stripe expiry has time to flow through our webhook before the cron
 * cancels the booking. Without the buffer, a successful payment in
 * the final seconds of Stripe's window could land on a booking
 * already cancelled by this cron, producing a charged-but-cancelled
 * row. The webhook ALSO has a "cancelled-but-paid" defensive branch
 * that auto-refunds if the race still loses, so the buffer is
 * defense-in-depth rather than the sole mitigation.
 */

const STALE_PENDING_PAYMENT_MINUTES = 35;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !timingSafeEqual(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - STALE_PENDING_PAYMENT_MINUTES * 60 * 1000,
  ).toISOString();

  // Bookings stuck in pending_payment for longer than the cutoff. We
  // match on `created_at` because pending_payment is set at INSERT
  // time in /api/checkout/create and never re-set by other paths.
  const { data: stale, error: lookupErr } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, scheduled_at, created_at")
    .eq("status", "pending_payment")
    .lt("created_at", cutoff)
    .limit(50);

  if (lookupErr) {
    console.error("[cron/cleanup-pending-payment] lookup failed:", lookupErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, cancelled: 0 });
  }

  let cancelled = 0;
  for (const b of stale) {
    // Optimistic-locked update so a concurrent webhook (Stripe finally
    // delivering the session.completed late) won't trample a real
    // confirmation.
    const { data: updated } = await admin
      .from("bookings")
      .update({
        status: "cancelled",
        cancellation_reason: "Checkout abbandonato senza pagamento",
        cancelled_by: "system",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", b.id)
      .eq("status", "pending_payment")
      .select("id")
      .maybeSingle();
    if (updated) cancelled += 1;
  }

  return NextResponse.json({
    ok: true,
    scanned: stale.length,
    cancelled,
    cutoff,
  });
}
