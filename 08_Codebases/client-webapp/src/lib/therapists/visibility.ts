/**
 * Centralised "is this therapist visible to clients?" rule.
 *
 * Three predicates must all hold for a therapist_profiles row to appear
 * in any client-facing surface (browse list, detail page, practice page,
 * freebusy API, slot picker counts):
 *
 *   1. approval_status = 'approved'   — admin has reviewed + green-lit
 *   2. is_approved     = true         — kept in lockstep with #1 by the
 *                                       admin tools (legacy boolean)
 *   3. stripe_account_status = 'active' — the therapist can actually
 *      receive payouts. Without this we'd surface profiles that look
 *      bookable but whose payments would fail at checkout.
 *
 * Apply this filter to any Supabase select query that builds a
 * client-facing list of therapists. DO NOT apply to:
 *   - The admin dashboard (admin needs to see ALL therapists, including
 *     pending-Stripe ones to follow up on them).
 *   - The therapist-webapp itself (a therapist needs to access their
 *     own profile/settings even when Stripe isn't yet active).
 */

// We intentionally use `any` for the generic Supabase query builder type.
// Supabase's PostgrestFilterBuilder has so many type parameters that
// trying to preserve the chain through a wrapper triggers TypeScript's
// "Type instantiation is excessively deep" guard. Since we're only
// chaining three .eq() calls — all on known column names — the loss of
// type information is negligible and the call sites still get full
// type-checking on the resulting query.

export function applyClientVisibilityFilters<T>(query: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  return q
    .eq("approval_status", "approved")
    .eq("is_approved", true)
    .eq("stripe_account_status", "active");
}
