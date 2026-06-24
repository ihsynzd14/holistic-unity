import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  /* config options here */
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
    project: "holistic-unity-admin-web",
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
