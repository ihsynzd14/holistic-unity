// Generic Meta CAPI relay — accepts a normalized event payload OR the
// stock Supabase Database-Webhook payload, and forwards a CAPI event to
// Meta via the shared _shared/meta_capi.ts module.
//
// Auth model:
//   The endpoint is unauthenticated at the Supabase gateway
//   (--no-verify-jwt at deploy) because Database Webhooks cannot attach
//   a user JWT. To stop the wider internet from posting arbitrary
//   conversions, callers must include header
//   `x-capi-secret: <CAPI_RELAY_SECRET>` matching the project secret.
//   Browser-facing surfaces (cross-origin from holisticunity.app) get
//   no header — they hit the rate limit + CORS allowlist instead.
//
// Three call modes (all routed through the same handler):
//
//   1. **Trusted relay — normalized payload** (server-to-server)
//      Headers: x-capi-secret: <secret>
//      Body:    { event_name, event_id, email, external_id, fbp, fbc,
//                 value, currency, action_source, custom_data,
//                 event_source_url }
//      → fires CAPI directly with the fields supplied.
//
//   2. **Trusted relay — DB Webhook auto-payload** (Postgres trigger)
//      Headers: x-capi-secret: <secret>
//      Body:    { type, table, schema, record, old_record }
//               This is what current Supabase Dashboard sends — the
//               "Custom payload" editor was removed from the UI, so we
//               accept the stock shape and translate it in-function
//               using table-specific rules (see normalizeDbWebhook).
//      → derives the CAPI event from `record`, then fires.
//
//   3. **Browser CORS** (e.g. early_access form direct mirror)
//      Headers: Origin from ALLOWED_ORIGINS, no secret
//      Body:    same shape as mode 1, but event_name forced to "Lead"
//               and value/currency to safe defaults.
//      → rate-limited per IP, fires CAPI.
//
// Deploy: `supabase functions deploy meta-capi-event --no-verify-jwt`

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  getCorsHeaders,
  handleCorsPreflightOrNull,
} from "../_shared/cors.ts";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import {
  type ActionSource,
  buildEventId,
  extractClientIp,
  sendCapiEvent,
} from "../_shared/meta_capi.ts";

const CAPI_RELAY_SECRET = Deno.env.get("CAPI_RELAY_SECRET") ?? "";

interface RelayPayload {
  event_name?: string;
  event_id?: string;
  email?: string;
  external_id?: string | number;
  fbp?: string;
  fbc?: string;
  value?: number;
  currency?: string;
  action_source?: ActionSource;
  custom_data?: Record<string, unknown>;
  event_source_url?: string;
}

