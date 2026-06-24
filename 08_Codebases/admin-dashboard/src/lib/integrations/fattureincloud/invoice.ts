import { ficFetch, getCompanyId } from "./client";
import type { TaxMode } from "./tax-mode";

/**
 * FattureInCloud invoice + credit-note builder.
 *
 * Supports the cross-border tax matrix described in
 * `tax-mode.ts`. The dispatcher is `createCommissionInvoice` — pass the
 * `mode` resolved by `resolveTaxMode()` and the rest takes care of the
 * IVA logic, the SDI flag, the legal note (reverse charge / fuori
 * campo / regime forfettario), and the FIC entity payload shape.
 */

export interface TherapistBilling {
  fic_client_id: number | null;
  display_name: string;
  // IT
  p_iva: string | null;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  regime_forfettario: boolean | null;
  // Cross-border
  vat_number: string | null;
  tax_id_foreign: string | null;
  // Always
  billing_email: string | null;
  billing_address: {
    street: string;
    cap: string;
    city: string;
    province: string;
    country: string;
  };
}

interface FicClientCreated { data: { id: number } }
interface FicInvoiceCreated { data: { id: number; number: string } }
interface FicUrlResponse { data: { url?: string } }

/**
 * Build the FIC entity payload for the given tax mode. The shape
 * differs per mode because FIC needs distinct fields for IT B2B vs
 * IT B2C vs cross-border.
 */
// FIC API expects the localized country name in Italian, NOT the ISO
// 3166 code. Sending "IT" returns "data.country field is not valid".
const COUNTRY_ISO_TO_FIC: Record<string, string> = {
  IT: "Italia",
  FR: "Francia",
  DE: "Germania",
  ES: "Spagna",
  PT: "Portogallo",
  BE: "Belgio",
  NL: "Paesi Bassi",
  AT: "Austria",
  CH: "Svizzera",
  GR: "Grecia",
  IE: "Irlanda",
  LU: "Lussemburgo",
  PL: "Polonia",
  RO: "Romania",
  SE: "Svezia",
  FI: "Finlandia",
  DK: "Danimarca",
  SI: "Slovenia",
  SK: "Slovacchia",
  CZ: "Cechia",
  HU: "Ungheria",
  HR: "Croazia",
  BG: "Bulgaria",
  EE: "Estonia",
  LV: "Lettonia",
  LT: "Lituania",
  MT: "Malta",
  CY: "Cipro",
  GB: "Regno Unito",
  UK: "Regno Unito",
  US: "Stati Uniti",
  CA: "Canada",
  BR: "Brasile",
  AU: "Australia",
};
function ficCountry(iso: string | null | undefined): string {
  const code = (iso || "IT").toUpperCase();
  return COUNTRY_ISO_TO_FIC[code] ?? code;
}

function buildEntityPayload(billing: TherapistBilling, mode: TaxMode) {
  const a = billing.billing_address;
  const base = {
    name: billing.display_name,
    address_street: a.street,
    address_postal_code: a.cap || "",
    address_city: a.city,
    address_province: a.province || "",
    country: ficCountry(a.country),
  };

  // Helper: only attach `certified_email` when we actually have a PEC.
  // FIC rejects `certified_email: null` with "must be a string" — the
  // field has to be a string OR absent.
  const withCertEmail = <T extends object>(payload: T, email: string | null | undefined): T =>
    email ? { ...payload, certified_email: email } : payload;

  switch (mode) {
    case "B2B_IT":
    case "B2B_IT_FORF":
      return withCertEmail(
        {
          ...base,
          type: "company",
          vat_number: billing.p_iva!,
          tax_code: billing.codice_fiscale ?? billing.p_iva!,
          ei_code: billing.codice_destinatario || "0000000",
        },
        billing.pec_email,
      );
    case "B2C_IT":
      return {
        ...base,
        // FIC's "person" type yields a B2C invoice; ei_code 0000000
        // tells SDI to deliver via the Cassetto Fiscale.
        type: "person",
        tax_code: billing.codice_fiscale!,
        ei_code: "0000000",
      };
    case "B2B_EU_REVERSE":
    case "B2B_UK_REVERSE":
      return withCertEmail(
        {
          ...base,
          type: "company",
          vat_number: billing.vat_number!,
        },
        billing.billing_email,
      );
    case "B2C_EU_OSS":
    case "B2C_UK_VAT":
      return withCertEmail(
        {
          ...base,
          type: "person",
        },
        billing.billing_email,
      );
    case "EXTRA_EU":
      return withCertEmail(
        {
          ...base,
          type: "company",
          // Generic foreign tax id — FIC accepts arbitrary text.
          tax_code: billing.tax_id_foreign || "",
        },
        billing.billing_email,
      );
    case "INCOMPLETE":
      throw new Error("Cannot create FIC entity for INCOMPLETE billing");
  }
}

