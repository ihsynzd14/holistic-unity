import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * GET /auth/callback?code=...&next=...
 *
 * The Supabase email-confirmation link redirects the user here after they
 * click "Confirm". Our job:
 *   1. Exchange the `code` query param for a real session via the Supabase
 *      SSR client (sets the auth cookies on this response).
 *   2. Fire the C2 "Welcome" Brevo email — once per user, idempotent via
 *      app_metadata.welcome_sent_at.
 *   3. Redirect them onward — to /welcome for first-time clients (their
 *      onboarding kicks in via the dashboard layout gate), or to the
 *      `next` query param if specified.
 *
 * Failure modes:
 *   - Missing/invalid code → bounce to /login with error flag.
 *   - Token expired → same.
 *   - Session set but downstream profile lookup fails → still let them in;
 *     dashboard layout will provision a public.users row defensively.
 *   - Brevo / admin update fails → swallowed; redirect still proceeds.
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

  // ─── C2 Welcome email (Brevo template_id=1, idempotent, fail-safe) ──
  // Fires the first time a user lands here with a confirmed session.
  // Idempotency via app_metadata.welcome_sent_at — prevents re-sends on
  // subsequent callback hits (e.g. magic-link re-login). Wrapped in
  // try/catch so a Brevo/admin failure NEVER breaks the redirect.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !user.app_metadata?.welcome_sent_at) {
      await fetch(`${SUPABASE_URL}/functions/v1/send-brevo-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          template_id: 1, // BREVO_TEMPLATES.WELCOME_CLIENT
          user_id: user.id,
          params: {},
          tags: ["welcome", "client"],
        }),
      });
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(user.id, {
        app_metadata: {
          ...(user.app_metadata ?? {}),
          welcome_sent_at: new Date().toISOString(),
        },
      });
    }
  } catch (welcomeErr) {
    console.warn(
      "[auth/callback] welcome email failed (non-blocking):",
      welcomeErr,
    );
  }

  // Success — session cookies have been set by the SSR client.
  // Redirect to /welcome (onboarding) or the explicit next path if safe.
  // Only allow same-origin paths to prevent open-redirect via ?next=.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/welcome";
  return NextResponse.redirect(`${origin}${safeNext}`);
}
