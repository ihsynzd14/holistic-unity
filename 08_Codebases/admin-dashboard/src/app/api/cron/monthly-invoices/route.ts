import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureFicClient,
  createCommissionInvoice,
  submitToSdi,
  shouldSubmitToSdi,
  computeCommissionBreakdown,
  type TherapistBilling,
} from "@/lib/integrations/fattureincloud/invoice";
import {
  resolveTaxMode,
  type BillingProfile,
} from "@/lib/integrations/fattureincloud/tax-mode";

const CRON_SECRET = process.env.CRON_SECRET;

interface SessionRow {
  amount: number | null;
}

interface TherapistProfileRow {
  id: string;
  display_name: string | null;
  fic_client_id: number | null;
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
  billing_email: string | null;
  billing_address: TherapistBilling["billing_address"] | null;
}

/**
 * POST /api/cron/monthly-invoices
 *
 * Runs monthly via Vercel Cron at 03:00 UTC on the 1st. Aggregates
 * the prior month's settled sessions per therapist and issues the
 * 20% commission invoice via FIC.
 *
 * The tax mode (B2B_IT, B2C_IT, B2B_EU_REVERSE, B2C_EU_OSS, B2B_UK_REVERSE,
 * B2C_UK_VAT, EXTRA_EU) is resolved per-therapist by `resolveTaxMode()`.
 * SDI submission only happens for IT modes; cross-border modes get a
 * regular FIC invoice that's then emailed to the therapist's
 * billing_email (or pec_email for IT).
 */
