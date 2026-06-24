/**
 * VIES (EU) and HMRC (UK) VAT validation.
 *
 * VIES:   https://ec.europa.eu/taxation_customs/vies/services/checkVatService
 *         (SOAP, but EU also exposes a REST gateway)
 *
 * Strategy: validate on save (in the billing API route), persist the
 * timestamp on `therapist_profiles.vat_validated_at`. The monthly cron
 * re-validates if the timestamp is older than 30 days — VAT numbers can
 * be deactivated and we don't want to issue a reverse-charge invoice
 * to a therapist whose VAT registration was cancelled mid-quarter.
 *
 * Failures are non-fatal at save time (we save the number but flag it
 * unvalidated; the cron then falls back to B2C_EU_OSS until validation
 * succeeds).
 */

const VIES_REST = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

export interface VatValidationResult {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  name?: string;
  address?: string;
  source: "vies" | "hmrc" | "skipped";
  error?: string;
}

/**
 * Validate an EU VAT number via the VIES REST gateway. The number can
 * be supplied with or without the country prefix; we strip and re-add it.
 *
 * Note: the REST gateway has been intermittently rate-limited. Treat
 * any non-200 as "unable to validate now" — caller should NOT block
 * the save, just leave `vat_validated_at` null.
 */
export async function validateEuVat(input: string): Promise<VatValidationResult> {
  const cleaned = input.replace(/\s+/g, "").toUpperCase();
  const m = cleaned.match(/^([A-Z]{2})(.+)$/);
  if (!m) {
    return {
      valid: false,
      countryCode: "",
      vatNumber: cleaned,
      source: "vies",
      error: "format_invalid",
    };
  }
  const [, countryCode, vatNumber] = m;
  try {
    const res = await fetch(VIES_REST, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryCode, vatNumber }),
      // VIES is sometimes slow; cap at 8s.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        valid: false,
        countryCode,
        vatNumber,
        source: "vies",
        error: `vies_http_${res.status}`,
      };
    }
    const json = (await res.json()) as {
      valid?: boolean;
      name?: string;
      address?: string;
      userError?: string;
    };
    return {
      valid: Boolean(json.valid),
      countryCode,
      vatNumber,
      name: json.name?.trim() || undefined,
      address: json.address?.trim() || undefined,
      source: "vies",
      error: json.userError || undefined,
    };
  } catch (e) {
    return {
      valid: false,
      countryCode,
      vatNumber,
      source: "vies",
      error: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

/**
 * UK VAT validation via HMRC public API. UK left VIES post-Brexit so
 * we hit a separate endpoint. Same fail-soft contract as VIES.
 */
export async function validateUkVat(input: string): Promise<VatValidationResult> {
  const cleaned = input.replace(/\s+/g, "").toUpperCase().replace(/^GB/, "");
  if (!/^\d{9}(\d{3})?$/.test(cleaned)) {
    return {
      valid: false,
      countryCode: "GB",
      vatNumber: cleaned,
      source: "hmrc",
      error: "format_invalid",
    };
  }
  try {
    const res = await fetch(
      `https://api.service.hmrc.gov.uk/organisations/vat/check-vat-number/lookup/${cleaned}`,
      {
        headers: { Accept: "application/vnd.hmrc.2.0+json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.status === 404) {
      return { valid: false, countryCode: "GB", vatNumber: cleaned, source: "hmrc" };
    }
    if (!res.ok) {
      return {
        valid: false,
        countryCode: "GB",
        vatNumber: cleaned,
        source: "hmrc",
        error: `hmrc_http_${res.status}`,
      };
    }
    const json = (await res.json()) as { target?: { name?: string; address?: { line1?: string; postcode?: string } } };
    return {
      valid: true,
      countryCode: "GB",
      vatNumber: cleaned,
      name: json.target?.name,
      address: [json.target?.address?.line1, json.target?.address?.postcode].filter(Boolean).join(", ") || undefined,
      source: "hmrc",
    };
  } catch (e) {
    return {
      valid: false,
      countryCode: "GB",
      vatNumber: cleaned,
      source: "hmrc",
      error: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

/**
 * Single dispatcher used by the billing API route. UK → HMRC, EU → VIES,
 * everything else → skipped (we don't validate ROW tax IDs).
 */
export async function validateVat(country: string, vatNumber: string): Promise<VatValidationResult> {
  const c = country.toUpperCase();
  if (c === "GB") return validateUkVat(vatNumber);
  // The number itself encodes its country prefix; we let validateEuVat
  // strip and re-add it. This also handles the edge case where the
  // therapist's billing address is in country X but they registered
  // VAT in country Y (rare but legal in the EU).
  return validateEuVat(vatNumber);
}
