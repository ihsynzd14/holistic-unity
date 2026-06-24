# Therapist Commission Invoices via FattureInCloud — V1

**Date:** 2026-04-25
**Author:** Marcello + Claude
**Status:** Approved scope (Phase 2 / option C from brainstorm), spec drafted
**Repo:** `therapist-webapp`
**Related:** `client-webapp` (no changes needed for V1)

## Problem

The platform commission model (20% on each session, mandato con
rappresentanza per `terms-clients.html`) requires Holistic Unity
S.R.L. to issue an Italian fattura elettronica to each therapist with
a P.IVA. Currently zero invoicing happens — therapists who have done
sessions can't reclaim VAT, can't close their books cleanly, and we're
non-compliant with the e-invoicing obligation in force since 2019.

## Decisions (from brainstorm)

1. **Tier**: Phase 2 / option C — full SDI compliance via FattureInCloud
   (FIC), Italian operators only in V1.
2. **Periodicity**: monthly aggregated (1 fattura per therapist per
   month, covering all sessions completed in the prior month). Issued
   automatically on day 1 of the new month via cron.
3. **Foreign therapists**: out of scope V1 (per existing
   `earnings.howItWorksDesc` copy: "Per i operatori internazionali,
   l'intero 20% è ricavo netto della piattaforma" — no fattura needed).
4. **Refund handling**: only invoice sessions older than the 14-day
   refund window AND with `payout_status` ∈ `{released, paid}`.
   Refunds happening after invoice issuance trigger a *nota di credito*
   (V1.1, deferred — flag to admin).
5. **OAuth**: Authorization Code grant with refresh token. One-time
   admin onboarding flow; thereafter the cron runs unattended.
6. **Sezionale**: use FIC's default numbering for V1 (no separate
   sezionale per "fatture verso operatori"). Reassess if accountant
   prefers separation.
7. **Rate limiting / error handling**: cron is per-therapist, errors on
   one don't block others. Failures logged to existing Sentry.

## Architecture

### Auth flow (one-time admin setup)

```
Admin clicks "Connetti FattureInCloud" in dashboard/admin
  ↓
Backend redirects browser to FIC authorize URL with PKCE
  ↓
Admin logs in to FIC + accepts requested scopes
  ↓
FIC redirects to /api/integrations/fattureincloud/callback?code=…
  ↓
Backend exchanges code for {access_token, refresh_token, expires_in}
  ↓
Calls GET /user/companies → resolves company_id for STORM X DIGITAL
  ↓
Stores {access_token, refresh_token, expires_at, company_id} in
fattureincloud_credentials table (single row, RLS deny-all, service
role only)
```

After first setup the cron uses the refresh token to mint new access
tokens; admin only has to re-authorize if the refresh token is
revoked or expires (~unlikely under normal use).

### Monthly cron flow

```
Vercel cron @ 03:00 on day 1 of each month (per Vercel Cron docs)
  ↓
For each therapist with role=therapist AND has_pivaIT=true:
  ↓
  1. Aggregate sessions: status=completed, completed_at in [prev_month_start, prev_month_end]
     AND payout_status in {released, paid}
  ↓
  2. Compute totals:
     gross_collected = SUM(session.amount)         # 20% of this is commission
     commission_gross = gross_collected × 0.20      # IVA inclusa
     imponibile = commission_gross / 1.22
     iva = commission_gross - imponibile
  ↓
  3. Skip if no sessions OR therapist already invoiced for this month
     (idempotent: query our invoices table)
  ↓
  4. Create FIC client record if missing (POST /companies/{id}/entities/clients):
     - name, P.IVA, codice_fiscale, address, codice_destinatario,
       PEC, country (always IT for V1)
  ↓
  5. Create invoice (POST /companies/{id}/issued_documents):
     - type: invoice
     - entity: { id: <fic_client_id> }
     - date: prev_month_end
     - causale: "Servizio di intermediazione marketplace, {Mese} {Anno} — {N} sessioni, fatturato lordo €{gross}"
     - items_list: [{ name: "Commissione 20%", net_price: imponibile, vat: { id: 0, value: 22, description: "22%" } }]
     - e_invoice: true
     - send_to_sdi: true (FIC handles transmission)
  ↓
  6. Store result locally: insert into therapist_invoices
     {therapist_id, period_month, fic_invoice_id, fic_pdf_url,
      sdi_status, gross_collected, commission_gross, sessions_count,
      created_at}
  ↓
  7. Send email to therapist (Brevo or fallback):
     "La fattura della commissione di {Mese} è disponibile" + PDF link
```

### Files to create / modify

