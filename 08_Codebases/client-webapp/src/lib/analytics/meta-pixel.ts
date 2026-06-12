/**
 * Meta Pixel conversion-event helpers — consent-gated, type-safe.
 *
 * Every helper checks `window.fbq` at call time. If the user hasn't
 * consented to marketing cookies (`hu-marketing-ack=1`), the pixel
 * was never loaded by `MetaPixel.tsx` → `window.fbq` is undefined
 * and the call is a no-op. No conditionals needed at call site.
 *
 * Standard events reference:
 *   https://www.facebook.com/business/help/402791146561655
 *
 * Use these at the conversion points that matter for ad optimisation:
 *   - trackLead                : registration form submitted (intent signal)
 *   - trackCompleteRegistration: registration succeeded (account created)
 *   - trackViewContent         : therapist profile viewed (retargeting)
 *   - trackInitiateCheckout    : "Conferma prenotazione" clicked
 *   - trackPurchase            : payment confirmed (value + currency
 *                                are critical for ROAS calculation)
 *
 * Server-side dedup (eventID):
 *   Each helper accepts an optional `eventID`. Pass the SAME id you
 *   sent to the CAPI server side (see lib/analytics/meta-capi-server.ts
 *   + the /api/capi/* routes), built with `buildEventId(eventType, entityId)`.
 *   Meta dedups by (event_name, event_id) within a 7-day window — so
 *   the browser hit and the server hit count as one event with the
 *   union of their match-quality signals. Omit it if there's no CAPI
 *   twin (e.g. ViewContent only fires browser-side).
 */

type FbqFn = (
  command: string,
  eventName?: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) => void;

function fbq(): FbqFn | null {
  if (typeof window === "undefined") return null;
  // Cast through unknown — the global type from MetaPixel.tsx is a
  // narrower stub shape; the runtime accepts the full standard signature.
  return ((window as unknown as { fbq?: FbqFn }).fbq) ?? null;
}

function track(
  eventName: string,
  params?: Record<string, unknown>,
  eventID?: string,
) {
  const q = fbq();
  if (!q) return false;
  // Meta accepts the 4th `options` arg only when it's an object; passing
  // `undefined` is harmless but skipping the arg entirely is cleaner and
  // matches what fbevents.js expects for the common no-dedup case.
  if (eventID) {
    q("track", eventName, params, { eventID });
  } else {
    q("track", eventName, params);
  }
  return true;
}

/**
 * Registration intent — fired when the user submits the form. Meta
 * requires `value` > 0 on Lead events for ad optimisation, so the
 * helper defaults value to 1 (currency EUR) when the caller doesn't
 * pass one — a lead has no monetary price, 1 is the standard placeholder.
 */
export function trackLead(
  params?: { content_name?: string; value?: number; currency?: string },
  eventID?: string,
) {
  return track(
    "Lead",
    { value: 1, currency: "EUR", ...params },
    eventID,
  );
}

/** Account successfully created. */
export function trackCompleteRegistration(
  params?: { content_name?: string; status?: boolean },
  eventID?: string,
) {
  return track("CompleteRegistration", params, eventID);
}

/** Viewed a therapist profile or a practice page (retargeting fuel). */
export function trackViewContent(
  params?: { content_ids?: string[]; content_type?: string; content_name?: string },
  eventID?: string,
) {
  return track("ViewContent", params, eventID);
}

/**
 * User clicked "Conferma prenotazione". Pass the value so Meta can
 * optimise ad spend for higher-value bookings.
 */
export function trackInitiateCheckout(
  params: {
    value: number;
    currency: string;
    content_ids?: string[];
    content_name?: string;
    num_items?: number;
  },
  eventID?: string,
) {
  return track("InitiateCheckout", params, eventID);
}

/**
 * Payment succeeded — the most important event for ad ROAS. Fire
 * once per successful booking, with the gross value paid by the
 * client (NOT the therapist net payout — Meta optimises against
 * customer-facing revenue).
 */
export function trackPurchase(
  params: {
    value: number;
    currency: string;
    content_ids?: string[];
    content_name?: string;
    num_items?: number;
    transaction_id?: string;
  },
  eventID?: string,
) {
  return track("Purchase", params, eventID);
}

/**
 * Read Meta's first-party cookies from `document.cookie`. Forward
 * these alongside CAPI POSTs so the server side can attribute the
 * conversion to the originating ad click — Meta's match-rate target
 * of >6 needs at least one of these on most events.
 *
 *   _fbp: Facebook Pixel session id, set whenever fbevents.js loads
 *   _fbc: Facebook Click id, set when the user landed via a fbclid URL
 *
 * Returns `{}` on the server or when neither cookie exists.
 */
export function readMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined") return {};
  const out: { fbp?: string; fbc?: string } = {};
  const fbpMatch = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
  const fbcMatch = document.cookie.match(/(?:^|;\s*)_fbc=([^;]+)/);
  if (fbpMatch) out.fbp = decodeURIComponent(fbpMatch[1]);
  if (fbcMatch) out.fbc = decodeURIComponent(fbcMatch[1]);
  return out;
}
