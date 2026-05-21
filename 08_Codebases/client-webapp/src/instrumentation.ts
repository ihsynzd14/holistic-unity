/**
 * Next.js instrumentation hook.
 *
 * Called once per server start. Routes the appropriate Sentry
 * config based on the runtime so we don't drag Node-only deps into
 * the edge bundle (Vercel's edge runtime would crash).
 *
 * `register` runs at process boot; `onRequestError` is called by
 * Next on every uncaught render error so we can forward it to Sentry.
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
