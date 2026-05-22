import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
import { redactStripeId } from "../_shared/redact.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

// Fee constants
const PLATFORM_FEE_PERCENT = 0.20;   // 20% platform commission
const IVA_RATE = 0.22;               // 22% Italian VAT (on commission + service fee)
const ITALY_VARIANTS = ["IT", "ITALY", "ITALIA"];

// Service fee: passed through to the client to cover Stripe processing costs.
// Stripe actual fees (Italy platform, destination charges):
//   EEA cards:           1.5%  + €0.25
//   UK cards:            2.5%  + €0.25
//   International cards: 3.25% + €0.25
//   PIX (cross-border):  ~4%   + FX conversion
//   Apple Pay:           same as underlying card
// We use 2.9% + €0.30 as a blended rate that covers the vast majority of
// transactions (EEA + UK) with a small buffer for international cards.
// The 20% platform commission absorbs any shortfall on rare intl/PIX payments.
// Legacy constants removed — see STRIPE_PERCENT and STRIPE_FIXED_CENTS in fee calculation section

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

function normalizeCountry(country?: string | null): string | null {
  const normalized = country?.trim().toUpperCase();
  if (!normalized) return null;
  if (ITALY_VARIANTS.includes(normalized)) return "IT";
  if (normalized.length === 2) return normalized;
  return normalized;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  try {
    // Verify auth — prefer x-user-token (bypasses gateway JWT check),
    // fall back to Authorization for backward compatibility
    const userToken = req.headers.get("x-user-token");
    const authHeader = req.headers.get("Authorization");
    const jwt = userToken || (authHeader ? authHeader.replace("Bearer ", "") : null);
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        JSON.stringify({ error: "Unauthorized", detail: authError?.message }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Rate limit: max 5 payment intents per user per minute
    if (await isRateLimited(`payment:${user.id}`, 5, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // Parse request. Price and therapist are derived from the booking on the server.
    const { booking_id, therapist_id, currency } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({
          error: "booking_id is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, client_id, therapist_id, service_id, price, status")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Booking not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (booking.client_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You can only pay for your own bookings" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (therapist_id && therapist_id !== booking.therapist_id) {
      return new Response(
        JSON.stringify({ error: "Booking therapist mismatch" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (booking.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Booking is not ready for payment" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: service, error: serviceError } = await supabaseAdmin
      .from("therapist_services")
      .select("id, pack_size")
      .eq("id", booking.service_id)
      .eq("therapist_id", booking.therapist_id)
      .single();

    if (serviceError || !service) {
      return new Response(
        JSON.stringify({ error: "Booking service not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const packSize = Number(service.pack_size ?? 0);
    const packSessionsRemaining = Number.isFinite(packSize) && packSize > 1 ? packSize - 1 : 0;

    const parsedAmount = Math.round(Number(booking.price) * 100); // session price in cents
    if (isNaN(parsedAmount) || parsedAmount < 50 || parsedAmount > 99999999) {
      return new Response(
        JSON.stringify({ error: "Invalid booking price. Must be between 50 and 99999999 cents." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get therapist's Stripe Connect account ID and location
    const { data: therapistProfile, error: therapistError } =
      await supabaseAdmin
        .from("therapist_profiles")
        .select("stripe_connected_account_id, stripe_account_status, currency, country")
        .eq("id", booking.therapist_id)
        .single();

    if (therapistError || !therapistProfile?.stripe_connected_account_id) {
      return new Response(
        JSON.stringify({ error: "Therapist has not set up payment account" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const allowedCurrencies = ["usd", "eur", "gbp", "brl"];
    const requestedCurrency = String(therapistProfile.currency || currency || "usd").toLowerCase();
    if (!allowedCurrencies.includes(requestedCurrency)) {
      return new Response(
        JSON.stringify({ error: "Unsupported currency." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (therapistProfile.stripe_account_status !== "active") {
      return new Response(
        JSON.stringify({ error: "Therapist payment account is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ─── Fee calculation ──────────────────────────────────────────────────────
    // Determine therapist's country from the country column
    const therapistCountry = normalizeCountry(therapistProfile.country);
    if (!therapistCountry) {
      return new Response(
        JSON.stringify({ error: "Therapist country is required before accepting payments" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // ── Fee calculation ──────────────────────────────────────────────────
    // Fee calculation v3.0 (matches PAYMENT_MODEL.md)
    const STRIPE_PERCENT = 0.025;
    const STRIPE_FIXED_CENTS = 25;
    const ivaApplied = ITALY_VARIANTS.includes(therapistCountry);

    const commissionBase = Math.round(parsedAmount * PLATFORM_FEE_PERCENT);
    const ivaAmount = ivaApplied
      ? commissionBase - Math.round(commissionBase / 1.22)
      : 0;
    const processingFee = Math.round(parsedAmount * STRIPE_PERCENT + STRIPE_FIXED_CENTS);

    const totalChargeAmount = parsedAmount + processingFee;
    const applicationFeeAmount = commissionBase + processingFee;
    const therapistPayoutCents = totalChargeAmount - applicationFeeAmount;
    // ─────────────────────────────────────────────────────────────────────────

    // Get or create Stripe customer for the client
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("stripe_customer_id, email, display_name")
      .eq("id", user.id)
      .single();

    let customerId = userData?.stripe_customer_id;

    // Validate existing customer still exists in Stripe, or create a new one.
    // The stored ID can become stale if the customer was deleted or if the
    // Stripe mode (test ↔ live) was switched.
    if (customerId) {
      try {
        await stripeRequest("GET", `/customers/${customerId}`);
      } catch {
        console.warn(`Stored Stripe customer ${redactStripeId(customerId)} not found — creating a new one.`);
        customerId = null;
      }
    }

    if (!customerId) {
      const customer = await stripeRequest("POST", "/customers", {
        email: userData?.email || user.email || "",
        name: userData?.display_name || "",
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      // Save customer ID back to the users table
      await supabaseAdmin
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Create an ephemeral key for the customer (requires Stripe-Version header)
    const ephKeyRes = await fetch(
      "https://api.stripe.com/v1/ephemeral_keys",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": "2023-10-16",
        },
        body: `customer=${encodeURIComponent(customerId!)}`,
      }
    );
    const ephKeyData = await ephKeyRes.json();
    if (!ephKeyRes.ok) {
      throw new Error(
        ephKeyData.error?.message || "Failed to create ephemeral key"
      );
    }

    // Create a customer session for PaymentSheet
    const customerSession = await stripeRequest(
      "POST",
      "/customer_sessions",
      {
        customer: customerId,
        components: {
          payment_element: {
            enabled: "true",
            features: {
              payment_method_redisplay: "enabled",
              payment_method_save: "enabled",
              payment_method_remove: "enabled",
              payment_method_save_usage: "off_session",
            },
          },
        },
      }
    );

    // Create payment intent — direct charge to therapist's connected account.
    // application_fee_amount is retained by the platform (commission + IVA + service fee).
    // The remainder (therapist_payout) flows automatically to the connected account.
    const paymentIntent = await stripeRequest("POST", "/payment_intents", {
      amount: String(totalChargeAmount),
      currency: requestedCurrency,
      customer: customerId,
      application_fee_amount: String(applicationFeeAmount),
      transfer_data: {
        destination: therapistProfile.stripe_connected_account_id,
      },
      metadata: {
        booking_id: booking_id || "",
        client_id: user.id,
        therapist_id: booking.therapist_id,
        connected_account_id: therapistProfile.stripe_connected_account_id,
        // Fee breakdown stored in metadata so the webhook can reconstruct it
        session_price: String(parsedAmount),
        commission_base: String(commissionBase),
        iva_amount: String(ivaAmount),
        iva_applied: String(ivaApplied),
        service_fee: String(processingFee),
        therapist_country: therapistCountry,
        total_charged: String(totalChargeAmount),
        service_id: booking.service_id,
        pack_size: String(packSize || 0),
        pack_sessions_remaining: String(packSessionsRemaining),
      },
      automatic_payment_methods: { enabled: "true" },
    });

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        customerId: customerId,
        ephemeralKeySecret: ephKeyData.secret,
        customerSessionClientSecret: customerSession.client_secret,
        feeBreakdown: {
          sessionPrice: parsedAmount / 100,
          serviceFee: processingFee / 100,
          totalCharged: totalChargeAmount / 100,
          commissionBase: commissionBase / 100,
          ivaAmount: ivaAmount / 100,
          ivaApplied,
          therapistPayout: therapistPayoutCents / 100,
          therapistCountry: therapistCountry,
          currency: requestedCurrency,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("create-payment-intent error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
