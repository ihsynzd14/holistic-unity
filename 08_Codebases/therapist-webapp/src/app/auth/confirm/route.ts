import { NextRequest, NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * GET /auth/confirm?token_hash=...&type=...&next=...
 *
 * Verifier-free email-link handler (Supabase `verifyOtp` / token_hash flow).
 * Mirror of the client-webapp route — see that file for the full rationale.
 *
 * Short version (F5 fix): password-recovery links previously used the PKCE
 * `code` flow (`/auth/callback` → `exchangeCodeForSession`), which only works
 * when the link is opened in the SAME browser that requested it. Recovery
 * emails are routinely opened in the Mail app's in-app browser or another
 * device, so the exchange failed. `verifyOtp({ type, token_hash })` validates
 * the one-time hash carried in the URL itself — no `code_verifier` — so the
 * link works regardless of which app/browser/device opens it.
 *
 * The shared (project-wide) recovery template routes here via {{ .RedirectTo }}
 * which each app sets to its own origin's /auth/confirm.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=auth_link_invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    console.error("[auth/confirm] verifyOtp failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_link_expired`);
  }

  // ─── Post-confirm logic (signup only) ───────────────────────────────
  // Moved here from /auth/callback now that signup confirmation uses the
  // token_hash flow. ONLY for `signup` — recovery must never trigger it.
  if (type === "signup") {
    // Lazy provisioning of public.users + therapist_profiles (safety net,
    // mirror of /auth/callback). Upserts → idempotent. Best-effort.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
      if (user && meta.role === "therapist") {
        const admin = createAdminClient();
        const fallbackName =
          (meta.display_name as string) ||
          (meta.full_name as string) ||
          user.email?.split("@")[0] ||
          "";
        const fallbackPhone = (meta.phone as string) || "";
        await admin.from("users").upsert(
          {
            id: user.id,
            email: user.email,
            display_name: fallbackName,
            phone_number: fallbackPhone,
            role: "therapist",
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        await admin.from("therapist_profiles").upsert(
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
      console.error("[auth/confirm] lazy provisioning failed:", e);
    }

    // C2 Welcome email (Brevo template_id=2), idempotent, fail-safe.
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
            "[auth/confirm] welcome email NOT sent (edge/Brevo returned failure) — leaving welcome_sent_at unset so it can be retried",
          );
        }
      }
    } catch (welcomeErr) {
      console.warn("[auth/confirm] welcome email failed (non-blocking):", welcomeErr);
    }
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
