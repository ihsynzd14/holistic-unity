import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/therapists/tiers?ids=<uuid>,<uuid>,...
 *
 * Returns `{ tiers: Record<id, "practitioner" | "trainer" | "supervisor"> }`
 * for the requested therapist ids.
 *
 * Why this exists: the browse list queries `therapist_profiles_public`
 * (a view that hides Stripe / VAT columns). The view does not yet
 * expose the new `tier` column, and broadening it risks touching
 * predicates we can't see from this repo. This endpoint is a small
 * sidecar: it uses service-role to read just the `tier` column for
 * IDs the client already discovered through the visibility-filtered
 * view, so no extra data is leaked.
 */

export async function GET(request: NextRequest) {
  // Auth — only logged-in clients should be enriching the list.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  if (ids.length === 0) {
    return NextResponse.json({ tiers: {} });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("therapist_profiles")
    .select("id, tier")
    .in("id", ids);

  if (error) {
    console.error("[therapists/tiers] query failed:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const tiers: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.id && row.tier) tiers[row.id as string] = row.tier as string;
  }

  return NextResponse.json(
    { tiers },
    {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    },
  );
}
