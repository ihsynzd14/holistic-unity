/**
 * Sentry — edge runtime config (middleware + edge route handlers).
 *
 * Vercel's edge runtime is more constrained than Node — no fs,
 * no full Node API. This file keeps the init minimal so we don't
 * try to load anything that breaks edge.
 */

import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "./src/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV || "development",
  enabled: process.env.NODE_ENV === "production",

  // Last-chance PII scrub for events from the edge runtime. Same
  // regex patterns as the client/server configs — Stripe IDs, JWTs,
  // Bearer tokens, emails. See src/lib/sentry/scrub.ts.
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});
