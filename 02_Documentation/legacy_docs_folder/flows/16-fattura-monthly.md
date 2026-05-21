# 16 — Monthly Commission Invoice (FattureInCloud + SDI)

**Last verified:** 2026-05-06 (added EU territories outside VAT zone detection)

> **EU territories outside the EU VAT zone (2026-05-06):** the tax-mode resolver now checks the billing CAP/postal code for therapists in EU countries. Canary Islands (ES 35xxx/38xxx), Ceuta (51xxx) and Melilla (52xxx), Azores (PT 95-96xxx), Madeira (PT 90-92xxx), French DOM-TOM (FR 97/98xxx), Italian Livigno + Campione d'Italia, German Heligoland + Büsingen — all resolved as `EXTRA_EU` ("fuori campo IVA Art. 7-ter") instead of `B2C_EU_OSS` (which would have applied Italian 22% VAT to a non-VAT-zone resident). Function: `isOutsideEuVatZone(country, cap)` in `admin-dashboard/src/lib/integrations/fattureincloud/tax-mode.ts`.


**Status:** ✅ Production (end-to-end since 2026-05-03)
**Criticality:** 🔴 Critical
**Owner:** Marcello

## Purpose

Once a month, the platform issues a **fattura riepilogativa** (summary invoice) to each approved therapist for the 20% intermediation commission collected during the previous calendar month. For Italian therapists the invoice is electronic (FE) and submitted to **SDI** (Sistema di Interscambio); for cross-border therapists a regular FattureInCloud invoice is generated and emailed via the FIC dashboard.

## Where the FIC invoice fields come from (source-of-truth map)

The cron reads from `therapist_profiles` (set via the therapist webapp `/dashboard/billing` form, persisted by `POST /api/billing/profile`). Mapping by tax mode:

| Mode | FIC `entity` field | DB column | Form field |
|---|---|---|---|
| **B2B_IT** / **B2B_IT_FORF** | `vat_number` | `p_iva` | "Partita IVA" |
| | `tax_code` | `codice_fiscale` (fallback `p_iva`) | "Codice fiscale" |
| | `ei_code` | `codice_destinatario` (fallback `0000000`) | "Codice destinatario SDI" |
| | `certified_email` | `pec_email` | "Indirizzo PEC" |
| **B2C_IT** | `tax_code` | `codice_fiscale` | "Codice fiscale" |
| | `ei_code` | hard-coded `0000000` | (n/a — Cassetto Fiscale) |
| **B2B_EU_REVERSE** / **B2B_UK_REVERSE** | `vat_number` | `vat_number` | "VAT Number UE/UK" |
| | `certified_email` | `billing_email` | "Email per ricezione fattura" |
| **B2C_EU_OSS** / **B2C_UK_VAT** | (no fiscal id) | — | — |
| | `certified_email` | `billing_email` | "Email per ricezione fattura" |
| **EXTRA_EU** | `tax_code` | `tax_id_foreign` | "NIF/NIE" (ES), "Numéro fiscal" (FR), "Steuer-IdNr" (DE), "UTR" (GB), etc. |
| | `certified_email` | `billing_email` | "Email per ricezione fattura" |

Common across all modes:
- `entity.name` ← `therapist_profiles.display_name`
- `entity.address_*` ← `billing_address.{street,cap,city,province}`
- `entity.country` ← `billing_address.country` (mapped ISO2 → Italian name via `COUNTRY_ISO_TO_FIC`, e.g. `ES` → `Spagna`)
- `entity.regime_forfettario` flag ← `regime_forfettario` (only relevant for IT)

