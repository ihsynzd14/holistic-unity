# Abuse Hardening — V1.0 → V1.1 Roadmap

**Last verified:** 2026-04-17 by Marcello
**Status:** Forward-looking plan. Nothing here is required for TestFlight / initial App Store submission.
**Owner:** Marcello

> **Purpose:** captures the abuse-control work intentionally deferred past V1. These items are low-probability-of-regret — they add cost in LoC + vendor spend that isn't justified at 0 users but becomes essential around 1–10k monthly active users.

## 1. CAPTCHA on signup / password reset (Phase 5.4)

### Why we don't have one yet

- V1 target is ~1k users, most via word-of-mouth invitation.
- Supabase's default auth throttling (5 requests/min per IP for signup) absorbs opportunistic abuse.
- CAPTCHAs add measurable user-facing friction; measured conversion drops are in the single-digit percent range even for privacy-preserving options.

### Why we'll need one before public launch

- Credential-stuffing: automated scripts spraying leaked credential pairs against login endpoints.
- Bot signup: account creation rings preparing disposable accounts for fraud, marketplace manipulation, or scraping.
- Password-reset amplification: attacker triggers `resetPasswordForEmail` for thousands of addresses; Supabase sends the real user an unexpected email, creating phishing confusion.

### Recommended provider: hCaptcha

Privacy-preserving (no PII shared), free tier up to 1M requests/month, integrates directly with Supabase Auth via a single config flag.

### Activation plan (when pulling the trigger)

**Step 1 — Sign up for hCaptcha (5 min)**
- https://www.hcaptcha.com/ → "Sign up" (free tier).
- Create a site key for `holisticunity.app`, `therapistportal.holisticunity.app`, `admin.holisticunity.app`.
- Copy the **site key** (public, safe to embed) and **secret key** (server-only).

**Step 2 — Configure Supabase (2 min)**
- Supabase Dashboard → Authentication → Settings → "Bot and Abuse Protection".
- Provider: hCaptcha.
- Secret key: paste the hCaptcha secret.
- Enable for: Sign up + Password recovery + (optional) Sign in.

**Step 3 — Wire in the webapps (15 min each)**
```tsx
// therapist-webapp and admin-dashboard — example on the login page
import HCaptcha from "@hcaptcha/react-hcaptcha";

const [captchaToken, setCaptchaToken] = useState<string>();
// ... in the form:
<HCaptcha
  sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY!}
  onVerify={setCaptchaToken}
/>
// ... on submit:
await supabase.auth.signInWithPassword({
  email, password,
  options: { captchaToken },
});
```

Add `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` to each Vercel project's env vars (Production + Preview).

**Step 4 — iOS wiring (30 min)**

