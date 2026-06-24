import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

export default async function TherapistsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const statusFilter = params.status || "all";
  const supabase = createAdminClient();

  const { data: allTherapists } = await supabase
    .from("therapist_profiles")
    .select("id, display_name, photo_url, tagline, categories, approval_status, is_verified, average_rating, total_reviews, city, country, created_at, stripe_account_status")
    .order("created_at", { ascending: false });

  const all = allTherapists || [];
  const counts: Record<string, number> = {
    all: all.length,
    pending_review: all.filter((t) => t.approval_status === "pending_review").length,
    approved: all.filter((t) => t.approval_status === "approved").length,
    draft: all.filter((t) => t.approval_status === "draft").length,
    changes_requested: all.filter((t) => t.approval_status === "changes_requested").length,
  };
  const display = statusFilter === "all" ? all : all.filter((t) => t.approval_status === statusFilter);

  return (
    <div>
      <DisplayHeading>Therapists</DisplayHeading>
      <p className="mt-1 text-sm text-charcoal-muted">Manage therapist applications and profiles</p>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-2xl bg-white/60 p-1.5 backdrop-blur-sm border border-berry/5 shadow-sm">
        {(["all", "pending_review", "approved", "draft", "changes_requested"] as const).map((status) => {
          const labels: Record<string, string> = { all: "All", pending_review: "Pending", approved: "Approved", draft: "Draft", changes_requested: "Changes" };
          const isActive = statusFilter === status;
          return (
            <Link key={status}
              href={status === "all" ? "/dashboard/therapists" : `/dashboard/therapists?status=${status}`}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                isActive ? "bg-berry text-white shadow-md shadow-berry/15" : "text-charcoal-muted hover:text-charcoal hover:bg-berry-subtle/30"
              }`}
            >
              {labels[status]}
              {counts[status] > 0 && (
                <span className={`ml-1.5 text-xs ${isActive ? "text-white/70" : "text-charcoal-muted/60"}`}>
                  {counts[status]}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* List */}
      <div className="mt-6 space-y-3">
        {display.length === 0 ? (
          <div className="rounded-2xl border border-berry/5 bg-white/70 py-16 text-center backdrop-blur-sm">
            <p className="text-sm text-charcoal-muted">No therapists in this category</p>
          </div>
        ) : (
          display.map((t: any, i: number) => (
            <Link key={t.id} href={`/dashboard/therapists/${t.id}`}
              className="flex items-center gap-4 rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 hover:border-berry/10 animate-reveal"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-berry-subtle to-berry-muted/30 text-lg font-bold text-berry-dark">
                {t.display_name?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-charcoal">{t.display_name || "Unknown"}</p>
                  {t.is_verified && (
                    <svg className="h-4 w-4 text-berry" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-charcoal-muted">{t.tagline || "No tagline"}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(t.categories || []).slice(0, 3).map((cat: string) => (
                    <span key={cat} className="rounded-full bg-berry-subtle/50 px-2.5 py-0.5 text-xs font-medium text-berry-dark">{cat}</span>
                  ))}
                </div>
              </div>
              <div className="hidden text-right sm:block">
                {t.total_reviews > 0 && (
                  <div className="flex items-center gap-1 text-sm">
                    <svg className="h-4 w-4 text-star" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z" clipRule="evenodd" /></svg>
                    <span className="font-semibold text-charcoal">{t.average_rating?.toFixed(1)}</span>
                  </div>
                )}
                <p className="mt-1 text-xs text-charcoal-muted">{new Date(t.created_at).toLocaleDateString("it-IT")}</p>
              </div>
              <ApprovalBadge status={t.approval_status} />
              <svg className="h-5 w-5 text-charcoal-muted/30" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function ApprovalBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending_review: "bg-warning-light text-gold-dark border-gold/20",
    approved: "bg-success-light text-success border-success/20",
    draft: "bg-cream-dark text-charcoal-muted border-charcoal/5",
    changes_requested: "bg-error-light text-error border-error/20",
  };
  const labels: Record<string, string> = { pending_review: "Pending", approved: "Approved", draft: "Draft", changes_requested: "Changes" };
  return (
    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${styles[status] || styles.draft}`}>
      {labels[status] || status}
    </span>
  );
}
