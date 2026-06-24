import { createClient } from "@/lib/supabase/server";
import { generateIcalToken } from "@/lib/calendar/tokens";
import { NextResponse } from "next/server";

/**
 * GET /api/ical/token
 * Returns the iCal feed URL for the authenticated therapist.
 * The token is derived deterministically via HMAC, so no DB storage is needed.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Non autenticato" },
        { status: 401 }
      );
    }

    const token = generateIcalToken(user.id);

    // Build the absolute URL using the public site URL or fallback
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

    const url = `${baseUrl}/api/ical/${user.id}/${token}`;

    return NextResponse.json({ url, token, therapistId: user.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
