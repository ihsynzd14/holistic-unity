import { NextRequest, NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

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

  // Success — session cookies set by the SSR client. Send the user onward
  // (recovery → /reset-password).
  return NextResponse.redirect(`${origin}${safeNext}`);
}
