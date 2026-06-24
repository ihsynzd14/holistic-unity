import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import {
  buildAuthorizeUrl,
  FIC_COOKIE_STATE,
  FIC_COOKIE_VERIFIER,
  FIC_COOKIE_OPTS,
} from "@/lib/integrations/fattureincloud/oauth";

/**
 * GET /api/integrations/fattureincloud/connect
 *
 * Admin-only entry point to start the FIC OAuth flow.
 * Sets state + verifier cookies (PKCE) and redirects to FIC.
 *
 * Open this URL directly in a browser as an admin to begin the
 * one-time platform connection. After consent the callback route
 * stores credentials and redirects to a status page.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/integrations/fattureincloud/callback`;
  const { url, state, verifier } = buildAuthorizeUrl(redirectUri);

  const response = NextResponse.redirect(url);
  response.cookies.set(FIC_COOKIE_STATE, state, FIC_COOKIE_OPTS);
  response.cookies.set(FIC_COOKIE_VERIFIER, verifier, FIC_COOKIE_OPTS);
  return response;
}