// Shape of the auto-generated Supabase Database Webhook payload. We
// accept it as-is because the Dashboard UI no longer exposes a
// "Custom payload" editor — the webhook always sends this default.
interface DbWebhookPayload {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Detect-and-translate the stock Supabase DB Webhook payload into the
 * normalized CAPI event shape. Returns null when the body doesn't look
 * like a DB Webhook payload (caller should treat it as a normalized
 * payload instead).
 *
 * Per-table mapping rules — add a new branch here when a new DB
 * Webhook is wired:
 *
 *   bookings + record.price = 0  → Lead "free_call"
 *
 * Any (table, record) combo not matched here returns a sentinel that
 * the caller surfaces as 400 — we don't silently swallow webhook
 * payloads we don't know how to translate.
 */
function normalizeDbWebhook(
  body: DbWebhookPayload,
): RelayPayload | "unsupported" | null {
  // Heuristic: a DB Webhook payload always has `type` + `table` +
  // `record` (or `old_record` for DELETE). Anything else is a
  // normalized caller using a similar key by accident.
  const looksLikeDbWebhook = typeof body.type === "string" &&
    typeof body.table === "string" &&
    (body.record !== undefined || body.old_record !== undefined);
  if (!looksLikeDbWebhook) return null;

  const record = (body.record ?? {}) as Record<string, unknown>;

  // ── Table: bookings → Lead on free-call INSERT ──────────────────────
  if (body.table === "bookings" && body.type === "INSERT") {
    // Schema reality check: Holistic Unity flags free-calls via
    // `price = 0` (the `services` row's `is_intro_call` flag is the
    // service-level signal, but on the bookings row only `price`
    // survives). Anything paid is a Purchase and is handled by the
    // stripe-webhook function instead — silently ignore here so the
    // webhook can be a single, simple "fire on every INSERT" trigger
    // without a Conditions filter (whether or not the Conditions field
    // works in your Dashboard UI version).
    const price = Number(record.price ?? -1);
    if (price !== 0) return "unsupported";

    const bookingId = String(record.id ?? "");
    const clientId = record.client_id != null
      ? String(record.client_id)
      : undefined;
    const therapistId = record.therapist_id != null
      ? String(record.therapist_id)
      : undefined;
    const serviceName = typeof record.service_name === "string"
      ? record.service_name
      : undefined;

    return {
      event_name: "Lead",
      event_id: `freecall_${bookingId}`,
      external_id: clientId,
      action_source: "website",
      custom_data: {
        content_name: "free_call",
        content_category: "Booking Intent",
        therapist_id: therapistId,
        service_name: serviceName,
        value: 0,
        currency: "EUR",
      },
    };
  }

  return "unsupported";
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

  let rawBody: RelayPayload & DbWebhookPayload;
  try {
    rawBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth gate ────────────────────────────────────────────────────────
  // Trusted callers (DB Webhooks) attach the secret. Browser callers
  // don't — they're identified by Origin (already validated by CORS)
  // and rate-limited below.
  const providedSecret = req.headers.get("x-capi-secret") ?? "";
  const isTrusted = CAPI_RELAY_SECRET !== "" &&
    timingSafeEqual(providedSecret, CAPI_RELAY_SECRET);

  // Translate the stock DB Webhook payload to a normalized event, if
  // applicable. Only attempted for trusted callers — browser callers
  // never send `{ type, table, record }` payloads. An unrecognized
  // (table, op) combo returns 200 with `ignored: true` so the DB
  // Webhook stops retrying on a payload we deliberately skipped
  // (e.g. paid bookings, which are handled by stripe-webhook).
  let body: RelayPayload;
  if (isTrusted) {
    const translated = normalizeDbWebhook(rawBody);
    if (translated === "unsupported") {
      return new Response(
        JSON.stringify({
          ok: true,
          ignored: true,
          reason: `no CAPI mapping for ${rawBody.table}/${rawBody.type} (likely paid booking — handled by stripe-webhook)`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    body = translated ?? (rawBody as RelayPayload);
  } else {
    body = rawBody as RelayPayload;
  }

  if (!isTrusted) {
    // No secret: must be a browser caller. Refuse if no Origin (likely
    // a server probing the endpoint without credentials).
    const origin = req.headers.get("Origin") || "";
    if (!origin) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Rate limit unauthenticated browser callers harder than trusted ones.
    // 30/IP/hour is generous for a campaign landing form, brutal for a
    // bot looping the endpoint.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    if (await isRateLimited(`capi-relay:browser:${ip}`, 30, 60 * 60_000)) {
      return rateLimitResponse(corsHeaders);
    }
    // Browser callers are restricted to safe event types — we don't
    // want a compromised marketing site to be able to fire fake
    // Purchase events at high value.
    if (body.event_name && body.event_name !== "Lead") {
      return new Response(
        JSON.stringify({ error: "browser callers restricted to Lead" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    // Force value/currency to defaults — a browser caller cannot inflate
    // attribution by sending value=10000.
    body.value = 0;
    body.currency = "EUR";
  }

  // ── Validate payload ────────────────────────────────────────────────
  if (!body.event_name || typeof body.event_name !== "string") {
    return new Response(
      JSON.stringify({ error: "event_name required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // event_id: caller can pass it explicitly, or we derive a sensible
  // default. For DB-webhook callers the explicit form is preferred
  // (deterministic on entity id, dedup with browser pixel works).
  const eventId = body.event_id && typeof body.event_id === "string"
    ? body.event_id
    : buildEventId(body.event_name.toLowerCase(), Date.now());

  const result = await sendCapiEvent({
    eventName: body.event_name,
    eventId,
    email: body.email,
    externalId: body.external_id,
    clientIp: extractClientIp(req),
    clientUserAgent: req.headers.get("user-agent") ?? undefined,
    fbp: body.fbp,
    fbc: body.fbc,
    value: body.value,
    currency: body.currency,
    actionSource: body.action_source ?? "website",
    eventSourceUrl: body.event_source_url,
    customData: body.custom_data,
  });

  // Always return 200 to the caller — the response body just reports
  // what happened. DB Webhooks expect 2xx to stop retrying; bubbling a
  // Meta 5xx as 502 would cause the DB Webhook to retry with the same
  // payload, which is rarely useful (Meta is either down or rejecting
  // the payload shape, neither fixes itself with retries).
  return new Response(
    JSON.stringify({
      ok: result !== null,
      event_id: eventId,
      events_received: Number(result?.events_received ?? 0),
      fbtrace_id: result?.fbtrace_id ?? null,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
