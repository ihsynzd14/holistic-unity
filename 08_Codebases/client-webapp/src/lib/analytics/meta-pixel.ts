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
 */

type FbqFn = (event: string, eventName?: string, params?: Record<string, unknown>) => void;

function fbq(): FbqFn | null {
  if (typeof window === "undefined") return null;
  // Cast through unknown — the global type from MetaPixel.tsx is a
  // narrower stub shape; the runtime accepts the full standard signature.
  return ((window as unknown as { fbq?: FbqFn }).fbq) ?? null;
}

function track(eventName: string, params?: Record<string, unknown>) {
  const q = fbq();
  if (!q) return false;
  q("track", eventName, params);
  return true;
}

/** Registration intent — fired when the user submits the form. */
export function trackLead(params?: { content_name?: string }) {
  return track("Lead", params);
}

/** Account successfully created. */
export function trackCompleteRegistration(params?: { content_name?: string; status?: boolean }) {
  return track("CompleteRegistration", params);
}

/** Viewed a therapist profile or a practice page (retargeting fuel). */
export function trackViewContent(params?: { content_ids?: string[]; content_type?: string; content_name?: string }) {
  return track("ViewContent", params);
}

/**
 * User clicked "Conferma prenotazione". Pass the value so Meta can
 * optimise ad spend for higher-value bookings.
 */
export function trackInitiateCheckout(params: {
  value: number;
  currency: string;
  content_ids?: string[];
  content_name?: string;
  num_items?: number;
}) {
  return track("InitiateCheckout", params);
}

/**
 * Payment succeeded — the most important event for ad ROAS. Fire
 * once per successful booking, with the gross value paid by the
 * client (NOT the therapist net payout — Meta optimises against
 * customer-facing revenue).
 */
export function trackPurchase(params: {
  value: number;
  currency: string;
  content_ids?: string[];
  content_name?: string;
  num_items?: number;
  transaction_id?: string;
}) {
  return track("Purchase", params);
}
