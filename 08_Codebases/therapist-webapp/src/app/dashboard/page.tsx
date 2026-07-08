"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { Calendar, TrendingUp, Star, Users, Clock, ArrowUpRight, Video, CreditCard, AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { isJoinWindowOpen } from "@/lib/booking/join-window";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

function KPICard({
  icon: Icon,
  label,
  value,
  sub,
  color = "berry",
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
  delay: number;
}) {
  const colors: Record<string, string> = {
    berry: "bg-berry-subtle text-berry",
    gold: "bg-[#F9F0DF] text-gold-dark",
    success: "bg-success-light text-success",
    info: "bg-info-light text-info",
  };

  return (
    <div
      className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between">
        <div className={`rounded-xl p-2.5 ${colors[color]}`}>
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </div>
        {sub && (
          <span className="flex items-center gap-0.5 text-xs font-medium text-success">
            <ArrowUpRight className="h-3 w-3" />
            {sub}
          </span>
        )}
      </div>
      <p className="mt-4 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-charcoal-muted">{label}</p>
    </div>
  );
}

type Profile = {
  approval_status: string;
  average_rating: number;
  total_reviews: number;
  display_name: string | null;
  stripe_account_status: string | null;
  stripe_connected_account_id: string | null;
};

type Booking = {
  id: string;
  scheduled_at: string;
  status: string;
  service_name: string;
  users: { display_name: string } | null;
};

