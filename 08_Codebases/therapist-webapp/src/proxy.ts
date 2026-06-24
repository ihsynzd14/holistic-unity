import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildCsp, generateNonce } from "@/lib/security/csp";

/**
 * Per-request middleware. Two jobs:
 *   1. Supabase session refresh + auth-gate redirect (delegates to
 *      `updateSession`).
 *   2. Content-Security-Policy injection with a fresh per-request nonce
 *      so `'unsafe-inline'` can be dropped from `script-src`.
 *
 * The nonce flows to the React Server Component render via the
 * `x-nonce` request header (`forwardHeaders`), and is mirrored onto
 * the outbound response so same-origin client-side fetches or Vercel
 * edge logs can see it for debugging.
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce, {
    isDev: process.env.NODE_ENV !== "production",
  });

  const response = await updateSession(request, {
    forwardHeaders: {
      "x-nonce": nonce,
      // Next.js reads `content-security-policy` from the forwarded
      // request headers and applies the nonce to its internally
      // generated inline scripts (hydration + router).
      "content-security-policy": csp,
    },
  });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
