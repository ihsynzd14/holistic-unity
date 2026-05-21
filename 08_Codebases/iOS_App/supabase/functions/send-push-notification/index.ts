import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://deno.land/x/jose@v5.2.0/index.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";

const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID")!;
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID")!;
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY")!;
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID")!;
const APNS_ENVIRONMENT = Deno.env.get("APNS_ENVIRONMENT") || "development";

const APNS_HOST =
  APNS_ENVIRONMENT === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";

/**
 * Generates a short-lived APNs JWT for token-based authentication.
 */
async function getAPNsJWT(): Promise<string> {
  const privateKey = await jose.importPKCS8(APNS_PRIVATE_KEY, "ES256");
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: APNS_KEY_ID })
    .setIssuer(APNS_TEAM_ID)
    .setIssuedAt()
    .sign(privateKey);
  return jwt;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Authentication: This function is only called by the Supabase database
    // webhook (on notifications table insert). Only the service role key is
    // accepted — end-user JWTs are rejected to prevent abuse.
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    // Timing-safe comparison to prevent key leakage via response timing
    const encoder = new TextEncoder();
    const providedBytes = encoder.encode(token);
    const expectedBytes = encoder.encode(supabaseServiceKey);
    const isAuthorized =
      providedBytes.byteLength === expectedBytes.byteLength &&
      crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — service role key required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { record } = await req.json();

    // The `record` is the newly inserted row from the `notifications` table.
    const userId: string = record.user_id;
    const title: string = record.title;
    const body: string = record.body;
    const notificationType: string = record.type || "";
    const metadata = record.metadata ? JSON.parse(record.metadata) : {};

    // 1. Get user's device tokens (supports multiple devices)
    const { data: deviceTokens, error: tokenError } = await supabaseAdmin
      .from("device_tokens")
      .select("token")
      .eq("user_id", userId);

    if (tokenError || !deviceTokens || deviceTokens.length === 0) {
      return new Response(
        JSON.stringify({ skipped: "no device tokens" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Check user's notification preferences
    const { data: prefs } = await supabaseAdmin
      .from("user_notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    // If preferences exist, respect them
    if (prefs) {
      if (!prefs.push_enabled) {
        return new Response(
          JSON.stringify({ skipped: "push disabled by user" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Check category-specific preferences
      if (
        notificationType.includes("booking") &&
        !prefs.push_booking_reminders
      ) {
        return new Response(
          JSON.stringify({ skipped: "booking reminders disabled" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (
        notificationType.includes("message") &&
        !prefs.push_new_messages
      ) {
        return new Response(
          JSON.stringify({ skipped: "message notifications disabled" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (
        notificationType.includes("session") &&
        !prefs.push_session_reminders
      ) {
        return new Response(
          JSON.stringify({ skipped: "session reminders disabled" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (
        notificationType.includes("promotional") &&
        !prefs.push_promotional
      ) {
        return new Response(
          JSON.stringify({ skipped: "promotional notifications disabled" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // 3. Build APNs payload
    const payload = {
      aps: {
        alert: { title, body },
        sound: "default",
        badge: 1,
      },
      // Include metadata for deep linking on the client
      ...metadata,
      type: notificationType,
    };

    // 4. Send push via APNs HTTP/2 to all registered devices
    const apnsJWT = await getAPNsJWT();
    const results = [];

    for (const { token } of deviceTokens) {
      try {
        const apnsResponse = await fetch(
          `${APNS_HOST}/3/device/${token}`,
          {
            method: "POST",
            headers: {
              authorization: `bearer ${apnsJWT}`,
              "apns-topic": APNS_BUNDLE_ID,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "apns-expiration": "0",
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        const status = apnsResponse.status;
        let responseBody = "";
        try {
          responseBody = await apnsResponse.text();
        } catch {
          // Response may be empty on success
        }

        results.push({ token: token.substring(0, 8) + "...", status, responseBody });

        // If APNs returns 410 (Unregistered), remove the stale token
        if (status === 410) {
          await supabaseAdmin
            .from("device_tokens")
            .delete()
            .eq("user_id", userId)
            .eq("token", token);
        }
      } catch (err) {
        results.push({ token: token.substring(0, 8) + "...", error: err.message });
      }
    }

    return new Response(
      JSON.stringify({ sent: results.length, results }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
