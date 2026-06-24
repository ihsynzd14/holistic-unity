import { createClient } from "@/lib/supabase/server";
import { exchangeMicrosoftCode, parseOAuthState } from "@/lib/calendar/tokens";
import { NextRequest, NextResponse } from "next/server";

const SETTINGS_URL = "/dashboard/settings";

/**
 * GET /api/calendar/microsoft/callback
 * Handles the OAuth callback from Microsoft after user grants consent.
 * Exchanges the authorization code for tokens, fetches the user's email,
 * and stores the integration in the database.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  // Microsoft may redirect back with an error (e.g. user denied consent)
  if (errorParam || !code || !state) {
    console.error("[Microsoft callback] OAuth error:", errorParam);
    return NextResponse.redirect(
      new URL(
        `${SETTINGS_URL}?calendar=microsoft&status=error`,
        request.url
      )
    );
  }

  try {
    const decoded = parseOAuthState(state);
    const therapistId = decoded?.therapistId;
    const stateTimestamp = decoded?.timestamp;

    if (!therapistId) {
      throw new Error("Missing therapistId in state");
    }

    // C6: Reject expired OAuth state (15-minute window)
    if (!stateTimestamp || Date.now() - stateTimestamp > 15 * 60 * 1000) {
      throw new Error("OAuth state expired");
    }

    // C6: Verify state therapistId matches current session user
    const supabaseAuth = await createClient();
    const { data: { user: currentUser } } = await supabaseAuth.auth.getUser();
    if (!currentUser || currentUser.id !== therapistId) {
      throw new Error("OAuth state user mismatch");
    }

    // Exchange the authorization code for tokens
    const tokens = await exchangeMicrosoftCode(code);

    if (tokens.error) {
      throw new Error(
        `Token exchange failed: ${tokens.error_description || tokens.error}`
      );
    }

    // Fetch the user's email from Microsoft Graph
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      throw new Error(`Failed to fetch Microsoft profile: ${profileRes.status}`);
    }

    const profile = await profileRes.json();
    const calendarEmail = profile.mail || profile.userPrincipalName;

    // Store the integration in Supabase
    const supabase = await createClient();
    const tokenExpiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();
    const now = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from("therapist_calendar_integrations")
      .upsert(
        {
          therapist_id: therapistId,
          provider: "microsoft",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt,
          calendar_email: calendarEmail,
          calendar_id: "primary",
          connected_at: now,
          updated_at: now,
        },
        { onConflict: "therapist_id,provider" }
      );

    if (upsertError) {
      throw new Error(`Database upsert failed: ${upsertError.message}`);
    }

    return NextResponse.redirect(
      new URL(
        `${SETTINGS_URL}?calendar=microsoft&status=connected`,
        request.url
      )
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Microsoft callback] Error:", message);
    return NextResponse.redirect(
      new URL(
        `${SETTINGS_URL}?calendar=microsoft&status=error&reason=${encodeURIComponent(message)}`,
        request.url
      )
    );
  }
}
