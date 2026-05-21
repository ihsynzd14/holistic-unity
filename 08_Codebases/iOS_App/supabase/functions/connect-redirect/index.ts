import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// This function acts as an HTTPS intermediary for Stripe Connect onboarding.
// Stripe requires https:// URLs for return_url and refresh_url in Account Links.
// This function receives the redirect from Stripe and issues a 302 redirect
// to the app's custom URL scheme (deep link).

serve((req) => {
  const url = new URL(req.url);
  const rawType = url.searchParams.get("type") ?? "return";

  // Strict allowlist — reject anything that isn't "return" or "refresh"
  const allowedTypes = ["return", "refresh"];
  const type = allowedTypes.includes(rawType) ? rawType : "return";

  // Build the deep link back to the iOS app
  const deepLink = `holisticunity://stripe-connect-${type}`;

  // 302 redirect directly to the app's deep link
  return new Response(null, {
    status: 302,
    headers: { "Location": deepLink },
  });
});
