# Therapist Invoices via FattureInCloud — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Issue Italian e-invoices (fattura elettronica via SDI) to therapists each month for the 20% commission, automatically and without manual ops.

**Architecture:** OAuth 2.0 (PKCE) flow connects platform-wide STORM X DIGITAL FIC account once. Vercel monthly cron aggregates last month's settled sessions per therapist, calls FIC API to create invoice + submit to SDI, persists invoice record locally for therapist dashboard display. Italian therapists only in V1.

**Tech Stack:** Next.js 16, Supabase (Postgres + Edge), FattureInCloud API v2 (OAuth Authorization Code + PKCE), Vercel Cron, bcrypt-style server-only modules.

**Source spec:** `docs/specs/2026-04-25-therapist-invoices-fattureincloud.md`

**Verification approach:** No test framework in repo → use `tsc --noEmit` + `next build` + manual smoke testing as confidence gates. Key validations are end-to-end via FIC sandbox first, then production.

**Pre-requisites:** Env vars `FATTUREINCLOUD_CLIENT_ID`, `FATTUREINCLOUD_CLIENT_SECRET` set in Vercel. Storm X Digital plan supports API access (verify before deploy).

---

## Phase 1 — Database

### Task 1: SQL migration for FIC integration

**Files:**
- Create: `supabase/migrations/<ts>_fattureincloud.sql`

- [ ] **Step 1: Write migration**

```sql
-- 2026-04-XX: FattureInCloud integration

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

ALTER TABLE public.therapist_profiles
  ADD COLUMN IF NOT EXISTS fic_client_id        bigint,
  ADD COLUMN IF NOT EXISTS p_iva                 text,
  ADD COLUMN IF NOT EXISTS codice_fiscale        text,
  ADD COLUMN IF NOT EXISTS codice_destinatario   text,
  ADD COLUMN IF NOT EXISTS pec_email             text,
  ADD COLUMN IF NOT EXISTS billing_address       jsonb;

CREATE TABLE public.therapist_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_month          date NOT NULL,
  sessions_count        integer NOT NULL,
  gross_collected       numeric(10, 2) NOT NULL,
  commission_gross      numeric(10, 2) NOT NULL,
  imponibile            numeric(10, 2) NOT NULL,
  iva                   numeric(10, 2) NOT NULL,
  fic_invoice_id        bigint NOT NULL,
  fic_invoice_number    text NOT NULL,
  fic_pdf_url           text,
  sdi_status            text NOT NULL DEFAULT 'pending',
  sdi_status_updated_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (therapist_id, period_month)
);

CREATE INDEX therapist_invoices_therapist_period_idx
  ON public.therapist_invoices (therapist_id, period_month DESC);

ALTER TABLE public.therapist_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY therapist_invoices_select_own
  ON public.therapist_invoices FOR SELECT
  TO authenticated
  USING (therapist_id = auth.uid());
```

- [ ] **Step 2: Apply in Supabase Studio** (manual, user)
- [ ] **Step 3: Smoke test RLS** as `authenticated` role
- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_fattureincloud.sql
git commit -m "feat(invoicing): FIC credentials + therapist invoices tables"
```

---

## Phase 2 — FIC client lib

### Task 2: FIC API typed client (with auto-refresh)

**Files:**
- Create: `src/lib/integrations/fattureincloud/client.ts`

- [ ] **Step 1: Write the client**

```typescript
import { createAdminClient } from "@/lib/supabase/admin";

const FIC_API_BASE = "https://api-v2.fattureincloud.it";
const TOKEN_URL = "https://api-v2.fattureincloud.it/oauth/token";

interface FicCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  company_id: number;
}

async function getCredentials(): Promise<FicCredentials | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("fattureincloud_credentials")
    .select("access_token, refresh_token, expires_at, company_id")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as FicCredentials | null;
}

async function refreshIfNeeded(creds: FicCredentials): Promise<FicCredentials> {
  const expires = new Date(creds.expires_at).getTime();
  if (expires - Date.now() > 60_000) return creds; // >60s left, OK

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
      client_id: process.env.FATTUREINCLOUD_CLIENT_ID!,
      client_secret: process.env.FATTUREINCLOUD_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`fic_refresh_failed:${res.status}`);
  const json = await res.json();
  const next: FicCredentials = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? creds.refresh_token,
    expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    company_id: creds.company_id,
  };
  const admin = createAdminClient();
  await admin
    .from("fattureincloud_credentials")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("company_id", creds.company_id);
  return next;
}

