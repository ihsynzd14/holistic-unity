import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveTaxMode,
  describeMode,
  type BillingProfile,
  type TaxMode,
} from "@/lib/integrations/fattureincloud/tax-mode";

interface TherapistRow {
  id: string;
  display_name: string | null;
  country: string | null;
  p_iva: string | null;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  regime_forfettario: boolean | null;
  vat_number: string | null;
  vat_validated_at: string | null;
  tax_id_foreign: string | null;
  billing_email: string | null;
  billing_address: BillingProfile["billing_address"];
  approval_status: string;
  is_approved: boolean;
}

const REASON_LABEL: Record<string, string> = {
  missing_country: "Paese mancante",
  missing_address: "Indirizzo incompleto",
  missing_sdi_or_pec: "Manca codice destinatario o PEC",
  missing_codice_fiscale: "Manca codice fiscale (B2C IT)",
  incomplete_billing: "Dati incompleti",
};

/**
 * /dashboard/integrations/fattureincloud/incomplete
 *
 * Admin view of approved therapists whose billing data is missing or
 * insufficient — those would be skipped by the monthly cron with a
 * reason. We classify each by `resolveTaxMode()` and show the missing
 * piece so admin can chase the therapist (or fix manually).
 */
export default async function IncompleteBillingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The admin-dashboard layout already enforces admin auth via MFA.
  // No role check needed at the page level.

  const admin = createAdminClient();
  const { data: therapists } = await admin
    .from("therapist_profiles")
    .select(
      "id, display_name, country, p_iva, codice_fiscale, codice_destinatario, pec_email, " +
      "regime_forfettario, vat_number, vat_validated_at, tax_id_foreign, billing_email, " +
      "billing_address, approval_status, is_approved",
    )
    .eq("approval_status", "approved")
    .eq("is_approved", true);

  const rows = (therapists ?? []) as unknown as TherapistRow[];
  const classified = rows.map((t) => {
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
    return { therapist: t, ...resolveTaxMode(profile) };
  });

  const incomplete = classified.filter((c) => c.mode === "INCOMPLETE");
  const ok = classified.filter((c) => c.mode !== "INCOMPLETE");
  const byMode = new Map<TaxMode, number>();
  for (const c of ok) byMode.set(c.mode, (byMode.get(c.mode) ?? 0) + 1);

  return (
    <div className="space-y-6 p-6 max-w-5xl">
      <div>
        <Link
          href="/dashboard/integrations/fattureincloud"
          className="text-sm text-charcoal-muted hover:underline"
        >
          ← FattureInCloud
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-charcoal">
          Stato fatturazione terapisti
        </h1>
        <p className="mt-1 text-sm text-charcoal-muted">
          Pre-flight check prima del cron mensile. Terapisti con dati incompleti vengono saltati.
        </p>
      </div>

      {/* Summary by mode */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-error/20 bg-error/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-error">
            Incompleti
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-error">
            {incomplete.length}
          </p>
          <p className="mt-1 text-[10px] text-charcoal-muted">
            {incomplete.length > 0 ? "saltati al prossimo cron" : "tutto a posto"}
          </p>
        </div>
        {Array.from(byMode.entries()).map(([mode, count]) => (
          <div key={mode} className="rounded-2xl border border-berry/10 bg-white/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
              {describeMode(mode)}
            </p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal">
              {count}
            </p>
          </div>
        ))}
      </div>

      {/* Incomplete list */}
      {incomplete.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-charcoal-muted">
            Terapisti da contattare ({incomplete.length})
          </h2>
          <div className="overflow-hidden rounded-2xl border border-berry/10 bg-white/80">
            <table className="min-w-full divide-y divide-berry/5 text-sm">
              <thead className="bg-berry-subtle/30">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
                  <th className="px-4 py-2">Terapista</th>
                  <th className="px-4 py-2">Paese</th>
                  <th className="px-4 py-2">Motivo</th>
                  <th className="px-4 py-2">P.IVA / VAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-berry/5">
                {incomplete.map(({ therapist, reason }) => (
                  <tr key={therapist.id}>
                    <td className="px-4 py-3 font-medium text-charcoal">
                      {therapist.display_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-charcoal-light">
                      {(therapist.billing_address?.country ?? therapist.country ?? "—").toUpperCase()}
                    </td>
                    <td className="px-4 py-3 text-charcoal-light">
                      <span className="rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-medium text-error">
                        {REASON_LABEL[reason ?? ""] ?? reason ?? "incompleto"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-charcoal-muted">
                      {therapist.p_iva ?? therapist.vat_number ?? therapist.tax_id_foreign ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {incomplete.length === 0 && (
        <div className="rounded-2xl border border-success/30 bg-success/10 px-5 py-4 text-sm text-success">
          ✓ Tutti i terapisti approvati hanno dati di fatturazione validi per il prossimo cron.
        </div>
      )}
    </div>
  );
}
