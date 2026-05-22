/**
 * C2: Atomic booking + payment intent creation.
 *
 * Previously the iOS app made three sequential calls:
 *   1. createBooking()          — insert pending booking row
 *   2. createPaymentIntent()    — call edge function → Stripe
 *   3. updateBookingPaymentIntent() — link intent to booking
 *
 * If any step failed mid-sequence, orphaned bookings or unlinked
 * payment intents could result. This edge function does all three
 * server-side in a single request. If the Stripe call fails, the
 * booking is rolled back before returning the error to the client.
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
import { BookingPaymentSchema, parseJson } from "../_shared/validate.ts";
import { redactStripeId } from "../_shared/redact.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

// Fee constants (must stay in sync with create-payment-intent)
const PLATFORM_FEE_PERCENT = 0.20;
const IVA_RATE = 0.22;
const ITALY_VARIANTS = ["IT", "ITALY", "ITALIA"];
// Legacy constants removed — see STRIPE_PERCENT and STRIPE_FIXED_CENTS in fee calculation section

// ── Stripe helpers (identical to create-payment-intent) ──────────────────────

async function stripeRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
) {
  const url = `https://api.stripe.com/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...extraHeaders,
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

// ── Request body schema ──────────────────────────────────────────────────────

interface BookingPaymentRequest {
  booking_id: string;
  therapist_id: string;
  service_id: string;
  service_name: string;
  duration: number;
  price: number;
  scheduled_at: string;
  timezone: string;
  video_room_id?: string | null;
  promo_code?: string | null;
  discount?: number | null;
  pack_booking_id?: string | null;
  currency?: string;
  idempotency_key?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  try {
    // Auth
    const userToken = req.headers.get("x-user-token");
    const authHeader = req.headers.get("Authorization");
    const jwt =
      userToken || (authHeader ? authHeader.replace("Bearer ", "") : null);
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

    // Rate limit: 5 per user per minute
    if (await isRateLimited(`booking-payment:${user.id}`, 5, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // ── Input validation via Zod ─────────────────────────────────────────
    // Schema in _shared/validate.ts enforces: UUID fields, price range
    // 0.5–999999.99, discount 0–0.95, ISO currency, service_name length,
    // etc. Replaces the manual checks that used to live here.
    const parsed = await parseJson(req, BookingPaymentSchema, corsHeaders);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;

    const sessionPriceCents = Math.round(body.price * 100);

    // ── Validate service & therapist ─────────────────────────────────────

    const { data: service, error: serviceError } = await supabaseAdmin
      .from("therapist_services")
      .select("id, price, pack_size, pack_price")
      .eq("id", body.service_id)
      .eq("therapist_id", body.therapist_id)
      .single();

    if (serviceError || !service) {
      return new Response(
        JSON.stringify({ error: "Service not found for this therapist" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const packSize = Number(service.pack_size ?? 0);
    // packSessionsRemaining is set after price verification (may be 0 for single purchase)

    // SECURITY: Verify client-sent price matches an allowed price for this service.
    // A service with pack_size > 1 allows TWO valid prices:
    //   - Single session: service.price
    //   - Pack purchase:  (service.pack_price ?? service.price) * pack_size
    // Never trust client-sent prices — validate against DB values.
    const servicePrice = Number(service.price);
    const packPrice = Number(service.pack_price ?? service.price);
    const singlePrice = servicePrice;
    const fullPackPrice = packSize > 1 ? packPrice * packSize : servicePrice;

    const matchesSingle = Math.abs(body.price - singlePrice) <= 0.01;
    const matchesPack = Math.abs(body.price - fullPackPrice) <= 0.01;

    if (!matchesSingle && !matchesPack) {
      return new Response(
        JSON.stringify({
          error: `Price mismatch: submitted ${body.price}, expected ${singlePrice} (single) or ${fullPackPrice} (pack)`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If the user chose single session (not pack), don't create credits
    const isSinglePurchase = matchesSingle && !matchesPack && packSize > 1;
    const packSessionsRemaining = isSinglePurchase ? 0
      : (Number.isFinite(packSize) && packSize > 1 ? packSize - 1 : 0);

    const { data: therapistProfile, error: therapistError } =
      await supabaseAdmin
        .from("therapist_profiles")
        .select(
          "stripe_connected_account_id, stripe_account_status, currency, country"
        )
        .eq("id", body.therapist_id)
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

    if (therapistProfile.stripe_account_status !== "active") {
      return new Response(
        JSON.stringify({ error: "Therapist payment account is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const therapistCountry = normalizeCountry(therapistProfile.country);
    if (!therapistCountry) {
      return new Response(
        JSON.stringify({
          error:
            "Therapist country is required before accepting payments",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const allowedCurrencies = ["usd", "eur", "gbp", "brl"];
    const requestedCurrency = String(
      therapistProfile.currency || body.currency || "usd"
    ).toLowerCase();
    if (!allowedCurrencies.includes(requestedCurrency)) {
      return new Response(
        JSON.stringify({ error: "Unsupported currency." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Fee calculation (v3.0 — matches PAYMENT_MODEL.md) ─────────────
    //
    // Client pays:  session price + processing fee (2.5% + €0.25)
    // Platform:     20% commission (IVA inclusa per IT)
    // Therapist:    80% of session price
    //
    // Commission breakdown (for Italian therapists):
    //   commission = session_price × 20%
    //   imponibile = commission / 1.22
    //   iva_quota  = commission - imponibile
    //   Platform versa iva_quota all'Erario
    //
    // Processing fee: 2.5% + €0.25 charged to client.
    //   Actual Stripe fee deducted from application_fee.
    //   Difference = platform margin (EEA cards) or cost (non-EEA cards).

    const STRIPE_PERCENT = 0.025;    // 2.5%
    const STRIPE_FIXED_CENTS = 25;   // €0.25

    const ivaApplied = ITALY_VARIANTS.includes(therapistCountry);

    // Commission: 20% of session price (IVA included for IT therapists)
    const commissionBase = Math.round(sessionPriceCents * PLATFORM_FEE_PERCENT);

    // IVA quota inside the commission (for accounting/metadata only)
    // commission / 1.22 = imponibile; commission - imponibile = IVA
    const ivaAmount = ivaApplied
      ? commissionBase - Math.round(commissionBase / 1.22)
      : 0;

    // Processing fee charged to client
    const processingFee = Math.round(sessionPriceCents * STRIPE_PERCENT + STRIPE_FIXED_CENTS);

    // Totals
    const totalChargeAmount = sessionPriceCents + processingFee;
    const applicationFeeAmount = commissionBase + processingFee;
    const therapistPayoutCents = totalChargeAmount - applicationFeeAmount;
    const platformFeeFraction = body.price * PLATFORM_FEE_PERCENT;

    // ── Step 1: Create booking (pending) ─────────────────────────────────
    const { error: bookingInsertError } = await supabaseAdmin
      .from("bookings")
      .insert({
        id: body.booking_id,
        client_id: user.id,
        therapist_id: body.therapist_id,
        service_id: body.service_id,
        service_name: body.service_name || "",
        duration: body.duration || 60,
        price: body.price,
        scheduled_at: body.scheduled_at,
        timezone: body.timezone || "UTC",
        status: "pending",
        video_room_id: body.video_room_id || null,
        platform_fee: platformFeeFraction,
        therapist_payout: body.price - platformFeeFraction,
        promo_code: body.promo_code || null,
        discount: body.discount || null,
        reschedule_count: 0,
        pack_booking_id: body.pack_booking_id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (bookingInsertError) {
      // Duplicate booking ID → likely a retry. Check if the booking exists
      // and already has a payment intent (idempotent path).
      if (bookingInsertError.code === "23505") {
        const { data: existingBooking } = await supabaseAdmin
          .from("bookings")
          .select("id, stripe_payment_intent_id, status")
          .eq("id", body.booking_id)
          .single();

        if (existingBooking?.stripe_payment_intent_id) {
          // Already processed — return a 409 so the client can recover
          return new Response(
            JSON.stringify({
              error: "Booking already has a payment intent",
              bookingId: existingBooking.id,
              existingPaymentIntentId:
                existingBooking.stripe_payment_intent_id,
            }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        // Booking exists but no payment intent yet — fall through to create one
      } else {
        return new Response(
          JSON.stringify({
            error: "Failed to create booking",
            detail: bookingInsertError.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // ── Step 2: Stripe — customer, ephemeral key, payment intent ─────────
    let customerId: string | null = null;
    let ephKeySecret: string | null = null;
    let customerSessionSecret: string | null = null;
    let paymentIntentId: string | null = null;
    let clientSecret: string | null = null;

    try {
      // Get or create Stripe customer
      const { data: userData } = await supabaseAdmin
        .from("users")
        .select("stripe_customer_id, email, display_name")
        .eq("id", user.id)
        .single();

      customerId = userData?.stripe_customer_id || null;

      // Validate existing customer in Stripe
      if (customerId) {
        try {
          await stripeRequest("GET", `/customers/${customerId}`);
        } catch {
          console.warn(
            `Stored Stripe customer ${redactStripeId(customerId)} not found — creating new one.`
          );
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
        await supabaseAdmin
          .from("users")
          .update({ stripe_customer_id: customerId })
          .eq("id", user.id);
      }

      // Ephemeral key
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
      ephKeySecret = ephKeyData.secret;

      // Customer session
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
      customerSessionSecret = customerSession.client_secret;

      // Payment intent — with idempotency key to prevent duplicates on retry
      const idempotencyKey = body.idempotency_key || `pi-${body.booking_id}`;
      const paymentIntent = await stripeRequest(
        "POST",
        "/payment_intents",
        {
          amount: String(totalChargeAmount),
          currency: requestedCurrency,
          customer: customerId,
          application_fee_amount: String(applicationFeeAmount),
          transfer_data: {
            destination: therapistProfile.stripe_connected_account_id,
          },
          metadata: {
            booking_id: body.booking_id,
            client_id: user.id,
            therapist_id: body.therapist_id,
            connected_account_id:
              therapistProfile.stripe_connected_account_id,
            session_price: String(sessionPriceCents),
            commission_base: String(commissionBase),
            iva_amount: String(ivaAmount),
            iva_applied: String(ivaApplied),
            service_fee: String(processingFee),
            therapist_country: therapistCountry,
            total_charged: String(totalChargeAmount),
            service_id: body.service_id,
            pack_size: String(packSize || 0),
            pack_sessions_remaining: String(packSessionsRemaining),
          },
          automatic_payment_methods: { enabled: "true" },
        },
        { "Idempotency-Key": idempotencyKey }
      );

      paymentIntentId = paymentIntent.id;
      clientSecret = paymentIntent.client_secret;

      // ── Step 3: Link payment intent to booking ─────────────────────────
      await supabaseAdmin
        .from("bookings")
        .update({
          stripe_payment_intent_id: paymentIntent.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.booking_id);
    } catch (stripeErr: unknown) {
      // Stripe or infra failure — roll back the booking
      console.error("Payment setup failed, rolling back booking:", stripeErr);
      await supabaseAdmin
        .from("bookings")
        .update({
          status: "cancelled",
          cancellation_reason: "Payment setup failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.booking_id);

      const errMsg =
        stripeErr instanceof Error ? stripeErr.message : "Payment setup failed";
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Success — return all payment details ─────────────────────────────
    return new Response(
      JSON.stringify({
        bookingId: body.booking_id,
        clientSecret,
        paymentIntentId,
        customerId,
        ephemeralKeySecret: ephKeySecret,
        customerSessionClientSecret: customerSessionSecret,
        feeBreakdown: {
          sessionPrice: sessionPriceCents / 100,
          serviceFee: processingFee / 100, // Stripe processing fee (EEA estimate)
          totalCharged: totalChargeAmount / 100,
          commissionBase: commissionBase / 100,
          ivaAmount: ivaAmount / 100, // IVA quota inside commission (for IT therapists)
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
  } catch (err: unknown) {
    console.error("create-booking-with-payment error:", err);
    const errMsg =
      err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
