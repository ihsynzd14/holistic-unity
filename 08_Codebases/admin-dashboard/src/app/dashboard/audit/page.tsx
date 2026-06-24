import { createAdminClient } from "@/lib/supabase/admin";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: string;
  admin_email: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export default async function AuditLogPage() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data as AuditRow[] | null) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <DisplayHeading>
          Audit Log
        </DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">
          Last 200 admin actions. Compliance + forensic trail (GDPR Art. 30).
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-error/20 bg-error/5 p-4 text-sm text-error">
          {error.message}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-12 text-center text-sm text-charcoal-muted">
          No admin actions logged yet. Approve or reject a therapist to see the trail start.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm">
          <div className="grid grid-cols-12 gap-2 border-b border-berry/5 bg-cream-dark/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
            <div className="col-span-3">When</div>
            <div className="col-span-3">Admin</div>
            <div className="col-span-2">Action</div>
            <div className="col-span-3">Target</div>
            <div className="col-span-1 text-right">IP</div>
          </div>
          <div className="divide-y divide-berry/5">
            {rows.map((row) => (
              <AuditRowItem key={row.id} row={row} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditRowItem({ row }: { row: AuditRow }) {
  const date = new Date(row.created_at);
  return (
    <div className="grid grid-cols-12 items-start gap-2 px-4 py-3 text-xs text-charcoal hover:bg-cream-dark/10">
      <div className="col-span-3 font-mono text-charcoal-muted">
        {date.toLocaleString("it-IT", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
      <div className="col-span-3 truncate">
        {row.admin_email ?? <span className="text-charcoal-muted">(deleted user)</span>}
      </div>
      <div className="col-span-2">
        <span className="rounded-full bg-berry-subtle px-2 py-0.5 text-[10px] font-semibold text-berry-dark">
          {row.action}
        </span>
      </div>
      <div className="col-span-3 truncate font-mono text-[11px] text-charcoal-muted">
        {row.target_table && row.target_id ? `${row.target_table}/${row.target_id.slice(0, 8)}` : "—"}
      </div>
      <div className="col-span-1 text-right font-mono text-[10px] text-charcoal-muted">
        {row.ip_address ?? "—"}
      </div>
      {row.details && Object.keys(row.details).length > 0 && (
        <div className="col-span-12 mt-1 ml-3 rounded-lg bg-cream-dark/30 px-2 py-1 font-mono text-[10px] text-charcoal-muted">
          {JSON.stringify(row.details)}
        </div>
      )}
    </div>
  );
}
