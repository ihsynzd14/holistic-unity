import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Billing profile API — GET returns the saved data, POST validates +
 * updates a per-country whitelist of fields.
 *
 * Validation is country-aware: an Italian therapist must supply at
 * least P.IVA + (cod. dest. OR PEC) **OR** a CF (private/B2C path).
 * EU/UK supply VAT (optionally validated via VIES/HMRC) plus address.
 * ROW just needs a tax id and a postal address. The shape of the
 * payload is the same across countries — empty fields are simply
 * persisted as null.
 *
 * VAT validation runs server-side via the admin-dashboard project's
 * `validateVat` helper. The therapist-webapp doesn't depend on it
 * directly to avoid cross-repo imports — instead the cron in
 * admin-dashboard re-validates if `vat_validated_at` is older than 30
 * days. Saving a new VAT here clears the timestamp so the cron will
 * re-validate on next run.
 */

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

interface BillingAddress {
  street: string;
  cap: string;
  city: string;
  province: string;
  country: string;
}

interface BillingPayload {
  // Common
  billing_address: BillingAddress;
  billing_email?: string;
  // IT
  p_iva?: string;
  codice_fiscale?: string;
  codice_destinatario?: string;
  pec_email?: string;
  regime_forfettario?: boolean;
  // Cross-border
  vat_number?: string;
  tax_id_foreign?: string;
}