/**
 * Lookup-or-create the FIC entity for this therapist. Cached on
 * `therapist_profiles.fic_client_id` after first call.
 */
export async function ensureFicClient(
  billing: TherapistBilling,
  mode: TaxMode,
): Promise<number> {
  if (billing.fic_client_id) return billing.fic_client_id;
  const companyId = await getCompanyId();
  const res = await ficFetch<FicClientCreated>(
    `/c/${companyId}/entities/clients`,
    {
      method: "POST",
      body: JSON.stringify({ data: buildEntityPayload(billing, mode) }),
    },
  );
  return res.data.id;
}

/**
 * IVA + invoice meta per mode.
 *   vatRate    — % to charge (0 for reverse-charge / fuori-campo / forfettario)
 *   vatNote    — legal text shown on the invoice (Italian or English)
 *   sendToSdi  — true only when SDI applies (IT modes)
 *   eInvoice   — e_invoice flag for FIC (IT modes only)
 *   chargesIva — drives the imponibile/iva split for therapist_invoices
 */
function modeConfig(mode: TaxMode): {
  vatRate: number;
  vatNote?: string;
  // For 0% rates, FIC needs to know which "natura" code (e_invoice
  // reference) to apply on the SDI XML. Without it the e-invoice gets
  // rejected by SDI as a missing-VAT-justification error.
  vatEInvoiceRef?: string;
  sendToSdi: boolean;
  eInvoice: boolean;
  chargesIva: boolean;
} {
  switch (mode) {
    case "B2B_IT":
      return { vatRate: 22, sendToSdi: true, eInvoice: true, chargesIva: true };
    case "B2B_IT_FORF":
      return {
        vatRate: 0,
        vatNote:
          "Operazione senza applicazione dell'IVA — Art. 1, c. 54-89, L. 190/2014 (regime forfettario)",
        vatEInvoiceRef: "N2.2",
        sendToSdi: true,
        eInvoice: true,
        chargesIva: false,
      };
    case "B2C_IT":
      return { vatRate: 22, sendToSdi: true, eInvoice: true, chargesIva: true };
    case "B2B_EU_REVERSE":
      return {
        vatRate: 0,
        vatNote:
          "Reverse charge — Art. 44 Direttiva 2006/112/CE. VAT to be accounted by the recipient.",
        vatEInvoiceRef: "N6.9",
        sendToSdi: false,
        eInvoice: false,
        chargesIva: false,
      };
    case "B2B_UK_REVERSE":
      return {
        vatRate: 0,
        vatNote:
          "Reverse charge — Art. 7-ter DPR 633/72. VAT to be accounted by the recipient under UK law.",
        vatEInvoiceRef: "N6.9",
        sendToSdi: false,
        eInvoice: false,
        chargesIva: false,
      };
    case "B2C_EU_OSS":
      return {
        vatRate: 22,
        vatNote: "Operazione tassata in Italia — regime OSS (One Stop Shop).",
        sendToSdi: false,
        eInvoice: false,
        chargesIva: true,
      };
    case "B2C_UK_VAT":
      return { vatRate: 22, sendToSdi: false, eInvoice: false, chargesIva: true };
    case "EXTRA_EU":
      return {
        vatRate: 0,
        vatNote:
          "Operazione fuori campo IVA — Art. 7-ter DPR 633/72.",
        vatEInvoiceRef: "N2.1",
        sendToSdi: false,
        eInvoice: false,
        chargesIva: false,
      };
    case "INCOMPLETE":
      throw new Error("INCOMPLETE mode cannot be invoiced");
  }
}

