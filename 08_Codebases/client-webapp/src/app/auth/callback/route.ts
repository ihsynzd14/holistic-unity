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

  // ─── Ensure public.users exists, then C2 Welcome email ─────────────
  // (1) Provision the row BEFORE the welcome send. send-brevo-email looks
  // the user up by id; with no signup DB trigger the row may not exist
  // yet on a fresh signup → 404 → welcome silently lost. Upsert is
  // idempotent (no-op for existing users / re-logins). Admin client so
  // RLS doesn't block the insert.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const fallbackName =
        (meta.display_name as string) || (meta.full_name as string) || "";
      const admin = createAdminClient();
      await admin.from("users").upsert(
        {
          id: user.id,
          email: user.email,
          display_name: fallbackName,
          phone_number: (meta.phone as string) || "",
          role: "client",
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
    }
  } catch (provErr) {
    console.error("[auth/callback] client provisioning failed:", provErr);
  }

  // (2) C2 Welcome email (Brevo template_id=1). Idempotent via
  // app_metadata.welcome_sent_at; fail-safe. welcome_sent_at is set ONLY
  // after a confirmed successful send, so a transient failure doesn't
  // permanently mark the user as welcomed and lose the email.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !user.app_metadata?.welcome_sent_at) {
      const welcomeRes = await fetch(`${SUPABASE_URL}/functions/v1/send-brevo-email`, {
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
      let welcomeSent = welcomeRes.ok;
      if (welcomeSent) {
        const body = await welcomeRes.json().catch(() => null);
        if (body && body.success === false) welcomeSent = false;
      }

      // Create/refresh the Brevo CONTACT (attributes + list membership).
      // Best-effort, independent of the welcome send result. Covers
      // SSO / PKCE signups (the email-confirm path is handled in
      // /auth/confirm).
      await fetch(`${SUPABASE_URL}/functions/v1/sync-brevo-contact`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: user.id, event: "client_signup" }),
      });

      if (welcomeSent) {
        const admin = createAdminClient();
        await admin.auth.admin.updateUserById(user.id, {
          app_metadata: {
            ...(user.app_metadata ?? {}),
            welcome_sent_at: new Date().toISOString(),
          },
        });
      } else {
        console.warn(
          "[auth/callback] welcome email NOT sent (edge/Brevo returned failure) — leaving welcome_sent_at unset so it can be retried",
        );
      }
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
