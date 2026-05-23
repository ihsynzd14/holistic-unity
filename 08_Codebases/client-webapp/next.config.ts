import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

// Bundle analyzer — only active when `ANALYZE=true` env var is set.
// Run `ANALYZE=true npm run build` to generate the report in `.next/analyze/`.
// Used 2026-05-23 to identify top-3 heaviest packages per webapp (audit
// row "Bundle analyzer" in 01_TASK_LIST_PRELANCIO.md).
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // C8: Disable source maps in production to prevent source code exposure
  productionBrowserSourceMaps: false,

  // Strip the X-Powered-By header to reduce framework fingerprinting
  poweredByHeader: false,

  // Allowlist of external image hosts that `next/image` can render. Required
  // even when `unoptimized={true}` is used per-component — Next.js 16 enforces
  // remotePatterns at parse-time regardless of optimization. Hosts mirror the
  // CSP `img-src` allowlist in src/lib/security/csp.ts.
  //
  // Supabase Storage: avatars (profile-photos bucket) + gallery + intro videos.
  // Strictly scoped to the project hostname + `/storage/v1/object/public/**`
  // path so an attacker can't trick the loader into proxying arbitrary URLs.
  //
  // YouTube img.youtube.com: hqdefault.jpg thumbnails generated from
  // therapist video_intro_url (see videoPosterUrl in therapists/[id]/page.tsx).
  // i.ytimg.com is the CDN alias; we include both even though we only emit
  // img.youtube.com — defensive for future CDN redirects.
  //
  // Vimeo vumbnail.com + *.vimeocdn.com: posters fetched async via
  // fetchVimeoPoster from Vimeo's oEmbed endpoint.
  //
  // For Supabase + YouTube/Vimeo we pass `unoptimized={true}` per-component:
  // Supabase Storage is already on Cloudflare with on-the-fly image
  // transforms, and YouTube/Vimeo thumbnails are already optimized JPEG/WebP.
  // Adding Vercel Image Optimization on top would be a duplicate CDN +
  // metered cost without measurable benefit at MVP traffic.
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
export default withBundleAnalyzer(
  withSentryConfig(nextConfig, {
    silent: !process.env.CI,
    disableLogger: true,
  }),
);