`entity_overrides` (cron-side) fills the same fields **mode-aware** as a defence against FIC entities that were cached with sparse data. Since 2026-05-06 the override is no longer hardcoded to Italian columns — for `EXTRA_EU` it sources `tax_code` from `tax_id_foreign`, for `B2B_EU/UK_REVERSE` it sources `vat_number` from the cross-border `vat_number` column, and so on. Earlier code passed `vat_number: t.p_iva` regardless of mode, which would have written `null` for non-IT therapists (harmless because the cron's `if (entity_overrides.vat_number)` truthy guard skips null) but would have re-written stale Italian values onto a foreign FIC entity if a therapist ever changed country mid-flight.

The shape of the **invoice items** (commission line, IVA rate, e_invoice_reference) is purely a function of `mode` — see `modeConfig()` in `tax-mode.ts`. SDI submission is gated by `shouldSubmitToSdi(mode)` which is true only for the three IT modes.

Italian fiscal basis: Art. 21 c. 4 DPR 633/72 allows a fattura riepilogativa for services rendered during a calendar month. Art. 6 c. 3 DPR 633/72 defines the moment of provision of service as the charge time (Stripe `payment_intent.succeeded`), NOT the bank-payout time. This is why the cron filters by `transactions.status='completed'` and **NOT** by `payout_status` — the platform's commission is the Stripe `application_fee_amount` deducted at charge time, already in our pocket regardless of whether the therapist's 14-day escrow has elapsed.

## Preconditions

- Vercel Cron is configured in `admin-dashboard/vercel.json`:
  ```json
  { "path": "/api/cron/monthly-invoices", "schedule": "0 3 1 * *" }
  ```
  Runs at 03:00 UTC on the 1st of every month for the previous calendar month.
- `CRON_SECRET` env var set on the admin-dashboard deployment.
- `FIC_ACCESS_TOKEN` (OAuth token) and `FIC_COMPANY_ID` set in admin env.
- Therapist `approval_status='approved'` AND `is_approved=true`.
- Therapist billing profile complete (`resolveTaxMode` returns non-INCOMPLETE — see `23-vat-validation.md`).
- FIC company has at least one active `payment_account` (Stripe / Conto generico).
- FIC company has VAT types configured for the rates we need: 22%, 0% N6.9 (reverse charge), 0% N2.1 (extra-EU), 0% N2.2 (forfettario).

## Sequence

### A. Cron entry point (`admin-dashboard/src/app/api/cron/monthly-invoices/route.ts:55`)

1. Auth: `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron sets this automatically.
2. Compute period:
   - `periodStart` = first day of last month, local time.
   - `periodEnd` = first day of this month (exclusive upper bound).
   - `invoiceDate` = last day of last month (data documento per Art. 21 c. 4).
3. Load all approved therapists with billing data (`route.ts:72`).

### B. Per-therapist loop

For each therapist:

1. **Resolve tax mode** via `resolveTaxMode(profile)` (`tax-mode.ts:64`). Returns one of:
   - `B2B_IT` — IT therapist with P.IVA, FE via SDI, 22% IVA charged.
   - `B2B_IT_FORF` — IT regime forfettario, FE via SDI, 0% IVA with `vat_note` "Operazione senza applicazione dell'IVA — Art. 1, c. 54-89, L. 190/2014" and SDI nature code `N2.2`.
   - `B2C_IT` — IT private (CF only), FE via SDI with `ei_code='0000000'`, 22% IVA.
   - `B2B_EU_REVERSE` — EU therapist with VIES-validated VAT, 0% reverse charge under Art. 44 Direttiva 2006/112/CE, nature `N6.9`. NO SDI submission.
   - `B2B_UK_REVERSE` — UK therapist with VAT, 0% reverse charge under Art. 7-ter DPR 633/72, nature `N6.9`. NO SDI.
   - `B2C_EU_OSS` — EU private, 22% IT VAT under OSS regime, no SDI.
   - `B2C_UK_VAT` — UK private, 22% IT VAT, no SDI.
   - `EXTRA_EU` — outside EU/UK, fuori campo IVA Art. 7-ter DPR 633/72, nature `N2.1`, no SDI.
   - `INCOMPLETE` — skip with reason; admin sees in audit + `billing-reminders` cron nudges next Monday.

2. **Idempotency check**: `therapist_invoices` row with `(therapist_id, period_month=periodMonthIso)` exists? → skip.

3. **Aggregate sessions** (`route.ts:150`):
   ```
   SELECT amount, status, created_at FROM transactions
   WHERE therapist_id = $1
     AND status = 'completed'
     AND created_at >= periodStart
     AND created_at < periodEnd
   ```
   Sum `amount` → `grossCollected`. **NOT filtered by `payout_status`** (see Purpose).

4. **Build FIC entity** via `buildEntityPayload(billing, mode)` (`invoice.ts:89`). Shape varies by mode:
   - IT modes: `type='company'` with `vat_number`, `tax_code`, `ei_code` (codice destinatario), and conditional `certified_email` (PEC).
   - B2C IT: `type='person'` with `tax_code` (codice fiscale) and `ei_code='0000000'`.
   - EU/UK reverse: `type='company'` with `vat_number`, `certified_email = billing_email`.
   - EU/UK B2C: `type='person'` with no tax id.
   - EXTRA_EU: `type='company'` with `tax_code = tax_id_foreign` (free-form).

5. **`ensureFicClient`** — POST `/c/{companyId}/entities/clients` with the entity payload (or skip if `fic_client_id` already cached). Cache the returned id on `therapist_profiles.fic_client_id`.

6. **`createCommissionInvoice`** (`invoice.ts:376`):
   - `commission_gross = grossCollected * 0.20` (rounded to 2 decimals).
   - `imponibile = commission_gross / (1 + vatRate/100)` if `chargesIva`; else `commission_gross` directly.
   - `iva = commission_gross - imponibile`.
   - Build payload:
     ```
     {
       type: "invoice",
       entity: { id: ficClientId, name: <override>, vat_number?, tax_code? },
       date: invoiceDate,
       subject: "Servizio di intermediazione marketplace - {periodLabel}",
       items_list: [{ name: "Commissione intermediazione marketplace 20%", net_price, qty:1, vat: { id: vatId } }],
       payments_list: [{ amount: totalDue, due_date, paid_date, status:"paid", payment_account:{ id: paymentAccountId } }],
       e_invoice: <IT modes only>,
       ei_data: { payment_method: "MP08" } // for e-invoices
     }
     ```
   - POST `/c/{companyId}/issued_documents`.
   - GET `/issued_documents/{id}/url` for the PDF link (best-effort).

7. **`submitToSdi(invoiceId)`** if `shouldSubmitToSdi(mode)` (only IT modes). POSTs `/issued_documents/{id}/email` with `{ data: { send_to_sdi: true } }`. Idempotent — calling twice is fine.

8. **Persist to `therapist_invoices`** (`route.ts:209`):
   ```
   { therapist_id, period_month, sessions_count, gross_collected,
     commission_gross, imponibile, iva,
     fic_invoice_id, fic_invoice_number, fic_pdf_url,
     sdi_status: <"sent"|"not_applicable">, sdi_status_updated_at }
   ```

### C. Response

Returns `{ ok, period, issued, skipped, results: [...] }`. Each result is either `{ ok:true, mode, invoice_id }` or `{ ok:false, reason }`. Admin UI reads this for the operational dashboard.

## Critical assertions

- **Filter by `status='completed'` ONLY.** The 20% commission is the Stripe `application_fee_amount` already withheld at charge time. Filtering by `payout_status='paid'` would leave most sessions un-invoiced for active therapists (Stripe holds funds 14 days, so during the cron run the previous month's payouts are still mostly `pending`). This was bug fix #1 below.
- **VAT type lookup is per-company.** `getVatIdForRate(value, eInvoiceRef)` queries FIC `/info/vat_types` and caches in module memory. Mapping is `0:N6.9`, `0:N2.1`, `0:N2.2`, `22` etc. Without the right `e_invoice_reference` the SDI XML is rejected for missing-VAT-justification.
- **Payment account id required for `payments_list[].status='paid'`.** FIC errors "È necessario impostare il conto di saldo nel pagamento" if missing. We pick the first non-disabled account on the company. The invoice is marked paid because the commission is already withheld via Stripe destination charge — there's no future payment event to track.
- **`certified_email: null` is rejected by FIC.** The field must be a string OR absent. `withCertEmail` helper conditionally attaches it only when `pec_email` (or `billing_email`) is non-empty.
- **`entity.name` override required at invoice creation.** FIC validates `entity.name` is non-empty AT INVOICE creation time, even when the entity is referenced by id. If the cached FIC entity was created with sparse fields (older flow), the invoice 422s with "entity.name field must not be empty". Passing `entity_overrides.name` inline overrides the cached entity for this invoice.
- **`ei_data.payment_method` must be set on e-invoices.** SDI requires the official DM 55/2013 Allegato A code. Stripe = card payment = `MP08`.
- **Country in entity payload must be the Italian name, not ISO code.** `ficCountry()` maps `IT`→`Italia`, `GB/UK`→`Regno Unito`, etc. Sending raw `IT` returns "data.country field is not valid".
- **Idempotency at the DB level.** `therapist_invoices` UNIQUE on `(therapist_id, period_month)` makes re-runs safe — second invocation finds the row, skips with reason `already_invoiced`.

## Edge cases & failures

| Error | Where | Behavior |
|-------|-------|----------|
| Therapist billing INCOMPLETE | `resolveTaxMode` | Skip with granular reason; `billing-reminders` cron nudges next Monday |
| `grossCollected = 0` | `route.ts:159` | Skip with `no_sessions` (no invoice for an idle month) |
| FIC entity creation 422 | `ensureFicClient` | Throws → caught at try/catch → result `{ ok:false, reason: <msg> }` |
| FIC invoice creation fails | `createCommissionInvoice` | Same as above; no `therapist_invoices` row written |
| SDI submission fails | `submitToSdi` | Logged, swallowed (`.catch`). Invoice exists in FIC; admin can re-trigger SDI from FIC dashboard |
| Concurrent cron runs | `therapist_invoices` UNIQUE | Second run sees existing row, skips |
| FIC tenant out of vat_types | `getVatIdForRate` | Throws "FIC VAT type not configured for rate=...". Admin must add it in FIC > Impostazioni > Tipi IVA |
| FIC tenant out of payment_accounts | `getDefaultPaymentAccountId` | Throws — admin must create at least one (e.g. "Stripe") in FIC |

## Files

- `admin-dashboard/src/app/api/cron/monthly-invoices/route.ts` — cron entry
- `admin-dashboard/src/lib/integrations/fattureincloud/invoice.ts` — `ensureFicClient`, `createCommissionInvoice`, `submitToSdi`, `computeCommissionBreakdown`, `createCreditNote`
- `admin-dashboard/src/lib/integrations/fattureincloud/tax-mode.ts` — `resolveTaxMode`, `TaxMode` matrix, `EU_COUNTRIES`
- `admin-dashboard/src/lib/integrations/fattureincloud/client.ts` — `ficFetch`, `getCompanyId` (OAuth refresh)
- `admin-dashboard/src/lib/integrations/fattureincloud/oauth.ts` — token refresh
- `admin-dashboard/src/lib/integrations/fattureincloud/vies.ts` — VIES validation helper
- `admin-dashboard/vercel.json` — cron schedule
- Migration `20260425110000_fattureincloud.sql` — `therapist_invoices` table + indexes
- Related: `17-stripe-connect-onboarding.md` (where commission is captured), `19-admin-refund.md` + `20-cron-jobs.md` (daily-credit-notes for refund stornos).

## Recent fixes / known issues

The end-to-end flow required **14 sequential bug fixes** to land cleanly on 2026-05-03. Each fix surfaced after the previous was deployed and the cron was re-run. Documenting all of them because they are all subtle and easy to regress.

1. **Cron filter wrong (filter by completed, NOT payout_status).** Original code filtered on `payout_status='paid'`. Combined with the Stripe 14-day escrow, this meant >90% of the previous month's sessions were still `pending` at cron time → most therapists got a "no_sessions" skip and ZERO invoice. Fix at `route.ts:154`: filter `status='completed'` only. The fattura riepilogativa is a charge-time document, not a settlement document.
2. **`process-pending-payouts` cron was not scheduled.** Even after fix #1, the `payout_status` column was always `pending` because nothing flipped it to `paid` when the 14-day window elapsed. Added `process-pending-payouts-daily` pg_cron job at 05:00 UTC (see `20-cron-jobs.md`).
3. **`payout_after` was NULL on existing rows.** The Edge Function `stripe-webhook` populated it but the Vercel webhook (web payments) didn't. Backfilled via SQL. Both webhooks now set `payout_after = now() + interval '14 days'` at insert.
4. **Edge Function auth was rejecting `process-pending-payouts` calls.** Initial Bearer comparison wasn't constant-time and returned 401 inconsistently. Replaced with `crypto.subtle.timingSafeEqual` (`process-pending-payouts/index.ts:32`).
5. **Cron auth was rejected by middleware.** The admin-dashboard middleware blocked unauthenticated requests; cron requests have only `Authorization: Bearer ${CRON_SECRET}` and no Supabase session cookie. Fix: allowlist `/api/cron/*` in middleware.
6. **`requireAdmin` middleware was blocking the cron path.** Layered with #5; the cron path is now exempt.
7. **Country was sent as ISO code, FIC rejected.** "data.country field is not valid". Built `COUNTRY_ISO_TO_FIC` map (`invoice.ts:48`) translating ISO → Italian name.
8. **`certified_email: null` rejected.** FIC error: "must be a string". Built `withCertEmail` helper that conditionally attaches the field only when present (`invoice.ts:103`).
9. **`vat.id` wrong on items_list.** Was sending raw rate (`vat: { id: 22 }`); FIC requires the company-specific VAT type id from `/info/vat_types`. Implemented `getVatIdForRate` with module-level cache (`invoice.ts:338`).
10. **`payments_list[].status="paid"` failed without account id.** "È necessario impostare il conto di saldo". Implemented `getDefaultPaymentAccountId` querying `/info/payment_accounts` (`invoice.ts:315`).
11. **`payment_account.id` instead of `payment_account_id`.** FIC accepts the nested form; the flat form is rejected on some endpoints. Now always nested.
12. **`ei_data.payment_method` missing on e-invoices.** SDI XML rejected for missing payment method classification. Set to `MP08` (carta di pagamento) for all e-invoices since commission is withheld via Stripe.
13. **`entity.name` empty even with cached entity.** When the cached FIC entity had a sparse name (older entity creation that didn't pass display_name), the invoice creation 422'd. Added `entity_overrides.name` inline override at `createCommissionInvoice` (`invoice.ts:391`) — also passes `vat_number` and `tax_code` overrides for completeness.
14. **The actual `payment_account.id` shape** — we needed `payment_account: { id: <num> }`, not `payment_account_id: <num>`. Also confirmed it has to come from the `/info/payment_accounts` listing for that specific FIC tenant.

After all 14 fixes, a manual cron trigger on 2026-05-03 successfully issued invoices for April 2026 to all approved therapists with complete billing data. SDI submission for IT modes worked on first try.

- **Known gap:** No retry logic for transient FIC errors. A 5xx from FIC fails the per-therapist iteration; admin must re-run the cron (idempotent — already-invoiced rows skip).
- **Known gap:** No alerting on `INCOMPLETE` skips. The `billing-reminders` weekly cron handles outreach, but admin doesn't get a "5 therapists skipped this month" Slack ping.
- **Known gap:** No way to issue an invoice for a partial period (e.g. mid-month termination of a therapist). Manual via FIC dashboard.