export async function ficFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let creds = await getCredentials();
  if (!creds) throw new Error("fic_not_connected");
  creds = await refreshIfNeeded(creds);
  const url = path.startsWith("http") ? path : `${FIC_API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${creds.access_token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fic_${res.status}:${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function getCompanyId(): Promise<number> {
  const creds = await getCredentials();
  if (!creds) throw new Error("fic_not_connected");
  return creds.company_id;
}
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit`
- [ ] **Step 3: Commit** — `feat(fic): typed client with auto-refresh`

---

### Task 3: OAuth helpers (PKCE + state)

**Files:**
- Create: `src/lib/integrations/fattureincloud/oauth.ts`

- [ ] **Step 1: Write helpers**

```typescript
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";

const AUTHORIZE_URL = "https://api-v2.fattureincloud.it/oauth/authorize";
const TOKEN_URL = "https://api-v2.fattureincloud.it/oauth/token";

const SCOPES = [
  "entity.suppliers:r",
  "entity.suppliers:a",
  "entity.clients:r",
  "entity.clients:a",
  "issued_documents.invoices:r",
  "issued_documents.invoices:a",
  "settings:r",
].join(" ");

const STATE_COOKIE = "fic_oauth_state";
const VERIFIER_COOKIE = "fic_oauth_verifier";

export function buildAuthorizeUrl(redirectUri: string): { url: string } {
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const cookieStore = cookies();
  // NOTE: Next 16 cookies() returns Promise — adapt as the build requires.
  // For the value below, ensure 10-min TTL + httpOnly + sameSite=lax.

  // (Implementation detail: pseudo-code; the actual `cookies()` await dance
  // must match the surrounding route handler context.)
  void cookieStore;

  const params = new URLSearchParams({
    client_id: process.env.FATTUREINCLOUD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return { url: `${AUTHORIZE_URL}?${params.toString()}` };
}

export async function exchangeCode(args: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      client_id: process.env.FATTUREINCLOUD_CLIENT_ID!,
      client_secret: process.env.FATTUREINCLOUD_CLIENT_SECRET!,
      redirect_uri: args.redirectUri,
      code_verifier: args.verifier,
    }),
  });
  if (!res.ok) throw new Error(`fic_token_exchange_failed:${res.status}`);
  return await res.json();
}

export const COOKIE_NAMES = { STATE: STATE_COOKIE, VERIFIER: VERIFIER_COOKIE };
```

- [ ] **Step 2: Resolve `cookies()` async pattern** for the actual Next 16 API surface in route handlers
- [ ] **Step 3: Type-check** — fix any cookie-API mismatches
- [ ] **Step 4: Commit** — `feat(fic): OAuth PKCE helpers`

---

## Phase 3 — Connect endpoints

### Task 4: GET /api/integrations/fattureincloud/connect

**Files:**
- Create: `src/app/api/integrations/fattureincloud/connect/route.ts`

