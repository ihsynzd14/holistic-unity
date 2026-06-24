import { createClient } from "@/lib/supabase/server";
import { exchangeGoogleCode, parseOAuthState } from "@/lib/calendar/tokens";
import { NextRequest, NextResponse } from "next/server";

const SETTINGS_URL = "/dashboard/settings";

/**
 * GET /api/calendar/google/callback
 * Google redirects here after the user grants (or denies) access.
 * Exchanges the authorization code for tokens and stores the integration.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Build absolute redirect base from the incoming request
  const baseUrl = new URL(request.url).origin;

  // User denied consent or Google returned an error
  if (error || !code || !state) {
    return NextResponse.redirect(
      `${baseUrl}${SETTINGS_URL}?calendar=google&status=error`
    );
  }

  try {
    const decoded = parseOAuthState(state);
    const therapistId = decoded?.therapistId;
    const stateTimestamp = decoded?.timestamp;

    if (!therapistId) {
      return NextResponse.redirect(
        `${baseUrl}${SETTINGS_URL}?calendar=google&status=error`
      );
    }

    // C6: Reject expired OAuth state (15-minute window)
    if (!stateTimestamp || Date.now() - stateTimestamp > 15 * 60 * 1000) {
      console.error("Google OAuth state expired or missing timestamp");
      return NextResponse.redirect(
        `${baseUrl}${SETTINGS_URL}?calendar=google&status=error&reason=state_expired`
      );
    }

    // C6: Verify state therapistId matches current session user
    const supabaseAuth = await createClient();
    const { data: { user: currentUser } } = await supabaseAuth.auth.getUser();
    if (!currentUser || currentUser.id !== therapistId) {
      console.error("Google OAuth: user mismatch or not authenticated. currentUser:", currentUser?.id, "stateTherapist:", therapistId);
      return NextResponse.redirect(
        `${baseUrl}${SETTINGS_URL}?calendar=google&status=error&reason=${!currentUser ? 'not_authenticated' : 'user_mismatch'}`
      );
    }

    // Exchange the authorization code for tokens
    console.log("Google OAuth: exchanging code, redirect_uri =", process.env.GOOGLE_REDIRECT_URI);
    const tokens = await exchangeGoogleCode(code);

    if (tokens.error) {
      console.error("Google token exchange failed:", tokens.error, tokens.error_description);
      return NextResponse.redirect(
        `${baseUrl}${SETTINGS_URL}?calendar=google&status=error&reason=${encodeURIComponent(tokens.error_description || tokens.error)}`
      );
    }

    // Fetch the user's Google email via the userinfo endpoint
    let calendarEmail = "";
    try {
      const userinfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }
      );
      if (userinfoRes.ok) {
        const userinfo = await userinfoRes.json();
        calendarEmail = userinfo.email || "";
      }
    } catch {
      // Non-critical: proceed without the email
    }

    const now = new Date().toISOString();
    const tokenExpiresAt = new Date(
      Date.now() + (tokens.expires_in ?? 3600) * 1000
    ).toISOString();

    // Persist the integration using the server Supabase client
    const supabase = await createClient();

    const { error: upsertError } = await supabase
      .from("therapist_calendar_integrations")
      .upsert(
        {
          therapist_id: therapistId,
          provider: "google",
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
      console.error("Supabase upsert error:", upsertError);
      return NextResponse.redirect(
        `${baseUrl}${SETTINGS_URL}?calendar=google&status=error`
      );
    }

    return NextResponse.redirect(
      `${baseUrl}${SETTINGS_URL}?calendar=google&status=connected`
    );
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      `${baseUrl}${SETTINGS_URL}?calendar=google&status=error`
    );
  }
}
