/**
 * Sentry — server runtime config (Node).
 *
 * Used by API routes, server components, and the Stripe webhook.
 * Sampled the same as client-side but no Replay integration (we
 * can't replay the browser from the server).
 */

import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "./src/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV || "development",
  enabled: process.env.NODE_ENV === "production",

  // Last-chance PII scrub before events leave the server. Drops the
  // request body (Stripe webhook payloads / form data), strips cookies
  // + auth headers, reduces user to `{ id }`, then deep-regex scrubs
  // Stripe IDs, JWTs, Bearer tokens, and emails out of every string
  // in the payload. See src/lib/sentry/scrub.ts for the threat model
  // and pattern list.
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});
