import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCreditNote,
  submitToSdi,
} from "@/lib/integrations/fattureincloud/invoice";
import {
  resolveTaxMode,
  type BillingProfile,
} from "@/lib/integrations/fattureincloud/tax-mode";
import { shouldSubmitToSdi } from "@/lib/integrations/fattureincloud/invoice";

const CRON_SECRET = process.env.CRON_SECRET;

interface RefundedTxRow {
  id: string;
  therapist_id: string;
  amount: number | null;
  created_at: string;
}

interface TherapistInvoiceRow {
  id: string;
  fic_invoice_id: number;
  fic_invoice_number: string;
  period_month: string;
}

interface TherapistProfileRow {
  fic_client_id: number | null;
  country: string | null;
  p_iva: string | null;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  regime_forfettario: boolean | null;
  vat_number: string | null;
  vat_validated_at: string | null;
  tax_id_foreign: string | null;
  billing_address: BillingProfile["billing_address"];
}

interface ClaimedTxRow {
  id: string;
  amount: number | null;
}

/**
 * POST /api/cron/daily-credit-notes
 *
 * Runs daily via Vercel Cron at 04:00 UTC. Identifies sessions that
 * were refunded AFTER the monthly commission invoice was issued, and
 * automatically issues an aggregated nota di credito elettronica per
 * therapist/invoice via FIC + SDI.
 *
 * Idempotency strategy:
 *  1. Atomic UPDATE to claim transactions (set credited_at) — race-safe
 *  2. Issue credit note via FIC
 *  3. On FIC failure: rollback credited_at to NULL → next run retries
 *  4. On success: insert therapist_invoice_credits row
 *
 * Authenticated via CRON_SECRET (Vercel Cron sets Bearer header).
 *
 * Manual trigger:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://admin.holisticunity.app/api/cron/daily-credit-notes
 */