/**
 * Math helper used by the cron to persist the breakdown into
 * `therapist_invoices`. Keeps the logic in one place so the cron and
 * the row-write stay consistent.
 */
export function computeCommissionBreakdown(
  grossCollected: number,
  mode: TaxMode,
): { commission_gross: number; imponibile: number; iva: number } {
  const cfg = modeConfig(mode);
  const commissionGross = +(grossCollected * 0.20).toFixed(2);
  if (!cfg.chargesIva) {
    // No IVA charged → commission is fully imponibile, IVA 0.
    return { commission_gross: commissionGross, imponibile: commissionGross, iva: 0 };
  }
  const factor = 1 + cfg.vatRate / 100;
  const imponibile = +(commissionGross / factor).toFixed(2);
  const iva = +(commissionGross - imponibile).toFixed(2);
  return { commission_gross: commissionGross, imponibile, iva };
}

/**
 * Issue the monthly commission invoice for a therapist.
 *
 * `gross_collected` is the gross billed to clients in the period (sum
 * of `transactions.amount` for completed sessions). Storm X retains
 * 20% as commission; that 20% is what we invoice. The breakdown
 * (imponibile / iva) depends on the mode — see `computeCommissionBreakdown`.
 */
/**
 * VAT type ID lookup — FIC's `items_list[].vat.id` references a saved
 * VAT entry on the company's books, not a raw rate. The mapping
 * (rate → id) is per-company because each FIC tenant has its own
 * curated list of VAT types. We query once and cache for the lifetime
 * of the lambda.
 *
 * For Italy, the standard rates we need are:
 *   - 22% (default, IT B2B/B2C/forfettario charges-VAT modes)
 *   - 0% with N6.9 (reverse charge EU/UK)
 *   - 0% with N2.1 (extra-EU services)
 *   - 0% with N2.2 (regime forfettario art. 1 c. 54)
 *
 * Cached at module level; FIC tenant doesn't change at runtime.
 */
let vatIdCache: Map<string, number> | null = null;

/**
 * Payment account ID lookup — FIC requires a `payment_account.id`
 * for any payment with `status: "paid"` (otherwise: "È necessario
 * impostare il conto di saldo nel pagamento."). We pick the first
 * non-disabled account on the company. For most setups that's the
 * default "Conto generico" or the user's primary bank/Stripe account.
 */
let paymentAccountIdCache: number | null = null;
async function getDefaultPaymentAccountId(): Promise<number> {
  if (paymentAccountIdCache !== null) return paymentAccountIdCache;
  const companyId = await getCompanyId();
  type AccountRow = {
    id: number;
    name?: string;
    type?: string;
    is_disabled?: boolean;
  };
  const list = await ficFetch<{ data: AccountRow[] }>(
    `/c/${companyId}/info/payment_accounts`,
    { method: "GET" },
  );
  const active = list.data.find((a) => !a.is_disabled);
  if (!active) {
    throw new Error(
      "FIC: no active payment account configured. Open the FIC company settings and create at least one (e.g. 'Stripe').",
    );
  }
  paymentAccountIdCache = active.id;
  return active.id;
}

async function getVatIdForRate(value: number, eInvoiceRef?: string): Promise<number> {
  if (!vatIdCache) {
    const companyId = await getCompanyId();
    type VatTypeRow = {
      id: number;
      value: number;
      description?: string;
      e_invoice_reference?: string | null;
      is_disabled?: boolean;
    };
    const list = await ficFetch<{ data: VatTypeRow[] }>(
      `/c/${companyId}/info/vat_types`,
      { method: "GET" },
    );
    vatIdCache = new Map();
    for (const v of list.data) {
      if (v.is_disabled) continue;
      // Build a key that distinguishes "0% N6.9" vs "0% N2.1" vs "22%".
      // Falling back to value-only for non-zero rates.
      const refKey = (v.e_invoice_reference ?? "").toUpperCase();
      const key = v.value === 0 && refKey ? `0:${refKey}` : `${v.value}`;
      // Prefer the first occurrence (FIC returns them in saved order).
      if (!vatIdCache.has(key)) vatIdCache.set(key, v.id);
    }
  }
  const lookupKey =
    value === 0 && eInvoiceRef
      ? `0:${eInvoiceRef.toUpperCase()}`
      : `${value}`;
  const id = vatIdCache.get(lookupKey);
  if (id === undefined) {
    throw new Error(
      `FIC VAT type not configured for rate=${value}${eInvoiceRef ? ` ref=${eInvoiceRef}` : ""}. Add it in the FIC company settings.`,
    );
  }
  return id;
}

