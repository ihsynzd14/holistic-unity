import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
import { DetachPaymentMethodSchema, parseJson } from "../_shared/validate.ts";

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
    const parts: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        parts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
        );
      }
    }
    encodedBody = parts.join("&");
  }

  const res = await fetch(url, { method, headers, body: encodedBody });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Stripe API error: ${res.status}`);
  }
  return data;
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

    // Rate limit: max 5 detach requests per user per minute
    if (await isRateLimited(`detach-pm:${user.id}`, 5, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // Input validation via Zod — enforces payment_method_row_id is a UUID.
    const parsed = await parseJson(req, DetachPaymentMethodSchema, corsHeaders);
    if (!parsed.success) return parsed.response;
    const { payment_method_row_id } = parsed.data;

    // Look up the payment method row to get the Stripe payment method ID
    // and verify ownership in one query
    const { data: pmRow, error: pmError } = await supabaseAdmin
      .from("payment_methods")
      .select("id, user_id, stripe_payment_method_id")
      .eq("id", payment_method_row_id)
      .maybeSingle();

    if (pmError) {
      console.error("Failed to look up payment method:", pmError);
      return new Response(
        JSON.stringify({ error: "Failed to look up payment method" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!pmRow) {
      return new Response(
        JSON.stringify({ error: "Payment method not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify the requesting user owns this payment method
    if (pmRow.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You can only remove your own payment methods" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 1. Detach from Stripe (removes from the customer object)
    if (pmRow.stripe_payment_method_id) {
      try {
        await stripeRequest(
          "POST",
          `/payment_methods/${pmRow.stripe_payment_method_id}/detach`
        );
        console.log(
          `Detached Stripe payment method ${pmRow.stripe_payment_method_id} for user ${user.id}`
        );
      } catch (stripeErr) {
        // If Stripe says the PM is already detached or not found, proceed with DB cleanup
        const msg = (stripeErr as Error).message || "";
        if (
          msg.includes("No such PaymentMethod") ||
          msg.includes("has already been detached")
        ) {
          console.warn(
            `Stripe PM ${pmRow.stripe_payment_method_id} already detached or not found, proceeding with DB cleanup`
          );
        } else {
          throw stripeErr;
        }
      }
    }

    // 2. Delete from our database
    const { error: deleteError } = await supabaseAdmin
      .from("payment_methods")
      .delete()
      .eq("id", payment_method_row_id);

    if (deleteError) {
      console.error("Failed to delete payment method row:", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to remove payment method from database" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("detach-payment-method error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
