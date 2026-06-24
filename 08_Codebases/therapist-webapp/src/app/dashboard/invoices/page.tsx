"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Receipt, Download, Loader2, FileText, ArrowLeft, AlertCircle, MinusCircle,
} from "lucide-react";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

interface InvoiceRow {
  id: string;
  period_month: string;
  sessions_count: number;
  gross_collected: number;
  commission_gross: number;
  imponibile: number;
  iva: number;
  fic_invoice_number: string;
  fic_pdf_url: string | null;
  sdi_status: string;
  sdi_status_updated_at: string | null;
  created_at: string;
}

interface CreditNoteRow {
  id: string;
  original_invoice_id: string;
  refunded_gross: number;
  commission_credited: number;
  fic_credit_note_number: string;
  fic_pdf_url: string | null;
  sdi_status: string;
  created_at: string;
}

const sdiStatusLabel: Record<string, { label: string; color: string }> = {
  sent: { label: "Inviata SDI", color: "text-success bg-success/10" },
  delivered: { label: "Consegnata", color: "text-success bg-success/10" },
  pending: { label: "In attesa", color: "text-warning bg-warning/10" },
  rejected: { label: "Scartata", color: "text-error bg-error/10" },
  not_delivered: { label: "Non consegnata", color: "text-error bg-error/10" },
};

function formatPeriod(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}

/**
 * Dashboard > Fatture commissione.
 *
 * Read-only list of monthly commission invoices issued by Storm X
 * Digital S.R.L. to the therapist via FattureInCloud + SDI.
 *
 * RLS on therapist_invoices restricts SELECT to auth.uid() = therapist_id,
 * so a direct query via the user-scoped supabase client is safe.
 */
export default function InvoicesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [credits, setCredits] = useState<CreditNoteRow[]>([]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError("");
    try {
      const supabase = createClient();
      const [invoicesRes, creditsRes] = await Promise.all([
        supabase
          .from("therapist_invoices")
          .select(
            "id, period_month, sessions_count, gross_collected, commission_gross, imponibile, iva, fic_invoice_number, fic_pdf_url, sdi_status, sdi_status_updated_at, created_at",
          )
          .order("period_month", { ascending: false }),
        supabase
          .from("therapist_invoice_credits")
          .select(
            "id, original_invoice_id, refunded_gross, commission_credited, fic_credit_note_number, fic_pdf_url, sdi_status, created_at",
          )
          .order("created_at", { ascending: false }),
      ]);
      if (invoicesRes.error) throw new Error(invoicesRes.error.message);
      if (creditsRes.error) throw new Error(creditsRes.error.message);
      setRows((invoicesRes.data ?? []) as InvoiceRow[]);
      setCredits((creditsRes.data ?? []) as CreditNoteRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Loader2 className="h-7 w-7 animate-spin text-berry" />
      </LoadingContainer>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/dashboard/billing"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-charcoal-muted hover:text-berry transition-all"
      >
        <ArrowLeft className="h-3 w-3" />
        Dati di fatturazione
      </Link>

      <div className="animate-reveal">
        <DisplayHeading>
          Fatture commissione
        </DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">
          Le fatture elettroniche emesse da Storm X Digital per la commissione mensile del 20%.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-error-light px-4 py-3 text-sm text-error flex items-start gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!error && rows.length === 0 && (
        <div className="animate-reveal rounded-2xl border border-dashed border-berry/15 bg-berry-subtle/20 p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/60">
            <Receipt className="h-5 w-5 text-berry" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-semibold text-charcoal">Nessuna fattura ancora</p>
          <p className="mt-1 text-xs text-charcoal-muted max-w-sm mx-auto">
            Le fatture vengono emesse il 1° di ogni mese, per le sessioni completate il mese
            precedente. Assicurati di aver compilato i{" "}
            <Link href="/dashboard/billing" className="text-berry hover:underline">
              dati di fatturazione
            </Link>
            .
          </p>
        </div>
      )}

      {rows.map((r, i) => {
        const status = sdiStatusLabel[r.sdi_status] ?? { label: r.sdi_status, color: "text-charcoal-muted bg-charcoal/5" };
        const myCredits = credits.filter((c) => c.original_invoice_id === r.id);
        const totalCredited = myCredits.reduce((s, c) => s + Number(c.commission_credited), 0);
        const netCommission = Number(r.commission_gross) - totalCredited;
        return (
          <div
            key={r.id}
            className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm"
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-charcoal capitalize">
                    {formatPeriod(r.period_month)}
                  </p>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${status.color}`}>
                    {status.label}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] font-mono text-charcoal-muted">
                  Fattura n. {r.fic_invoice_number}
                </p>
              </div>
              {r.fic_pdf_url ? (
                <a
                  href={r.fic_pdf_url}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-1.5 rounded-full border border-berry/20 px-3 py-1.5 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
                >
                  <Download className="h-3 w-3" />
                  PDF
                </a>
              ) : (
                <span className="text-[10px] text-charcoal-muted/60 italic">PDF non disponibile</span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              <Stat label="Sessioni" value={r.sessions_count.toString()} />
              <Stat label="Fatturato lordo" value={formatEuro(r.gross_collected)} />
              <Stat label="Imponibile" value={formatEuro(r.imponibile)} />
              <Stat label="IVA 22%" value={formatEuro(r.iva)} />
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-berry/5 pt-3">
              <p className="text-xs text-charcoal-muted">Commissione totale (IVA inclusa)</p>
              <p className="text-base font-bold text-berry">{formatEuro(r.commission_gross)}</p>
            </div>

            {/* Credit notes (storni) */}
            {myCredits.length > 0 && (
              <div className="mt-4 rounded-xl border border-warning/20 bg-warning-light/30 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
                  <MinusCircle className="h-3 w-3" />
                  Note di credito ({myCredits.length})
                </div>
                {myCredits.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] text-charcoal-muted truncate">
                        N. {c.fic_credit_note_number} · {new Date(c.created_at).toLocaleDateString("it-IT")}
                      </p>
                      <p className="text-[11px] text-charcoal-muted/80">
                        Storno commissione su rimborsi €{Number(c.refunded_gross).toFixed(2)}
                      </p>
                    </div>
                    <p className="font-semibold text-warning whitespace-nowrap">
                      −{formatEuro(c.commission_credited)}
                    </p>
                    {c.fic_pdf_url && (
                      <a
                        href={c.fic_pdf_url}
                        target="_blank"
                        rel="noopener"
                        className="text-[11px] font-medium text-berry hover:underline whitespace-nowrap"
                      >
                        PDF
                      </a>
                    )}
                  </div>
                ))}
                <div className="border-t border-warning/20 pt-2 flex items-center justify-between text-xs">
                  <p className="text-charcoal-muted">Commissione netta dopo storni</p>
                  <p className="font-bold text-berry">{formatEuro(netCommission)}</p>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {rows.length > 0 && (
        <p className="text-[11px] text-charcoal-muted/60 text-center pt-2 flex items-center justify-center gap-1.5">
          <FileText className="h-3 w-3" />
          La fattura originale è anche stata trasmessa a SDI per la consegna al tuo recapito fiscale.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-charcoal-muted/70">{label}</p>
      <p className="mt-0.5 font-semibold text-charcoal">{value}</p>
    </div>
  );
}
