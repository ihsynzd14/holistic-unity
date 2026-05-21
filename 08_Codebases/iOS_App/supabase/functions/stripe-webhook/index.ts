import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// ── Google/Microsoft Calendar sync ──────────────────────────────
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const MS_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
const MS_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "";
const MS_TENANT = "common";

async function refreshGoogleToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET, grant_type: "refresh_token",
    }),
  });
  return res.json();
}

async function refreshMicrosoftToken(refreshToken: string) {
  const res = await fetch(
    `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken, client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET, grant_type: "refresh_token",
      }),
    }
  );
  return res.json();
}

interface CalendarIntegration {
  id: string; provider: "google" | "microsoft";
  access_token: string; refresh_token: string;
  token_expires_at: string; calendar_id: string | null;
}

// deno-lint-ignore no-explicit-any
async function getValidCalendarToken(integration: CalendarIntegration, supabaseAdmin: any): Promise<string> {
  const expiresAt = new Date(integration.token_expires_at);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return integration.access_token;
  const data = integration.provider === "google"
    ? await refreshGoogleToken(integration.refresh_token)
    : await refreshMicrosoftToken(integration.refresh_token);
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`);
  await supabaseAdmin.from("therapist_calendar_integrations").update({
    access_token: data.access_token, token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}), updated_at: new Date().toISOString(),
  }).eq("id", integration.id);
  return data.access_token;
}

/**
 * Creates a Google Calendar event for a confirmed booking.
 * Non-blocking — failures are logged but don't break the webhook.
 */
// deno-lint-ignore no-explicit-any
async function syncBookingToCalendar(bookingId: string, therapistId: string, supabaseAdmin: any) {
  try {
    // Fetch calendar integrations for this therapist
    const { data: integrations } = await supabaseAdmin
      .from("therapist_calendar_integrations")
      .select("*")
      .eq("therapist_id", therapistId);

    if (!integrations || integrations.length === 0) return;

    // Fetch booking details + client name
    const { data: booking } = await supabaseAdmin
      .from("bookings")
      .select("id, scheduled_at, duration, service_name, timezone, client_id")
      .eq("id", bookingId)
      .single();

    if (!booking) return;

    const { data: client } = await supabaseAdmin
      .from("users")
      .select("display_name")
      .eq("id", booking.client_id)
      .single();

    const clientName = client?.display_name || "Client";
    const startTime = new Date(booking.scheduled_at);
    const endTime = new Date(startTime.getTime() + (booking.duration || 60) * 60 * 1000);
    const tz = booking.timezone || "Europe/Rome";
    // All sessions are virtual V1 — no conditional needed.

    for (const integration of integrations) {
      try {
        const accessToken = await getValidCalendarToken(integration, supabaseAdmin);

        if (integration.provider === "google") {
          const calendarId = integration.calendar_id || "primary";
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                summary: `${clientName} — ${booking.service_name || "Session"}`,
                description: [
                  `Client: ${clientName}`,
                  `Service: ${booking.service_name}`,
                  `Duration: ${booking.duration} min`,
                  `Format: Virtual (video call)`,
                  `Booked via Holistic Unity`,
                ].join("\n"),
                start: { dateTime: startTime.toISOString(), timeZone: tz },
                end: { dateTime: endTime.toISOString(), timeZone: tz },
                reminders: {
                  useDefault: false,
                  overrides: [
                    { method: "popup", minutes: 30 },
                    { method: "popup", minutes: 10 },
                  ],
                },
              }),
            }
          );

          if (res.ok) {
            console.log(`Google Calendar event created for booking ${bookingId}`);
          } else {
            const err = await res.text();
            console.error(`Google Calendar event creation failed: ${err}`);
          }
        } else if (integration.provider === "microsoft") {
          const res = await fetch(
            "https://graph.microsoft.com/v1.0/me/events",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                subject: `${clientName} — ${booking.service_name || "Session"}`,
                body: {
                  contentType: "text",
                  content: `Client: ${clientName}\nService: ${booking.service_name}\nDuration: ${booking.duration} min\nFormat: Virtual\nBooked via Holistic Unity`,
                },
                start: { dateTime: startTime.toISOString().replace("Z", ""), timeZone: tz },
                end: { dateTime: endTime.toISOString().replace("Z", ""), timeZone: tz },
                isReminderOn: true,
                reminderMinutesBeforeStart: 30,
              }),
            }
          );

          if (res.ok) {
            console.log(`Microsoft Calendar event created for booking ${bookingId}`);
          } else {
            const err = await res.text();
            console.error(`Microsoft Calendar event creation failed: ${err}`);
          }
        }
      } catch (calErr) {
        console.error(`Calendar sync failed for ${integration.provider}:`, calErr);
      }
    }
  } catch (err) {
    console.error("Calendar sync error (non-blocking):", err);
  }
}

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

