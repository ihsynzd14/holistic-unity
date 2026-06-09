/**
 * Meta Conversions API (CAPI) — shared Deno helper for Edge Functions.
 *
 * Used by:
 *   - auth-hook                 → CompleteRegistration after signUp
 *   - meta-capi-event           → generic relay for DB webhooks
 *   - stripe-webhook            → Purchase on payment_intent.succeeded
 *   - save-early-access-lead    → Lead on the pre-launch funnel
 *
 * All four import { sendCapiEvent, buildEventId, extractClientIp } from
 * here. The module is intentionally framework-free (no Supabase SDK,
 * no Stripe SDK) so the same surface can be added to any future Edge
 * Function without dragging in deps.
 *
 * Why server-side at all (recap):
 *   Browser pixel events get blocked by iOS 14+ ATT (~40% loss), ad
 *   blockers (~25% of users), and Safari ITP cookie wipes. CAPI sends
 *   the same conversion from a datacenter IP with a token the browser
 *   never sees — none of those layers can intercept it.
 *
 * Required secrets (Supabase project secrets):
 *   META_PIXEL_ID=1445760663897743
 *   META_ACCESS_TOKEN=<System User token from Events Manager, doesn't expire>
 *   META_API_VERSION=v22.0
 *
 * Optional during QA — events flow to Events Manager → Test Events tab
 * instead of production:
 *   META_TEST_EVENT_CODE=TESTxxxxx
 *
 * Deduplication with the browser pixel: pass the SAME `event_id` to
 * both `fbq('track', name, params, { eventID })` AND
 * `sendCapiEvent({ event_id })`. Meta keeps one copy per
 * (event_name, event_id) within a 7-day window. Build the id with
 * `buildEventId(eventType, entityId)` on both sides so the value
 * matches without any explicit coordination.
 */

const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "1445760663897743";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_API_VERSION = Deno.env.get("META_API_VERSION") ?? "v22.0";
const META_TEST_EVENT_CODE = Deno.env.get("META_TEST_EVENT_CODE") || undefined;

const META_CAPI_URL =
  `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events`;

// 5s mirrors the reference Python module. Meta P95 is well under 1s; the
// extra headroom absorbs regional latency without holding a caller (e.g.
// the Stripe webhook) past Stripe's own 10s retry budget.
const HTTP_TIMEOUT_MS = 5000;

export type ActionSource =
  | "website"
  | "app"
  | "physical_store"
  | "system_generated"
  | "email"
  | "chat";

export interface CapiUserData {
  email?: string;
  /** E.164 without "+", e.g. "393331234567". Non-digits stripped before hash. */
  phone?: string;
  /** Internal user id (Supabase auth.users.id). Hashed before send. */
  externalId?: string | number;
  /** Real client IP — extract via extractClientIp(req). */
  clientIp?: string;
  /** Browser UA — req.headers.get("user-agent"). */
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
}

export interface SendCapiEventArgs extends CapiUserData {
  eventName: string;
  eventId: string;
  value?: number;
  currency?: string;
  customData?: Record<string, unknown>;
  actionSource?: ActionSource;
  eventSourceUrl?: string;
}

/**
 * Deterministic event_id shared with the browser pixel for dedup.
 *
 *   buildEventId("registration", user.id)        → "registration_<uuid>"
 *   buildEventId("purchase", booking.id)         → "purchase_<uuid>"
 *   buildEventId("lead", emailHash + bucket)     → "lead_<short>_<ts>"
 *
 * Use the same key on both sides (frontend pixel + this server) so Meta
 * collapses the pair into one event with the union of their signals.
 */
export function buildEventId(
  eventType: string,
  entityId: string | number,
): string {
  return `${eventType}_${entityId}`;
}

/**
 * Pull the real client IP from a Request, honouring reverse-proxy
 * headers Supabase Edge Network sets. Matches the reference Python
 * `extract_client_ip` order so behavior is consistent across surfaces.
 */
