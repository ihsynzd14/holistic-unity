import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // C8: Disable source maps in production to prevent source code exposure
  productionBrowserSourceMaps: false,

  // Strip the X-Powered-By header to reduce framework fingerprinting
  poweredByHeader: false,

  // Allowlist of external image hosts that `next/image` can render. Required
  // even when `unoptimized={true}` is used per-component. Mirrors client-webapp
  // config (see client-webapp/next.config.ts for full rationale). On the
  // therapist side the only externally-sourced images today are the avatar +
  // gallery uploads in dashboard/profile (Supabase Storage) and the video
  // intro preview thumbnail from YouTube/Vimeo oEmbed.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "bqyqkvkzkemiwyqjkbna.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
        pathname: "/vi/**",
      },
      {
        protocol: "https",
        hostname: "i.ytimg.com",
        pathname: "/vi/**",
      },
      {
        protocol: "https",
        hostname: "vumbnail.com",
      },
      {
        protocol: "https",
        hostname: "**.vimeocdn.com",
      },
    ],
  },

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

// Sentry wrapper — see client-webapp/next.config.ts for the rationale.
// Source maps upload + Release tagging require SENTRY_AUTH_TOKEN in
// Vercel; org/project are the targets for upload; Release is auto-tagged
// from VERCEL_GIT_COMMIT_SHA on every deploy.
export default withBundleAnalyzer(
  withSentryConfig(nextConfig, {
    silent: !process.env.CI,
    disableLogger: true,
    org: "storm-x-digital-srl",
    project: "holistic-unity-therapist-web",
    widenClientFileUpload: true,
    // Release name precedence: SENTRY_RELEASE → VERCEL_GIT_COMMIT_SHA →
    // VERCEL_DEPLOYMENT_ID. See client-webapp/next.config.ts for the full
    // rationale and the reason we gate the spread on truthiness.
    ...((process.env.SENTRY_RELEASE
      || process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.VERCEL_DEPLOYMENT_ID)
      ? {
          release: {
            name:
              process.env.SENTRY_RELEASE
              || process.env.VERCEL_GIT_COMMIT_SHA
              || process.env.VERCEL_DEPLOYMENT_ID,
          },
        }
      : {}),
    sourcemaps: {
      // v10 replacement for the old `hideSourceMaps`. See client-webapp/next.config.ts.
      deleteSourcemapsAfterUpload: true,
    },
  }),
);
