# Compliance & Legal Status

**Last verified:** 2026-04-17 by Marcello
**Status:** ⚠️ Privacy policy / ToS present but incomplete — sub-processor gaps flagged below.
**Owner:** Marcello (legal review required)

> **Purpose:** operational status of compliance obligations — GDPR, App Store Review Guideline 5.1.1(v), and general EU consumer law. This doc is written from a *product* perspective; all statements about legal adequacy must be reviewed by counsel before reliance.

## 1. Documents in force

| Document | File | Languages | Status |
|----------|------|-----------|--------|
| Privacy Policy | `holistic-unity-website/privacy-policy.html` | EN / IT / PT | Published; **sub-processor list incomplete** — see § 2.1 |
| Terms for clients | `holistic-unity-website/terms-clients.html` | EN / IT / PT | Published; review recommended for refund policy alignment |
| Terms for therapists | `holistic-unity-website/terms-therapists.html` | EN / IT / PT | Published; review recommended for Stripe Connect payout terms |
| Cookie Policy | `holistic-unity-website/cookie-policy.html` | EN / IT / PT | Published; mentions Google Analytics which may or may not actually be in use — see § 2.2 |

Publication URLs:
- `https://holisticunity.app/privacy-policy.html`
- `https://holisticunity.app/terms-clients.html`
- `https://holisticunity.app/terms-therapists.html`
- `https://holisticunity.app/cookie-policy.html`

**App Store Connect requirement:** the privacy policy URL must be entered in App Store Connect → App Information → Privacy Policy URL before app submission. Verify this is set to the canonical URL above (not a Vercel preview URL or similar).

## 2. Known gaps

### 2.1 Missing sub-processors in the privacy policy

The current privacy policy explicitly names **Stripe** and **Supabase** as data processors. It does NOT name the following, all of which receive personal data:

| Sub-processor | What it receives | Where it's located | Status |
|---------------|-----------------|-------------------|--------|
| **LiveKit Cloud** | Display name, voice + video during session, IP address, session duration logs | EU (configured region) | MUST be added |
| **Stream Chat** | User id, display name, photo URL, message content, typing/read state | US (primary), EU replica on paid plans | MUST be added |
| **Brevo** (formerly Sendinblue) | Email address, display name, marketing-consent state | EU (France) | Add if marketing emails are sent — otherwise remove the consent toggle from iOS |
| **Sentry** | Opaque user id only (verified 2026-04-17 in `AuthManager.swift:279`) + stack traces + device model + OS version | US (primary) | Low sensitivity but declare for transparency |
| **TelemetryDeck** (product analytics, scaffolded 2026-04-17) | SHA-256-hashed pseudonymous user id + aggregate event counts (screen views, feature adoption) + coarse device info | EU (Germany) | Minimal — pre-configured PII scrub in `TelemetryDeckAnalyticsService.redactIfLooksLikePII`; no IDFA, no ATT prompt; activation pending SPM add + App ID in Secrets.xcconfig |
| **Apple Push Notification Service** | Device token, notification payload | Global | Minor — covered by standard "notifications" language |
| **Google Sign-In** (if user signs in via Google) | Name + email passed through from Google, nothing stored client-side beyond the resulting Supabase session | Global | Should mention as authentication provider |
| **Microsoft OAuth** (therapist-side, Outlook calendar) | Access token for Calendar scope, refresh token | Global | Therapist-facing only; mention in therapist ToS |
| **Vercel** | IP addresses (in access logs), cookies | US primary | Standard hosting disclosure |

Recommended action (pre-App-Store submission):
1. Add each of the above to the privacy policy "Third-Party Service Providers" section with purpose + data categories + retention.
2. Add LiveKit + Stream to the "International Data Transfers" section explicitly (both involve US transfer — Stream unconditionally, LiveKit only if non-EU region is used).
3. Update the "Last modified" date on the HTML.
4. Re-verify 1-click takes users from the app to each policy (iOS Settings → "Privacy Policy" link must resolve).

### 2.2 Google Analytics claimed but possibly unused

The cookie policy lists Google Analytics as in use. Verify:
```bash
grep -rn "gtag\|GA_MEASUREMENT\|googletagmanager\|google-analytics" "/Users/marcello/Desktop/Holistic Unity/holistic-unity-website/" 2>/dev/null
grep -rn "gtag\|GA_MEASUREMENT\|googletagmanager\|google-analytics" "/Users/marcello/Desktop/Holistic Unity/therapist-webapp/" 2>/dev/null
```
If GA is NOT actually present, remove the entire GA section from the cookie policy — declaring a tracker that isn't deployed is a CNIL/Garante compliance hazard (misleading consent banner).

### 2.3 DPA references

Article 28 of GDPR requires a Data Processing Agreement with every sub-processor. Verify each is in place:

| Sub-processor | DPA status |
|---------------|-----------|
| Stripe | Available at stripe.com/legal/dpa — auto-accepted by account creation |
| Supabase | Auto-accepted in Supabase dashboard on Pro plan; download from billing settings |
| LiveKit | Enterprise-plan default; contact sales on free tier |
| Stream | Available via support@getstream.io |
| Brevo | Auto-accepted; download from account settings |
| Sentry | sentry.io/legal/dpa — auto-accepted |
| Vercel | vercel.com/legal/dpa — auto-accepted |

Retain signed/downloaded DPAs in a secure internal folder (e.g. 1Password vault or encrypted drive). Not required to publish.

### 2.4 Cookie banner implementation