| # | Path | Action | Notes |
|---|---|---|---|
| 1 | `supabase/migrations/<ts>_fattureincloud.sql` | CREATE | `fattureincloud_credentials` (1 row) + `therapist_invoices` (history) + `therapist_billing` extension |
| 2 | `src/lib/integrations/fattureincloud/client.ts` | CREATE | Typed wrapper around FIC API + token refresh |
| 3 | `src/lib/integrations/fattureincloud/oauth.ts` | CREATE | PKCE state, code exchange, token refresh |
| 4 | `src/lib/integrations/fattureincloud/invoice.ts` | CREATE | Build the invoice payload from session aggregates |
| 5 | `src/app/api/integrations/fattureincloud/connect/route.ts` | CREATE | GET — redirect to FIC authorize URL |
| 6 | `src/app/api/integrations/fattureincloud/callback/route.ts` | CREATE | GET — exchange code, store tokens + company_id |
| 7 | `src/app/api/cron/monthly-invoices/route.ts` | CREATE | POST — Vercel cron handler, iterate therapists |
| 8 | `vercel.json` | MODIFY | Add cron entry `0 3 1 * *` |
| 9 | `src/app/dashboard/earnings/page.tsx` | MODIFY | Add "Fatture commissione" sub-section listing rows from `therapist_invoices` with PDF links |
| 10 | `src/app/dashboard/profile/page.tsx` (or settings) | MODIFY | Therapist self-service form: P.IVA, CF, codice destinatario / PEC, indirizzo |
| 11 | `src/app/dashboard/admin/integrations/fattureincloud/page.tsx` | CREATE | Admin one-time "Connetti FIC" button + status (admin role gated) |

### DB schema

```sql
-- 2026-04-25: FattureInCloud integration

-- Single-row table for the platform-wide FIC credentials
CREATE TABLE public.fattureincloud_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token    text NOT NULL,
  refresh_token   text NOT NULL,
  expires_at      timestamptz NOT NULL,
  company_id      bigint NOT NULL,
  scope           text,
  connected_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fattureincloud_credentials ENABLE ROW LEVEL SECURITY;
-- deny-all for authenticated; service_role only

-- Per-therapist FIC client mapping (one therapist = one FIC client record)
ALTER TABLE public.therapist_profiles
  ADD COLUMN IF NOT EXISTS fic_client_id    bigint,
  ADD COLUMN IF NOT EXISTS p_iva             text,
  ADD COLUMN IF NOT EXISTS codice_fiscale    text,
  ADD COLUMN IF NOT EXISTS codice_destinatario text,  -- 7-char SDI code, may be empty if PEC used
  ADD COLUMN IF NOT EXISTS pec_email          text,    -- alternative to codice_destinatario
  ADD COLUMN IF NOT EXISTS billing_address    jsonb;   -- { street, cap, city, province, country }

-- Invoice history (one row per monthly invoice issued)
CREATE TABLE public.therapist_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_month        date NOT NULL,             -- first day of invoiced month
  sessions_count      integer NOT NULL,
  gross_collected     numeric(10, 2) NOT NULL,    -- sum of session amounts collected
  commission_gross    numeric(10, 2) NOT NULL,    -- IVA inclusa (gross)
  imponibile          numeric(10, 2) NOT NULL,
  iva                 numeric(10, 2) NOT NULL,
  fic_invoice_id      bigint NOT NULL,
  fic_invoice_number  text NOT NULL,
  fic_pdf_url         text,
  sdi_status          text NOT NULL DEFAULT 'pending',
                                                 -- pending | sent | accepted | rejected | mancata_consegna
  sdi_status_updated_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (therapist_id, period_month)            -- idempotency
);

CREATE INDEX therapist_invoices_therapist_period_idx
  ON public.therapist_invoices (therapist_id, period_month DESC);

ALTER TABLE public.therapist_invoices ENABLE ROW LEVEL SECURITY;

-- Policy: therapist can read own invoices
CREATE POLICY therapist_invoices_select_own
  ON public.therapist_invoices FOR SELECT
  TO authenticated
  USING (therapist_id = auth.uid());

-- Service role bypasses RLS for inserts/updates from the cron
```

### Therapist UX additions

**Profile / billing section** (`/dashboard/profile` or `/dashboard/settings`):
- Form fields: P.IVA, codice fiscale, codice destinatario (7 chars, optional if PEC), PEC email (optional if codice destinatario), billing address.
- Validation: at least one of `codice_destinatario` or `pec_email` required, P.IVA format check (`/^IT?\d{11}$/`), CAP 5 digits.
- Note: *"Questi dati ci servono per emettere la fattura della commissione mensile. Se non li compili, non possiamo fatturarti — i pagamenti restano sospesi finché non sono completi."*

**Earnings page sub-section** (`/dashboard/earnings`):
- New collapsible card: "Fatture commissione (mensili)"
- Table with columns: Periodo | N. Fattura | Imponibile | IVA | Totale | SDI Status | PDF
- Click PDF → opens FIC PDF URL in new tab
- Empty state: "La prima fattura sarà emessa il 1° del mese prossimo."

**Admin connect page** (`/dashboard/admin/integrations/fattureincloud`, admin role only):
- Status: "Connesso" or "Non connesso"
- Button: "Connetti FattureInCloud" → starts OAuth flow
- After connect: shows company name, scopes granted, expires_at
- Manual button: "Genera fatture per il mese scorso" (force-run cron, dev/recovery)