Supabase Swift SDK supports CAPTCHA tokens via the `options` parameter on `signUp` / `signInWithPassword` / `resetPasswordForEmail`. Display the hCaptcha challenge via a `WKWebView` overlay or the [HCaptchaIOS](https://github.com/hCaptcha/HCaptcha-ios-sdk) SDK.
```swift
// In AuthView.swift
let token = try await HCaptcha.verify(siteKey: AppConstants.hcaptchaSiteKey)
try await SupabaseConfig.client.auth.signInWithPassword(
    email: email, password: password,
    options: .init(captchaToken: token)
)
```

**Step 5 — Monitor (ongoing)**

Watch the hCaptcha dashboard for:
- Pass rate < 95% → something is misconfigured; users are getting stuck in a bad state.
- Signup volume drop > 10% in the week after turning it on → conversion impact; consider moving the challenge to ONLY fire after 3 rapid failures on an IP rather than on every attempt.

### Alternative providers considered

- **Cloudflare Turnstile** — free, invisible most of the time. Excellent UX but requires proxying through Cloudflare; not zero-touch for our Vercel setup.
- **reCAPTCHA v3** — invisible but sends fingerprint data to Google. Privacy-policy overhead.
- **Friendly Captcha** — EU-based, GDPR-clean; more expensive at scale.

Decision heuristic: use hCaptcha unless we move to Cloudflare for DDoS/WAF, at which point Turnstile becomes free.

---

## 2. Bug bounty / responsible disclosure program (Phase 5.5)

### When to launch

- **Not before V1.1** (at least 500 active users, 30+ days of production operation).
- Launching too early = unfocused noise from researchers who find minor issues that we'd otherwise catch in normal development.
- Launching too late = responsible researchers stay silent or drop 0-days publicly.

### Recommended platform: Intigriti VDP (Vulnerability Disclosure Policy)

Free tier, EU-based, public leaderboard optional. Alternatives: HackerOne VDP (US-based, also free), or self-hosted `.well-known/security.txt` for researchers who prefer no intermediary.

### Scope (when published)

```
In-scope:
  • iOS application (Holistic Unity on App Store)
  • https://holisticunity.app/*
  • https://therapistportal.holisticunity.app/*
  • https://admin.holisticunity.app/*
  • https://bqyqkvkzkemiwyqjkbna.supabase.co/* (Supabase project)

Out-of-scope:
  • Sub-processors (Stripe, LiveKit, Stream, Sentry, Brevo) —
    report directly to the provider.
  • Rate-limit / DoS attacks — known, not interesting.
  • Social engineering of our team.
  • Physical attacks on staff.
  • Vulnerabilities requiring root / jailbroken devices (but JB
    detector false-positives ARE interesting — see
    JailbreakDetector.swift).
  • Issues in third-party libraries WITHOUT a specific exploitable
    path in our code.
  • Outdated SDK versions without a proof-of-concept exploit.

Rules:
  • No automated scanning of production endpoints at > 10 req/s.
  • Test accounts only — do NOT interact with real users or their data.
  • Report via <security@holisticunity.app>; we acknowledge in ≤ 48 h.
  • 90-day disclosure window before public write-up.

Reward model (V1 — Vulnerability Disclosure Policy, no monetary bounty):
  • Public credit in a security.txt hall-of-fame if the reporter wishes.
  • Swag (T-shirt, stickers) for medium+ severity.

Reward model (V1.1+ — if transitioning to paid bounty):
  • Critical (RCE, unauthenticated admin): €500–1500
  • High (privilege escalation, data leak): €200–500
  • Medium (authenticated privilege issues): €50–200
  • Low (CSRF, open redirect): €25–50
  Adjust based on user count + severity class.
```

### Pre-launch checklist

- [ ] Create `security@holisticunity.app` mailbox (or forward to personal inbox until team grows).
- [ ] Publish `/.well-known/security.txt` at each domain with contact + PGP key + policy URL.
- [ ] Publish `/security-policy` page linking the scope above.
- [ ] Commit to 48 h acknowledgement SLA — if you can't honour it, don't launch the program.
- [ ] Practise internal response on 2-3 test reports before going public.

### Don't launch a bounty if you haven't resolved

Every critical finding from:
- MobSF scan on release IPA
- OWASP ZAP baseline
- gitleaks CI
- `npm audit` high/critical
- The Phase 1–3 hardening items in the original pre-TestFlight plan.

Researchers file duplicates of those first, which (a) wastes their time, (b) damages program reputation.

---

## 3. Additional abuse-control items (lower priority)

### 3.1 IP-based behavioural rate limiting

Beyond per-user rate limiting, add per-IP limits on signup + password reset + booking creation. Implemented in the same Postgres-backed `rate_limit_buckets` table by using `ip:${x-forwarded-for}` as the key. Cost: 3 edge function tweaks.

### 3.2 Disposable-email blocklist

Free signups from throwaway providers (mailinator, guerrillamail, etc.) are a common bot signal. Use an open list (https://github.com/disposable-email-domains/disposable-email-domains) and reject at signup OR quarantine signups until first booking. Start with a soft quarantine — wait for signal before hard-blocking.

### 3.3 Device fingerprinting

Fingerprint the device at signup (user agent + TLS fingerprint + canvas fingerprint on web) — store hash, alert on multiple accounts from same fingerprint. Privacy trade-off is real; only consider if the abuse cost-benefit flips.

### 3.4 Proof-of-Work on signup

Modern alternative to CAPTCHA: make the client compute a small PoW (e.g. https://github.com/drew2a/friendly-captcha-alternative). Zero server cost, zero tracking, but adds ~1–3s on slow devices.

### 3.5 Anti-fraud on booking

The money path is already protected by:
- Stripe Radar (automatic fraud scoring on every charge)
- UNIQUE constraint on `stripe_payment_intent_id` (no double-charge)
- Transaction history + dispute tracking in our DB

Next-level would be: block bookings from accounts < 24 h old paying with cards that don't match the account country; require 3DS on high-value bookings. Stripe Radar rules can do most of this without our code.

---

## 4. What NOT to add

- **IP geo-blocking** — too broad, legitimate users travel.
- **Mandatory phone verification** — large conversion drop, often abused more than preventing abuse (SMS pumping fraud).
- **"Are you a robot?" checkboxes without a backing provider** — security theatre.
- **Client-side rate limiting** — bypassable, gives false sense of security. Server-side only.

## Related

- `security.md` — technical safeguards already deployed.
- `scanning-runbook.md` — catches issues researchers would report.
- `INCIDENT_RESPONSE.md` § 3 — breach response if abuse succeeds.
- `monitoring.md` — alert rules that detect abuse in progress.