The cookie policy describes categories (strictly-necessary / analytics / marketing) but check the webapps for an actual consent banner:
```bash
grep -rn "cookie.banner\|cookieConsent\|Cookiebot\|OneTrust" "/Users/marcello/Desktop/Holistic Unity/therapist-webapp/" 2>/dev/null
```
If none exists, cookies that fall outside "strictly necessary" (analytics, marketing) require user opt-in BEFORE being set. Until a banner is live, either (a) don't set non-essential cookies or (b) remove the mention of them from the cookie policy.

## 3. App Store Review Guideline 5.1.1(v) — account deletion

**Requirement:** as of 30 June 2022, apps that allow account creation must also allow account deletion from within the app. Apple rejects submissions lacking this.

**Status:** ✅ Implemented.
- Entry point: iOS Settings → Account → "Delete Account" (`SettingsView.swift:61`)
- Flow: confirmation dialog → `AuthRepository.deleteAccount()` → `delete-user-account` edge function → cascade (Stripe, Stream, DB RPC, auth.users)
- User receives in-app confirmation; re-login is blocked immediately.
- Re-signup with same email is possible immediately (anonymized row remains but email is mangled).

### Verification checklist (run before App Store submission)
- [ ] Create a test account via the iOS app (email/password).
- [ ] Book a session + leave a review + start a chat (to populate external-service state).
- [ ] In Settings → Delete Account, tap through.
- [ ] Confirm: cannot log back in with the same credentials.
- [ ] Stream Chat console: user appears as "Deleted user" or is gone.
- [ ] Stripe dashboard: customer marked deleted.
- [ ] Supabase DB: `users.deleted_at` set, other rows anonymized or reassigned to tombstone UUID.
- [ ] 30+ days later (or manually trigger `SELECT public.hard_purge_deleted_accounts()` as service_role): confirm the anonymized row is gone.

## 4. GDPR Articles — operational coverage

| Article | Right | Implementation | Status |
|---------|-------|----------------|--------|
| 13 — information at collection | Transparency notice at sign-up | Privacy policy linked from signup screen | ✅ |
| 15 — right of access | Data export on demand | iOS Settings → "Export my data" returns JSON covering 7 tables (`SettingsView.swift:979`) | ✅ |
| 16 — rectification | Edit profile / account fields | iOS Settings profile editor | ✅ |
| 17 — erasure | Account deletion | Edge function `delete-user-account` + DB RPC `delete_user_account()` — soft-delete + 30-day purge cron | ✅ |
| 18 — restriction of processing | Marketing consent toggle (`users.marketing_consent`) | iOS Settings | ✅ (narrow — full "restrict all processing" not wired) |
| 20 — data portability | Structured, commonly-used format | Data export returns JSON | ✅ |
| 21 — right to object | Marketing opt-out | Same as Art 18 | ✅ |
| 22 — automated decision-making | No automated profiling / automated decisions in V1 | N/A | ✅ |
| 33 — breach notification (72 h) | Runbook | See `INCIDENT_RESPONSE.md` § 3.2 | ✅ |

## 5. Records of processing (Art 30)

Required: a register of all processing activities, maintained by the data controller.

Recommended skeleton (create and store privately, not in this repo):

```
| Activity              | Purpose                     | Data categories       | Recipients (processors)        | Retention | Legal basis       |
|-----------------------|-----------------------------|-----------------------|--------------------------------|-----------|-------------------|
| User sign-up          | Create account              | Email, password hash  | Supabase                       | Until delete  | Contract        |
| Booking + payment     | Facilitate therapy session  | Name, email, amount   | Supabase, Stripe, LiveKit      | 10 yr (tax)   | Contract        |
| Marketing email       | Promote new services        | Email, name           | Brevo                          | Until opt-out | Consent         |
| Chat between parties  | In-session messaging        | Message content       | Stream Chat                    | Until delete  | Contract        |
| Video session         | Deliver therapy             | Audio + video stream  | LiveKit (ephemeral, not recorded) | N/A (not stored) | Contract   |
| Error telemetry       | Diagnose app crashes        | Opaque user id, stack trace, device model | Sentry | 90 days | Legitimate interest |
| Analytics (if live)   | Understand usage patterns   | Hashed identifier, page events | Google Analytics          | 26 months  | Consent           |
```

Hold this in an internal doc (not public) and review quarterly.

## 6. Accepted risks (V1)

| Risk | Status | Reason |
|------|--------|--------|
| No dedicated DPO | Accepted | Below Art 37(1)(b) threshold (not systematic large-scale monitoring); reassess at 10k users |
| No CNIL/Garante privacy notice registration | Accepted | Italy doesn't require pre-filing; notices are obligation-at-breach |
| No periodic DPIA (Art 35) | Accepted | Therapy data is arguably special-category under Art 9 — DPIA SHOULD be done before scaling beyond 1k users |
| No cross-border transfer assessment | Accepted | Stripe + Stream + Sentry all have SCCs; DPF applies for US transfers |
| No data subject request automation | Partially accepted | Art 15 + 17 in-app; others (rectification, restriction) require manual email to support |

## 7. What's on the critical path before App Store submit

1. **Update privacy policy sub-processor list** (§ 2.1) — blocker.
2. **Verify / remove Google Analytics mention** (§ 2.2) — blocker if GA not live.
3. **Confirm privacy policy URL in App Store Connect** — blocker.
4. **End-to-end test account deletion** (§ 3 verification checklist) — blocker.

Everything else in this doc can land post-TestFlight but must be handled before public GA.

## Related

- `holistic-unity-website/privacy-policy.html` — the actual published text
- `holistic-unity-website/terms-clients.html`
- `holistic-unity-website/terms-therapists.html`
- `holistic-unity-website/cookie-policy.html`
- `INCIDENT_RESPONSE.md` § 3 — GDPR breach notification procedure
- `security.md` — threat model + technical safeguards
