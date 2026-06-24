import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/me/tier-request
 * Body: { tier: 'practitioner' | 'trainer' | 'supervisor' }
 *
 * Records the therapist's tier self-declaration. Uses service-role
 * (admin client) to bypass the `protect_therapist_admin_columns`
 * trigger — but only writes the row belonging to the authenticated
 * session user, so there's no privilege escalation.
 *
 * Rules:
 * - tier='practitioner' → AUTO-APPROVED. Practitioner is the default
 *   tier; the therapist isn't claiming anything above it, so no admin
 *   verification is needed. We set status='approved' AND tier='practitioner'
 *   so the row is in a clean approved state and the admin queue stays
 *   uncluttered.
 * - tier='trainer' | 'supervisor' → status='pending'. Admin must review
 *   the uploaded certifications before flipping the public `tier`.
 *
 * Used by both the first-login `/onboarding/tier` page and the profile
 * page's "Invia richiesta" button so the logic lives in one place.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tier = body?.tier as "practitioner" | "trainer" | "supervisor" | undefined;
  if (!tier || !["practitioner", "trainer", "supervisor"].includes(tier)) {
    return NextResponse.json(
      { error: "tier must be practitioner, trainer, or supervisor" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const update =
    tier === "practitioner"
      ? {
          requested_tier: "practitioner",
          tier_request_status: "approved",
          tier: "practitioner",
        }
      : {
          requested_tier: tier,
          tier_request_status: "pending",
        };

  const { error } = await admin
    .from("therapist_profiles")
    .update(update)
    .eq("id", user.id);

  if (error) {
    console.error("[me/tier-request] write failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
