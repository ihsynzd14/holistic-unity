/**
 * Tax-mode resolver: maps a therapist's billing profile to the correct
 * cross-border invoice classification used by the monthly cron.
 *
 * Matrix:
 *   B2B_IT          — IT therapist with P.IVA, FE via SDI
 *   B2B_IT_FORF     — IT forfettario (no IVA, art. 1 c.54-89 L. 190/2014)
 *   B2C_IT          — IT private (no P.IVA), FE via SDI with ei_code "0000000"
 *   B2B_EU_REVERSE  — EU therapist with VIES-validated VAT, reverse charge
 *   B2C_EU_OSS      — EU private, IT VAT 22% applied (OSS rules)
 *   B2B_UK_REVERSE  — UK therapist with VAT, reverse charge
 *   B2C_UK_VAT      — UK private, IT VAT 22%
 *   EXTRA_EU        — Outside EU/UK, fuori campo IVA
 *   INCOMPLETE      — Missing required data; cron skips and reports
 */

export type TaxMode =
  | "B2B_IT"
  | "B2B_IT_FORF"
  | "B2C_IT"
  | "B2B_EU_REVERSE"
  | "B2C_EU_OSS"
  | "B2B_UK_REVERSE"
  | "B2C_UK_VAT"
  | "EXTRA_EU"
  | "INCOMPLETE";

export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * Detect EU territories that are constitutionally OUTSIDE the EU VAT
 * zone, so the Italian fattura must treat them as `EXTRA_EU`
 * ("fuori campo IVA Art. 7-ter DPR 633/72") rather than `B2C_EU_OSS`
 * (which would charge Italian 22% VAT).
 *
 * Reference: Art. 6 + Annex III, Council Directive 2006/112/CE.
 *
 * Detected by postal code prefix because the country code alone
 * doesn't disambiguate (Spain mainland and Canary Islands are both
 * country=ES). The prefixes below cover the major cases — extend if
 * we onboard therapists from other special territories.
 *
 * Coverage:
 *  - ES Canary Islands: Tenerife (38xxx), Las Palmas (35xxx)
 *  - ES Ceuta (51xxx) + Melilla (52xxx)
 *  - PT Azores (95xxx, 96xxx) + Madeira (90xxx, 91xxx, 92xxx)
 *  - FR DOM-TOM (97xxx, 98xxx) — Guadalupe, Martinique, Réunion, etc.
 *  - IT Livigno (23030, 23041) + Campione d'Italia (22060) — internal
 *    Italian exception ("fuori IVA" by special status)
 *  - DE Heligoland (27498) + Büsingen (78266)
 */
export function isOutsideEuVatZone(country: string, cap: string | undefined): boolean {
  const c = (cap ?? "").trim();
  if (!c) return false;
  if (country === "ES") {
    if (c.startsWith("35") || c.startsWith("38")) return true; // Canary Islands
    if (c.startsWith("51") || c.startsWith("52")) return true; // Ceuta + Melilla
  }
  if (country === "PT") {
    if (c.startsWith("9")) return true; // Azores 95-96, Madeira 90-92
  }
  if (country === "FR") {
    if (c.startsWith("97") || c.startsWith("98")) return true; // DOM-TOM
  }
  if (country === "IT") {
    if (c === "23030" || c === "23041" || c === "22060") return true; // Livigno + Campione
  }
  if (country === "DE") {
    if (c === "27498" || c === "78266") return true; // Heligoland + Büsingen
  }
  return false;
}

export interface BillingProfile {
  country: string | null;
  // IT-specific
  p_iva: string | null;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  regime_forfettario: boolean | null;
  // Cross-border
  vat_number: string | null;
  vat_validated_at: string | null;
  tax_id_foreign: string | null;
  // Always
  billing_address: { street?: string; cap?: string; city?: string; province?: string; country?: string } | null;
}

export interface ResolvedMode {
  mode: TaxMode;
  reason?: string; // populated when mode === "INCOMPLETE"
}

/**
 * Look at a therapist's billing fields and decide which invoice path to
 * run. Returns INCOMPLETE with a granular reason when something is
 * missing (the cron logs this and admin UI surfaces it).
 *
 * Country precedence: billing_address.country wins over therapist_profiles.country.
 * That's because the legal entity address is what determines invoicing,
 * not the city the therapist is currently practicing in.
 */
export function resolveTaxMode(p: BillingProfile): ResolvedMode {
  const country = (p.billing_address?.country ?? p.country ?? "").toUpperCase();
  if (!country) return { mode: "INCOMPLETE", reason: "missing_country" };
  if (!hasFullAddress(p.billing_address))
    return { mode: "INCOMPLETE", reason: "missing_address" };

  if (country === "IT") {
    if (p.p_iva) {
      const sdiOk = (p.codice_destinatario && p.codice_destinatario.length === 7) || !!p.pec_email;
      if (!sdiOk) return { mode: "INCOMPLETE", reason: "missing_sdi_or_pec" };
      return { mode: p.regime_forfettario ? "B2B_IT_FORF" : "B2B_IT" };
    }
    // No P.IVA → B2C IT (private/occasional). CF is mandatory.
    if (!p.codice_fiscale) return { mode: "INCOMPLETE", reason: "missing_codice_fiscale" };
    return { mode: "B2C_IT" };
  }

  if (country === "GB") {
    if (p.vat_number) return { mode: "B2B_UK_REVERSE" };
    return { mode: "B2C_UK_VAT" };
  }

  if (EU_COUNTRIES.has(country)) {
    // EU territories outside the EU VAT zone (Canary Islands, Ceuta,
    // Melilla, Azores, Madeira, French DOM-TOM, Livigno, Campione,
    // Heligoland, Büsingen) — treated as EXTRA_EU per Art. 7-ter so
    // we don't apply Italian 22% VAT to a non-VAT-zone resident.
    if (isOutsideEuVatZone(country, p.billing_address?.cap)) {
      return { mode: "EXTRA_EU" };
    }
    if (p.vat_number && p.vat_validated_at) return { mode: "B2B_EU_REVERSE" };
    return { mode: "B2C_EU_OSS" };
  }

  // ROW (US, CA, AU, BR, CH, etc.)
  return { mode: "EXTRA_EU" };
}

function hasFullAddress(a: BillingProfile["billing_address"]): boolean {
  if (!a) return false;
  return Boolean(a.street && a.city && a.country);
}

/** True if the resolved mode means the cron should issue an invoice. */
export function isBillable(mode: TaxMode): boolean {
  return mode !== "INCOMPLETE";
}

/** Human-readable label for admin UI / logs. */
export function describeMode(mode: TaxMode): string {
  switch (mode) {
    case "B2B_IT": return "Italia · B2B con P.IVA (FE via SDI)";
    case "B2B_IT_FORF": return "Italia · Forfettario (FE via SDI senza IVA)";
    case "B2C_IT": return "Italia · Privato (FE via SDI cod. dest. 0000000)";
    case "B2B_EU_REVERSE": return "UE · B2B reverse charge";
    case "B2C_EU_OSS": return "UE · Privato (IVA 22% OSS)";
    case "B2B_UK_REVERSE": return "UK · B2B reverse charge";
    case "B2C_UK_VAT": return "UK · Privato (IVA 22%)";
    case "EXTRA_EU": return "Extra-UE · Fuori campo IVA";
    case "INCOMPLETE": return "Dati incompleti";
  }
}
