/**
 * Holistic Unity — Fee Configuration & Payment Calculation Module
 *
 * Mirror of supabase/functions/_shared/fee-config.ts for use in the
 * Next.js therapist-webapp (Node/browser runtime).
 *
 * KEEP IN SYNC with the Edge Function version. The logic is identical;
 * only the module system differs (ESM vs Deno).
 *
 * Key invariant: the therapist ALWAYS receives exactly 80% of their
 * listed session price, regardless of country.
 */

// ─── Country lists ───────────────────────────────────────────────────────────

export const ITALY_VARIANTS = ["IT", "ITALY", "ITALIA"];

export const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "LV", "LT", "LU", "MT", "NL", "PL",
  "PT", "RO", "SK", "SI", "ES", "SE",
];

export const EEA_COUNTRIES = ["IS", "LI", "NO"];

// ─── Fee constants ───────────────────────────────────────────────────────────

const PLATFORM_FEE_PERCENT = 0.20;
const IVA_RATE = 0.22;
const SERVICE_FEE_PERCENT = 0.029;
const SERVICE_FEE_FIXED = 30; // cents

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeeRegion = "IT" | "EU" | "UK" | "US" | "ROW";

export interface FeeConfig {
  region: FeeRegion;
  platformFeePercent: number;
  ivaApplied: boolean;
  ivaRate: number;
  vatMechanism: "iva_inclusa" | "reverse_charge" | "fuori_campo" | "none";
  invoiceNote: string;
  requiresVatNumber: boolean;
  serviceFeePercent: number;
  serviceFeeFixed: number;
}

export interface PaymentCalculation {
  sessionPriceCents: number;
  totalChargedCents: number;
  platformFeeCents: number;
  platformFeeNetCents: number;
  ivaAmountCents: number;
  ivaApplied: boolean;
  serviceFeeCents: number;
  applicationFeeCents: number;
  therapistPayoutCents: number;
  feeRegion: FeeRegion;
  therapistCountry: string;
}

// ─── Core functions ──────────────────────────────────────────────────────────

export function getFeeConfig(countryCode: string): FeeConfig {
  const cc = countryCode.trim().toUpperCase();

  if (ITALY_VARIANTS.includes(cc)) {
    return {
      region: "IT",
      platformFeePercent: PLATFORM_FEE_PERCENT,
      ivaApplied: true,
      ivaRate: IVA_RATE,
      vatMechanism: "iva_inclusa",
      invoiceNote: "Commissione 20% IVA inclusa ai sensi del DPR 633/72",
      requiresVatNumber: false,
      serviceFeePercent: SERVICE_FEE_PERCENT,
      serviceFeeFixed: SERVICE_FEE_FIXED,
    };
  }

  if (EU_COUNTRIES.includes(cc) || EEA_COUNTRIES.includes(cc)) {
    return {
      region: "EU",
      platformFeePercent: PLATFORM_FEE_PERCENT,
      ivaApplied: false,
      ivaRate: 0,
      vatMechanism: "reverse_charge",
      invoiceNote:
        "Reverse charge - Art. 44 Directive 2006/112/CE - VAT to be accounted for by the recipient",
      requiresVatNumber: true,
      serviceFeePercent: SERVICE_FEE_PERCENT,
      serviceFeeFixed: SERVICE_FEE_FIXED,
    };
  }

  if (cc === "GB" || cc === "UK") {
    return {
      region: "UK",
      platformFeePercent: PLATFORM_FEE_PERCENT,
      ivaApplied: false,
      ivaRate: 0,
      vatMechanism: "reverse_charge",
      invoiceNote:
        "Outside the scope of Italian VAT - Art. 7-ter DPR 633/72. Reverse charge applies - recipient to account for UK VAT",
      requiresVatNumber: true,
      serviceFeePercent: SERVICE_FEE_PERCENT,
      serviceFeeFixed: SERVICE_FEE_FIXED,
    };
  }

  if (cc === "US") {
    return {
      region: "US",
      platformFeePercent: PLATFORM_FEE_PERCENT,
      ivaApplied: false,
      ivaRate: 0,
      vatMechanism: "none",
      invoiceNote:
        "Outside the scope of Italian VAT - Art. 7-ter DPR 633/72. No US federal VAT applies.",
      requiresVatNumber: false,
      serviceFeePercent: SERVICE_FEE_PERCENT,
      serviceFeeFixed: SERVICE_FEE_FIXED,
    };
  }

  return {
    region: "ROW",
    platformFeePercent: PLATFORM_FEE_PERCENT,
    ivaApplied: false,
    ivaRate: 0,
    vatMechanism: "none",
    invoiceNote: "Outside the scope of Italian VAT - Art. 7-ter DPR 633/72",
    requiresVatNumber: false,
    serviceFeePercent: SERVICE_FEE_PERCENT,
    serviceFeeFixed: SERVICE_FEE_FIXED,
  };
}

export function calculatePaymentAmounts(
  sessionPriceCents: number,
  countryCode: string
): PaymentCalculation {
  const config = getFeeConfig(countryCode);
  const cc = countryCode.trim().toUpperCase();

  const platformFeeCents = Math.round(sessionPriceCents * config.platformFeePercent);

  let platformFeeNetCents: number;
  let ivaAmountCents: number;

  if (config.ivaApplied) {
    platformFeeNetCents = Math.round(platformFeeCents / (1 + config.ivaRate));
    ivaAmountCents = platformFeeCents - platformFeeNetCents;
  } else {
    platformFeeNetCents = platformFeeCents;
    ivaAmountCents = 0;
  }

  // Stripe processing fee passed through to the client. This formula
  // MUST match the Edge Function `create-booking-with-payment` (see
  // docs/flows/07-payment.md):
  //   processingFee = round(price * percent + fixed)
  //   totalCharged  = price + processingFee
  // Earlier versions used a multiplicative reverse-gross-up with
  // Math.ceil, which produced a ~1-9¢ drift between display and the
  // actual amount charged by the Edge Function on non-round prices.
  const serviceFeeCents = Math.round(
    sessionPriceCents * config.serviceFeePercent + config.serviceFeeFixed,
  );
  const totalChargedCents = sessionPriceCents + serviceFeeCents;

  const applicationFeeCents = platformFeeCents + serviceFeeCents;
  const therapistPayoutCents = totalChargedCents - applicationFeeCents;

  return {
    sessionPriceCents,
    totalChargedCents,
    platformFeeCents,
    platformFeeNetCents,
    ivaAmountCents,
    ivaApplied: config.ivaApplied,
    serviceFeeCents,
    applicationFeeCents,
    therapistPayoutCents,
    feeRegion: config.region,
    therapistCountry: ITALY_VARIANTS.includes(cc) ? "IT" : cc,
  };
}
