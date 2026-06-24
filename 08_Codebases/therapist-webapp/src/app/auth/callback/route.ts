import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * GET /auth/callback?code=...&next=...
 *
 * Email-confirmation landing for therapists. Post-confirm landing is
 * /dashboard (not /welcome — therapists have no client-style flow).
 *
 * The dashboard layout itself gates further: pending_review therapists
 * get bounced back to /login with a banner about awaiting approval.
 *
 * **Lazy provisioning** (added after audit): when email-confirm is ON
 * the register flow can't write to `public.users` or
 * `therapist_profiles` because the auth.users row isn't committed
 * until after this callback. If a DB trigger doesn't lazily create
 * those rows, the dashboard gate would see role=null and bounce the
 * user out forever. We provision here as a safety net — uses upsert,
 * so it's a no-op if the trigger already populated.
 *
 * **C2 Welcome email** (Brevo template_id=2): sent once per user, after
 * provisioning. Idempotency via app_metadata.welcome_sent_at. Fail-safe
 * — Brevo/admin errors are swallowed and never block the redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
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

  // Lazy provisioning of public.users + therapist_profiles. Best-effort
  // — failure here doesn't block the redirect, the dashboard gate has
  // its own fallback that re-attempts.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    // Only provision when this user signed up as a therapist. If
    // metadata.role is missing or different, skip — they signed up via
    // some other path (e.g. admin promote) that owns provisioning.
    if (user && meta.role === "therapist") {
      const admin = createAdminClient();
      const fallbackName =
        (meta.display_name as string) ||
        (meta.full_name as string) ||
        user.email?.split("@")[0] ||
        "";
      const fallbackPhone = (meta.phone as string) || "";
      // Upsert so this is idempotent — if the trigger or register flow
      // already wrote, we don't overwrite with stale metadata.
      await admin
        .from("users")
        .upsert(
          {
            id: user.id,
            email: user.email,
            display_name: fallbackName,
            phone_number: fallbackPhone,
            role: "therapist",
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
      await admin
        .from("therapist_profiles")
        .upsert(
          {
            id: user.id,
            display_name: fallbackName,
            approval_status: "pending_review",
            is_approved: false,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
    }
  } catch (e) {
    console.error("[auth/callback] lazy provisioning failed:", e);
  }

  // ─── C2 Welcome email (Brevo template_id=2, idempotent, fail-safe) ──
  // Fires the first time a therapist lands here with a confirmed session.
  // welcome_sent_at is set ONLY after a confirmed successful send, so a
  // transient Brevo/edge failure doesn't permanently mark the therapist
  // as welcomed and lose the email.
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
          template_id: 2, // BREVO_TEMPLATES.WELCOME_THERAPIST
          user_id: user.id,
          params: {},
          tags: ["welcome", "therapist"],
        }),
      });
      let welcomeSent = welcomeRes.ok;
      if (welcomeSent) {
        const body = await welcomeRes.json().catch(() => null);
        if (body && body.success === false) welcomeSent = false;
      }
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

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return NextResponse.redirect(`${origin}${safeNext}`);
}
