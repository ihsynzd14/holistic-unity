import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
import { RefundSchema, parseJson } from "../_shared/validate.ts";
import { redactStripeId } from "../_shared/redact.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

// Helper to call Stripe REST API directly
async function stripeRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
) {
  const url = `https://api.stripe.com/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  let encodedBody: string | undefined;
  if (body) {
    encodedBody = encodeStripeParams(body);
  }

  const res = await fetch(url, { method, headers, body: encodedBody });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Stripe API error: ${res.status}`);
  }
  return data;
}

function encodeStripeParams(
  obj: Record<string, unknown>,
  prefix = ""
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      parts.push(
        encodeStripeParams(value as Record<string, unknown>, fullKey)
      );
    } else if (value !== undefined && value !== null) {
      parts.push(
        `${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`
      );
    }
  }
  return parts.join("&");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  try {
    // Verify auth — prefer x-user-token, fall back to Authorization
    const userToken = req.headers.get("x-user-token");
    const authHeader = req.headers.get("Authorization");
    const jwt =
      userToken || (authHeader ? authHeader.replace("Bearer ", "") : null);
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          details: authError?.message,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Rate limit: max 3 refund requests per user per minute
    if (await isRateLimited(`refund:${user.id}`, 3, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // Input validation via Zod. Schema requires at least one of
    // transaction_id / booking_id (as UUIDs) and an optional reason.
    const parsed = await parseJson(req, RefundSchema, corsHeaders);
    if (!parsed.success) return parsed.response;
    const { transaction_id, booking_id } = parsed.data;
    const lookupId = transaction_id || booking_id!;

    // Current iOS builds send the transaction id. Older builds may send booking id.
    // Include refunded statuses so the idempotency check can detect and reject duplicates
    let { data: transaction, error: txError } = await supabaseAdmin
      .from("transactions")
      .select("id, booking_id, client_id, therapist_id, stripe_payment_intent_id, amount, status, refund_amount")
      .eq("id", lookupId)
      .in("status", ["completed", "processing", "refunded", "partially_refunded"])
      .maybeSingle();

    if (!transaction && !txError) {
      const fallback = await supabaseAdmin
        .from("transactions")
        .select("id, booking_id, client_id, therapist_id, stripe_payment_intent_id, amount, status, refund_amount")
        .eq("booking_id", lookupId)
        .in("status", ["completed", "processing", "refunded", "partially_refunded"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      transaction = fallback.data;
      txError = fallback.error;
    }

    if (txError) {
      console.error("Failed to look up transaction:", txError);
      return new Response(
        JSON.stringify({ error: "Failed to look up transaction" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!transaction) {
      return new Response(
        JSON.stringify({ error: "No eligible transaction found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify the requesting user is the client who made the payment
    if (transaction.client_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You can only request refunds for your own payments" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // H1: Validate transaction amount is positive before computing refund
    const originalAmount = Number(transaction.amount);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Transaction has invalid amount — cannot refund" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Only completed transactions are eligible for refund
    if (transaction.status !== "completed") {
      const msg = transaction.status === "refunded" || transaction.status === "partially_refunded"
        ? "This transaction has already been refunded"
        : "Only completed transactions can be refunded";
      return new Response(
        JSON.stringify({
          error: msg,
          refund_amount: transaction.refund_amount || 0,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!transaction.stripe_payment_intent_id) {
      return new Response(
        JSON.stringify({ error: "No Stripe payment found for this transaction" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, scheduled_at")
      .eq("id", transaction.booking_id)
      .maybeSingle();

    if (bookingError) {
      console.error("Failed to look up booking for refund:", bookingError);
      return new Response(
        JSON.stringify({ error: "Failed to verify booking refund eligibility" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!booking?.scheduled_at) {
      return new Response(
        JSON.stringify({ error: "Booking not found for this transaction" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const hoursUntilSession =
      (new Date(booking.scheduled_at).getTime() - Date.now()) / (1000 * 60 * 60);

    // Platform refund policy (v3.1, three-tier):
    //   >= 48h before session  → 100% refund
    //   24h..<48h before       →  50% refund
    //   <  24h before          →   0% (no refund; therapist keeps payout)
    // Must match iOS CancellationPolicy.refundPercentage in Therapist.swift
    // and PAYMENT_MODEL.md section 8. Do NOT change here without updating both.
    const FULL_REFUND_CUTOFF_HOURS = 48;
    const PARTIAL_REFUND_CUTOFF_HOURS = 24;

    let refundPercentage = 0;
    if (hoursUntilSession >= FULL_REFUND_CUTOFF_HOURS) {
      refundPercentage = 1.0;
    } else if (hoursUntilSession >= PARTIAL_REFUND_CUTOFF_HOURS) {
      refundPercentage = 0.5;
    }

    if (refundPercentage <= 0) {
      return new Response(
        JSON.stringify({
          error: `No refund is available within ${PARTIAL_REFUND_CUTOFF_HOURS} hours of the session`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const originalAmountCents = Math.round(originalAmount * 100);
    const refundAmountCents = Math.round(originalAmountCents * refundPercentage);

    // H1: Validate refund amount bounds — must be positive and ≤ original charge
    if (!Number.isFinite(refundAmountCents) || refundAmountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Calculated refund amount is invalid" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (refundAmountCents > originalAmountCents) {
      return new Response(
        JSON.stringify({ error: "Refund amount exceeds original charge" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Atomic optimistic lock: cancel the booking BEFORE the refund so two
    // cancel/refund paths can't both refund the same booking. Only one caller
    // flips it out of a live status; anyone else gets 409 and never reaches
    // Stripe. (Mirrors client-webapp/.../cancel/route.ts.) Runs as service_role,
    // so protect_booking_columns is bypassed; the iOS app's subsequent
    // cancelBooking becomes a harmless no-op (cancelled→cancelled skips the
    // trigger's status check).
    const CANCELLABLE = ["pending", "confirmed", "in_progress", "reschedule_pending"];
    const { data: lockedBooking, error: lockErr } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_by: "client",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Refund requested by client",
        cancellation_notice_hrs: Math.floor(hoursUntilSession),
        updated_at: new Date().toISOString(),
      })
      .eq("id", transaction.booking_id)
      .in("status", CANCELLABLE)
      .select("id")
      .maybeSingle();
    if (lockErr) {
      console.error("request-refund: booking lock failed:", lockErr);
      return new Response(
        JSON.stringify({ error: "Failed to cancel booking for refund" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!lockedBooking) {
      // Already cancelled/handled by another path (therapist cancel, a prior
      // refund, a stale retry) → do NOT issue a second refund.
      return new Response(
        JSON.stringify({ error: "Booking is no longer active — it may already be cancelled or refunded." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Post-payout detection (best-effort): if the charge is older than the
    // 14-day payout-hold, the therapist may already have withdrawn the funds,
    // so reverse_transfer can fail / drive the connected account negative.
    // Mirrors therapist-webapp/.../cancel/route.ts.
    const PAYOUT_HOLD_DAYS = 14;
    let chargeAgeDays = 0;
    let isPostPayout = false;
    try {
      const pi = await stripeRequest(
        "GET",
        `/payment_intents/${transaction.stripe_payment_intent_id}`
      );
      if (pi?.created) {
        chargeAgeDays = (Date.now() / 1000 - Number(pi.created)) / 86400;
        isPostPayout = chargeAgeDays > PAYOUT_HOLD_DAYS;
      }
    } catch (piErr) {
      console.warn("request-refund: PI lookup for post-payout check failed:", piErr);
    }

    // Build the Stripe refund. CRITICAL: with destination charges the
    // therapist's payout is already in their connected account, so we MUST
    // reverse the transfer or the platform eats the payout. Matches
    // PAYMENT_MODEL.md + flows/08-refund-cancellation.md (100% → also refund
    // the application fee; 50% → platform keeps it) and the webapp cancel routes.
    const isFullTier = refundPercentage >= 1.0;
    const refundParams: Record<string, unknown> = {
      payment_intent: transaction.stripe_payment_intent_id,
      amount: String(refundAmountCents),
      reverse_transfer: true,
      refund_application_fee: isFullTier,
      metadata: {
        booking_id: transaction.booking_id,
        tier: isFullTier ? "100" : "50",
        notice_hours: String(Math.floor(hoursUntilSession)),
        reason: "client_requested_refund",
      },
    };

    // Create the refund via Stripe API
    let refund;
    try {
      refund = await stripeRequest("POST", "/refunds", refundParams);
    } catch (refundErr) {
      const msg = refundErr instanceof Error ? refundErr.message : String(refundErr);
      // The booking is already cancelled (locked above), so we must NOT throw —
      // that would leave it cancelled, unrefunded, and unflagged. ANY refund
      // failure (transient, post-payout, or insufficient connected-account
      // balance) is flagged for admin manual reconciliation. The client keeps
      // their cancellation; an admin completes the refund.
      console.error("request-refund: Stripe refund failed after booking lock:", msg);
      await supabaseAdmin
        .from("bookings")
        .update({
          requires_manual_refund: true,
          manual_refund_note:
            `Automatic refund failed: ${msg.slice(0, 180)}. Charge age ` +
            `${chargeAgeDays.toFixed(1)}d (payout-hold ${PAYOUT_HOLD_DAYS}d). ` +
            `Booking is cancelled; complete the refund manually.`,
        })
        .eq("id", transaction.booking_id);
      return new Response(
        JSON.stringify({
          error: "refund_requires_manual_review",
          detail: msg,
          requires_manual_refund: true,
          booking_cancelled: true,
        }),
        {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `Refund created: ${redactStripeId(refund.id)} for payment_intent ${redactStripeId(transaction.stripe_payment_intent_id)}, amount: ${refund.amount / 100} ${refund.currency}`
    );

    // Update the transaction immediately (the charge.refunded webhook also
    // reconciles). Ledger consistency per PLATFORM_MAP.md matrix:
    //   full refund          → status + payout_status 'refunded'
    //   partial, post-escrow → 'partially_refunded' (clawback accounted)
    //   partial, pre-escrow  → leave payout_status 'pending' (cron pays the
    //                          un-refunded half later)
    const refundedAmount = refund.amount / 100;
    const transactionAmount = transaction.amount;
    const isFullRefund = refundedAmount >= transactionAmount;

    const txUpdate: Record<string, unknown> = {
      status: isFullRefund ? "refunded" : "partially_refunded",
      refund_amount: refundedAmount,
    };
    if (isFullRefund) {
      txUpdate.payout_status = "refunded";
    } else if (isPostPayout) {
      txUpdate.payout_status = "partially_refunded";
    }
    await supabaseAdmin
      .from("transactions")
      .update(txUpdate)
      .eq("id", transaction.id);

    // Post-payout refund succeeded but may have driven the connected account
    // negative — flag for admin verification. (The charge.refunded webhook
    // clears this flag on completion for full refunds.)
    if (isPostPayout) {
      await supabaseAdmin
        .from("bookings")
        .update({
          requires_manual_refund: true,
          manual_refund_note:
            `Refund issued ${chargeAgeDays.toFixed(1)}d after charge ` +
            `(payout-hold ${PAYOUT_HOLD_DAYS}d). Verify the connected account ` +
            `did not end up with a negative balance.`,
        })
        .eq("id", transaction.booking_id);
    }

    return new Response(
      JSON.stringify({
        refund_id: refund.id,
        amount_refunded: refundedAmount,
        status: refund.status,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("request-refund error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
