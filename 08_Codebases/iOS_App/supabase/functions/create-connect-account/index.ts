import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const PAYOUT_DELAY_DAYS = 14;
const PAYOUT_WEEKLY_ANCHOR = "friday";
const ITALY_VARIANTS = new Set(["IT", "ITALY", "ITALIA"]);

// Helper to call Stripe REST API directly (avoids SDK import issues in Deno)
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

  const res = await fetch(url, {
    method,
    headers,
    body: encodedBody,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Stripe API error: ${res.status}`);
  }
  return data;
}

// Encode nested objects into Stripe's form-encoded format
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

function normalizeStripeCountry(country?: string | null): string | undefined {
  const raw = country?.trim();
  if (!raw) return undefined;

  const upper = raw.toUpperCase();
  if (ITALY_VARIANTS.has(upper)) return "IT";
  if (upper.length == 2) return upper;
  return undefined;
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

    // Parse request
    const { therapist_id } = await req.json();

    if (!therapist_id) {
      return new Response(
        JSON.stringify({ error: "therapist_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify the user is the therapist
    // In this schema, therapist_profiles.id IS the user's auth ID (FK to users.id)
    const { data: therapistProfile, error: profileError } = await supabaseAdmin
      .from("therapist_profiles")
      .select("id, stripe_connected_account_id, stripe_account_status, country")
      .eq("id", therapist_id)
      .single();

    if (profileError || !therapistProfile) {
      return new Response(
        JSON.stringify({
          error: "Therapist profile not found",
          detail: profileError?.message,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // therapist_profiles.id = users.id, so verify the caller owns this profile
    if (therapistProfile.id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You can only set up your own payment account" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripeCountry = normalizeStripeCountry(therapistProfile.country);

    let accountId = therapistProfile.stripe_connected_account_id;

    // Create a new Connect account if one doesn't exist
    if (!accountId) {
      const { data: userData } = await supabaseAdmin
        .from("users")
        .select("email, display_name")
        .eq("id", user.id)
        .single();

      const account = await stripeRequest("POST", "/accounts", {
        type: "express",
        country: stripeCountry,
        email: userData?.email || user.email || "",
        metadata: {
          supabase_user_id: user.id,
          therapist_profile_id: therapist_id,
        },
        capabilities: {
          card_payments: { requested: "true" },
          transfers: { requested: "true" },
        },
        business_type: "individual",
        settings: {
          payouts: {
            schedule: {
              interval: "weekly",
              weekly_anchor: PAYOUT_WEEKLY_ANCHOR,
              delay_days: PAYOUT_DELAY_DAYS,
            },
          },
        },
      });

      accountId = account.id;

      // Save the Connect account ID to the therapist profile
      await supabaseAdmin
        .from("therapist_profiles")
        .update({
          stripe_connected_account_id: accountId,
          stripe_account_status: "onboarding_pending",
        })
        .eq("id", therapist_id);
    }

    // Enforce the platform payout policy for both newly-created and existing
    // connected accounts. For Italy, Stripe's delay_days already uses calendar
    // days, so 14 means 14 calendar days.
    await stripeRequest("POST", `/accounts/${accountId}`, {
      settings: {
        payouts: {
          schedule: {
            interval: "weekly",
            weekly_anchor: PAYOUT_WEEKLY_ANCHOR,
            delay_days: PAYOUT_DELAY_DAYS,
          },
        },
      },
    });

    // Create an account link for onboarding (or re-onboarding)
    // Stripe requires https:// URLs — use Supabase function URL as intermediary
    // that redirects to the app's deep link
    const baseUrl = `${supabaseUrl}/functions/v1/connect-redirect`;
    const accountLink = await stripeRequest("POST", "/account_links", {
      account: accountId,
      refresh_url: `${baseUrl}?type=refresh`,
      return_url: `${baseUrl}?type=return`,
      type: "account_onboarding",
    });

    return new Response(
      JSON.stringify({
        onboarding_url: accountLink.url,
        account_id: accountId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("create-connect-account error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
