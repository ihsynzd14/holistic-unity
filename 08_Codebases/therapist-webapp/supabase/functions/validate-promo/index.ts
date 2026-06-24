// validate-promo — V1 stub
//
// The iOS app's BookingFlowView.swift calls this Edge Function when the
// user types a promo code. Until V1.1 we don't have a real promo
// catalog, but the function MUST exist on the server: without it the
// iOS request fails silently (network 404) and the user sees no
// feedback at all. With this stub the user gets a clear "code not
// recognised" response and the rest of the booking flow continues
// normally with `discount = 0`.
//
// When V1.1 lights up promotions:
//   1. Replace the body of `lookupCode` to query a `promo_codes` table
//   2. Return an HMAC-signed discount payload that
//      `create-booking-with-payment` can verify before applying
//      (do NOT trust client-sent discount values).
//   3. Update this comment.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type ValidateRequest = {
  code?: unknown;
  therapistId?: unknown;
  servicePrice?: unknown;
};

type ValidateResponse =
  | {
      valid: true;
      discountCents: number;
      // HMAC over (code|therapistId|servicePrice|expiresAt) so
      // create-booking-with-payment can verify the discount wasn't
      // tampered with by the client. Required when V1.1 ships.
      signature: string;
      expiresAt: string;
    }
  | {
      valid: false;
      reason:
        | "code_required"
        | "code_not_found"
        | "code_expired"
        | "code_already_redeemed"
        | "promo_codes_not_supported_v1";
    };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function json(body: ValidateResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  let body: ValidateRequest = {};
  try {
    body = (await req.json()) as ValidateRequest;
  } catch {
    // Empty/malformed body is treated as missing code.
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return json({ valid: false, reason: "code_required" }, 200);
  }

  // V1 stub: no codes are valid. Return a stable, parseable response
  // so the iOS app can show "Codice non riconosciuto" in the UI.
  return json(
    { valid: false, reason: "promo_codes_not_supported_v1" },
    200,
  );
});
