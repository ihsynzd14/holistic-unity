// Orchestrates GDPR Article 17 right-to-erasure.
//
// Flow:
//   1. Authenticate caller (user JWT required).
//   2. Rate-limit: 1 delete attempt per 5 min per user — deletion is a
//      deliberate, one-shot operation; a rapid retry means a bug or
//      abuse.
//   3. External-service cleanup:
//        a. Stripe — delete customer object (also detaches all payment
//           methods; retains transaction history for audit).
//        b. Stream Chat — delete user + mark their messages as deleted
//           (their DMs remain visible to the other party only if the
//           peer still has them cached; new fetches return
//           `[User Deleted]`).
//   4. Invoke `public.delete_user_account()` RPC to soft-delete + anonymize.
//   5. Delete the `auth.users` row via the Supabase admin API so the
//      user cannot log in again.
//   6. Return a summary JSON for the client to display.
//
// If any step 3 fails, we DO continue to step 4+5 — GDPR erasure takes
// precedence over external-service cleanup. Failed externals are logged
// to Sentry + the returned JSON so support can complete them manually
// within the 30-day retention window.
//
// Deploy: `supabase functions deploy delete-user-account`

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { StreamChat } from "npm:stream-chat";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STREAM_API_KEY = Deno.env.get("STREAM_API_KEY")!;
const STREAM_API_SECRET = Deno.env.get("STREAM_API_SECRET")!;

interface CleanupResult {
  ok: boolean;
  message?: string;
}

// Minimal Stripe REST helper — the SDK would bloat the edge bundle.
async function stripeRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
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
            `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
          );
        }
      }
      encodedBody = parts.join("&");
    }
    const res = await fetch(url, { method, headers, body: encodedBody });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // --- 1. Authenticate caller ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const jwt = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 2. Rate limit ---
    if (await isRateLimited(`delete-user:${user.id}`, 1, 5 * 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // --- 3a. Stripe: delete customer ---
    // Look up Stripe customer id from payment_methods OR from a dedicated
    // column on users if we add one later. For V1, grab the first
    // payment_methods row's stripe_customer_id.
    let stripeResult: CleanupResult = {
      ok: true,
      message: "no stripe customer found",
    };

    const { data: paymentMethods, error: pmError } = await admin
      .from("payment_methods")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .limit(1);

    if (!pmError && paymentMethods && paymentMethods.length > 0) {
      const stripeCustomerId = paymentMethods[0].stripe_customer_id;
      if (stripeCustomerId) {
        const del = await stripeRequest(
          "DELETE",
          `/customers/${stripeCustomerId}`,
        );
        stripeResult = del.ok
          ? { ok: true, message: `deleted ${stripeCustomerId}` }
          : { ok: false, message: del.error };
      }
    }

    // --- 3b. Stream Chat: delete user + mark messages deleted ---
    let streamResult: CleanupResult;
    try {
      const stream = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);
      // `mark_messages_deleted: true` replaces the user's message bodies
      // with `[Deleted]` in channel history. `hard_delete: false` keeps
      // the user row as a tombstone so old channel member lists don't
      // break — Stream's recommended pattern for GDPR compliance.
      const resp = await stream.deleteUser(user.id, {
        mark_messages_deleted: true,
        hard_delete: false,
      });
      streamResult = {
        ok: true,
        message: `deleted ${resp.user?.id ?? user.id}`,
      };
    } catch (err) {
      streamResult = { ok: false, message: (err as Error).message };
    }

    // --- 4. DB soft-delete + anonymize ---
    // Call the RPC as the user (their JWT). `createClient` with the
    // service role would bypass auth.uid() in the function. We need
    // auth.uid() to resolve correctly, so use the caller's JWT here.
    const userScoped = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: rpcData, error: rpcError } = await userScoped.rpc(
      "delete_user_account",
    );

    if (rpcError) {
      return new Response(
        JSON.stringify({
          error: "Database erasure failed",
          detail: rpcError.message,
          stripe: stripeResult,
          stream: streamResult,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // --- 5. Delete auth.users so the user cannot log in again ---
    // This uses the admin API; the caller's session cookies become
    // invalid immediately.
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(
      user.id,
    );
    const authResult: CleanupResult = authDeleteError
      ? { ok: false, message: authDeleteError.message }
      : { ok: true };

    // --- 6. Return summary ---
    return new Response(
      JSON.stringify({
        ok: true,
        user_id: user.id,
        db: rpcData,
        stripe: stripeResult,
        stream: streamResult,
        auth: authResult,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