export async function POST(req: NextRequest) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Find all refunded transactions not yet credited.
  //    refund_amount > 0 + status='refunded' = full refund (per cancel
  //    route logic: partial refunds keep status original and platform
  //    keeps the commission, so no credit note needed).
  const { data: txs, error: txErr } = await admin
    .from("transactions")
    .select("id, therapist_id, amount, created_at")
    .eq("status", "refunded")
    .is("credited_at", null);

  if (txErr) {
    return NextResponse.json(
      { error: "tx_query_failed", detail: txErr.message },
      { status: 500 },
    );
  }

  const rows = (txs ?? []) as RefundedTxRow[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, results: [] });
  }

  // 2. Group by therapist_id + period_month (= 1st day of created_at month).
  type Group = {
    therapistId: string;
    periodIso: string;
    txIds: string[];
  };
  const groups = new Map<string, Group>();
  for (const tx of rows) {
    const d = new Date(tx.created_at);
    const periodStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const periodIso = periodStart.toISOString().slice(0, 10);
    const key = `${tx.therapist_id}::${periodIso}`;
    if (!groups.has(key)) {
      groups.set(key, { therapistId: tx.therapist_id, periodIso, txIds: [] });
    }
    groups.get(key)!.txIds.push(tx.id);
  }

  const results: Array<{
    therapist_id: string;
    period: string;
    ok: boolean;
    reason?: string;
    credited?: number;
  }> = [];

  // 3. For each group: lookup invoice → claim txs → issue credit note → record
  for (const g of groups.values()) {
    try {
      // 3a. Find the existing monthly invoice for this period
      const { data: invRow } = await admin
        .from("therapist_invoices")
        .select("id, fic_invoice_id, fic_invoice_number, period_month")
        .eq("therapist_id", g.therapistId)
        .eq("period_month", g.periodIso)
        .maybeSingle();
      if (!invRow) {
        results.push({
          therapist_id: g.therapistId,
          period: g.periodIso,
          ok: false,
          reason: "no_invoice_yet",
        });
        continue;
      }
      const invoice = invRow as TherapistInvoiceRow;

      // 3b. Lookup therapist's FIC client id + billing data so we can
      //     resolve the tax mode and pass it to createCreditNote.
      const { data: profRow } = await admin
        .from("therapist_profiles")
        .select(
          "fic_client_id, country, p_iva, codice_fiscale, codice_destinatario, pec_email, " +
          "regime_forfettario, vat_number, vat_validated_at, tax_id_foreign, billing_address",
        )
        .eq("id", g.therapistId)
        .maybeSingle();
      const profile = profRow as TherapistProfileRow | null;
      if (!profile?.fic_client_id) {
        results.push({
          therapist_id: g.therapistId,
          period: g.periodIso,
          ok: false,
          reason: "missing_fic_client_id",
        });
        continue;
      }
      const billingProfile: BillingProfile = {
        country: profile.country,
        p_iva: profile.p_iva,
        codice_fiscale: profile.codice_fiscale,
        codice_destinatario: profile.codice_destinatario,
        pec_email: profile.pec_email,
        regime_forfettario: profile.regime_forfettario,
        vat_number: profile.vat_number,
        vat_validated_at: profile.vat_validated_at,
        tax_id_foreign: profile.tax_id_foreign,
        billing_address: profile.billing_address,
      };
      const resolved = resolveTaxMode(billingProfile);
      if (resolved.mode === "INCOMPLETE") {
        // Therapist's billing profile got broken since the original
        // invoice was issued. Skip — admin needs to look at this.
        results.push({
          therapist_id: g.therapistId,
          period: g.periodIso,
          ok: false,
          reason: `billing_now_incomplete:${resolved.reason}`,
        });
        continue;
      }
      const mode = resolved.mode;

      // 3c. Atomic claim — set credited_at on the txs we want to credit.
      //     The is_null guard makes this safe against concurrent runs.
      const claimedAt = new Date().toISOString();
      const { data: claimedRows, error: claimErr } = await admin
        .from("transactions")
        .update({ credited_at: claimedAt })
        .in("id", g.txIds)
        .is("credited_at", null)
        .select("id, amount");

      if (claimErr) {
        results.push({
          therapist_id: g.therapistId,
          period: g.periodIso,
          ok: false,
          reason: `claim_failed:${claimErr.message.slice(0, 100)}`,
        });
        continue;
      }
      const claimed = (claimedRows ?? []) as ClaimedTxRow[];
      if (claimed.length === 0) continue; // raced with concurrent run

      const refundedGross = +claimed
        .reduce((s, r) => s + Number(r.amount ?? 0), 0)
        .toFixed(2);

      // 3d. Compute original invoice date (last day of period_month).
      const periodDate = new Date(invoice.period_month);
      const origInvoiceDate = new Date(
        Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth() + 1, 0),
      );
      const origInvoiceDateIso = origInvoiceDate.toISOString().slice(0, 10);

      // 3e. Issue credit note via FIC (today's date as data documento)
      const today = new Date().toISOString().slice(0, 10);
      let cn;
      try {
        cn = await createCreditNote({
          fic_client_id: profile.fic_client_id,
          original_invoice_fic_id: invoice.fic_invoice_id,
          original_invoice_number: invoice.fic_invoice_number,
          original_invoice_date: origInvoiceDateIso,
          credit_date: today,
          refund_period_label: invoice.period_month,
          refunded_gross: refundedGross,
          mode,
        });
        // SDI submission only for IT modes — cross-border credit notes
        // exist in FIC for bookkeeping but don't go to SDI.
        if (shouldSubmitToSdi(mode)) {
          await submitToSdi(cn.id);
        }
      } catch (e) {
        // 3f. Rollback the claim so next run retries cleanly
        await admin
          .from("transactions")
          .update({ credited_at: null })
          .in("id", claimed.map((r) => r.id));
        throw e;
      }

      // 3g. Record the credit note
      const commissionCredited = +(refundedGross * 0.20).toFixed(2);
      const imponibile = +(commissionCredited / 1.22).toFixed(2);
      const iva = +(commissionCredited - imponibile).toFixed(2);
      await admin.from("therapist_invoice_credits").insert({
        therapist_id: g.therapistId,
        original_invoice_id: invoice.id,
        refunded_gross: refundedGross,
        commission_credited: commissionCredited,
        imponibile,
        iva,
        fic_credit_note_id: cn.id,
        fic_credit_note_number: cn.number,
        fic_pdf_url: cn.pdf_url,
        sdi_status: "sent",
        sdi_status_updated_at: new Date().toISOString(),
      });

      results.push({
        therapist_id: g.therapistId,
        period: g.periodIso,
        ok: true,
        credited: commissionCredited,
      });
    } catch (e) {
      console.error(
        "[cron.daily-credit-notes] failed",
        g.therapistId,
        g.periodIso,
        e,
      );
      results.push({
        therapist_id: g.therapistId,
        period: g.periodIso,
        ok: false,
        reason: (e as Error).message.slice(0, 200),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
