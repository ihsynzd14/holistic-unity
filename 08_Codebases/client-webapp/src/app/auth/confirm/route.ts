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

  // ─── C2 Welcome email (signup only) ─────────────────────────────────
  // Moved here from /auth/callback now that signup confirmation uses the
  // token_hash flow. ONLY for `signup` — recovery must never trigger it.
  // Idempotent via app_metadata.welcome_sent_at; fail-safe (never blocks the
  // redirect). Mirrors the logic that used to live in /auth/callback.
  if (type === "signup") {
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
        // Create/refresh the Brevo CONTACT (attributes + list membership).
        // Without this the user only ever received a transactional email
        // and never appeared in the Brevo contact lists — the C2 welcome
        // mail fired but the contact was never synced (sync-brevo-contact
        // was only wired to therapist approval). This covers both web AND
        // iOS email signups, since iOS verification redirects here too.
        await fetch(`${SUPABASE_URL}/functions/v1/sync-brevo-contact`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: user.id, event: "client_signup" }),
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
      console.warn("[auth/confirm] welcome email failed (non-blocking):", welcomeErr);
    }
  }

  // Success — session cookies set by the SSR client. Send the user onward
  // (recovery → /reset-password, signup → /welcome).
  return NextResponse.redirect(`${origin}${safeNext}`);
}
