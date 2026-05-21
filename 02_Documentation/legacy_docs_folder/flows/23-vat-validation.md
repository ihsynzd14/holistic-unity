# 23 — VAT Validation (VIES + UK HMRC)

**Last verified:** 2026-05-03 by code review
**Status:** ⚠️ Partial (auth gap — see Recent fixes)
**Criticality:** 🟡 Important (gates monthly invoicing for cross-border therapists)
**Owner:** Marcello

## Purpose

Cross-border therapists (EU outside Italy, UK) need a validated VAT number on file before the monthly invoice cron (`16-fattura-monthly.md`) will issue a `B2B_EU_REVERSE` or `B2B_UK_REVERSE` invoice. Without validation the tax-mode resolver returns `B2C_EU_OSS` / `B2C_UK_VAT` and charges 22% IT VAT instead of using reverse charge — which a real B2B therapist legitimately wants to avoid (their clients/business would pay VAT in their own country).

Validation paths:

- **EU**: live via European Commission **VIES** REST API (`https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`). Returns `valid`, `name`, `address`.
- **UK**: format check only (post-Brexit, HMRC API requires registration and we haven't onboarded). Format: `GB` + 9 or 12 digits.

Validation is one-shot at submit time. If the therapist's VAT number is later revoked by their tax authority, our cached `vat_validated_at` doesn't update — admin would need to manually re-run validation (or trust the original signal until the next monthly invoice surfaces a SDI rejection).

## Preconditions

- Therapist `country` set to a non-IT EU country code or `GB`.
- Therapist authenticated.
- For EU: VIES API reachable (VIES has periodic outages; we surface 503 to the user).

## Sequence

### A. Therapist enters VAT in billing form

`therapist-webapp/src/app/dashboard/billing/page.tsx` (form for `vat_number`). On submit, the page calls `POST /api/billing/vat` (or directly invokes the Edge Function — depending on which surface).

### B. `validate-vat` Edge Function

`iOS App/supabase/functions/validate-vat/index.ts`

1. **Auth:** prefer `x-user-token` header, fall back to `Authorization` Bearer. Resolves to a Supabase user (`index.ts:73`).
2. **Rate limit:** `vat:${user.id}` 10 req/min (`index.ts:89`). VIES is slow (~2-3s); guarding against accidental form spam + hostile probing.
3. **Input validation:** `vat_number` cleaned (`replace(/\s+/g, '').toUpperCase()`); must start with 2-letter country code.
4. **Country branch:**

   **GB:**
   - `validateUkVatFormat()` checks `^\d{9}$` or `^\d{12}$` after stripping `GB` prefix.
   - On valid format: UPDATE `therapist_profiles` `vat_number = cleaned`, `vat_validated_at = now()` (`index.ts:139`).
   - Return `{ valid, vat_number, method: 'format_check', note }`. The note explicitly states "Live validation via HMRC is not available."

   **EU (non-IT):**
   - POST to VIES with `{ countryCode, vatNumber }`.
   - On VIES `{ valid: true, name, address }`: UPDATE `therapist_profiles` same as GB.
   - Return `{ valid, vat_number, name, address, method: 'vies' }`.
   - On VIES error: return 503 with detail.

5. **Reads-only on invalid input** — DB is only updated when the VAT actually validates.

### C. Tax-mode resolution downstream

The `resolveTaxMode` function (`admin-dashboard/src/lib/integrations/fattureincloud/tax-mode.ts:64`) reads `vat_number` AND `vat_validated_at` together for EU therapists:

```ts
if (EU_COUNTRIES.has(country)) {
    if (p.vat_number && p.vat_validated_at) return { mode: "B2B_EU_REVERSE" };
    return { mode: "B2C_EU_OSS" };
}
```

`vat_validated_at` is the gate — having a `vat_number` without successful validation falls back to B2C OSS (22% IT VAT), which is the safe default.

UK behaves the same with `B2B_UK_REVERSE` / `B2C_UK_VAT`.

### D. Billing reminders cron

`admin-dashboard/src/app/api/cron/billing-reminders/route.ts` (Vercel cron Mon 09:00 UTC).

For each approved therapist whose `resolveTaxMode` returns `INCOMPLETE`:
- Throttle: skip if `last_billing_reminder_at` < 7 days ago.
- Look up `auth.users.email` (separate from `billing_email`).
- Send a Brevo email (custom HTML, not a template) explaining what's missing — uses `REASON_TEXT` mapping for the granular reason from the resolver.
- Bump `last_billing_reminder_at` on success.

The text nudges therapists with `missing_country`, `missing_address`, `missing_sdi_or_pec`, `missing_codice_fiscale`, or generic `incomplete_billing` toward `/dashboard/billing`.

## Critical assertions

- **`vat_validated_at` is the truth gate.** A `vat_number` value alone does not unlock B2B reverse charge — the column must be non-null.
- **VIES is the only authoritative source for EU.** No fallback to format-check if VIES is down — we return 503 and the therapist retries later. This avoids storing an unvalidated number that would later cause a SDI rejection.
- **UK falls back to format check** (post-Brexit limitation). The note returned to the user is explicit so they understand why HMRC isn't called.
- **Cleaning is consistent:** `replace(/\s+/g, '').toUpperCase()`. The cleaned value is what's persisted, so downstream comparisons (e.g. on the invoice payload) match.
- **Rate limit 10/min/user is intentionally generous** for genuine retry needs but tight enough that brute-force VAT enumeration becomes impractical.
- **Updates `therapist_profiles` directly via service-role** (the Edge Function uses the service-role client). Future hardening should verify the user is a therapist before writing — see Recent fixes.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Empty / too short VAT | `index.ts:108` | 400 "VAT number is too short" |
| No country prefix | `index.ts:120` | 400 "VAT number must start with a 2-letter country code" |
| GB invalid format | `validateUkVatFormat` | 200 with `valid:false`; DB not updated |
| EU invalid VAT | VIES `{valid:false}` | 200 with `valid:false`; DB not updated |
| VIES API 5xx | `viesErr` | 503 "VAT validation service temporarily unavailable" |
| VIES timeout | Same path | 503; therapist retries later |
| Rate limit hit | `isRateLimited` | 429 |
| Unauthenticated | `authError` | 401 |

## Files

- `iOS App/supabase/functions/validate-vat/index.ts` — main Edge Function
- `iOS App/supabase/functions/_shared/rate-limit.ts` — `isRateLimited` helper
- `admin-dashboard/src/lib/integrations/fattureincloud/tax-mode.ts` — `resolveTaxMode` consumer
- `admin-dashboard/src/lib/integrations/fattureincloud/vies.ts` — VIES helper (admin-side, parallel implementation)
- `admin-dashboard/src/app/api/cron/billing-reminders/route.ts` — Mon 09:00 UTC cron
- `therapist-webapp/src/app/api/stripe/validate-vat/route.ts` — webapp wrapper around the Edge Function
- `therapist-webapp/src/app/dashboard/billing/page.tsx` — UI form

## Recent fixes / known issues

- **Auth gap (KNOWN ISSUE, not yet fixed):** the Edge Function authenticates the caller as a Supabase user (any role) but writes to `therapist_profiles` for that user_id WITHOUT verifying the user has the `therapist` role. A non-therapist with a valid Supabase session could call `validate-vat` to set their own `therapist_profiles.vat_number` IF a row exists for them — but `therapist_profiles` is keyed on user_id, so a non-therapist wouldn't have a profile row to update. **Lower-impact than it sounds**, but the fix is trivial: pre-check `users.role = 'therapist'` before the UPDATE. Tracked for V1.1.
- **VIES outages are common.** The European Commission's VIES service has documented downtime windows (often Sundays + bank holidays). The 503 response is the correct behavior; therapists must retry.
- **No live UK HMRC validation.** Format check only. A therapist could theoretically enter a syntactically-correct but non-existent UK VAT and the system would mark it `validated`. The downside: SDI doesn't apply for UK (mode is `B2B_UK_REVERSE` which doesn't go to SDI), so the only consequence is incorrect commission classification — surfaces as a customer dispute, not a fiscal violation against us.
- **`vat_validated_at` never expires.** Once set, the system trusts it indefinitely. If a therapist's VAT registration is revoked by their authority, we wouldn't know until SDI rejects (for IT modes — but UK/EU don't use SDI here). V1.1 to add a 12-month re-validation cron.
- **`billing-reminders` cron throttle is per-therapist (`last_billing_reminder_at`).** No global rate limit — if many therapists onboard incomplete in one week, all get an email; Brevo queues handle bulk delivery without issues.
- **Known gap:** no admin UI to force re-validation. Manual via service-role NULL on `vat_validated_at` then asking the therapist to re-submit.
