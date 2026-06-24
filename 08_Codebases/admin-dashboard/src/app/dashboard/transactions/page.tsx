import { createAdminClient } from "@/lib/supabase/admin";
import { RefundButton } from "./refund-button";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

const PAGE_SIZE = 50;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1"));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const supabase = createAdminClient();
  const { data: transactions, count } = await supabase.from("transactions").select("id, booking_id, amount, platform_fee, therapist_payout, service_fee, total_charged, commission_base, iva_amount, iva_applied, currency, status, payout_status, payout_after, stripe_payment_intent_id, created_at, client:client_id(display_name), therapist:therapist_id(display_name), booking:booking_id(service_name)", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);
  const completed = (transactions || []).filter((t) => t.status === "completed");
  const totalVolume = completed.reduce((sum, t) => sum + (Number(t.total_charged) || t.amount || 0), 0);
  const totalCommission = completed.reduce((sum, t) => sum + (Number(t.commission_base) || t.platform_fee || 0), 0);
  const totalServiceFees = completed.reduce((sum, t) => sum + (Number(t.service_fee) || 0), 0);
  const totalIVA = completed.reduce((sum, t) => sum + (Number(t.iva_amount) || 0), 0);

  return (
    <div>
      <DisplayHeading>Transactions</DisplayHeading>
      <p className="mt-1 text-sm text-charcoal-muted">Payment history and revenue breakdown</p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Total Volume" value={`\u20AC${totalVolume.toFixed(2)}`} accent="berry" />
        <MiniStat label="Platform Commission" value={`\u20AC${totalCommission.toFixed(2)}`} accent="gold" />
        <MiniStat label="Service Fees" value={`\u20AC${totalServiceFees.toFixed(2)}`} accent="success" />
        <MiniStat label="IVA Withheld" value={`\u20AC${totalIVA.toFixed(2)}`} accent="info" />
      </div>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm">
        <table className="min-w-full divide-y divide-berry/5">
          <thead className="bg-cream-dark/50">
            <tr>
              <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Date</th>
              <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Service</th>
              <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Client</th>
              <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Therapist</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Client Paid</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Service Fee</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Commission</th>
              <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Therapist Payout</th>
              <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Status</th>
              <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Payout</th>
              <th className="px-4 py-3.5 text-center text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-berry/5">
            {(transactions || []).map((tx: any) => {
              const curr = tx.currency === "usd" ? "$" : tx.currency === "gbp" ? "\u00A3" : tx.currency === "brl" ? "R$" : "\u20AC";
              return (
              <tr key={tx.id} className="transition-colors hover:bg-berry-subtle/10">
                <td className="whitespace-nowrap px-4 py-3.5 text-sm text-charcoal-muted">{new Date(tx.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}</td>
                <td className="max-w-[140px] truncate px-4 py-3.5 text-sm text-charcoal">{(tx.booking as any)?.service_name || "\u2014"}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-sm text-charcoal-light">{(tx.client as any)?.display_name || "\u2014"}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-sm text-charcoal-light">{(tx.therapist as any)?.display_name || "\u2014"}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm font-semibold text-charcoal">{curr}{(Number(tx.total_charged) || tx.amount || 0).toFixed(2)}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm text-charcoal-muted">{curr}{(Number(tx.service_fee) || 0).toFixed(2)}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm font-semibold text-berry">{curr}{(Number(tx.commission_base) || tx.platform_fee || 0).toFixed(2)}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm text-charcoal-light">{curr}{(tx.therapist_payout || 0).toFixed(2)}</td>
                <td className="whitespace-nowrap px-4 py-3.5"><TxBadge status={tx.status} /></td>
                <td className="whitespace-nowrap px-4 py-3.5"><PayBadge status={tx.payout_status} /></td>
                <td className="whitespace-nowrap px-4 py-3.5 text-center"><RefundButton transactionId={tx.id} status={tx.status} amount={tx.amount} /></td>
              </tr>
              );
            })}
            {(!transactions || transactions.length === 0) && <tr><td colSpan={11} className="px-4 py-12 text-center text-sm text-charcoal-muted">No transactions yet</td></tr>}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {page > 1 && (
            <a href={`/dashboard/transactions?page=${page - 1}`} className="rounded-xl border border-berry/10 px-3 py-1.5 text-sm font-medium text-charcoal-muted hover:bg-berry-subtle/30 transition-all">Previous</a>
          )}
          <span className="text-sm text-charcoal-muted">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`/dashboard/transactions?page=${page + 1}`} className="rounded-xl border border-berry/10 px-3 py-1.5 text-sm font-medium text-charcoal-muted hover:bg-berry-subtle/30 transition-all">Next</a>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  const accents: Record<string, string> = { berry: "border-l-berry", gold: "border-l-gold", success: "border-l-success", info: "border-l-info" };
  return (
    <div className={`rounded-2xl border border-berry/5 ${accents[accent] || ""} border-l-4 bg-white/70 p-4 shadow-sm backdrop-blur-sm`}>
      <p className="text-xs font-medium text-charcoal-muted">{label}</p>
      <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">{value}</p>
    </div>
  );
}

function TxBadge({ status }: { status: string }) {
  const s: Record<string, string> = { pending: "bg-warning-light text-gold-dark", processing: "bg-info-light text-info", completed: "bg-success-light text-success", failed: "bg-error-light text-error", refunded: "bg-cream-dark text-charcoal-muted", partially_refunded: "bg-warning-light text-gold-dark" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s[status] || "bg-cream-dark text-charcoal-muted"}`}>{(status || "").replace(/_/g, " ")}</span>;
}

function PayBadge({ status }: { status: string }) {
  const s: Record<string, string> = { pending: "bg-warning-light/50 text-gold-dark", paid: "bg-success-light text-success", failed: "bg-error-light text-error", failed_no_account: "bg-error-light text-error" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s[status] || "bg-cream-dark text-charcoal-muted"}`}>{(status || "").replace(/_/g, " ")}</span>;
}
