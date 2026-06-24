import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildCsp, generateNonce } from "@/lib/security/csp";

/**
 * Admin-dashboard edge middleware.
 *   1. Refresh Supabase session + enforce `ADMIN_EMAILS` allowlist.
 *   2. Inject Content-Security-Policy with a per-request nonce so the
 *      `'unsafe-inline'` directive can be dropped from `script-src`.
 *
 * Admin-dashboard route-level code also re-validates admin status via
 * `requireAdmin()` (2-factor: env + `users.is_admin` RPC) — the env
 * check here in middleware is the outer layer; see `lib/auth/requireAdmin.ts`.
 */
export async function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce, {
    isDev: process.env.NODE_ENV !== "production",
  });

  const response = await updateSession(request, {
    forwardHeaders: {
      "x-nonce": nonce,
      "content-security-policy": csp,
    },
  });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);
  // Also apply the baseline static headers. Admin dashboard's
  // next.config.ts is bare, so these would otherwise be missing.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files (svg, png, jpg, etc.)
     * - api/sentry-test — token-gated Sentry verification endpoint;
     *   bypasses admin auth on purpose so we can hit it without logging
     *   in. The route handler enforces its own `SENTRY_TEST_TOKEN`
     *   check, so no auth surface is widened. Unlike client-webapp /
     *   therapist-webapp where `api` is wholly excluded, admin-dashboard
     *   keeps `/api/*` middleware-gated for routes like
     *   `/api/stream/token` — so we only carve out this one path.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/sentry-test|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
