import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/therapists/[id]/profile
 *
 * Returns the public-safe profile of a therapist for the detail page.
 *
 * Why this exists: querying `therapist_profiles_public` directly from
 * the browser sometimes returns null even for therapists that the
 * `/freebusy` endpoint considers bookable. The view appears to apply
 * stricter (or different) predicates than the canonical bookability
 * filter (approval_status='approved' + is_approved=true +
 * stripe_account_status='active'). Result: a client navigates from the
 * list to the detail page and gets "Operatore non trovato" on a
 * therapist that the same client could literally book a slot with.
 *
 * Fix: this route mirrors the freebusy auth pattern —
 *   1. Verify the caller has a valid access token (logged-in client)
 *   2. Use service-role to read `therapist_profiles` directly
 *   3. Enforce the SAME bookability predicates as freebusy
 *   4. Project ONLY public-safe columns (no Stripe IDs, no VAT, no
 *      stripe_country, no internal moderation fields)
 *
 * The column projection here MUST stay aligned with what the iOS app
 * and the list page show — anything new added to the detail UI needs
 * to be added here too (failing safe: omit unknown columns).
 */

const SAFE_COLUMNS = [
  "id",
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth via access token (cookie-bound JWT). Same pattern as freebusy.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Accept EITHER the canonical UUID or a public slug, so the in-app
  // detail route can show pretty `/dashboard/therapists/<slug>` URLs while
  // old UUID links keep working. Slugs match the shape produced by the DB
  // slugify() (lowercase, hyphen-separated).
  const { id: idOrSlug } = await params;
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  if (!isUuid && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(idOrSlug)) {
    return NextResponse.json({ error: "Invalid therapist id" }, { status: 400 });
  }
  const lookupColumn = isUuid ? "id" : "slug";

  const admin = createAdminClient();

  // `helps_with` + `slug` are newer columns — graceful fallback for older
  // deployments where they don't exist yet (a UUID lookup still works
  // without them; only the pretty-URL swap needs slug).
  const baseSelect = SAFE_COLUMNS.join(", ");
  const tryQuery = async (withOptional: boolean) => {
    return admin
      .from("therapist_profiles")
      .select(withOptional ? `${baseSelect}, helps_with, slug` : baseSelect)
      .eq(lookupColumn, idOrSlug)
      .eq("approval_status", "approved")
      .eq("is_approved", true)
      .eq("stripe_account_status", "active")
      .maybeSingle();
  };

  let { data, error } = await tryQuery(true);
  if (error?.message?.includes("helps_with") || error?.message?.includes("slug")) {
    ({ data, error } = await tryQuery(false));
  }

  if (error) {
    console.error("[therapists/profile] query failed:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Therapist not available" }, { status: 404 });
  }

  // `accepts_bookings` is derived from stripe_account_status='active'.
  // Since the WHERE clause already enforces that, it's always true
  // here. Add it explicitly so the page's existing UI logic doesn't
  // need to be changed.
  const profile = { ...(data as unknown as Record<string, unknown>), accepts_bookings: true };

  return NextResponse.json(
    { profile },
    {
      headers: {
        // Per-user JWT-bound. Short cache so reloads are cheap but
        // approval/Stripe state changes propagate within 30s.
        "Cache-Control": "private, max-age=30",
      },
    },
  );
}