// Verify Stripe webhook signature using Web Crypto API
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  tolerance = 300 // 5 minutes
): Promise<boolean> {
  const parts = sigHeader.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > tolerance) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload)
  );
  const expectedSigBytes = new Uint8Array(signatureBytes);

  // Constant-time comparison to prevent timing attacks
  function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }

  function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  return signatures.some((sig) => {
    try {
      const sigBytes = hexToBytes(sig);
      return timingSafeEqual(sigBytes, expectedSigBytes);
    } catch {
      return false;
    }
  });
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Verify webhook signature
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const isValid = await verifyStripeSignature(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
    if (!isValid) {
      console.error("Webhook signature verification failed");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const event = JSON.parse(body);
    console.log(`Received event: ${event.type}`);

    switch (event.type) {
      // ─── Payment succeeded ───────────────────────────────────────────
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const bookingIdFromMeta = paymentIntent.metadata?.booking_id;
        const clientId = paymentIntent.metadata?.client_id;
        const therapistId = paymentIntent.metadata?.therapist_id;
        const connectedAccountId = paymentIntent.metadata?.connected_account_id;
        const serviceId = paymentIntent.metadata?.service_id;
        const packSessionsRemaining = parseInt(paymentIntent.metadata?.pack_sessions_remaining ?? "0", 10);

        if (!clientId || !therapistId) {
          console.error(
            "Missing metadata on payment_intent:",
            paymentIntent.id
          );
          break;
        }

        const currency = paymentIntent.currency;

        // Read fee breakdown from metadata (set by create-payment-intent)
        const sessionPriceCents = parseInt(paymentIntent.metadata?.session_price ?? "0", 10);
        const commissionBaseCents = parseInt(paymentIntent.metadata?.commission_base ?? "0", 10);
        const ivaAmountCents = parseInt(paymentIntent.metadata?.iva_amount ?? "0", 10);
        const ivaApplied = paymentIntent.metadata?.iva_applied === "true";
        const serviceFeeCents = parseInt(paymentIntent.metadata?.service_fee ?? "0", 10);
        const therapistCountry = paymentIntent.metadata?.therapist_country ?? "";
        const totalChargedCents = parseInt(paymentIntent.metadata?.total_charged ?? String(paymentIntent.amount), 10);

        // Convert cents to currency units
        const amount = sessionPriceCents / 100;       // session price (what booking.price was)
        const totalCharged = totalChargedCents / 100; // what the client actually paid
        const commissionBase = commissionBaseCents / 100;
        const ivaAmount = ivaAmountCents / 100;
        const serviceFee = serviceFeeCents / 100;
        const platformFee = commissionBase + ivaAmount; // platform keeps commission + IVA
        const therapistPayout = totalCharged - platformFee - serviceFee; // therapist net

        // Escrow tracking: with destination charges, Stripe transfers the
        // therapist's share immediately. The payout_after field tracks a 14-day
        // escrow window for our internal ledger. process-pending-payouts marks
        // the transaction as "paid" once this window elapses (no new Stripe
        // Transfer is created — the funds are already in the connected account).
        const payoutAfter = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        // Find the booking: first try metadata, then look up by payment intent ID
        let bookingId = bookingIdFromMeta || null;
        if (!bookingId) {
          const { data: booking } = await supabaseAdmin
            .from("bookings")
            .select("id")
            .eq("stripe_payment_intent_id", paymentIntent.id)
            .maybeSingle();
          bookingId = booking?.id || null;
        }

        // Create or update transaction record. Uses upsert so that if a
        // "failed" transaction already exists (from payment_intent.payment_failed),
        // it gets overwritten with the successful data. Also handles concurrent
        // webhook delivery via the UNIQUE constraint on stripe_payment_intent_id.
        {
          const txData = {
            booking_id: bookingId || null,
            client_id: clientId,
            therapist_id: therapistId,
            amount: amount,
            platform_fee: platformFee,
            therapist_payout: therapistPayout,
            currency: currency,
            status: "completed",
            stripe_payment_intent_id: paymentIntent.id,
            payout_status: "pending",
            payout_after: payoutAfter,
            stripe_connected_account_id: connectedAccountId || null,
            total_charged: totalCharged,
            commission_base: commissionBase,
            iva_amount: ivaAmount,
            iva_applied: ivaApplied,
            service_fee: serviceFee,
            therapist_country: therapistCountry,
            updated_at: new Date().toISOString(),
          };

          // Try insert first
          const { error: txError } = await supabaseAdmin
            .from("transactions")
            .insert(txData);

          if (txError) {
            if (txError.code === "23505") {
              // Transaction already exists (e.g., from a failed attempt).
              // Update it to "completed" with the correct fee data.
              const { error: updateError } = await supabaseAdmin
                .from("transactions")
                .update(txData)
                .eq("stripe_payment_intent_id", paymentIntent.id);

              if (updateError) {
                console.error("Failed to update existing transaction:", updateError);
              } else {
                console.log(`Updated existing transaction to completed for ${paymentIntent.id}`);
              }
            } else {
              console.error("Failed to insert transaction:", txError);
            }
          } else if (!bookingId) {
            console.warn(`Ghost payment recorded: no booking found for ${paymentIntent.id}. Transaction saved for manual review.`);
          }
        }

        // Update booking status to confirmed if we found one
        if (bookingId) {
          const { error: bookingError } = await supabaseAdmin
            .from("bookings")
            .update({
              status: "confirmed",
              stripe_payment_intent_id: paymentIntent.id,
            })
            .eq("id", bookingId);

          if (bookingError) {
            console.error("Failed to update booking:", bookingError);
          } else {
            // Sync to Google/Microsoft Calendar. This MUST be non-blocking
            // because a token-refresh failure (revoked OAuth) would otherwise
            // throw before session_credits are created for pack purchases,
            // leaving the client paid but without credits. Swallow all errors
            // here — the booking is already confirmed; calendar sync is best-effort.
            try {
              await syncBookingToCalendar(bookingId, therapistId, supabaseAdmin);
            } catch (calErr) {
              console.error(
                `[stripe-webhook] Calendar sync failed for booking ${bookingId} (non-blocking):`,
                calErr instanceof Error ? calErr.message : String(calErr)
              );
            }
          }

          if (serviceId && packSessionsRemaining > 0) {
            const { data: existingCredit } = await supabaseAdmin
              .from("session_credits")
              .select("id")
              .eq("pack_booking_id", bookingId)
              .maybeSingle();

            if (!existingCredit) {
              const { error: creditError } = await supabaseAdmin
                .from("session_credits")
                .insert({
                  client_id: clientId,
                  therapist_id: therapistId,
                  service_id: serviceId,
                  pack_booking_id: bookingId,
                  sessions_total: packSessionsRemaining,
                  sessions_remaining: packSessionsRemaining,
                });

              if (creditError) {
                console.error("Failed to create session credits:", creditError);
              }
            }
          }
        }

        // Save the payment method for future use
        if (paymentIntent.payment_method && clientId) {
          try {
            const pm = await stripeRequest(
              "GET",
              `/payment_methods/${paymentIntent.payment_method}`
            );

            if (pm.card) {
              // Check if already saved
              const { data: existing } = await supabaseAdmin
                .from("payment_methods")
                .select("id")
                .eq("user_id", clientId)
                .eq("stripe_payment_method_id", pm.id)
                .maybeSingle();

              if (!existing) {
                await supabaseAdmin.from("payment_methods").insert({
                  user_id: clientId,
                  stripe_payment_method_id: pm.id,
                  brand: pm.card.brand || "unknown",
                  last4: pm.card.last4 || "****",
                  expiry_month: pm.card.exp_month,
                  expiry_year: pm.card.exp_year,
                  is_default: false,
                });
              }
            }
          } catch (pmErr) {
            console.error("Failed to save payment method:", pmErr);
          }
        }

        console.log(
          `Payment succeeded for intent ${paymentIntent.id}: $${amount}`
        );
        break;
      }

      // ─── Payment failed ──────────────────────────────────────────────
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const bookingIdFromMeta = paymentIntent.metadata?.booking_id;
        const clientId = paymentIntent.metadata?.client_id;
        const therapistId = paymentIntent.metadata?.therapist_id;

        // Find the booking: first try metadata, then look up by payment intent ID
        let bookingId = bookingIdFromMeta || null;
        if (!bookingId) {
          const { data: booking } = await supabaseAdmin
            .from("bookings")
            .select("id")
            .eq("stripe_payment_intent_id", paymentIntent.id)
            .maybeSingle();
          bookingId = booking?.id || null;
        }

        if (bookingId) {
          const { error } = await supabaseAdmin.from("transactions").insert({
            booking_id: bookingId,
            client_id: clientId,
            therapist_id: therapistId,
            amount: paymentIntent.amount / 100,
            platform_fee: 0,
            therapist_payout: 0,
            currency: paymentIntent.currency,
            status: "failed",
            stripe_payment_intent_id: paymentIntent.id,
          });

          if (error) {
            console.error("Failed to insert failed transaction:", error);
          }
        }

        console.log(`Payment failed for intent ${paymentIntent.id}`);
        break;
      }

      // ─── Refund created ──────────────────────────────────────────────
      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;

        if (paymentIntentId) {
          const refundedAmount = (charge.amount_refunded || 0) / 100;
          const totalAmount = (charge.amount || 0) / 100;
          const isFullRefund = refundedAmount >= totalAmount;

          const { error } = await supabaseAdmin
            .from("transactions")
            .update({
              status: isFullRefund ? "refunded" : "partially_refunded",
              refund_amount: refundedAmount,
            })
            .eq("stripe_payment_intent_id", paymentIntentId);

          if (error) {
            console.error("Failed to update transaction refund:", error);
          }

          // If full refund, cancel the booking
          if (isFullRefund) {
            const { data: tx } = await supabaseAdmin
              .from("transactions")
              .select("booking_id")
              .eq("stripe_payment_intent_id", paymentIntentId)
              .maybeSingle();

            if (tx?.booking_id) {
              await supabaseAdmin
                .from("bookings")
                .update({ status: "cancelled" })
                .eq("id", tx.booking_id);
            }
          }

          console.log(
            `Refund processed: $${refundedAmount} for ${paymentIntentId}`
          );
        }
        break;
      }

      // ─── Connect account updated ─────────────────────────────────────
      case "account.updated": {
        const account = event.data.object;
        // Prefer metadata lookup; fall back to matching by stripe_connected_account_id
        const therapistProfileId: string | null =
          account.metadata?.therapist_profile_id ?? null;

        let status = "onboarding_pending";
        if (account.charges_enabled && account.payouts_enabled) {
          status = "active";
        } else if (account.requirements?.disabled_reason) {
          status = "restricted";
        } else if (account.details_submitted) {
          status = "onboarding_pending";
        }

        if (therapistProfileId) {
          const { error } = await supabaseAdmin
            .from("therapist_profiles")
            .update({ stripe_account_status: status })
            .eq("id", therapistProfileId);

          if (error) {
            console.error("Failed to update therapist stripe status (by profile id):", error);
          } else {
            console.log(`Connect account ${account.id} status updated to: ${status}`);
          }
        } else {
          // Fallback: look up by the Stripe account ID stored on the profile
          const { error } = await supabaseAdmin
            .from("therapist_profiles")
            .update({ stripe_account_status: status })
            .eq("stripe_connected_account_id", account.id);

          if (error) {
            console.error("Failed to update therapist stripe status (by account id):", error);
          } else {
            console.log(`Connect account ${account.id} status updated to: ${status} (matched by account id)`);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
