import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { DisplayHeading } from "@/components/ui/DisplayHeading";
import TierRequestActions from "./tier-request-actions";

type Row = {
  id: string;
  display_name: string | null;
  photo_url: string | null;
  tagline: string | null;
  city: string | null;
  country: string | null;
  tier: "practitioner" | "trainer" | "supervisor" | null;
  requested_tier: "practitioner" | "trainer" | "supervisor" | null;
  years_experience: number | null;
  created_at: string | null;
};

const TIER_LABEL: Record<string, string> = {
  practitioner: "Practitioner",
  trainer: "Trainer",
  supervisor: "Supervisor",
};

/**
 * Admin queue page — every therapist with tier_request_status='pending'.
 * Sorted oldest first so the review queue is FIFO. Each row links to
 * the existing therapist detail page (which shows uploaded
 * certifications) and exposes Approve / Reject buttons that hit the
 * `/api/admin/tier-requests/[id]` route.
 */
export default async function TierRequestsPage() {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("therapist_profiles")
    .select(
      "id, display_name, photo_url, tagline, city, country, tier, requested_tier, years_experience, created_at",
    )
    .eq("tier_request_status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[tier-requests page] query failed:", error);
  }

  const pending = (data as Row[] | null) ?? [];

  return (
    <div>
      <DisplayHeading>Tier Requests</DisplayHeading>
      <p className="mt-1 text-sm text-charcoal-muted">
        Therapists who self-declared a tier in onboarding and are awaiting verification.
        Approving flips their public badge; rejecting leaves them at their current tier.
      </p>

      <div className="mt-6 space-y-3">
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-berry/5 bg-white/70 py-16 text-center backdrop-blur-sm">
            <p className="text-sm text-charcoal-muted">No pending tier requests.</p>
          </div>
        ) : (
          pending.map((t, i) => (
            <div
              key={t.id}
              className="flex items-start gap-4 rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm animate-reveal"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-berry-subtle to-berry-muted/30 text-lg font-bold text-berry-dark">
                {t.display_name?.[0]?.toUpperCase() || "?"}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-charcoal">
                  {t.display_name || "Unknown"}
                </p>
                {t.tagline && (
                  <p className="mt-0.5 truncate text-sm text-charcoal-muted">
                    {t.tagline}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal-muted">
                  <span>
                    Current:{" "}
                    <strong className="text-charcoal">
                      {t.tier ? TIER_LABEL[t.tier] : "—"}
                    </strong>
                  </span>
                  <span className="text-berry">→</span>
                  <span>
                    Requested:{" "}
                    <strong className="text-charcoal">
                      {t.requested_tier ? TIER_LABEL[t.requested_tier] : "—"}
                    </strong>
                  </span>
                  {t.years_experience !== null && (
                    <span>{t.years_experience} years experience</span>
                  )}
                  {(t.city || t.country) && (
                    <span>{[t.city, t.country].filter(Boolean).join(", ")}</span>
                  )}
                </div>
                <Link
                  href={`/dashboard/therapists/${t.id}`}
                  className="mt-3 inline-block text-xs font-medium text-berry hover:text-berry-dark"
                >
                  View profile &amp; certifications &rarr;
                </Link>
              </div>

              <TierRequestActions therapistId={t.id} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
