import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback?code=...&next=...
 *
 * The Supabase email-confirmation link redirects the user here after they
 * click "Confirm". Our job:
 *   1. Exchange the `code` query param for a real session via the Supabase
 *      SSR client (sets the auth cookies on this response).
 *   2. Redirect them onward — to /welcome for first-time clients (their
 *      onboarding kicks in via the dashboard layout gate), or to the
 *      `next` query param if specified.
 *
 * Failure modes:
 *   - Missing/invalid code → bounce to /login with error flag.
 *   - Token expired → same.
 *   - Session set but downstream profile lookup fails → still let them in;
 *     dashboard layout will provision a public.users row defensively.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/welcome";

  if (!code) {
    // Could be an old-style email link that doesn't use PKCE — treat as
    // "you've confirmed, now log in".
    return NextResponse.redirect(
      `${origin}/login?confirmed=1`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchange failed:", error.message);
    return NextResponse.redirect(
      `${origin}/login?error=auth_callback_failed`,
    );
  }

  // Success — session cookies have been set by the SSR client.
  // Redirect to /welcome (onboarding) or the explicit next path if safe.
  // Only allow same-origin paths to prevent open-redirect via ?next=.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/welcome";
  return NextResponse.redirect(`${origin}${safeNext}`);
}
