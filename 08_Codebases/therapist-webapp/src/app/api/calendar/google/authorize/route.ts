import { createClient } from "@/lib/supabase/server";
import { createOAuthState, getGoogleAuthUrl } from "@/lib/calendar/tokens";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/calendar/google/authorize
 * Initiates the Google Calendar OAuth flow.
 * Redirects the authenticated therapist to Google's consent screen.
 */
export async function GET(request: NextRequest) {
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

    // Rate limit: 30 OAuth starts/min. High normal use is 1-2/day;
    // higher rate suggests automation or CSRF probing.
    const limit = await withRateLimit(request, {
      key: "calendar-oauth-google",
      max: 30,
      windowSec: 60,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    // Encode therapist identity + timestamp into the OAuth state parameter
    const state = createOAuthState(user.id);

    const authUrl = getGoogleAuthUrl(state);

    return NextResponse.redirect(authUrl);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
