/**
 * PII redaction helpers for edge function logs.
 *
 * Truncation strategy (not full "[redacted]") preserves enough of the
 * identifier prefix to correlate a log line with an event in Stripe
 * Dashboard / Supabase tables during incident response, while making
 * the logged value unusable on its own (an attacker with read access
 * to logs cannot reconstruct the full ID).
 *
 * - Stripe IDs follow `<prefix>_<random>` convention (e.g.
 *   `pi_3N4ABC123DEF`). We keep the first 8 chars (covers the prefix
 *   plus 2-3 random chars) and replace the rest with `***`.
 * - UUIDs (user.id, booking.id) follow `xxxxxxxx-xxxx-…` — we keep
 *   the first 8 chars (the time_low segment) which is unique enough
 *   for correlation but not enough to reverse to a user.
 */

export function redactStripeId(id: string | null | undefined): string {
  if (!id) return "[null]";
  if (id.length <= 12) return "[short_id]";
  return `${id.slice(0, 8)}***`;
}

export function redactUuid(id: string | null | undefined): string {
  if (!id) return "[null]";
  if (id.length <= 8) return "[short_uuid]";
  return `${id.slice(0, 8)}***`;
}
