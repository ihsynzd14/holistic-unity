import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { isDisposableEmail } from "@/lib/auth/disposable-email-domains";

/**
 * POST /api/auth/check-signup
 *
 * Server-side pre-flight check that runs BEFORE `supabase.auth.signUp`.
 * It's the replacement for the old `/api/auth/verify-turnstile` route,
 * which depended on Cloudflare Turnstile JS loading client-side — that
 * dependency was breaking signups for any user running uBlock Origin,
 * Privacy Badger, Brave's strict shields, iOS Safari with strict
 * privacy mode, or corporate networks that block challenges.cloudflare.com.
 *
 * Instead of one all-or-nothing captcha, this endpoint layers four
 * silent signals — none of them visible to the user — that together
 * make bot signups unprofitable without breaking legitimate ones:
 *
 *   1. **Honeypot field.** The /register form renders a hidden input
 *      named `company_url` that humans never see (off-screen via CSS).
 *      Naive form-fillers (the kind that scrape forms and POST every
 *      field) populate it. If it arrives non-empty → bot. Returns 200
 *      with a slow fake delay so the bot doesn't learn it tripped a
 *      wire and just retries.
 *
 *   2. **Time-on-form check.** The client submits `formAgeMs` (ms
 *      since mount). Humans take >2s to fill a real signup form;
 *      stupid bots submit immediately. If under 2000ms → reject.
 *      Bots that fake this just hit the next layer.
 *
 *   3. **Disposable email blocklist.** Mailinator, 10minutemail,
 *      yopmail, ~80 domains hand-picked from the open-source list.
 *      These addresses can't actually receive our confirmation link
 *      (the inbox auto-discards), so they're useless for real signups
 *      and the favourite tool of signup farms.
 *
 *   4. **Rate limit per IP.** We share the global Postgres-backed
 *      rate limiter (`check_rate_limit` RPC). 3 signups per hour per
 *      IP is generous for a household with multiple people but
 *      brutal for a farm.
 *
 * Anything that gets past all four layers still has to defeat the
 * existing checks downstream (email confirmation gate, HaveIBeenPwned
 * password check, manual review at booking time). The whole stack is
 * "defence in depth": no single layer is perfect, the sum is.
 *
 * Why this is robust vs. ad-blockers:
 *   - Honeypot is just an HTML input — extensions don't touch it.
 *   - Time check is client-side timestamp — no third-party JS.
 *   - Email check is server-side — invisible to the client.
 *   - Rate limit is server-side — same.
 *
 * Lorena Maraschi-style test signups via Gmail `+` aliases pass all
 * four layers, so this doesn't get in the way of QA.
 */
export async function POST(req: NextRequest) {
  let body: { honeypot?: string; formAgeMs?: number; email?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // ── Layer 1: honeypot ────────────────────────────────────────────────
  // Bots that scrape forms and submit every field fill this one. Real
  // humans never see it. We return 200 with a fake success after a
  // short delay so the bot caches us as "signup works" and the inevitable
  // failure at email-confirm time isn't tied back to this gate.
  if (typeof body.honeypot === "string" && body.honeypot.trim().length > 0) {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ ok: true, deferred: true });
  }

  // ── Layer 2: time-on-form ────────────────────────────────────────────
  // Anything below 2s is statistically impossible for a real form fill
  // (name + email + phone + password + confirm + 2 checkboxes). We
  // accept the client-supplied timestamp because faking it forces the
  // attacker to maintain per-form state, which most don't bother with.
  if (typeof body.formAgeMs !== "number" || body.formAgeMs < 2000) {
    return NextResponse.json(
      { error: "form_submitted_too_fast" },
      { status: 429 },
    );
  }

  // ── Layer 3: disposable email blocklist ──────────────────────────────
  if (!body.email || typeof body.email !== "string") {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }
  if (isDisposableEmail(body.email)) {
    return NextResponse.json(
      { error: "disposable_email_not_allowed" },
      { status: 422 },
    );
  }

  // ── Layer 4: per-IP rate limit ───────────────────────────────────────
  // 3 successful pre-checks per IP per hour. Generous for shared
  // households (different family members signing up from the same
  // router) but a brick wall for signup farms. The Postgres-backed
  // rate limiter returns 429 with proper `Retry-After` headers when
  // tripped — no further logic needed here.
  const rl = await withRateLimit(req, {
    key: "signup-precheck",
    max: 3,
    windowSec: 3600,
  });
  if (rl.response) return rl.response;

  return NextResponse.json({ ok: true });
}
