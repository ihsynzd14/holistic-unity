// Meta CAPI auth-hook — fires `CompleteRegistration` server-side after
// a successful signUp. Called explicitly from the frontend
// (register/page.tsx and welcome/page.tsx) so we get the user's _fbp /
// _fbc cookies forwarded for highest match quality. The PDF brief
// labels this "Opzione B" — the simpler alternative to wiring a
// native Supabase Auth Hook.
//
// Why not also call this from a Supabase Auth Hook (Opzione A)?
//   Auth Hooks fire from inside Postgres and have no access to the
//   originating browser's cookies. We'd send a server event with no
//   fbp/fbc, losing the ad-click attribution we worked to keep through
//   the funnel. The frontend call has the cookies; we use it.
//
// Request body:
//   { user_id: string,            // Supabase auth.users.id (uuid)
//     email?: string,             // canonical email — caller controls
//     fbp?: string,               // _fbp browser cookie
//     fbc?: string,               // _fbc browser cookie
//     source_url?: string }       // window.location.href at signup
//
// Response (always 200, even when Meta is unreachable — caller never
// cares about the conversion path's health):
//   { ok: boolean, event_id: "registration_<user_id>" }
//
// Deploy: `supabase functions deploy auth-hook --no-verify-jwt`

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  getCorsHeaders,
  handleCorsPreflightOrNull,
} from "../_shared/cors.ts";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import {
  buildEventId,
  extractClientIp,
  sendCapiEvent,
} from "../_shared/meta_capi.ts";

interface AuthHookBody {
  user_id?: string;
  email?: string;
  fbp?: string;
  fbc?: string;
  source_url?: string;
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

  let body: AuthHookBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Loose UUID v4-ish check — Supabase auth.users.id is always a UUID,
  // so anything else is a misuse. Avoids accidentally hashing arbitrary
  // strings into Meta's external_id space.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return new Response(JSON.stringify({ error: "user_id must be a uuid" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Rate limit per IP + per user_id ──────────────────────────────────
  // Per IP: 20/hour. Generous for testing flows where the same dev
  // re-registers, brutal for someone scripting Meta CAPI floods.
  // Per user: 5/hour. A real user signs up once; multiple fires for
  // the same user_id are either bugs or abuse. Both are cheap to cap.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (await isRateLimited(`capi-auth:ip:${ip}`, 20, 60 * 60_000)) {
    return rateLimitResponse(corsHeaders);
  }
  if (await isRateLimited(`capi-auth:user:${userId}`, 5, 60 * 60_000)) {
    return rateLimitResponse(corsHeaders);
  }

  const eventId = buildEventId("registration", userId);

  const result = await sendCapiEvent({
    eventName: "CompleteRegistration",
    eventId,
    email: typeof body.email === "string" ? body.email : undefined,
    externalId: userId,
    clientIp: extractClientIp(req),
    clientUserAgent: req.headers.get("user-agent") ?? undefined,
    fbp: typeof body.fbp === "string" ? body.fbp : undefined,
    fbc: typeof body.fbc === "string" ? body.fbc : undefined,
    actionSource: "website",
    eventSourceUrl: typeof body.source_url === "string"
      ? body.source_url
      : undefined,
    customData: { content_name: "client_register" },
  });

  return new Response(
    JSON.stringify({
      ok: result !== null,
      event_id: eventId,
      events_received: Number(result?.events_received ?? 0),
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
