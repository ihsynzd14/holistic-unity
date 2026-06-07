import { createAdminClient } from "@/lib/supabase/admin";
import { applyClientVisibilityFilters } from "./visibility";

/**
 * SERVER-ONLY. Resolves a therapist's public profile from their slug for
 * the shareable, unauthenticated /t/<slug> page (and the matching public
 * API route). Never import this from a client component — it uses the
 * service-role admin client.
 *
 * Safety is structural, not auth-based: we only ever return
 * PUBLIC_PROFILE_COLUMNS of a therapist who passes the SAME bookability
 * predicate as the in-app detail page (approval_status='approved' +
 * is_approved=true + stripe_account_status='active', via
 * applyClientVisibilityFilters). No Stripe IDs, VAT, or moderation fields.
 *
 * Kept aligned with SAFE_COLUMNS in
 * app/api/therapists/[id]/profile/route.ts — same list, plus `slug`.
 */

export const PUBLIC_PROFILE_COLUMNS = [
  "id",
  "slug",
  "display_name",
  "tagline",
  "bio",
  "photo_url",
  "video_intro_url",
  "gallery_image_urls",
  "years_experience",
  "categories",
  "languages",
  "city",
  "country",
  "average_rating",
  "total_reviews",
  "is_verified",
  "has_mfa",
  "cancellation_policy",
  "currency",
  "availability",
  "tier",
] as const;

// Matches the shape the DB slugify() function produces.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicTherapistProfile = Record<string, unknown> & {
  id: string;
  slug: string;
  display_name: string | null;
};

export async function fetchPublicProfileBySlug(
  slug: string,
): Promise<PublicTherapistProfile | null> {
  // Cheap input guard — reject anything that isn't a well-formed slug
  // before touching the DB.
  if (!slug || slug.length > 80 || !SLUG_RE.test(slug)) return null;

  const admin = createAdminClient();
  const baseSelect = PUBLIC_PROFILE_COLUMNS.join(", ");

  // `helps_with` graceful fallback — mirrors the [id]/profile route so
  // older deployments without the column don't 500.
  const run = (withHelpsWith: boolean) =>
    applyClientVisibilityFilters(
      admin
        .from("therapist_profiles")
        .select(withHelpsWith ? `${baseSelect}, helps_with` : baseSelect)
        .eq("slug", slug),
    ).maybeSingle();

  let { data, error } = await run(true);
  if (error?.message?.includes("helps_with")) {
    ({ data, error } = await run(false));
  }

  if (error) {
    console.error("[public-profile] query failed:", error);
    throw error;
  }
  if (!data) return null;

  // accepts_bookings is implied true by the bookability predicate.
  return {
    ...(data as unknown as Record<string, unknown>),
    accepts_bookings: true,
  } as unknown as PublicTherapistProfile;
}
