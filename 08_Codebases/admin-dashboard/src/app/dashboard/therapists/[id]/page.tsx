import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import ApprovalActions from "./approval-actions";
import { Card } from "@/components/ui/Card";

export default async function TherapistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { data: profile, error } = await supabase.from("therapist_profiles").select("*").eq("id", id).single();
  if (!profile || error) notFound();

  const [{ data: user }, { data: services }, { data: certifications }, { data: reviews }, { data: reliabilityRows }, { data: recentCancels }] = await Promise.all([
    supabase.from("users").select("email, display_name, phone_number, auth_provider, created_at").eq("id", id).single(),
    supabase.from("therapist_services").select("*").eq("therapist_id", id).order("created_at"),
    supabase.from("certifications").select("*").eq("therapist_id", id).order("year_obtained", { ascending: false }),
    supabase.from("reviews").select("id, rating, text, client_name, created_at").eq("therapist_id", id).order("created_at", { ascending: false }).limit(5),
    // Live reliability via the SQL function — uses actual bookings,
    // not the materialized view, so the admin always sees the latest
    // numbers when they're investigating a complaint.
    supabase.rpc("get_therapist_reliability", { p_therapist_id: id }),
    supabase
      .from("bookings")
      .select("id, scheduled_at, cancelled_at, cancellation_notice_hrs, cancellation_category, cancellation_reason")
      .eq("therapist_id", id)
      .eq("cancelled_by", "therapist")
      .order("cancelled_at", { ascending: false })
      .limit(10),
  ]);

  const reliability = reliabilityRows?.[0] as
    | { cancellation_rate_30d: number; reliability_tier: string; total_bookings_30d: number; cancellations_30d: number }
    | undefined;

  const statusStyles: Record<string, string> = {
    pending_review: "bg-warning-light text-gold-dark", approved: "bg-success-light text-success",
    draft: "bg-cream-dark text-charcoal-muted", changes_requested: "bg-error-light text-error",
  };
  const statusLabels: Record<string, string> = {
    pending_review: "Pending Review", approved: "Approved", draft: "Draft", changes_requested: "Changes Requested",
  };

  return (
    <div className="mx-auto max-w-4xl">
      <a href="/dashboard/therapists" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-berry-muted hover:text-berry transition-colors">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        Back to Therapists
      </a>

      {/* Header */}
      <Card>
        <div className="flex items-start gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-berry-subtle to-berry-muted/30 text-2xl font-bold text-berry-dark">
            {profile.display_name?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">{profile.display_name}</h1>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[profile.approval_status] || statusStyles.draft}`}>
                {statusLabels[profile.approval_status] || profile.approval_status}
              </span>
            </div>
            <p className="mt-1 text-charcoal-muted">{profile.tagline || "No tagline"}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-charcoal-muted">
              {user?.email && <span className="flex items-center gap-1.5"><svg className="h-4 w-4 text-berry-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>{user.email}</span>}
              {profile.city && <span className="flex items-center gap-1.5"><svg className="h-4 w-4 text-berry-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>{profile.city}{profile.country ? `, ${profile.country}` : ""}</span>}
              <span className="flex items-center gap-1.5"><svg className="h-4 w-4 text-berry-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{profile.years_experience} years</span>
            </div>
          </div>
        </div>
        <ApprovalActions therapistId={id} currentStatus={profile.approval_status} isVerified={profile.is_verified} />
      </Card>

      {/* Contact info — prominent so admin can reach the therapist
          before approving (request more info, verify identity, etc.).
          Clickable mailto: + tel: links for one-click action. */}
      <div className="mt-6 rounded-2xl border border-berry/15 bg-berry-subtle/20 p-6 shadow-sm backdrop-blur-sm">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">
          Contatti per la verifica
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ContactRow
            label="Email"
            value={user?.email}
            href={user?.email ? `mailto:${user.email}` : undefined}
            iconPath="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
          <ContactRow
            label="Telefono"
            value={user?.phone_number}
            href={user?.phone_number ? `tel:${user.phone_number}` : undefined}
            iconPath="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
          />
          <ContactRow
            label="Registrato il"
            value={
              user?.created_at
                ? new Date(user.created_at).toLocaleDateString("it-IT", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : undefined
            }
            iconPath="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
          />
          <ContactRow
            label="Metodo di accesso"
            value={user?.auth_provider === "google" ? "Google" : "Email + password"}
            iconPath="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          />
          <ContactRow
            label="ID utente"
            value={profile.id}
            mono
            iconPath="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
          />
          {profile.vat_number && (
            <ContactRow
              label="P.IVA / Codice Fiscale"
              value={profile.vat_number}
              mono
              iconPath="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
            />
          )}
        </div>
      </div>

      {/* Reliability — therapist-initiated cancellations + rate, used
          to spot abusive patterns before suspending the account.
          The tier is computed live by the get_therapist_reliability
          function; thresholds: 10% warning, 20% high, 30% critical. */}
      {reliability && (
        <Card className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">
              Affidabilità (ultimi 30 giorni)
            </h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                reliability.reliability_tier === "critical"
                  ? "bg-error-light text-error"
                  : reliability.reliability_tier === "high"
                  ? "bg-error-light text-error"
                  : reliability.reliability_tier === "warning"
                  ? "bg-warning-light text-gold-dark"
                  : "bg-success-light text-success"
              }`}
            >
              {reliability.reliability_tier === "critical" && "Critical (>30%)"}
              {reliability.reliability_tier === "high" && "High (>20%)"}
              {reliability.reliability_tier === "warning" && "Warning (>10%)"}
              {reliability.reliability_tier === "ok" && "OK"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
            <div className="rounded-xl bg-cream/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">
                Cancellation rate
              </p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
                {Number(reliability.cancellation_rate_30d).toFixed(2)}%
              </p>
            </div>
            <div className="rounded-xl bg-cream/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">
                Cancellate
              </p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-error">
                {reliability.cancellations_30d}
              </p>
            </div>
            <div className="rounded-xl bg-cream/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">
                Sessioni totali (30gg)
              </p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
                {reliability.total_bookings_30d}
              </p>
            </div>
          </div>

          {recentCancels && recentCancels.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-charcoal-muted">
                Cancellazioni recenti
              </p>
              <div className="space-y-2">
                {recentCancels.map((c) => (
                  <div key={c.id} className="rounded-xl bg-cream/60 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-charcoal">
                        {c.cancelled_at
                          ? new Date(c.cancelled_at).toLocaleString("it-IT", {
                              day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                            })
                          : "(no timestamp)"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          (c.cancellation_notice_hrs ?? 99) < 24
                            ? "bg-error-light text-error"
                            : "bg-info-light text-info"
                        }`}
                      >
                        {(c.cancellation_notice_hrs ?? 0) < 0
                          ? "ritardo"
                          : `preavviso ${c.cancellation_notice_hrs ?? 0}h`}
                      </span>
                    </div>
                    <p className="mt-1 text-charcoal-muted">
                      <span className="font-medium">{c.cancellation_category || "—"}</span>
                      {c.cancellation_reason && <> — {c.cancellation_reason}</>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Content */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Bio"><p className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal-light">{profile.bio || "No bio provided"}</p></Section>

        <Section title="Specializations">
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Categories</p>
              <div className="flex flex-wrap gap-1.5">
                {(profile.categories || []).length > 0 ? profile.categories.map((c: string) => (
                  <span key={c} className="rounded-full bg-berry-subtle/60 px-3 py-1 text-xs font-medium text-berry-dark">{c}</span>
                )) : <span className="text-sm text-charcoal-muted">None</span>}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Languages</p>
              <div className="flex flex-wrap gap-1.5">
                {(profile.languages || []).map((l: string) => (
                  <span key={l} className="rounded-full bg-info-light px-3 py-1 text-xs font-medium text-info">{l}</span>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title={`Services (${services?.length || 0})`}>
          {!services?.length ? <p className="text-sm text-charcoal-muted">No services listed</p> : (
            <div className="space-y-2.5">{services.map((s: any) => (
              <div key={s.id} className="rounded-xl bg-cream/80 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-charcoal">{s.name}</p>
                  <p className="font-[family-name:var(--font-display)] text-lg font-bold text-berry">{"\u20AC"}{s.price}</p>
                </div>
                <p className="mt-0.5 text-xs text-charcoal-muted">{s.duration} min &middot; {s.format} &middot; {s.category}</p>
              </div>
            ))}</div>
          )}
        </Section>

        <Section title={`Certifications (${certifications?.length || 0})`}>
          {!certifications?.length ? <p className="text-sm text-charcoal-muted">No certifications</p> : (
            <div className="space-y-2.5">{certifications.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl bg-cream/80 p-3.5">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.is_verified ? "bg-success-light" : "bg-cream-dark"}`}>
                  <svg className={`h-5 w-5 ${c.is_verified ? "text-success" : "text-charcoal-muted"}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342" /></svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-charcoal">{c.name}</p>
                  <p className="text-xs text-charcoal-muted">{c.issuing_organization} &middot; {c.year_obtained}</p>
                </div>
                {c.is_verified && <span className="rounded-full bg-success-light px-2.5 py-0.5 text-xs font-semibold text-success">Verified</span>}
              </div>
            ))}</div>
          )}
        </Section>

        <Section title="Stripe Connect">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${profile.stripe_account_status === "active" ? "bg-success-light" : "bg-cream-dark"}`}>
              <svg className={`h-5 w-5 ${profile.stripe_account_status === "active" ? "text-success" : "text-charcoal-muted"}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-charcoal capitalize">{(profile.stripe_account_status || "not_connected").replace(/_/g, " ")}</p>
              {profile.stripe_connected_account_id && <p className="text-xs text-charcoal-muted font-mono">{profile.stripe_connected_account_id}</p>}
            </div>
          </div>
        </Section>

        <Section title={`Reviews (${profile.total_reviews})`}>
          {!reviews?.length ? <p className="text-sm text-charcoal-muted">No reviews yet</p> : (
            <div className="space-y-2.5">{reviews.map((r: any) => (
              <div key={r.id} className="rounded-xl bg-cream/80 p-3.5">
                <div className="flex items-center gap-2">
                  <div className="flex">{Array.from({ length: 5 }).map((_, i) => (
                    <svg key={i} className={`h-3.5 w-3.5 ${i < r.rating ? "text-star" : "text-charcoal-muted/20"}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z" clipRule="evenodd" /></svg>
                  ))}</div>
                  <span className="text-xs text-charcoal-muted">{r.client_name}</span>
                </div>
                {r.text && <p className="mt-1.5 text-sm text-charcoal-light">{r.text}</p>}
              </div>
            ))}</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">{title}</h2>
      {children}
    </Card>
  );
}

/**
 * Single row in the "Contatti per la verifica" panel. Renders an icon
 * + label + value. If `href` is provided the value becomes a clickable
 * link (mailto: / tel:) so the admin can contact the therapist with one
 * click. `mono` switches to monospace for IDs / VAT numbers.
 */
function ContactRow({
  label,
  value,
  href,
  iconPath,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  href?: string;
  iconPath: string;
  mono?: boolean;
}) {
  const display = value && value.length > 0 ? value : "—";
  const valueClass = `text-sm ${mono ? "font-mono text-xs" : "font-medium"} ${
    value ? "text-charcoal" : "text-charcoal-muted italic"
  } break-all`;

  return (
    <div className="flex items-start gap-3 rounded-xl bg-white/60 p-3.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-berry-subtle/60 text-berry">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">{label}</p>
        {href && value ? (
          <a href={href} className={`${valueClass} text-berry hover:text-berry-dark hover:underline transition-colors`}>
            {display}
          </a>
        ) : (
          <p className={valueClass}>{display}</p>
        )}
      </div>
    </div>
  );
}