export default function DashboardPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [monthlyEarnings, setMonthlyEarnings] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [currSymbol, setCurrSymbol] = useState("\u20AC");
  const [referenceDate] = useState(() => new Date());

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Fetch therapist profile (now also pulls availability for the
      // capacity panel below).
      //
      // We read from `my_therapist_profile` instead of the base table
      // because the base table has column-level grants that restrict
      // which fields anon/authenticated can SELECT (a privacy fix
      // applied during launch hardening to stop the public from
      // reading `stripe_connected_account_id`, `vat_number`, etc.).
      // `my_therapist_profile` is a security-definer view that returns
      // ALL columns of the caller's own row only — built specifically
      // so therapists can read their own complete profile via `*`
      // without weakening the public-read protection.
      const { data: profileData } = await supabase
        .from("my_therapist_profile")
        .select("*")
        .eq("id", user.id)
        .single();
      // The display_name lives on therapist_profiles itself (denormalized
      // from users), so we don't need the embedded join anymore.
      setProfile(profileData as Profile | null);
      // Derive currency symbol from profile
      const currency = (profileData as Record<string, unknown>)?.currency as string || "eur";
      const sym = currency === "usd" ? "$" : currency === "gbp" ? "\u00A3" : currency === "brl" ? "R$" : "\u20AC";
      setCurrSymbol(sym);

      // Fetch upcoming bookings
      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("id, scheduled_at, status, service_name, users!bookings_client_id_fkey(display_name)")
        .eq("therapist_id", user.id)
        .eq("status", "confirmed")
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(5);
      setUpcomingBookings((bookingsData as Booking[] | null) || []);

      // Fetch earnings this month
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      firstOfMonth.setHours(0, 0, 0, 0);
      const { data: monthlyTx } = await supabase
        .from("transactions")
        .select("therapist_payout")
        .eq("therapist_id", user.id)
        .eq("status", "completed")
        .gte("created_at", firstOfMonth.toISOString());

      setMonthlyEarnings((monthlyTx || []).reduce((sum, tx) => sum + ((tx as Record<string, number>).therapist_payout || 0), 0));
      setTotalSessions((monthlyTx || []).length);

      // Fetch pending booking requests
      const { data: pendingBookings } = await supabase
        .from("bookings")
        .select("id")
        .eq("therapist_id", user.id)
        .eq("status", "pending")
        .limit(10);
      setPendingCount(pendingBookings?.length || 0);

      setLoading(false);
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  // display_name lives on therapist_profiles itself (kept in sync with
  // users.display_name by app code on register/profile-edit).
  const firstName =
    profile?.display_name?.split(" ")[0] || t.dashboard.therapist;
  const rating = profile?.average_rating || 0;
  const totalReviews = profile?.total_reviews || 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-reveal">
        <DisplayHeading>
          {t.dashboard.hello}, {firstName}
        </DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">
          {t.dashboard.activitySummary}
        </p>
      </div>

      {/* Approval status banner */}
      {profile?.approval_status !== "approved" && (
        <div
          className="animate-reveal rounded-2xl border border-warning/30 bg-warning-light/60 p-5"
          style={{ animationDelay: "40ms" }}
        >
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 text-warning" />
            <div>
              <p className="font-semibold text-charcoal">{t.dashboard.profileInReview}</p>
              <p className="mt-0.5 text-sm text-charcoal-light">
                {profile?.approval_status === "changes_requested"
                  ? t.dashboard.changesRequested
                  : t.dashboard.reviewPending}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stripe-not-active banner. Shown to APPROVED therapists whose
          Stripe Connect account isn't `active` — without an active
          Connect account, paid bookings are silently hidden from the
          client-side browse (see applyClientVisibilityFilters + the
          therapist_profiles_public view). Previously the only signal
          was a small hint on /dashboard/settings; several therapists
          don't find it until a client asks why they can't book.
          The banner is dismiss-resistant (no X button) — Stripe
          activation is required, not optional. */}
      {profile?.approval_status === "approved" &&
        profile?.stripe_account_status !== "active" && (
          <Link
            href="/dashboard/settings"
            className="group animate-reveal block rounded-2xl border border-error/30 bg-error/5 p-5 shadow-sm transition-all hover:shadow-md hover:border-error/40"
            style={{ animationDelay: "60ms" }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="mt-0.5 h-5 w-5 flex-shrink-0 text-error"
                strokeWidth={1.75}
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-charcoal">
                  {t.dashboard.stripeNotActiveTitle ??
                    "Completa la configurazione dei pagamenti"}
                </p>
                <p className="mt-0.5 text-sm text-charcoal-light">
                  {profile?.stripe_account_status === "onboarding_pending" ||
                  profile?.stripe_account_status === null ||
                  profile?.stripe_account_status === undefined
                    ? (t.dashboard.stripeNotActiveBodyPending ??
                      "Il tuo profilo è approvato, ma finché non completi l'onboarding Stripe non puoi ricevere prenotazioni a pagamento e non appari nei risultati di ricerca.")
                    : (t.dashboard.stripeNotActiveBodyRestricted ??
                      "Stripe richiede ulteriori informazioni per attivare i pagamenti. Apri Stripe per completare ciò che manca.")}
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 flex-shrink-0 self-center text-error transition-transform group-hover:translate-x-1"
              />
            </div>
          </Link>
        )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard
          icon={TrendingUp}
          label={t.dashboard.totalEarnings}
          value={`${currSymbol}${monthlyEarnings.toFixed(2)}`}
          color="gold"
          delay={80}
        />
        <KPICard
          icon={Calendar}
          label={t.dashboard.completedSessions}
          value={String(totalSessions)}
          color="berry"
          delay={120}
        />
        <KPICard
          icon={Users}
          label={t.dashboard.pendingBookings}
          value={String(pendingCount)}
          color="info"
          delay={160}
        />
        <KPICard
          icon={Star}
          label={t.dashboard.averageRating}
          value={rating > 0 ? `${rating.toFixed(1)} / 5` : "\u2014"}
          sub={totalReviews > 0 ? `${totalReviews} ${t.dashboard.reviews}` : undefined}
          color="success"
          delay={200}
        />
      </div>

      {/* Decorative divider */}
      <div className="mx-auto h-px w-1/2 bg-gradient-to-r from-transparent via-berry/10 to-transparent" />

      {/* Upcoming bookings */}
      <div className="animate-reveal" style={{ animationDelay: "240ms" }}>
        <DisplayHeading as="h2" size="md">
          {t.dashboard.upcomingSessions}
        </DisplayHeading>

        {(!upcomingBookings || upcomingBookings.length === 0) ? (
          <div className="mt-4 rounded-2xl border border-berry/5 bg-white/50 p-8 text-center">
            <Calendar className="mx-auto h-10 w-10 text-berry-muted/50" strokeWidth={1} />
            <p className="mt-3 text-sm text-charcoal-muted">{t.dashboard.noUpcomingSessions}</p>
            <p className="mt-1 text-xs text-charcoal-muted/70">{t.dashboard.newBookingsHere}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {upcomingBookings.map((booking, i) => {
              const date = new Date(booking.scheduled_at);
              const tomorrow = new Date(referenceDate);
              tomorrow.setDate(tomorrow.getDate() + 1);
              const isToday = date.toDateString() === referenceDate.toDateString();
              const isTomorrow = date.toDateString() === tomorrow.toDateString();

              return (
                <div
                  key={booking.id}
                  className="animate-reveal flex items-center gap-4 rounded-2xl border border-berry/5 bg-white/70 p-4 shadow-sm backdrop-blur-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                  style={{ animationDelay: `${280 + i * 40}ms` }}
                >
                  {/* Date badge */}
                  <div className={`flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl ${
                    isToday ? "bg-berry text-white" : "bg-berry-subtle text-berry"
                  }`}>
                    <span className="text-[10px] font-semibold uppercase">
                      {isToday ? t.dashboard.today : isTomorrow ? t.dashboard.tomorrow : date.toLocaleDateString("it-IT", { month: "short", timeZone: "Europe/Rome" })}
                    </span>
                    <span className="text-lg font-bold leading-none">
                      {isToday || isTomorrow ? date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }) : date.getDate()}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-charcoal truncate">
                      {booking.users && typeof booking.users === "object"
                        ? (booking.users as { display_name: string }).display_name
                        : t.dashboard.client}
                    </p>
                    <p className="text-xs text-charcoal-muted truncate">
                      {booking.service_name || t.dashboard.session} &middot;{" "}
                      {date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" })}
                      {` ${t.dashboard.at} `}
                      {date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}
                    </p>
                  </div>

                  {/* Action — only when the join window is open
                      (T-15min through T+2h45min). See
                      src/lib/booking/join-window.ts for the policy. */}
                  {isJoinWindowOpen(date, referenceDate) && (
                    <a
                      href={`/dashboard/sessions?booking=${booking.id}`}
                      className="flex items-center gap-1.5 rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-success/20 transition-all hover:bg-success/90"
                    >
                      <Video className="h-3.5 w-3.5" />
                      {t.dashboard.startSession}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