export async function createCommissionInvoice(args: {
  fic_client_id: number;
  invoice_date: string;
  period_month_label: string;
  sessions_count: number;
  gross_collected: number;
  mode: TaxMode;
  // Entity overrides on the invoice payload — FIC validates
  // entity.name is non-empty AT INVOICE creation time, even when
  // the entity is referenced by id. If the cached FIC entity was
  // created with sparse fields (e.g. an earlier failed flow that
  // left it with no name), the invoice would 422 with
  // "entity.name field must not be empty". Passing the name (and
  // optionally other fields) inline overrides the cached entity
  // for this invoice and dodges that validation.
  entity_overrides?: {
    name?: string;
    vat_number?: string | null;
    tax_code?: string | null;
  };
}): Promise<{ id: number; number: string; pdf_url: string | null }> {
  const cfg = modeConfig(args.mode);
  const companyId = await getCompanyId();
  const { commission_gross, imponibile } = computeCommissionBreakdown(
    args.gross_collected,
    args.mode,
  );
  const periodLabel = new Date(args.period_month_label).toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric",
  });
  const subject = `Servizio di intermediazione marketplace - ${periodLabel}`;
  const description = `${args.sessions_count} sessioni, fatturato lordo €${args.gross_collected.toFixed(2)}`;

  const itemPrice = cfg.chargesIva ? imponibile : commission_gross;
  const vatId = await getVatIdForRate(cfg.vatRate, cfg.vatEInvoiceRef);
  const paymentAccountId = await getDefaultPaymentAccountId();
  // The full amount the therapist "owes" us — already withheld via
  // Stripe destination charge, so the invoice is paid at issue time.
  const totalDue = commission_gross;

  const payload: Record<string, unknown> = {
    type: "invoice",
    entity: {
      id: args.fic_client_id,
      ...(args.entity_overrides?.name ? { name: args.entity_overrides.name } : {}),
      ...(args.entity_overrides?.vat_number
        ? { vat_number: args.entity_overrides.vat_number }
        : {}),
      ...(args.entity_overrides?.tax_code
        ? { tax_code: args.entity_overrides.tax_code }
        : {}),
    },
    date: args.invoice_date,
    subject,
    description,
    items_list: [
      {
        name: "Commissione intermediazione marketplace 20%",
        net_price: itemPrice,
        qty: 1,
        vat: { id: vatId },
      },
    ],
    // FIC enforces sum(payments_list.amount) == invoice total.
    // The commission is already trattenuta automaticamente via Stripe
    // application_fee at charge time, so the invoice is settled at
    // issue. We mark it `paid` and book it against the first active
    // payment account on the FIC company (cached).
    payments_list: [
      {
        amount: totalDue,
        due_date: args.invoice_date,
        paid_date: args.invoice_date,
        status: "paid",
        payment_account: { id: paymentAccountId },
      },
    ],
    e_invoice: cfg.eInvoice,
  };

  // For e-invoices submitted to SDI, the payment_method must be set
  // in `ei_data` using the official SDI codes (DM 55/2013 Allegato A):
  //   MP01 contanti, MP02 assegno, MP05 bonifico, MP08 carta di
  //   pagamento, MP19 SEPA Direct Debit, etc.
  // Our commission is withheld at charge time via Stripe (carta di
  // credito/debito → MP08).
  if (cfg.eInvoice) {
    payload.ei_data = { payment_method: "MP08" };
  }
  if (cfg.vatNote) {
    payload.notes = cfg.vatNote;
  }

  const res = await ficFetch<FicInvoiceCreated>(
    `/c/${companyId}/issued_documents`,
    { method: "POST", body: JSON.stringify({ data: payload }) },
  );

  let pdfUrl: string | null = null;
  try {
    const pdfRes = await ficFetch<FicUrlResponse>(
      `/c/${companyId}/issued_documents/${res.data.id}/url`,
    );
    pdfUrl = pdfRes.data.url ?? null;
  } catch { /* PDF endpoint optional */ }

  return { id: res.data.id, number: res.data.number, pdf_url: pdfUrl };
}

