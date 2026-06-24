/**
 * Last-mile PII scrub for outbound Sentry events.
 *
 * Even with `event.user = { id }` and stripped cookies/auth headers,
 * a stray `console.log("paid", paymentIntent.id)` or a thrown Error
 * that embeds a JWT in its message will leak straight to Sentry. This
 * file is the regex safety net: every string in the outgoing event is
 * walked and rewritten before transmission. Companion to the Edge
 * Function redaction (see 03_Security_and_Audits/) — same threat
 * model, different runtime.
 *
 * Patterns covered:
 *   - Stripe IDs (`pi_*`, `cus_*`, `pm_*`, `re_*`, `acct_*`, …)
 *     Prefix kept so the event is still triageable ("oh, payment
 *     intent error") without disclosing the resource ID.
 *   - Stripe API keys (`sk_live_*`, `rk_live_*`, `pk_live_*`)
 *   - JWTs (3-part base64url, e.g. Supabase session tokens)
 *   - `Authorization: Bearer …` strings
 *   - Email addresses (catches strays beyond `event.user.email`)
 */

const REDACTORS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /(\b(?:pi|cs|cus|pm|re|seti|ch|evt|acct|ba|card|txn|sub|in|prod|price|src|tok|po|tr|trr)_)[A-Za-z0-9]{14,}/g,
    "$1***",
  ],
  [/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]{20,}\b/g, "$1_$2_***"],
  [
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    "eyJ***JWT_REDACTED***",
  ],
  [/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, "$1***"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "***@***"],
];

function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of REDACTORS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Sentry events can occasionally embed React component trees in
// breadcrumbs — cap recursion so a deep object doesn't blow the stack.
const MAX_DEPTH = 8;

function deepScrub(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.map((v) => deepScrub(v, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      next[key] = deepScrub(
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
    }
    return next;
  }
  return value;
}

/**
 * Sentry `beforeSend` hook. Strips cookies + auth headers + server-side
 * request body, reduces user context to `{ id }`, then deep-regex
 * scrubs every remaining string in the event payload.
 *
 * Typed permissively (`any`) because Sentry's event shape differs
 * slightly across client / server / edge runtimes — sharing one helper
 * across all three means accepting the lowest common denominator.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubSentryEvent(event: any): any {
  if (event?.request?.headers) {
    const h = event.request.headers as Record<string, string>;
    delete h.cookie;
    delete h.Cookie;
    delete h.authorization;
    delete h.Authorization;
  }
  if (event?.request && "data" in event.request) {
    delete event.request.data;
  }
  if (event?.user) {
    event.user = { id: event.user.id };
  }
  return deepScrub(event, 0);
}