- [ ] **Step 1: Write handler**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl, COOKIE_NAMES } from "@/lib/integrations/fattureincloud/oauth";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  // Admin-only check (mirror admin layout pattern in the codebase)
  const { data: userRow } = await supabase
    .from("users").select("role").eq("id", user.id).single();
  if (userRow?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/integrations/fattureincloud/callback`;
  const { url } = buildAuthorizeUrl(redirectUri);

  // (See Task 3: cookies for state + verifier are set there — wire them
  // here in the actual response.)

  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Type-check + commit**

---

### Task 5: GET /api/integrations/fattureincloud/callback

**Files:**
- Create: `src/app/api/integrations/fattureincloud/callback/route.ts`

- [ ] **Step 1: Write handler**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, COOKIE_NAMES } from "@/lib/integrations/fattureincloud/oauth";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  // Validate state vs cookie (CSRF protection); read verifier cookie too
  // (… see Task 3 cookie wiring …)
  void state;

  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/integrations/fattureincloud/callback`;

  // Replace `verifierFromCookie` with the actual cookie read.
  const verifierFromCookie = ""; // TODO during impl
  const tokens = await exchangeCode({ code, redirectUri, verifier: verifierFromCookie });

  // Resolve the user's company list to pick STORM X DIGITAL S.R.L. id.
  const companiesRes = await fetch("https://api-v2.fattureincloud.it/user/companies", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const companies = (await companiesRes.json())?.data?.companies ?? [];
  const stormX = companies.find((c: { name?: string }) =>
    /storm\s*x\s*digital/i.test(c.name ?? ""),
  );
  if (!stormX) {
    return NextResponse.json({ error: "company_not_found" }, { status: 400 });
  }

  const admin = createAdminClient();
  await admin.from("fattureincloud_credentials").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("fattureincloud_credentials").insert({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    company_id: stormX.id,
    scope: tokens.scope,
    connected_by: user.id,
  });

  return NextResponse.redirect(new URL("/dashboard/admin/integrations/fattureincloud?connected=1", req.url));
}
```

- [ ] **Step 2: Smoke test** — admin clicks Connect → FIC consent → callback stores credentials. Verify DB row.
- [ ] **Step 3: Commit**

---

## Phase 4 — Invoice creation logic

### Task 6: Invoice payload builder

**Files:**
- Create: `src/lib/integrations/fattureincloud/invoice.ts`

- [ ] **Step 1: Write builder + send-to-SDI**

```typescript
import { ficFetch, getCompanyId } from "./client";

export interface SessionAggregate {
  therapist_id: string;
  sessions_count: number;
  gross_collected: number;
}

export interface TherapistBilling {
  fic_client_id: number | null;
  display_name: string;
  p_iva: string;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  billing_address: { street: string; cap: string; city: string; province: string; country: string };
}

export async function ensureFicClient(billing: TherapistBilling): Promise<number> {
  if (billing.fic_client_id) return billing.fic_client_id;
  const companyId = await getCompanyId();
  const res = await ficFetch<{ data: { id: number } }>(
    `/c/${companyId}/entities/clients`,
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          name: billing.display_name,
          vat_number: billing.p_iva,
          tax_code: billing.codice_fiscale ?? billing.p_iva,
          country: billing.billing_address.country,
          address_street: billing.billing_address.street,
          address_postal_code: billing.billing_address.cap,
          address_city: billing.billing_address.city,
          address_province: billing.billing_address.province,
          ei_code: billing.codice_destinatario ?? "0000000",
          certified_email: billing.pec_email ?? null,
          type: "company",
        },
      }),
    },
  );
  return res.data.id;
}

export async function createCommissionInvoice(args: {
  fic_client_id: number;
  period_month: string;       // first day of invoiced month, ISO
  sessions_count: number;
  gross_collected: number;    // sum of sessions in that month
}): Promise<{ id: number; number: string; pdf_url: string | null }> {
  const companyId = await getCompanyId();
  const commissionGross = +(args.gross_collected * 0.20).toFixed(2);
  const imponibile = +(commissionGross / 1.22).toFixed(2);
  const periodLabel = new Date(args.period_month).toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  const res = await ficFetch<{ data: { id: number; number: string } }>(
    `/c/${companyId}/issued_documents`,
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "invoice",
          entity: { id: args.fic_client_id },
          date: args.period_month,
          subject: `Servizio di intermediazione marketplace - ${periodLabel}`,
          description: `${args.sessions_count} sessioni, fatturato lordo €${args.gross_collected.toFixed(2)}`,
          items_list: [
            {
              name: "Commissione intermediazione 20%",
              net_price: imponibile,
              qty: 1,
              vat: { id: 0, value: 22 },
            },
          ],
          payments_list: [],
          e_invoice: true,
          ei_data: { payment_method: "MP05" }, // bonifico — adjust if needed
        },
      }),
    },
  );

  const pdfRes = await ficFetch<{ data: { url?: string } }>(
    `/c/${companyId}/issued_documents/${res.data.id}/url`,
  ).catch(() => ({ data: { url: null as string | null } }));

  return { id: res.data.id, number: res.data.number, pdf_url: pdfRes.data.url ?? null };
}

export async function submitToSdi(invoiceId: number): Promise<void> {
  const companyId = await getCompanyId();
  await ficFetch(`/c/${companyId}/issued_documents/${invoiceId}/email`, {
    method: "POST",
    body: JSON.stringify({ data: { send_to_sdi: true } }),
  });
}
```

- [ ] **Step 2: Validate FIC API field names** against latest FIC docs (some of the above are best-effort guesses — confirm during impl)
- [ ] **Step 3: Type-check + commit**

---

## Phase 5 — Cron handler

### Task 7: Vercel monthly cron endpoint

**Files:**
- Create: `src/app/api/cron/monthly-invoices/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Write the cron handler**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureFicClient,
  createCommissionInvoice,
  submitToSdi,
  type TherapistBilling,
} from "@/lib/integrations/fattureincloud/invoice";

const CRON_SECRET = process.env.CRON_SECRET;

