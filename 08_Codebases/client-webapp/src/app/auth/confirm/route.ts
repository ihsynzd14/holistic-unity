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
 *
 * WHY THIS EXISTS (F5 fix): the password-recovery email previously used the
 * PKCE `code` flow (`/auth/callback` → `exchangeCodeForSession`). That flow
 * only works if the link is opened in the SAME browser that requested it,
 * because it needs the locally-stored `code_verifier`. In practice the
 * recovery link is opened from the Mail app's in-app browser, a different
 * browser, or another device (and on iOS the verifier lives inside the app,
 * not the web browser at all) — so `exchangeCodeForSession` failed and the
 * user saw "link non valido o scaduto".
 *
 * `verifyOtp({ type, token_hash })` validates the one-time hash carried IN the
 * URL itself — no `code_verifier` required — so the link works regardless of
 * which app/browser/device opens it. This is Supabase's recommended pattern
 * for email links in SSR apps.
 *
 * The recovery email template points here:
 *   …/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
 *
 * On success the SSR client sets the session cookies on this response, so the
 * user arrives at `next` (e.g. /reset-password) already authenticated for the
 * recovery session and can call `updateUser({ password })`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/welcome";
  // Open-redirect guard: only same-origin relative paths (same as /auth/callback).
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/welcome";

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=auth_link_invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Expired, already-consumed (e.g. a spam scanner pre-fetched the link),
    // or malformed hash. Bounce to login with a flag the UI can surface.
    console.error("[auth/confirm] verifyOtp failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_link_expired`);
  }

  // ─── Signup post-confirm: provision the row, then C2 Welcome email ──
  // ONLY for `signup` — recovery must never trigger any of this.
  if (type === "signup") {
    // (1) Ensure the public.users row exists BEFORE the welcome send.
    // With email-confirm ON and no signup DB trigger, the row otherwise
    // doesn't exist yet at this point → send-brevo-email looks the user
    // up by id, 404s, and the welcome is silently lost. Upsert is
    // idempotent (no-op if the row already exists). Admin client so RLS
    // doesn't block the insert. (Mirrors the therapist confirm route.)
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
      console.error("[auth/confirm] client provisioning failed:", provErr);
    }

    // (2) C2 Welcome email (Brevo template_id=1). Idempotent via
    // app_metadata.welcome_sent_at; fail-safe (never blocks the redirect).
    // IMPORTANT: welcome_sent_at is set ONLY after a confirmed successful
    // send — otherwise a transient Brevo/edge failure would permanently
    // mark the user as welcomed and the email would be lost forever.
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
        // The edge fn returns { success:false } when Brevo rejects the
        // send, so check both the HTTP status AND the body.
        let welcomeSent = welcomeRes.ok;
        if (welcomeSent) {
          const body = await welcomeRes.json().catch(() => null);
          if (body && body.success === false) welcomeSent = false;
        }

        // Create/refresh the Brevo CONTACT (attributes + list membership).
        // Best-effort, independent of the welcome send result.
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
            "[auth/confirm] welcome email NOT sent (edge/Brevo returned failure) — leaving welcome_sent_at unset so it can be retried",
          );
        }
      }
    } catch (welcomeErr) {
      console.warn("[auth/confirm] welcome email failed (non-blocking):", welcomeErr);
    }
  }

  // Success — session cookies set by the SSR client. Send the user onward
  // (recovery → /reset-password, signup → /welcome).
  return NextResponse.redirect(`${origin}${safeNext}`);
}