## Out of scope V1

- Foreign therapists (no fattura issued)
- Note di credito for refunds occurring after invoice issuance (manual admin
  step in FIC UI for V1; automate in V1.1)
- Bulk re-issue / corrections (manual admin in FIC UI)
- Sezionale separato (use FIC default)
- Multi-company support (V1 = STORM X DIGITAL S.R.L. only)
- Support for therapists in regime forfettario without IVA (V1.1 — needs
  different VAT handling)

## Security

- `fattureincloud_credentials`: RLS deny-all + service_role only. Tokens
  encrypted at rest by Postgres (no app-level encryption needed for V1).
- OAuth state cookie: `httpOnly, secure, sameSite=lax`, 10-min TTL.
- PKCE used for the auth flow (defense against code interception).
- Service role key for cron stays in Vercel env, never exposed to client.
- P.IVA / codice fiscale on `therapist_profiles`: covered by existing
  RLS (therapist sees own row only).
- Cron endpoint authenticated via Vercel Cron header
  (`Authorization: Bearer ${CRON_SECRET}`).

## Implementation discovery items (to resolve at task start)

- `transactions.payout_status` actual enum values — spec assumes
  `{released, paid}` for "settled"; verify against the live schema
  during Task 1 of the plan and adjust the cron query accordingly.
- `therapist_profiles` columns to ADD must not collide with existing
  ones — `ADD COLUMN IF NOT EXISTS` handles this safely.
- FIC OAuth scopes — exact strings depend on FIC API v2 docs; verify
  against the latest docs before constructing the authorize URL.

## Edge cases

| Case | V1 handling |
|---|---|
| Therapist has no P.IVA filled | Skipped this month; admin notified (Sentry alert) |
| Therapist has P.IVA but `codice_destinatario` AND `pec_email` both empty | Same: skipped + flagged |
| Cron runs twice (manual trigger after auto) | UNIQUE(therapist_id, period_month) blocks duplicate |
| FIC API returns 401 (token expired mid-cron) | Auto-refresh; if refresh also fails, skip therapist + alert admin to re-authorize |
| FIC API returns 5xx | Retry once with backoff; if still fails, log + skip therapist |
| Therapist refunds a session AFTER monthly invoice issued | V1: manual admin nota di credito in FIC UI. V1.1: automate. |
| Zero sessions in the month | Skip silently (no invoice, no log) |
| First-of-month falls on weekend / holiday | Cron still runs at 03:00 UTC (FIC accepts) |
| Therapist deletes account between cron run and next month | `ON DELETE CASCADE` on therapist_invoices preserves history? NO — they delete with user. Mitigation: archive completed invoices to S3 / FIC retains them anyway. V1: accepted gap; V1.1 add export-on-delete. |
| OAuth refresh token revoked by FIC user | Cron fails for that month; admin gets alert; re-auth required |

## Verification plan

After implementation, in this order:

1. **Local dev**:
   - Run OAuth flow manually with test FIC sandbox account (FIC has a dev environment).
   - Trigger cron handler manually with a fake therapist + fake session.
   - Confirm invoice appears in FIC dashboard + DB row written.

2. **Production smoke** (after deploy):
   - Admin connects real FIC (Storm X account).
   - Manual trigger for a single test therapist with a real completed session.
   - Confirm: PDF is downloadable, SDI status moves from `pending` → `sent`/`accepted`.
   - Verify therapist sees the invoice in their dashboard.

3. **First real cron** (1st of next month):
   - Monitor Sentry for errors during 03:00 cron.
   - Check `therapist_invoices` table for new rows.
   - Spot-check 3 therapists' dashboards.

## Compliance / privacy notes

- P.IVA + codice fiscale + codice destinatario / PEC are personal data
  under GDPR — declared in privacy policy under "Dati di fatturazione"
  (update `holistic-unity-website/privacy-policy.html`).
- Add FattureInCloud (TeamSystem S.p.A.) to sub-processor list per
  `compliance.md` § 2.1.
- Retention: `therapist_invoices` rows retained for 10 years (Italian
  tax law). Do not delete on user account deletion.
- DPA with TeamSystem auto-accepted at FIC account creation; download
  PDF for records.

## Cost / commercial notes

- **FIC plan required**: API access typically requires FIC Premium or
  higher (~€30/mo). Verify Storm X's current plan before deploy.
- **Per-invoice cost**: included in FIC plan up to monthly quota
  (varies). Likely negligible for current beta volume.
- **SDI submission**: included in FIC plan (no extra per-invoice fee).

## Related

- `docs/specs/2026-04-25-therapist-mfa-mandatory.md` — Feature B (independent)
- `docs/platform/compliance.md` — sub-processor list (needs update)
- `holistic-unity-website/privacy-policy.html` — billing data section (needs update)
- `client-webapp/src/lib/i18n/translations/it.ts:473` — `howItWorksDesc` already mentions IT vs international handling
