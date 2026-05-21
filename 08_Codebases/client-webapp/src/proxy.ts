import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { createServerClient } from "@supabase/ssr";
import {
  CLIENT_TOS_VERSION,
  THERAPIST_TOS_VERSION,
} from "@/lib/tos/version";

/**
 * Routes that must remain accessible *without* a current TOS acceptance —
 * otherwise the user couldn't sign in / accept terms / log out / fetch the
 * TOS-acceptance API itself, creating a redirect loop.
 */
const TOS_GATE_BYPASS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/accept-terms",
  "/api/tos",
  "/logout",
];

function isBypassed(pathname: string): boolean {
  return TOS_GATE_BYPASS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Per-request middleware. Three jobs:
 *   1. Supabase session refresh + auth-gate redirect (delegates to
 *      `updateSession`).
 *   2. Content-Security-Policy injection with a fresh per-request nonce
 *      so `'unsafe-inline'` can be dropped from `script-src`.
 *   3. Auto-detect initial UI language from request geo on the first
 *      visit (no `hu-locale` cookie yet): Italy → `it`, elsewhere →
 *      `en`. Once set, the cookie persists for a year and the user's
 *      explicit choice (via /dashboard/account → Lingua) is stored in
 *      localStorage and takes priority.
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

  // ─── TOS gate ─────────────────────────────────────────────────────────
  // Authenticated users must have a tos_acceptances row matching the
  // CURRENT version for their role. Otherwise → /accept-terms.
  // This is what makes art. 1341 c.c. enforceable when we update the
  // contract: continued use after notice doesn't create vincolo, an
  // explicit re-acceptance does.
  const pathname = request.nextUrl.pathname;
  if (!isBypassed(pathname)) {
    // Reuse the cookie set written by updateSession — read-only client
    // here, no need for cookie write (response is already prepared).
    const tosCheck = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll() { /* read-only */ },
        },
      },
    );
    const { data: { user } } = await tosCheck.auth.getUser();
    if (user) {
      const role = (user.user_metadata as { role?: string } | null)?.role === "therapist"
        ? "therapist"
        : "client";
      const requiredVersion =
        role === "therapist" ? THERAPIST_TOS_VERSION : CLIENT_TOS_VERSION;

      const { data: rows } = await tosCheck
        .from("tos_acceptances")
        .select("tos_version")
        .eq("user_id", user.id)
        .eq("tos_version", requiredVersion)
        .limit(1);

      if (!rows || rows.length === 0) {
        // Therapist on first login OR any user after a TOS bump. Redirect
        // to /accept-terms with a `next` param so we return them where
        // they were trying to go.
        const url = request.nextUrl.clone();
        url.pathname = "/accept-terms";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
    }
  }
  // ──────────────────────────────────────────────────────────────────────

  // Geolocation-aware initial language. Vercel edge sets
  // `x-vercel-ip-country` based on the client IP; on other runtimes or
  // in local dev this header is absent and we fall back to the
  // Accept-Language header. Only set the cookie if it isn't already
  // there — respects the user's explicit choice (and repeat visits).
  const hasLocaleCookie = request.cookies.get("hu-locale");
  if (!hasLocaleCookie) {
    const country = (
      request.headers.get("x-vercel-ip-country") ?? ""
    ).toUpperCase();
    const acceptLang = request.headers.get("accept-language") ?? "";
    // Italy-resident → Italian. Anywhere else defaults to English even
    // if the browser speaks Italian (a Milan-raised user in the UK
    // probably wants English UI + it can always switch manually).
    const isItaly =
      country === "IT" ||
      // Dev fallback (no geo header): use Accept-Language first-match.
      (country === "" && /^it(-|;|$)/i.test(acceptLang));
    const chosen = isItaly ? "it" : "en";
    response.cookies.set("hu-locale", chosen, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: "lax",
      // Secure in prod (Vercel serves https); readable by JS since the
      // I18nProvider in the client needs to hydrate from this value.
      secure: process.env.NODE_ENV === "production",
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
