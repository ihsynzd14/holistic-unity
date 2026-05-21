/**
 * Sentry — server runtime config (Node).
 *
 * Used by API routes, server components, and the Stripe webhook.
 * Sampled the same as client-side but no Replay integration (we
 * can't replay the browser from the server).
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV || "development",
  enabled: process.env.NODE_ENV === "production",

  beforeSend(event) {
    // Strip request body — may contain Stripe webhook payloads,
    // session tokens, or form submissions with PII. The event's
    // stack trace is what actually gets us debugging, not the body.
    if (event.request) {
      delete event.request.data;
      if (event.request.headers) {
        delete (event.request.headers as Record<string, string>).cookie;
        delete (event.request.headers as Record<string, string>).authorization;
      }
    }
    if (event.user) {
      event.user = { id: event.user.id };
    }
    return event;
  },
});
