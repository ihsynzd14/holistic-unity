import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // C8: Disable source maps in production to prevent source code exposure
  productionBrowserSourceMaps: false,

  // Strip the X-Powered-By header to reduce framework fingerprinting
  poweredByHeader: false,

  // C8: Static security headers for all routes. CSP is intentionally
  // excluded here — it's built per-request with a fresh nonce in the
  // edge middleware (`src/proxy.ts` + `src/lib/security/csp.ts`).
  //
  // Headers() cannot inject a nonce because it runs at build time; all
  // other headers in this list are static strings and are safe here.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

// Wrap with Sentry's Next.js plugin so:
//   - the client SDK gets injected into the browser bundle
//   - the server SDK is initialised via instrumentation.ts
//   - source maps upload in CI when SENTRY_AUTH_TOKEN is present
//     (the upload step just warns + skips if the token is missing,
//     so local builds and PR previews don't fail for lack of it).
//
// Kept minimal: no tunnelRoute (we don't need it at launch volume),
// no release tracking (inferred from Vercel deployment), no custom
// errorHandler (Sentry's default is "warn, don't fail").
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  disableLogger: true,
});
