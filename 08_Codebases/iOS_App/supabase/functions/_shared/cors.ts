/**
 * H14: Shared CORS configuration for all Edge Functions.
 *
 * In development, allows all origins for easier testing.
 * In production, restricts to the therapist webapp domain and
 * the iOS app's Supabase client (which sends Origin: null).
 *
 * Usage in edge functions:
 *   import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
 *
 *   serve(async (req) => {
 *     const preflight = handleCorsPreflightOrNull(req);
 *     if (preflight) return preflight;
 *     // ... handler logic ...
 *     return new Response(body, { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
 *   });
 */

// Allowed origins. Update these when deploying to new domains.
const ALLOWED_ORIGINS: string[] = [
  "https://therapistportal.holisticunity.app", // production therapist portal
  "https://therapist-webapp-tau.vercel.app",   // Vercel default domain
  "https://holisticunity.com",
  "https://www.holisticunity.com",
  "https://holisticunity.app",
  "https://www.holisticunity.app",
];

// In development (Deno.env IS_DEV or SUPABASE_URL contains localhost/127.0.0.1),
// allow all origins for easier local testing.
function isDev(): boolean {
  const envDev = Deno.env.get("IS_DEV");
  if (envDev === "true" || envDev === "1") return true;
  const url = Deno.env.get("SUPABASE_URL") || "";
  return url.includes("localhost") || url.includes("127.0.0.1");
}

/**
 * Returns the appropriate Access-Control-Allow-Origin for the request.
 * - iOS app sends no Origin (or "null") → reflected as the first allowed origin
 *   (Supabase gateway already authenticates via JWT/apikey)
 * - Browser requests → reflected only if Origin is in the allow list
 * - Dev mode → "*"
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const baseHeaders: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-user-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (isDev()) {
    return { ...baseHeaders, "Access-Control-Allow-Origin": "*" };
  }

  const origin = req?.headers.get("Origin") || "";

  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      ...baseHeaders,
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  }

  // No Origin header (native app, server-to-server) or unrecognized origin.
  // Supabase gateway authenticates these via JWT, so we allow them through
  // but don't reflect a wildcard — the browser won't expose the response
  // to pages on disallowed origins.
  return {
    ...baseHeaders,
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
    Vary: "Origin",
  };
}

/**
 * Returns a preflight response if the request is OPTIONS, or null otherwise.
 */
export function handleCorsPreflightOrNull(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  return null;
}