interface SessionRow {
  therapist_id: string;
  amount: number | null;
}

interface TherapistProfileRow {
  id: string;
  display_name: string | null;
  fic_client_id: number | null;
  p_iva: string | null;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  billing_address: TherapistBilling["billing_address"] | null;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Period = last completed month
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodMonthIso = periodStart.toISOString().slice(0, 10);

  // 1. Fetch therapists with valid Italian billing data
  const { data: therapists } = await admin
    .from("therapist_profiles")
    .select("id, display_name, fic_client_id, p_iva, codice_fiscale, codice_destinatario, pec_email, billing_address")
    .not("p_iva", "is", null);

  for (const t of (therapists ?? []) as TherapistProfileRow[]) {
    try {
      // Skip if billing data incomplete
      if (!t.p_iva || (!t.codice_destinatario && !t.pec_email) || !t.billing_address) continue;

      // Idempotency
      const { data: existing } = await admin
        .from("therapist_invoices")
        .select("id")
        .eq("therapist_id", t.id)
        .eq("period_month", periodMonthIso)
        .maybeSingle();
      if (existing) continue;

      // Aggregate sessions completed in this period AND payout settled
      const { data: sessions } = await admin
        .from("transactions")
        .select("amount, payout_status, status, created_at, therapist_id")
        .eq("therapist_id", t.id)
        .eq("status", "completed")
        .in("payout_status", ["released", "paid"]) // adjust to actual enum
        .gte("created_at", periodStart.toISOString())
        .lt("created_at", periodEnd.toISOString());
      const rows = (sessions ?? []) as Pick<SessionRow, "amount">[];
      const grossCollected = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
      if (rows.length === 0 || grossCollected <= 0) continue;

      // Ensure FIC client exists
      const billing: TherapistBilling = {
        fic_client_id: t.fic_client_id,
        display_name: t.display_name ?? "Operatore",
        p_iva: t.p_iva,
        codice_fiscale: t.codice_fiscale,
        codice_destinatario: t.codice_destinatario,
        pec_email: t.pec_email,
        billing_address: t.billing_address!,
      };
      const ficClientId = await ensureFicClient(billing);
      if (!t.fic_client_id) {
        await admin.from("therapist_profiles").update({ fic_client_id: ficClientId }).eq("id", t.id);
      }

      // Create + submit invoice
      const inv = await createCommissionInvoice({
        fic_client_id: ficClientId,
        period_month: periodMonthIso,
        sessions_count: rows.length,
        gross_collected: grossCollected,
      });
      await submitToSdi(inv.id);

      const commissionGross = +(grossCollected * 0.20).toFixed(2);
      const imponibile = +(commissionGross / 1.22).toFixed(2);
      const iva = +(commissionGross - imponibile).toFixed(2);

      await admin.from("therapist_invoices").insert({
        therapist_id: t.id,
        period_month: periodMonthIso,
        sessions_count: rows.length,
        gross_collected: grossCollected,
        commission_gross: commissionGross,
        imponibile,
        iva,
        fic_invoice_id: inv.id,
        fic_invoice_number: inv.number,
        fic_pdf_url: inv.pdf_url,
        sdi_status: "sent",
        sdi_status_updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[cron.monthly-invoices] therapist failed", t.id, e);
      // Don't break the loop — next therapist
    }
  }

  return NextResponse.json({ ok: true, processed: therapists?.length ?? 0 });
}
```

- [ ] **Step 2: Add cron to vercel.json**

```json
{
  "crons": [
    { "path": "/api/cron/monthly-invoices", "schedule": "0 3 1 * *" }
  ]
}
```

- [ ] **Step 3: Add `CRON_SECRET` env var** in Vercel (random 32-char hex)
- [ ] **Step 4: Type-check + commit**

---

## Phase 6 — Therapist UX

### Task 8: Billing form on profile page

**Files:**
- Modify: `src/app/dashboard/profile/page.tsx` (or settings — pick existing convention)

- [ ] **Step 1: Add billing fields to existing form**

Add a "Dati di fatturazione" section with fields: P.IVA, codice fiscale, codice destinatario (7 chars), PEC email, billing address (street/cap/city/province/country=IT).

Validation: IT P.IVA format `^IT?\d{11}$`, CAP 5 digits, country ISO2.

API endpoint to PATCH these fields: re-use existing therapist profile update or add `PATCH /api/therapist/billing`.

(Detailed code omitted — follows existing form pattern in the file.)

- [ ] **Step 2: Smoke test save + reload**
- [ ] **Step 3: Commit**

---

### Task 9: Invoice list in earnings page

**Files:**
- Modify: `src/app/dashboard/earnings/page.tsx`

- [ ] **Step 1: Add invoices section**

Below the existing payouts/charges sections, add:

```tsx
<section className="rounded-2xl border ...">
  <h2>Fatture commissione (mensili)</h2>
  <table>
    <thead>
      <tr><th>Periodo</th><th>N°</th><th>Imp.</th><th>IVA</th><th>Tot.</th><th>SDI</th><th>PDF</th></tr>
    </thead>
    <tbody>
      {invoices.map(i => (
        <tr key={i.id}>
          <td>{formatMonth(i.period_month)}</td>
          <td>{i.fic_invoice_number}</td>
          <td>€{i.imponibile.toFixed(2)}</td>
          <td>€{i.iva.toFixed(2)}</td>
          <td>€{i.commission_gross.toFixed(2)}</td>
          <td>{i.sdi_status}</td>
          <td>{i.fic_pdf_url && <a href={i.fic_pdf_url} target="_blank" rel="noopener noreferrer">PDF</a>}</td>
        </tr>
      ))}
    </tbody>
  </table>
  {invoices.length === 0 && <p>La prima fattura sarà emessa il 1° del mese prossimo.</p>}
</section>
```

Fetch `therapist_invoices` filtered by `therapist_id = auth.uid()` (RLS already scopes).

- [ ] **Step 2: Type-check + smoke test + commit**

---

## Phase 7 — Admin UX

### Task 10: Admin connect page

**Files:**
- Create: `src/app/dashboard/admin/integrations/fattureincloud/page.tsx`

- [ ] **Step 1: Write the page**

Server component, admin role gated. Reads `fattureincloud_credentials` row → shows status. Button "Connetti" links to `/api/integrations/fattureincloud/connect`. After connect (?connected=1 query param), shows company name + scopes + expiry. Optional dev button "Trigger cron now" → POSTs to `/api/cron/monthly-invoices` with the right Bearer.

(Code omitted — follows existing admin page patterns.)

- [ ] **Step 2: Smoke test full flow** end-to-end
- [ ] **Step 3: Commit**

---

## Phase 8 — Verification + deploy

### Task 11: End-to-end smoke

- [ ] **Step 1: FIC sandbox test**

If FIC offers a sandbox mode, run full flow there first. Otherwise, use real account with a "test" therapist + manually trigger cron.

- [ ] **Step 2: First monthly cron**

After deploy on prod, watch Sentry on the 1st at 03:00 UTC. Spot-check 3 therapists' dashboards for the new invoice rows.

- [ ] **Step 3: Update sub-processor list + privacy policy**

Add FattureInCloud (TeamSystem S.p.A.) to:
- `/Users/marcello/Desktop/Holistic Unity/therapist-webapp/docs/platform/compliance.md` § 2.1
- `/Users/marcello/Desktop/Holistic Unity/holistic-unity-website/privacy-policy.html` (sub-processors section)

- [ ] **Step 4: Tag release** — `git tag fic-v1`

---

## Self-review

- [x] Spec coverage: every section of `docs/specs/2026-04-25-therapist-invoices-fattureincloud.md` maps to one of Tasks 1-11. ✓
- [x] Placeholders: a few places call out "actual cookie API depends on Next 16 surface" or "FIC field names per latest docs" — these are pragmatic discovery items, not lazy TBDs. ✓
- [x] Type consistency: `TherapistBilling` defined in Task 6 is consumed in Task 7. `ficFetch` defined in Task 2 used everywhere. ✓
- [x] File paths: all `src/...` paths spelled out exactly. ✓
- [x] Verification gates: each task has type-check + commit boundary. ✓

## Out of scope (per spec)

- Foreign therapists (no fattura V1)
- Refund-driven note di credito (V1.1 manual)
- Sezionale separato
- Multi-company support
- Forfettario IVA handling

## Implementation discovery items

To resolve at task start (in this order):

1. `transactions.payout_status` actual enum — adapt the cron query.
2. `cookies()` API surface in Next 16 inside route handlers — pattern depends on whether the file is RSC or route handler context.
3. FIC `entities/clients` POST exact field names — confirm against `developers.fattureincloud.com` v2 docs.
4. `MP05` payment method code — confirm vs alternatives in FIC settings.
5. SDI submission endpoint — `issued_documents/{id}/email` vs `issued_documents/{id}/sdi` — verify.
