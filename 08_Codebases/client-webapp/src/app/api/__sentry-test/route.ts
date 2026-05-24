import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// Sentry capture verification endpoint.
//
// Gated by a one-off token (`SENTRY_TEST_TOKEN` env var on Vercel) so
// this can ship to production without being a public DoS vector. Set
// the env var to a random string, hit `GET /api/__sentry-test?token=…`
// once, then look for the event in the Sentry inbox. The event
// deliberately embeds three PII-shaped canaries so we can confirm the
// scrub regex in `src/lib/sentry/scrub.ts` is firing — in the Sentry
// dashboard those canaries should appear REDACTED, NOT in plaintext.
//
// If/when you're done verifying, either delete this file or unset
// `SENTRY_TEST_TOKEN` (no token configured → endpoint returns 404).
export async function GET(request: Request) {
  const expected = process.env.SENTRY_TEST_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const provided = new URL(request.url).searchParams.get("token");
  if (provided !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const eventId = Sentry.captureException(
    new Error(
      "Sentry test event — verifying capture + scrub. " +
        "PII canaries: pi_test1234567890abcd, " +
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.SflKxwRJSMeKKF, " +
        "test-user@example.com",
    ),
  );

  // Flush before returning — Vercel serverless functions get torn
  // down quickly after the response; without flush the event can be
  // dropped silently.
  await Sentry.flush(2000);

  return NextResponse.json({
    ok: true,
    eventId,
    note:
      "Check the Sentry inbox for this event. PII canaries should appear " +
      "redacted (pi_***, eyJ***JWT_REDACTED***, ***@***), NOT in plaintext.",
  });
}
