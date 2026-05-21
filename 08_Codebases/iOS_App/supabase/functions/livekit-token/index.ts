import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AccessToken,
  VideoGrant,
} from "https://esm.sh/livekit-server-sdk@2.6.1";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import { LivekitTokenSchema, parseJson } from "../_shared/validate.ts";

const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY")!;
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET")!;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  try {
    // Verify the Supabase auth JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use the service role client to verify the user's JWT.
    // This avoids failures when the access token is slightly expired but
    // the request is still legitimate (the iOS client refreshes tokens
    // automatically, but there can be a small race window).
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Extract the raw JWT from the Authorization header
    const jwt = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 20 token requests/min per user. Legitimate flow is 1-2 per
    // call; higher rate is enumeration / brute-force of room names.
    if (await isRateLimited(`livekit-token:${user.id}`, 20, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // Parse + validate request body via Zod schema.
    const parsed = await parseJson(req, LivekitTokenSchema, corsHeaders);
    if (!parsed.success) return parsed.response;
    const { roomName, participantName } = parsed.data;

    // Verify the user is a participant in a booking with this room name
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, client_id, therapist_id, status, scheduled_at, duration")
      .eq("video_room_id", roomName)
      .single();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "No booking found for this room" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (booking.client_id !== user.id && booking.therapist_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You are not a participant in this session" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const scheduledAt = new Date(booking.scheduled_at).getTime();
    const now = Date.now();
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

    // Active statuses: joinable any time on the session day
    const activeStatuses = ["confirmed", "in_progress", "reschedule_pending"];
    // Completed: allow rejoin within 3 hours of scheduled start (covers accidental disconnects)
    const isCompletedWithinGrace =
      booking.status === "completed" && now <= scheduledAt + THREE_HOURS_MS && now >= scheduledAt;

    if (!activeStatuses.includes(booking.status) && !isCompletedWithinGrace) {
      let statusMessage: string;
      if (booking.status === "cancelled") {
        statusMessage = "This session has been cancelled and can no longer be joined.";
      } else if (booking.status === "completed") {
        statusMessage = "The 3-hour rejoin window for this session has expired.";
      } else if (booking.status === "pending") {
        statusMessage = "This session has not been confirmed yet. Please wait for confirmation.";
      } else {
        statusMessage = "This session is not currently available to join.";
      }
      return new Response(
        JSON.stringify({ error: statusMessage }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Time window: active sessions = full day, completed = within 3h grace
    const scheduledDate = new Date(booking.scheduled_at);
    const dayStart = new Date(scheduledDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // For completed sessions the grace period already checked above is sufficient.
    // For active sessions, enforce the full-day window.
    if (activeStatuses.includes(booking.status) && (now < dayStart.getTime() || now >= dayEnd.getTime())) {
      return new Response(
        JSON.stringify({ error: "This video session is outside the allowed join window (session day only)" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Sanitize participant name (limit length)
    const safeName = (participantName || user.email || "Participant")
      .substring(0, 100);

    // Mint a LiveKit access token.
    // TTL = 1 hour: therapy sessions are 45–60 min, so 1h gives enough
    // headroom for reconnects without making leaked tokens useful for long.
    // If the user rejoins after 1h, iOS calls this endpoint again and
    // gets a fresh token.
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: safeName,
      ttl: "1h",
    });

    const grant: VideoGrant = {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    };
    at.addGrant(grant);

    const token = await at.toJwt();

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
