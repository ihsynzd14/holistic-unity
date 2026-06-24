import { createAdminClient } from "@/lib/supabase/admin";
import { CancelBookingButton } from "./cancel-button";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

const PAGE_SIZE = 50;

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const params = await searchParams;
  const sf = params.status || "all";
  const page = Math.max(1, parseInt(params.page || "1"));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const supabase = createAdminClient();
  // `format` column was dropped on 2026-04-16 (all sessions are virtual
  // now). Selecting it caused PostgREST to 400 the entire query, which
  // made the table render empty for the admin.
  let query = supabase.from("bookings").select("id, service_name, duration, price, platform_fee, therapist_payout, status, scheduled_at, created_at, client:client_id(display_name, email), therapist:therapist_id(display_name)", { count: "exact" }).order("scheduled_at", { ascending: false }).range(from, to);
  if (sf !== "all") query = query.eq("status", sf);
  const { data: bookings, count } = await query;
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);
  const statuses = ["all", "pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"];

  return (
    <div>
      <DisplayHeading>Bookings</DisplayHeading>
      <p className="mt-1 text-sm text-charcoal-muted">All sessions on the platform</p>
      <div className="mt-6 flex flex-wrap gap-1.5 rounded-2xl bg-white/60 p-1.5 backdrop-blur-sm border border-berry/5 shadow-sm w-fit">
        {statuses.map((s) => (
          <a key={s} href={s === "all" ? "/dashboard/bookings" : `/dashboard/bookings?status=${s}`}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ${sf === s ? "bg-berry text-white shadow-md shadow-berry/15" : "text-charcoal-muted hover:text-charcoal hover:bg-berry-subtle/30"}`}>
            {s === "all" ? "All" : s.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
          </a>
        ))}
      </div>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm">
        <table className="min-w-full divide-y divide-berry/5">
          <thead className="bg-cream-dark/50">
            <tr>
              <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Service</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Client</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Therapist</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Date</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Price</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Status</th>
              <th className="px-5 py-3.5 text-center text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-berry/5">
            {(bookings || []).map((b: any) => (
              <tr key={b.id} className="transition-colors hover:bg-berry-subtle/10">
                <td className="whitespace-nowrap px-5 py-4"><p className="text-sm font-semibold text-charcoal">{b.service_name || "Session"}</p><p className="text-xs text-charcoal-muted">{b.duration} min</p></td>
                <td className="whitespace-nowrap px-5 py-4 text-sm text-charcoal-light">{(b.client as any)?.display_name || "\u2014"}</td>
                <td className="whitespace-nowrap px-5 py-4 text-sm text-charcoal-light">{(b.therapist as any)?.display_name || "\u2014"}</td>
                <td className="whitespace-nowrap px-5 py-4 text-sm text-charcoal-muted">{new Date(b.scheduled_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold text-charcoal">{"\u20AC"}{(b.price || 0).toFixed(2)}</td>
                <td className="whitespace-nowrap px-5 py-4"><StatusBadge status={b.status} /></td>
                <td className="whitespace-nowrap px-5 py-4 text-center"><CancelBookingButton bookingId={b.id} status={b.status} /></td>
              </tr>
            ))}
            {(!bookings || bookings.length === 0) && <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-charcoal-muted">No bookings found</td></tr>}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {page > 1 && (
            <a href={`/dashboard/bookings?status=${sf}&page=${page - 1}`} className="rounded-xl border border-berry/10 px-3 py-1.5 text-sm font-medium text-charcoal-muted hover:bg-berry-subtle/30 transition-all">Previous</a>
          )}
          <span className="text-sm text-charcoal-muted">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`/dashboard/bookings?status=${sf}&page=${page + 1}`} className="rounded-xl border border-berry/10 px-3 py-1.5 text-sm font-medium text-charcoal-muted hover:bg-berry-subtle/30 transition-all">Next</a>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, string> = { pending: "bg-warning-light text-gold-dark", confirmed: "bg-info-light text-info", in_progress: "bg-berry-subtle text-berry", completed: "bg-success-light text-success", cancelled: "bg-error-light text-error", no_show: "bg-cream-dark text-charcoal-muted", reschedule_pending: "bg-warning-light text-gold-dark" };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s[status] || "bg-cream-dark text-charcoal-muted"}`}>{(status || "").replace(/_/g, " ")}</span>;
}
