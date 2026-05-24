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
//   - source maps upload + Release tagging happen automatically when
//     SENTRY_AUTH_TOKEN is present in the build env (Vercel). The
//     plugin needs org + project slugs (below) to know where to upload;
//     without the token it silently skips, so local builds and PR
//     previews don't fail for lack of it.
//   - Release name is auto-detected from VERCEL_GIT_COMMIT_SHA at
//     build time, so every deploy creates a Sentry Release tagged with
//     the exact commit. No manual `sentry-cli releases new` step.
//
// `hideSourceMaps: true` complements `productionBrowserSourceMaps: false`
// — the plugin still uploads source maps to Sentry for symbolication,
// but strips the public *.map files from the build output so source
// code can't be reconstructed from a downloaded bundle.
//
// `widenClientFileUpload: true` lets the plugin pick up source maps
// from a wider glob (e.g. dynamic imports) so post-deploy stack traces
// are fully symbolicated instead of partial.
export default withBundleAnalyzer(
  withSentryConfig(nextConfig, {
    silent: !process.env.CI,
    disableLogger: true,
    org: "storm-x-digital-srl",
    project: "holistic-unity-client-web",
    widenClientFileUpload: true,
    // Sentry Release name resolution. Precedence (most → least specific):
    //   1. SENTRY_RELEASE — explicit override (set by the caller when
    //      deploying, e.g. `SENTRY_RELEASE=$(git rev-parse HEAD) vercel
    //      deploy --prod` to get commit-SHA naming with CLI deploys).
    //   2. VERCEL_GIT_COMMIT_SHA — set automatically when a Vercel project
    //      is git-connected AND the "Automatically expose System Env
    //      Variables" toggle is on. Our projects are CLI-deployed today,
    //      so this is normally absent — kept here for the day we wire git.
    //   3. VERCEL_DEPLOYMENT_ID — always set by Vercel for any deploy
    //      (CLI, dashboard redeploy, or git-triggered). Opaque (`dpl_...`)
    //      but uniquely identifies a deploy, which is enough to make
    //      Sentry's regression-tracking work.
    //
    // The whole `release` block is conditionally spread: passing
    // `release: { name: undefined }` would let sentry-cli receive
    // `--release ''` and abort the upload with a non-zero exit code,
    // failing the entire Vercel build. Omitting the block when name is
    // empty makes a missing identifier a clean no-op (no release created)
    // instead of a build crash.
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
      // v10 replacement for the old `hideSourceMaps`. The plugin still
      // uploads maps to Sentry for symbolication, but removes the *.map
      // artifacts from the build output afterwards so they never ship
      // to users. Belt-and-braces with `productionBrowserSourceMaps:
      // false` above.
      deleteSourcemapsAfterUpload: true,
    },
  }),
);