const P_IVA_IT_RE = /^[0-9]{11}$/;
const CF_IT_RE = /^[A-Z0-9]{16}$|^[0-9]{11}$/;
const SDI_RE = /^[A-Z0-9]{7}$/;
const CAP_IT_RE = /^[0-9]{5}$/;
const PROV_IT_RE = /^[A-Z]{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VAT_EU_RE = /^[A-Z]{2}[0-9A-Z]{2,12}$/;

function nz(v: string | undefined | null): string {
  return (v ?? "").trim();
}

/** Returns first error message, or null if valid. */
function validate(p: BillingPayload): string | null {
  const a = p.billing_address ?? ({} as BillingAddress);
  const country = nz(a.country).toUpperCase();
  if (!country) return "Paese obbligatorio";
  if (!nz(a.street)) return "Indirizzo (via) obbligatorio";
  if (!nz(a.city)) return "Città obbligatoria";

  const billingEmail = nz(p.billing_email);
  if (billingEmail && !EMAIL_RE.test(billingEmail))
    return "Email di fatturazione non valida";

  if (country === "IT") {
    // CAP and Provincia are mandatory for IT (FE rejects otherwise).
    if (!CAP_IT_RE.test(nz(a.cap))) return "CAP non valido (5 cifre)";
    if (!PROV_IT_RE.test(nz(a.province).toUpperCase()))
      return "Provincia non valida (2 lettere, es. MI)";

    const piva = nz(p.p_iva);
    const cf = nz(p.codice_fiscale).toUpperCase();
    const sdi = nz(p.codice_destinatario).toUpperCase();
    const pec = nz(p.pec_email).toLowerCase();

    if (piva) {
      if (!P_IVA_IT_RE.test(piva)) return "P.IVA non valida (11 cifre)";
      if (cf && !CF_IT_RE.test(cf))
        return "Codice fiscale non valido (11 cifre o 16 caratteri)";
      if (!sdi && !pec)
        return "Inserisci codice destinatario SDI o indirizzo PEC";
      if (sdi && !SDI_RE.test(sdi))
        return "Codice destinatario SDI non valido (7 caratteri alfanumerici)";
      if (pec && !EMAIL_RE.test(pec)) return "Indirizzo PEC non valido";
      return null;
    }
    // No P.IVA → B2C path. CF mandatory.
    if (!cf) return "Senza P.IVA è obbligatorio il codice fiscale";
    if (!CF_IT_RE.test(cf))
      return "Codice fiscale non valido (16 caratteri)";
    return null;
  }

  if (country === "GB") {
    const vat = nz(p.vat_number).toUpperCase().replace(/\s+/g, "");
    const taxId = nz(p.tax_id_foreign);
    if (vat) {
      if (!/^GB[0-9]{9}([0-9]{3})?$/.test(vat))
        return "VAT UK non valido (es. GB123456789)";
      return null;
    }
    // No VAT → at least the local Tax ID (UTR / NI) must be present so
    // the cross-border invoice has a fiscal identifier for the payee.
    if (!taxId)
      return "Senza VAT UK è obbligatorio il Tax ID locale (UTR per autonomi o National Insurance Number)";
    return null;
  }

  if (EU_COUNTRIES.has(country)) {
    const vat = nz(p.vat_number).toUpperCase().replace(/\s+/g, "");
    const taxId = nz(p.tax_id_foreign);
    if (vat) {
      if (!VAT_EU_RE.test(vat))
        return "VAT UE non valido (es. FR12345678901)";
      return null;
    }
    // No EU VAT → at least the local Tax ID must be present (NIF in
    // Spain, Numéro fiscal in France, Steuer-IdNr in Germany, etc.).
    // This unblocks therapists who are not subject to VAT (private,
    // occasional, special-territory residents like Canary Islands).
    if (!taxId)
      return "Senza VAT UE è obbligatorio il Tax ID locale (NIF/NIE per Spagna, Steuer-IdNr per Germania, ecc.)";
    return null;
  }

  // ROW
  if (!nz(p.tax_id_foreign))
    return "Tax ID locale obbligatorio per i paesi extra-UE (es. EIN, SSN, ITIN, ABN, BN)";
  return null;
}

export async function GET() {
  // Auth-gate first using the user-scoped client. Only after we have
  // a confirmed `auth.uid()` do we use the service-role client to
  // SELECT the billing columns — these have column-level grants
  // (INSERT/UPDATE only, no SELECT) for the `authenticated` role
  // because they hold sensitive fiscal data the platform doesn't want
  // exposed via PostgREST. Without the admin client, the user-scoped
  // SELECT silently returns nulls for `p_iva`, `codice_fiscale`,
  // `vat_number`, `tax_id_foreign`, `billing_email`, `billing_address`
  // (etc.), which made the billing form re-render as if no data had
  // been saved (Roberta Pagliani report, 2026-05-08: "Quando inserisco
  // i dati pare tutto ok, ma tornando nella schermata, dopo, sembra
  // non averlo memorizzato"). The data WAS saved — the read just
  // couldn't see it.
  //
  // Using the admin client here is safe because:
  //   1. We've already verified `user` is authenticated above.
  //   2. The query is filtered to `id = user.id` — the caller can
  //      only ever see their own row, never another therapist's.
  //   3. We do NOT return any column outside the billing whitelist
  //      (e.g. no stripe_connected_account_id or auth metadata).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("therapist_profiles")
    .select(
      "p_iva, codice_fiscale, codice_destinatario, pec_email, regime_forfettario, " +
        "vat_number, vat_validated_at, tax_id_foreign, billing_email, billing_address, fic_client_id",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? null });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: BillingPayload;
  try {
    body = (await req.json()) as BillingPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  // Read the current row to detect VAT changes (and clear the
  // validation timestamp accordingly). Same column-level grant story
  // as the GET handler — the user-scoped client can't SELECT
  // `vat_number`, so a previous version of this code always saw
  // `prev.vat_number === null` and falsely flagged every save as a
  // VAT change, clearing `vat_validated_at` unnecessarily on every
  // form submit. Using the admin client (after the auth gate above)
  // is safe because the SELECT is scoped to `id = user.id`.
  const admin = createAdminClient();
  const { data: prev } = await admin
    .from("therapist_profiles")
    .select("vat_number")
    .eq("id", user.id)
    .maybeSingle();
  const newVat = nz(body.vat_number).toUpperCase().replace(/\s+/g, "") || null;
  const vatChanged = prev?.vat_number !== newVat;

  const a = body.billing_address;
  const update = {
    p_iva: nz(body.p_iva) || null,
    codice_fiscale: nz(body.codice_fiscale).toUpperCase() || null,
    codice_destinatario: nz(body.codice_destinatario).toUpperCase() || null,
    pec_email: nz(body.pec_email).toLowerCase() || null,
    regime_forfettario: !!body.regime_forfettario,
    vat_number: newVat,
    // Clear validation timestamp on change so the cron re-validates.
    ...(vatChanged ? { vat_validated_at: null } : {}),
    tax_id_foreign: nz(body.tax_id_foreign) || null,
    billing_email: nz(body.billing_email).toLowerCase() || null,
    billing_address: {
      street: nz(a.street),
      cap: nz(a.cap),
      city: nz(a.city),
      province: nz(a.province).toUpperCase(),
      country: nz(a.country).toUpperCase() || "IT",
    },
  };

  // The UPDATE itself works under the user-scoped client (the
  // INSERT/UPDATE column grants are wide enough), but using the same
  // admin client we already created keeps the read+write
  // consistent and avoids a second auth round-trip.
  const { error: upErr } = await admin
    .from("therapist_profiles")
    .update(update)
    .eq("id", user.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
