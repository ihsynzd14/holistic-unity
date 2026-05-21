/**
 * Sentry — browser runtime config.
 *
 * Captures unhandled client-side errors and routes them to
 * Holistic Unity's Sentry project. Runs inside the browser so we
 * have a small but deliberate scrubbing pipeline to strip anything
 * that looks like PII before the event leaves the user's machine.
 *
 * DSN comes from NEXT_PUBLIC_SENTRY_DSN — set in Vercel env vars.
 * If absent (e.g. during local dev without the env var), Sentry
 * becomes a no-op, which is what we want: we don't send events
 * from `npm run dev`.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample a fraction of transactions for performance monitoring.
  // Start at 10% so we don't blow past the Sentry plan quota on
  // launch; raise later once we see steady-state volume.
  tracesSampleRate: 0.1,

  // Replay captures DOM state at error time — invaluable for
  // "this was broken on my laptop" reports. Sample conservatively:
  //   0% of normal sessions (privacy + quota)
  //   100% of sessions that hit an error (full replay of failure)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Block sending entirely on localhost + preview deploys to avoid
  // noise from internal QA. `environment` gets set by Vercel.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",
  enabled: process.env.NODE_ENV === "production",

  integrations: [
    Sentry.replayIntegration({
      // Mask all text + media content in session replays by default.
      // Holistic Unity deals with mental-health-adjacent disclosures in
      // onboarding, chat, and bookings — we'd rather blur more than
      // risk leaking a sensitive message body to the error dashboard.
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Last-chance scrub before events leave the browser. Removes PII
  // that may have slipped into breadcrumb URLs, form data, or
  // user-context from the auth layer.
  beforeSend(event) {
    // Strip cookies + auth headers
    if (event.request?.headers) {
      delete (event.request.headers as Record<string, string>).cookie;
      delete (event.request.headers as Record<string, string>).authorization;
    }
    // Don't send the user's email/phone from Supabase session — only
    // the opaque UUID (for cross-referencing with Supabase logs).
    if (event.user) {
      event.user = { id: event.user.id };
    }
    return event;
  },
});
