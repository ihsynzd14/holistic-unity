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

    // Build the Stripe refund request. Refund amount is calculated server-side
    // from the single global policy: 50% if more than 24 hours before session.
    const refundParams: Record<string, unknown> = {
      payment_intent: transaction.stripe_payment_intent_id,
      amount: String(refundAmountCents),
    };

    // Create the refund via Stripe API
    const refund = await stripeRequest("POST", "/refunds", refundParams);

    console.log(
      `Refund created: ${redactStripeId(refund.id)} for payment_intent ${redactStripeId(transaction.stripe_payment_intent_id)}, amount: ${refund.amount / 100} ${refund.currency}`
    );

    // The stripe-webhook handler will update the transaction status
    // when it receives the charge.refunded event from Stripe.
    // But we can also update it immediately for faster UI feedback.
    const refundedAmount = refund.amount / 100;
    const transactionAmount = transaction.amount;
    const isFullRefund = refundedAmount >= transactionAmount;

    await supabaseAdmin
      .from("transactions")
      .update({
        status: isFullRefund ? "refunded" : "partially_refunded",
        refund_amount: refundedAmount,
      })
      .eq("id", transaction.id);

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
