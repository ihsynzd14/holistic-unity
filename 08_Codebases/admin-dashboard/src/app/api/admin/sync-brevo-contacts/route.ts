import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { NextResponse } from "next/server";

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";

// Brevo list IDs — must match _shared/brevo.ts
const BREVO_LISTS = {
  ALL_USERS: 4,
  CLIENTS: 5,
  THERAPISTS: 6,
  MARKETING_OPTED_IN: 7,
};

/**
 * POST /api/admin/sync-brevo-contacts
 *
 * Bulk syncs all users from Supabase to Brevo contact lists.
 * Creates/updates contacts with attributes and list assignments.
 * Run this once to seed Brevo, then rely on real-time sync via Edge Functions.
 */
export async function POST() {
  try {
    // Defense-in-depth: ADMIN_EMAILS env AND users.is_admin DB flag.
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    if (!BREVO_API_KEY) {
      return NextResponse.json(
        { error: "BREVO_API_KEY not configured" },
        { status: 500 }
      );
    }

    const admin = createAdminClient();
    const { data: users, error } = await admin
      .from("users")
      .select(
        "id, email, display_name, role, city, country, marketing_consent, created_at, preferred_languages"
      )
      .not("email", "is", null);

    if (error || !users) {
      return NextResponse.json(
        { error: "Failed to fetch users" },
        { status: 500 }
      );
    }

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const u of users) {
      if (!u.email) continue;

      const listIds: number[] = [BREVO_LISTS.ALL_USERS];
      if (u.role === "client") listIds.push(BREVO_LISTS.CLIENTS);
      if (u.role === "therapist") listIds.push(BREVO_LISTS.THERAPISTS);
      if (u.marketing_consent) listIds.push(BREVO_LISTS.MARKETING_OPTED_IN);

      const nameParts = (u.display_name || "").split(" ");

      try {
        const res = await fetch("https://api.brevo.com/v3/contacts", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: u.email,
            attributes: {
              FIRSTNAME: nameParts[0] || "",
              LASTNAME: nameParts.slice(1).join(" ") || "",
              FULL_NAME: u.display_name || "",
              ROLE: u.role || "unknown",
              CITY: u.city || "",
              COUNTRY: u.country || "",
              MARKETING_CONSENT: u.marketing_consent || false,
              SIGNUP_DATE: u.created_at || "",
              LANGUAGE: (u.preferred_languages || ["en"])[0] || "en",
              APP_USER_ID: u.id,
            },
            listIds,
            updateEnabled: true,
          }),
        });

        if (res.ok || res.status === 204) {
          synced++;
        } else {
          const err = await res.json().catch(() => ({}));
          failed++;
          errors.push(
            `${u.email}: ${(err as Record<string, string>).message || res.status}`
          );
        }
      } catch (e) {
        failed++;
        errors.push(`${u.email}: ${(e as Error).message}`);
      }

      // Brevo rate limit: 10 req/sec on free plan
      await new Promise((r) => setTimeout(r, 120));
    }

    return NextResponse.json({
      total: users.length,
      synced,
      failed,
      errors: errors.slice(0, 20), // First 20 errors only
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 }
    );
  }
}
