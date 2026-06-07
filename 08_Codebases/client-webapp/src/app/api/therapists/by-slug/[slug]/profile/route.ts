import { NextRequest, NextResponse } from "next/server";
import { fetchPublicProfileBySlug } from "@/lib/therapists/public-profile";

/**
 * GET /api/therapists/by-slug/[slug]/profile
 *
 * PUBLIC, unauthenticated — powers the shareable /t/<slug> link for HTTP
 * callers (client components, iOS, external). The /t/<slug> page itself
 * calls fetchPublicProfileBySlug directly (no HTTP hop).
 *
 * Intentionally NO auth check: a shareable link must render for logged-out
 * visitors. Safety lives in fetchPublicProfileBySlug — bookability
 * predicate + public-safe column projection only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  let profile;
  try {
    profile = await fetchPublicProfileBySlug(slug);
  } catch {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json(
      { error: "Therapist not available" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { profile },
    {
      headers: {
        // Public + briefly cacheable so approval/Stripe changes propagate
        // fast but repeat hits are cheap at the edge.
        "Cache-Control": "public, max-age=30, s-maxage=60",
      },
    },
  );
}
