/**
 * Single source of truth for the current Terms of Service version.
 *
 * BUMP THIS WHEN T&C CHANGE.
 *   The middleware redirects authenticated users to `/accept-terms`
 *   if their latest tos_acceptances row has a version older than this.
 *   That re-acceptance is the legal mechanism that keeps onerous
 *   clauses (vessatorie ex art. 1341 c.c.) enforceable when we update
 *   the contract.
 *
 * Format: `<role>-vMAJOR.MINOR-YYYYMMDD`.
 *   - Bump MAJOR for changes that materially alter user rights
 *     (e.g. cancellation policy, commission structure, jurisdiction).
 *   - Bump MINOR for clarifications and additions that don't reduce
 *     user rights.
 *   - The date suffix lets us correlate audit-trail rows to the
 *     human-readable HTML version published on holisticunity.app.
 */

export const CLIENT_TOS_VERSION = "client-v1.0-20260425";
export const THERAPIST_TOS_VERSION = "therapist-v1.0-20260425";

export const TOS_URLS = {
  client: "https://holisticunity.app/terms-clients.html",
  therapist: "https://holisticunity.app/terms-therapists.html",
  privacy: "https://holisticunity.app/privacy-policy.html",
} as const;