export function extractClientIp(req: Request): string | undefined {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || undefined;
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return undefined;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildUserData(d: CapiUserData): Promise<Record<string, unknown>> {
  const ud: Record<string, unknown> = {};
  if (d.email) ud.em = [await sha256Hex(d.email)];
  if (d.phone) {
    const digits = d.phone.replace(/\D/g, "");
    if (digits) ud.ph = [await sha256Hex(digits)];
  }
  if (
    d.externalId !== undefined && d.externalId !== null && d.externalId !== ""
  ) {
    ud.external_id = [await sha256Hex(String(d.externalId))];
  }
  if (d.clientIp) ud.client_ip_address = d.clientIp;
  if (d.clientUserAgent) ud.client_user_agent = d.clientUserAgent;
  if (d.fbp) ud.fbp = d.fbp;
  if (d.fbc) ud.fbc = d.fbc;
  return ud;
}

/**
 * Send one event to Meta's Conversions API.
 *
 * Returns the parsed JSON response on success, null on any failure —
 * by design this never throws and never blocks the caller, because the
 * caller is a conversion-critical path (webhook, signup confirmation)
 * where a dropped marketing event is strictly preferable to a broken
 * user flow.
 *
 * Fail-silent matrix:
 *   - Meta 4xx/5xx           → log + null. Don't retry; next genuine
 *                              conversion re-attempts and the lost
 *                              event is basis-points attribution loss,
 *                              not a user-facing bug.
 *   - Network timeout (>5s)  → log + null. Same reasoning.
 *   - Missing access token   → log + null. Lets staging boot without
 *                              the prod secret configured.
 *
 * Payload shape is byte-for-byte equivalent to the reference Python
 * module so Meta's `events_received` counter, Match Quality scoring,
 * and dedup against the browser pixel all behave identically.
 */
export async function sendCapiEvent(
  args: SendCapiEventArgs,
): Promise<Record<string, unknown> | null> {
  if (!META_ACCESS_TOKEN) {
    console.warn(
      `[META CAPI] META_ACCESS_TOKEN not configured, skipping ${args.eventName}`,
    );
    return null;
  }

  const userData = await buildUserData(args);
  const eventPayload: Record<string, unknown> = {
    event_name: args.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: args.eventId,
    action_source: args.actionSource ?? "website",
    user_data: userData,
  };
  if (args.eventSourceUrl) eventPayload.event_source_url = args.eventSourceUrl;

  const customData: Record<string, unknown> = {};
  if (args.eventName === "Purchase" && typeof args.value === "number") {
    customData.value = Math.round(args.value * 100) / 100;
    customData.currency = (args.currency ?? "EUR").toUpperCase();
  }
  if (args.customData) Object.assign(customData, args.customData);
  if (Object.keys(customData).length > 0) {
    eventPayload.custom_data = customData;
  }

  const body: Record<string, unknown> = {
    data: [eventPayload],
    access_token: META_ACCESS_TOKEN,
  };
  if (META_TEST_EVENT_CODE) body.test_event_code = META_TEST_EVENT_CODE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(META_CAPI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      // Meta occasionally returns plain text on 5xx; preserve in log
      // so debugging doesn't require replaying the request.
    }

    if (!response.ok) {
      console.error(
        `[META CAPI] HTTP ${response.status} on ${args.eventName}: ${
          text.slice(0, 500)
        }`,
      );
      return null;
    }

    const received = Number(data.events_received ?? 0);
    if (received > 0) {
      console.log(
        `[META CAPI] ${args.eventName} OK (id=${args.eventId}, received=${received}, fbtrace=${
          data.fbtrace_id ?? ""
        })`,
      );
    } else {
      console.warn(
        `[META CAPI] ${args.eventName} sent but events_received=0 (id=${args.eventId}, resp=${
          JSON.stringify(data).slice(0, 300)
        })`,
      );
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(
        `[META CAPI] timeout on ${args.eventName} (id=${args.eventId})`,
      );
    } else {
      console.error(
        `[META CAPI] unhandled error on ${args.eventName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