export async function POST(req: NextRequest) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Period = last completed calendar month, in local time.
  // invoice_date = last day of competence month (Art. 21 c. 4 DPR 633/72
  // for fattura riepilogativa).
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const invoiceDate = new Date(now.getFullYear(), now.getMonth(), 0);
  const periodMonthIso = periodStart.toISOString().slice(0, 10);
  const invoiceDateIso = invoiceDate.toISOString().slice(0, 10);

  const { data: therapists, error: tErr } = await admin
    .from("therapist_profiles")
    .select(
      "id, display_name, fic_client_id, country, " +
        "p_iva, codice_fiscale, codice_destinatario, pec_email, regime_forfettario, " +
        "vat_number, vat_validated_at, tax_id_foreign, " +
        "billing_email, billing_address",
    )
    .eq("approval_status", "approved")
    .eq("is_approved", true);

  if (tErr) {
    return NextResponse.json(
      { error: "therapist_query_failed", detail: tErr.message },
      { status: 500 },
    );
  }

  type Result =
    | { therapist_id: string; ok: true; mode: string; invoice_id: number }
    | { therapist_id: string; ok: false; reason: string };
  const results: Result[] = [];

  for (const t of (therapists ?? []) as unknown as TherapistProfileRow[]) {
    try {
      const profile: BillingProfile = {
        country: t.country,
        p_iva: t.p_iva,
        codice_fiscale: t.codice_fiscale,
        codice_destinatario: t.codice_destinatario,
        pec_email: t.pec_email,
        regime_forfettario: t.regime_forfettario,
        vat_number: t.vat_number,
        vat_validated_at: t.vat_validated_at,
        tax_id_foreign: t.tax_id_foreign,
        billing_address: t.billing_address,
      };
      const resolved = resolveTaxMode(profile);
      if (resolved.mode === "INCOMPLETE") {
        results.push({
          therapist_id: t.id,
          ok: false,
          reason: resolved.reason ?? "incomplete_billing",
        });
        continue;
      }
      const mode = resolved.mode;

      // Idempotency
      const { data: existing } = await admin
        .from("therapist_invoices")
        .select("id")
        .eq("therapist_id", t.id)
        .eq("period_month", periodMonthIso)
        .maybeSingle();
      if (existing) {
        results.push({ therapist_id: t.id, ok: false, reason: "already_invoiced" });
        continue;
      }

      // Aggregate completed sessions for the period.
      //
      // We DO NOT filter by `payout_status` — the platform's 20%
      // commission is `application_fee_amount` deducted by Stripe at
      // charge time (destination charge), so it's already in our
      // pocket independently of the therapist's payout schedule.
      // The fattura riepilogativa documents the commission collected
      // during the competence month per Art. 6 c. 3 DPR 633/72
      // (momento di erogazione del servizio = charge time, not bank
      // payout time). Filtering by payout_status would leave most
      // sessions un-invoiced for therapists with active customers,
      // because Stripe's 14-day escrow keeps everything in `pending`
      // until well after the cron runs.
      //
      // `status = "completed"` is the right gate: the Stripe charge
      // succeeded and didn't get refunded mid-period. Refunds that
      // happen AFTER the cron runs are handled by the daily-credit-
      // notes cron (issues nota di credito for the refunded amount).
      const { data: sessions } = await admin
        .from("transactions")
        .select("amount, status, created_at")
        .eq("therapist_id", t.id)
        .eq("status", "completed")
        .gte("created_at", periodStart.toISOString())
        .lt("created_at", periodEnd.toISOString());
      const rows = (sessions ?? []) as SessionRow[];
      const grossCollected = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      if (rows.length === 0 || grossCollected <= 0) {
        results.push({ therapist_id: t.id, ok: false, reason: "no_sessions" });
        continue;
      }

      // Build the FIC entity payload from the therapist row + mode.
      const billing: TherapistBilling = {
        fic_client_id: t.fic_client_id,
        display_name: t.display_name ?? "Operatore",
        p_iva: t.p_iva,
        codice_fiscale: t.codice_fiscale,
        codice_destinatario: t.codice_destinatario,
        pec_email: t.pec_email,
        regime_forfettario: t.regime_forfettario,
        vat_number: t.vat_number,
        tax_id_foreign: t.tax_id_foreign,
        billing_email: t.billing_email,
        billing_address: t.billing_address!,
      };
      const ficClientId = await ensureFicClient(billing, mode);
      if (!t.fic_client_id) {
        await admin
          .from("therapist_profiles")
          .update({ fic_client_id: ficClientId })
          .eq("id", t.id);
      }

      // Issue invoice. SDI submission only for IT modes.
      //
      // `entity_overrides` is a defence-in-depth against FIC entities
      // that were cached with sparse fields (e.g. an earlier flow
      // that created the entity before display_name was populated).
      // The fields below are mode-aware so we don't accidentally
      // overwrite a correctly-created entity's identifier with a
      // stale Italian field — e.g. a therapist who started as IT
      // (codice_fiscale set) and later moved to Spain (mode=EXTRA_EU,
      // tax_id_foreign=NIF) would otherwise have their FIC entity's
      // tax_code overwritten back to the obsolete codice_fiscale on
      // every monthly run.
      const overrideVatNumber: string | null =
        mode === "B2B_IT" || mode === "B2B_IT_FORF"
          ? t.p_iva
          : mode === "B2B_EU_REVERSE" || mode === "B2B_UK_REVERSE"
            ? t.vat_number
            : null;
      const overrideTaxCode: string | null =
        mode === "B2B_IT" || mode === "B2B_IT_FORF"
          ? t.codice_fiscale ?? t.p_iva
          : mode === "B2C_IT"
            ? t.codice_fiscale
            : mode === "EXTRA_EU"
              ? t.tax_id_foreign
              : // B2B_EU_REVERSE / B2B_UK_REVERSE / B2C_EU_OSS / B2C_UK_VAT:
                // tax_code isn't part of the cross-border FIC entity, the
                // VAT number on its own is the fiscal identifier.
                null;

      const inv = await createCommissionInvoice({
        fic_client_id: ficClientId,
        invoice_date: invoiceDateIso,
        period_month_label: periodMonthIso,
        sessions_count: rows.length,
        gross_collected: grossCollected,
        mode,
        entity_overrides: {
          name: t.display_name ?? "Operatore",
          vat_number: overrideVatNumber,
          tax_code: overrideTaxCode,
        },
      });
      if (shouldSubmitToSdi(mode)) {
        await submitToSdi(inv.id);
      }

      const { commission_gross, imponibile, iva } = computeCommissionBreakdown(
        grossCollected,
        mode,
      );

      await admin.from("therapist_invoices").insert({
        therapist_id: t.id,
        period_month: periodMonthIso,
        sessions_count: rows.length,
        gross_collected: grossCollected,
        commission_gross,
        imponibile,
        iva,
        fic_invoice_id: inv.id,
        fic_invoice_number: inv.number,
        fic_pdf_url: inv.pdf_url,
        sdi_status: shouldSubmitToSdi(mode) ? "sent" : "not_applicable",
        sdi_status_updated_at: new Date().toISOString(),
      });

      results.push({ therapist_id: t.id, ok: true, mode, invoice_id: inv.id });
    } catch (e) {
      console.error("[cron.monthly-invoices] therapist failed", t.id, e);
      results.push({
        therapist_id: t.id,
        ok: false,
        reason: (e as Error).message.slice(0, 200),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    period: periodMonthIso,
    issued: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => !r.ok).length,
    results,
  });
}