/**
 * Credit note (storno) for a refunded session, only meaningful for IT
 * modes that originally went through SDI. For non-SDI modes the cron
 * reverses the equivalent amount in the next invoice — credit notes
 * outside Italy aren't required as a separate document.
 */
export async function createCreditNote(args: {
  fic_client_id: number;
  original_invoice_fic_id: number;
  original_invoice_number: string;
  original_invoice_date: string;
  credit_date: string;
  refund_period_label: string;
  refunded_gross: number;
  mode: TaxMode;
}): Promise<{ id: number; number: string; pdf_url: string | null }> {
  const cfg = modeConfig(args.mode);
  // FIC supports credit notes for every mode; the difference is
  // whether SDI gets a copy. The caller is responsible for calling
  // submitToSdi only when shouldSubmitToSdi(mode) is true.
  const companyId = await getCompanyId();
  const { commission_gross, imponibile } = computeCommissionBreakdown(
    args.refunded_gross,
    args.mode,
  );
  const periodLabel = new Date(args.refund_period_label).toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric",
  });
  const itemPrice = cfg.chargesIva ? imponibile : commission_gross;
  const vatId = await getVatIdForRate(cfg.vatRate, cfg.vatEInvoiceRef);

  const res = await ficFetch<FicInvoiceCreated>(
    `/c/${companyId}/issued_documents`,
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "credit_note",
          entity: { id: args.fic_client_id },
          date: args.credit_date,
          subject: `Storno commissione - rimborsi ${periodLabel}`,
          description:
            `Storno parziale fattura n. ${args.original_invoice_number} ` +
            `del ${args.original_invoice_date}. ` +
            `Rimborsi sessioni cliente per €${args.refunded_gross.toFixed(2)}.`,
          items_list: [
            {
              name: "Storno commissione intermediazione marketplace 20%",
              net_price: itemPrice,
              qty: 1,
              vat: { id: vatId },
            },
          ],
          payments_list: [],
          e_invoice: cfg.eInvoice,
          ...(cfg.vatNote ? { notes: cfg.vatNote } : {}),
          related_document: [
            {
              id: args.original_invoice_fic_id,
              type: "invoice",
              number: args.original_invoice_number,
              date: args.original_invoice_date,
            },
          ],
        },
      }),
    },
  );

  let pdfUrl: string | null = null;
  try {
    const pdfRes = await ficFetch<FicUrlResponse>(
      `/c/${companyId}/issued_documents/${res.data.id}/url`,
    );
    pdfUrl = pdfRes.data.url ?? null;
  } catch { /* PDF endpoint optional */ }

  return { id: res.data.id, number: res.data.number, pdf_url: pdfUrl };
}

/**
 * Submit an invoice to SDI (IT modes only). Caller must check
 * `modeConfig(mode).sendToSdi` before invoking. Idempotent on FIC's
 * side — calling twice is fine.
 */
export async function submitToSdi(invoiceId: number): Promise<void> {
  const companyId = await getCompanyId();
  await ficFetch(`/c/${companyId}/issued_documents/${invoiceId}/email`, {
    method: "POST",
    body: JSON.stringify({ data: { send_to_sdi: true } }),
  }).catch((e) => {
    console.error("[fic] submitToSdi failed", e);
  });
}

/** Re-export so the cron can read just the SDI flag without importing modeConfig. */
export function shouldSubmitToSdi(mode: TaxMode): boolean {
  return modeConfig(mode).sendToSdi;
}
