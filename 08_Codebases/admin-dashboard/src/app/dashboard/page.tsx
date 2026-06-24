import { createAdminClient } from "@/lib/supabase/admin";
import {
  aggregateCapacityByCategory,
  type Availability,
  type TherapistInput,
} from "@/lib/capacity/capacity";
import { Card } from "@/components/ui/Card";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

/* ──────────────────────────── date helpers ──────────────────────────── */
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString();
}

/* ──────────────────────────── data fetching ──────────────────────────── */
async function getKPIs() {
  const supabase = createAdminClient();
  const now = new Date();
  const curStart = startOfMonth(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevStart = startOfMonth(prevDate);
  const prevEnd = endOfMonth(prevDate);

  const [
    { count: totalUsers },
    { count: totalClients },
    { count: totalTherapists },
    { count: pendingApplications },
    { count: approvedTherapists },
    { data: stripeWaitTherapists },
    { data: allTransactions },
    { data: curMonthTx },
    { data: prevMonthTx },
    { data: allBookings },
    { data: curMonthBookings },
    { data: prevMonthBookings },
    { data: reviews },
    { data: recentApplications },
    { data: recentBookings },
    { data: allClients },
    { data: allTherapistUsers },
    { data: curMonthUsers },
    { data: prevMonthUsers },
  ] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "client"),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "therapist"),
    supabase.from("therapist_profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending_review"),
    supabase.from("therapist_profiles").select("*", { count: "exact", head: true }).eq("approval_status", "approved"),
    // Approved therapists who haven't finished Stripe Connect — they're
    // hidden from the client-webapp marketplace because clients couldn't
    // pay them. This is the list to nudge.
    supabase
      .from("therapist_profiles")
      .select("id, display_name, photo_url, stripe_account_status, created_at")
      .eq("approval_status", "approved")
      .neq("stripe_account_status", "active")
      .order("created_at", { ascending: false }),
    // All completed transactions
    supabase.from("transactions").select("amount, platform_fee, commission_base, service_fee, iva_amount, currency, created_at, client_id, therapist_id").eq("status", "completed"),
    // Current month transactions
    supabase.from("transactions").select("amount, platform_fee, commission_base, client_id, therapist_id, created_at").eq("status", "completed").gte("created_at", curStart),
    // Previous month transactions
    supabase.from("transactions").select("amount, platform_fee, commission_base, client_id, therapist_id, created_at").eq("status", "completed").gte("created_at", prevStart).lte("created_at", prevEnd),
    // All bookings
    supabase.from("bookings").select("id, client_id, therapist_id, status, scheduled_at, created_at, duration, price"),
    // Current month bookings
    supabase.from("bookings").select("id, client_id, therapist_id, status, duration, price, created_at").gte("created_at", curStart),
    // Previous month bookings
    supabase.from("bookings").select("id, client_id, therapist_id, status, duration, price, created_at").gte("created_at", prevStart).lte("created_at", prevEnd),
    // Reviews
    supabase.from("reviews").select("rating, client_id, therapist_id, booking_id, created_at"),
    // Recent applications
    supabase.from("therapist_profiles").select("id, display_name, photo_url, approval_status, categories, created_at").eq("approval_status", "pending_review").order("created_at", { ascending: false }).limit(5),
    // Recent bookings
    supabase.from("bookings").select("id, service_name, status, scheduled_at, price, client_id, therapist_id").order("created_at", { ascending: false }).limit(5),
    // All clients with created_at for cohort analysis
    supabase.from("users").select("id, created_at").eq("role", "client"),
    // All therapist users
    supabase.from("users").select("id, created_at").eq("role", "therapist"),
    // New users this month
    supabase.from("users").select("id, role").gte("created_at", curStart),
    // New users prev month
    supabase.from("users").select("id, role").gte("created_at", prevStart).lte("created_at", prevEnd),
  ]);

  const tx = allTransactions || [];
  const curTx = curMonthTx || [];
  const prevTx = prevMonthTx || [];
  const bookings = allBookings || [];
  const curBookings = curMonthBookings || [];
  const prevBookings = prevMonthBookings || [];

  // ─── INVESTOR METRICS ───
  const gmvAllTime = tx.reduce((s, t) => s + (t.amount || 0), 0);
  const gmvCurrent = curTx.reduce((s, t) => s + (t.amount || 0), 0);
  const gmvPrevious = prevTx.reduce((s, t) => s + (t.amount || 0), 0);
  const platformRevAllTime = tx.reduce((s, t) => s + (Number(t.commission_base) || t.platform_fee || 0), 0);
  const platformRevCurrent = curTx.reduce((s, t) => s + (Number(t.commission_base) || t.platform_fee || 0), 0);
  const takeRate = gmvAllTime > 0 ? (platformRevAllTime / gmvAllTime) * 100 : 0;

  // NRR: clients who transacted last month — how much did they spend this month?
  const prevClientIds = new Set(prevTx.map(t => t.client_id));
  const nrrRevenue = curTx.filter(t => prevClientIds.has(t.client_id)).reduce((s, t) => s + (t.amount || 0), 0);
  const prevClientRevenue = prevTx.reduce((s, t) => s + (t.amount || 0), 0);
  const nrr = prevClientRevenue > 0 ? (nrrRevenue / prevClientRevenue) * 100 : 0;

  // ─── DEMAND SIDE ───
  const completedBookings = bookings.filter(b => b.status === "completed");
  const clientBookingCounts: Record<string, number> = {};
  completedBookings.forEach(b => { clientBookingCounts[b.client_id] = (clientBookingCounts[b.client_id] || 0) + 1; });
  const clientsWithBookings = Object.keys(clientBookingCounts).length;
  const avgSessionsPerClient = clientsWithBookings > 0 ? completedBookings.length / clientsWithBookings : 0;
  const rebookingClients = Object.values(clientBookingCounts).filter(c => c > 1).length;
  const rebookingRate = clientsWithBookings > 0 ? (rebookingClients / clientsWithBookings) * 100 : 0;

  // Time to first session
  const clientFirstSession: Record<string, Date> = {};
  completedBookings.forEach(b => {
    const d = new Date(b.scheduled_at);
    if (!clientFirstSession[b.client_id] || d < clientFirstSession[b.client_id]) {
      clientFirstSession[b.client_id] = d;
    }
  });
  const clientList = allClients || [];
  const ttfsDays: number[] = [];
  clientList.forEach(c => {
    if (clientFirstSession[c.id]) {
      const diff = (clientFirstSession[c.id].getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (diff >= 0) ttfsDays.push(diff);
    }
  });
  const avgTimeToFirstSession = ttfsDays.length > 0 ? ttfsDays.reduce((s, d) => s + d, 0) / ttfsDays.length : 0;

  // Client churn: clients who booked prev month but not this month
  const prevMonthClientIds = new Set(prevBookings.filter(b => b.status !== "cancelled").map(b => b.client_id));
  const curMonthClientIds = new Set(curBookings.filter(b => b.status !== "cancelled").map(b => b.client_id));
  const churnedClients = [...prevMonthClientIds].filter(id => !curMonthClientIds.has(id)).length;
  const clientChurnRate = prevMonthClientIds.size > 0 ? (churnedClients / prevMonthClientIds.size) * 100 : 0;

  // ─── SUPPLY SIDE ───
  const therapistBookingCounts: Record<string, number> = {};
  completedBookings.forEach(b => { therapistBookingCounts[b.therapist_id] = (therapistBookingCounts[b.therapist_id] || 0) + 1; });
  const therapistsWithBookings = Object.keys(therapistBookingCounts).length;
  const avgSessionsPerTherapist = therapistsWithBookings > 0 ? completedBookings.length / therapistsWithBookings : 0;

  // Therapist churn: therapists active prev month not active this month
  const prevMonthTherapistIds = new Set(prevBookings.filter(b => b.status !== "cancelled").map(b => b.therapist_id));
  const curMonthTherapistIds = new Set(curBookings.filter(b => b.status !== "cancelled").map(b => b.therapist_id));
  const churnedTherapists = [...prevMonthTherapistIds].filter(id => !curMonthTherapistIds.has(id)).length;
  const therapistChurnRate = prevMonthTherapistIds.size > 0 ? (churnedTherapists / prevMonthTherapistIds.size) * 100 : 0;

  // Utilization: total booked hours / (active therapists × available hours estimate)
  const totalBookedMinutes = completedBookings.reduce((s, b) => s + (b.duration || 0), 0);
  const totalBookedHours = totalBookedMinutes / 60;

  // ─── MATCH QUALITY ───
  const allReviews = reviews || [];
  const avgRating = allReviews.length > 0 ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length : 0;
  const completedCount = bookings.filter(b => b.status === "completed").length;
  const cancelledCount = bookings.filter(b => b.status === "cancelled").length;
  const totalFinished = completedCount + cancelledCount;
  const completionRate = totalFinished > 0 ? (completedCount / totalFinished) * 100 : 0;

  // Repeat with same therapist
  const clientTherapistPairs: Record<string, Set<string>> = {};
  completedBookings.forEach(b => {
    if (!clientTherapistPairs[b.client_id]) clientTherapistPairs[b.client_id] = new Set();
    clientTherapistPairs[b.client_id].add(b.therapist_id);
  });
  const repeatClients = Object.entries(clientBookingCounts).filter(([, count]) => count > 1);
  const stayingClients = repeatClients.filter(([clientId]) => (clientTherapistPairs[clientId]?.size || 0) === 1).length;
  const loyaltyRate = repeatClients.length > 0 ? (stayingClients / repeatClients.length) * 100 : 0;

  // ─── UNIT ECONOMICS ───
  const revPerSession = completedCount > 0 ? platformRevAllTime / completedCount : 0;
  const avgSessionPrice = completedCount > 0 ? gmvAllTime / completedCount : 0;
  const totalServiceFees = tx.reduce((s, t) => s + (Number(t.service_fee) || 0), 0);
  const totalIVA = tx.reduce((s, t) => s + (Number(t.iva_amount) || 0), 0);

  // Growth
  const newClientsThisMonth = (curMonthUsers || []).filter(u => u.role === "client").length;
  const newClientsPrevMonth = (prevMonthUsers || []).filter(u => u.role === "client").length;
  const newTherapistsThisMonth = (curMonthUsers || []).filter(u => u.role === "therapist").length;

  // ─── CAPACITY BY CATEGORY (weekly, across all approved therapists) ───
  // Drives advertising budget allocation: categories with more unbooked
  // hours/week = where we have room to grow and should push ad spend.
  const capacity = await getCategoryCapacity(now);

  // Approved-but-Stripe-pending therapists are HIDDEN from the
  // marketplace by the client-webapp visibility filter. The admin needs
  // to know who they are to follow up.
  const stripeWaitList = stripeWaitTherapists ?? [];

  return {
    // Headline
    gmvAllTime, gmvCurrent, gmvPrevious, platformRevAllTime, platformRevCurrent, takeRate, nrr,
    // Counts
    totalUsers: totalUsers || 0, totalClients: totalClients || 0, totalTherapists: totalTherapists || 0,
    pendingApplications: pendingApplications || 0, approvedTherapists: approvedTherapists || 0,
    stripeWaitCount: stripeWaitList.length,
    stripeWaitList,
    totalBookings: bookings.length, completedBookings: completedCount, activeBookings: bookings.filter(b => ["confirmed", "in_progress"].includes(b.status)).length,
    // Demand
    avgSessionsPerClient, rebookingRate, avgTimeToFirstSession, clientChurnRate,
    clientsWithBookings, newClientsThisMonth, newClientsPrevMonth,
    // Supply
    avgSessionsPerTherapist, therapistChurnRate, therapistsWithBookings,
    totalBookedHours, newTherapistsThisMonth,
    // Quality
    avgRating, totalReviews: allReviews.length, completionRate, loyaltyRate,
    cancelledCount,
    // Unit economics
    revPerSession, avgSessionPrice, totalServiceFees, totalIVA,
    // Lists
    recentApplications: recentApplications || [],
    recentBookings: recentBookings || [],
    // Capacity-by-category
    capacity,
  };
}

/**
 * Compute aggregated available hours per service category across all
 * approved therapists for the next 7 days.
 *
 * Attribution: a therapist's free hours count fully toward each category
 * they offer (see capacity.ts for the rationale). Output is a sorted
 * list so the UI can render it directly.
 */
async function getCategoryCapacity(now: Date) {
  const supabase = createAdminClient();
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // CHANGED: include only therapists that are actually visible to clients
  // (Stripe Connect active). Including stripe-pending therapists in the
  // capacity widget would over-state real bookable supply and skew ad
  // budget decisions — those hours can't currently be sold.
  // Also pull canonical categories from public.practices so we can
  // distinguish official categories from legacy/drift ones.
  const [{ data: profiles }, { data: services }, { data: bookings }, { data: practices }] =
    await Promise.all([
      supabase
        .from("therapist_profiles")
        .select("id, availability")
        .eq("approval_status", "approved")
        .eq("is_approved", true)
        .eq("stripe_account_status", "active"),
      supabase
        .from("therapist_services")
        .select("therapist_id, category, is_active")
        .eq("is_active", true),
      supabase
        .from("bookings")
        .select("id, therapist_id, scheduled_at, duration, status")
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", windowEnd.toISOString()),
      supabase
        .from("practices")
        .select("category_key")
        .eq("is_published", true),
    ]);

  const visibleTherapistIds = new Set((profiles ?? []).map((p) => p.id));
  const canonicalCategories = new Set(
    (practices ?? []).map((p: { category_key: string }) => p.category_key),
  );

  // Group services by therapist → set of categories they offer.
  // Only count services from VISIBLE therapists (skip the rest entirely).
  // Drop categories that aren't in the canonical 9 — those are legacy
  // drift (Psicoterapia, EMDR, Mindfulness, etc.) that we don't want
  // to surface as if they were official platform offerings.
  const catsByTherapist: Record<string, Set<string>> = {};
  for (const s of services || []) {
    if (!s.therapist_id || !s.category) continue;
    if (!visibleTherapistIds.has(s.therapist_id)) continue;
    if (!canonicalCategories.has(s.category)) continue;
    if (!catsByTherapist[s.therapist_id]) catsByTherapist[s.therapist_id] = new Set();
    catsByTherapist[s.therapist_id].add(s.category);
  }

  // Group bookings by therapist (also only for visible therapists)
  const bookingsByTherapist: Record<string, TherapistInput["bookings"]> = {};
  for (const b of bookings || []) {
    if (!b.therapist_id) continue;
    if (!visibleTherapistIds.has(b.therapist_id)) continue;
    if (!bookingsByTherapist[b.therapist_id]) bookingsByTherapist[b.therapist_id] = [];
    bookingsByTherapist[b.therapist_id].push({
      id: b.id,
      scheduled_at: b.scheduled_at,
      duration: b.duration,
      status: b.status,
    });
  }

  const therapists: TherapistInput[] = (profiles || []).map((p: { id: string; availability: unknown }) => ({
    id: p.id,
    availability: (p.availability ?? null) as Availability | null,
    categories: Array.from(catsByTherapist[p.id] ?? []),
    bookings: bookingsByTherapist[p.id] ?? [],
  }));

  return aggregateCapacityByCategory({
    therapists,
    now,
    windowDays: 7,
  });
}

/* ──────────────────────────── page ──────────────────────────── */
export default async function DashboardPage() {
  const k = await getKPIs();
  const gmvGrowth = k.gmvPrevious > 0 ? ((k.gmvCurrent - k.gmvPrevious) / k.gmvPrevious) * 100 : 0;
  const clientGrowth = k.newClientsPrevMonth > 0 ? ((k.newClientsThisMonth - k.newClientsPrevMonth) / k.newClientsPrevMonth) * 100 : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <DisplayHeading>Dashboard</DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">Marketplace KPIs &amp; unit economics</p>
      </div>

      {/* Pending alert */}
      {k.pendingApplications > 0 && (
        <div className="flex items-center gap-4 rounded-2xl border border-gold/30 bg-gradient-to-r from-warning-light to-cream p-5 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/15">
            <svg className="h-5 w-5 text-gold-dark" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
          </div>
          <div className="flex-1">
            <p className="font-semibold text-charcoal">{k.pendingApplications} therapist application{k.pendingApplications > 1 ? "s" : ""} pending</p>
            <p className="text-sm text-charcoal-muted">Review and approve to expand supply.</p>
          </div>
          <a href="/dashboard/therapists?status=pending_review" className="rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/15 transition-all hover:bg-berry-dark hover:shadow-lg hover:-translate-y-0.5">Review Now</a>
        </div>
      )}

      {/* Approved-but-Stripe-pending alert. These therapists are HIDDEN
          from the marketplace because clients couldn't pay them. Nudge
          them to finish onboarding so they appear in the catalog. */}
      {k.stripeWaitCount > 0 && (
        <div className="rounded-2xl border border-info/20 bg-gradient-to-r from-info-light/40 to-cream p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-info/15">
              <svg className="h-5 w-5 text-info" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-charcoal">
                {k.stripeWaitCount} approved therapist{k.stripeWaitCount > 1 ? "s" : ""} hidden from marketplace
              </p>
              <p className="mt-0.5 text-sm text-charcoal-muted">
                Approved but Stripe Connect isn&apos;t active yet. Clients can&apos;t see or book them. Nudge them to finish onboarding.
              </p>
              <ul className="mt-3 space-y-1.5">
                {k.stripeWaitList.slice(0, 5).map((t: { id: string; display_name: string | null; stripe_account_status: string | null }) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <a
                      href={`/dashboard/therapists/${t.id}`}
                      className="font-medium text-info hover:text-info/80 transition-colors"
                    >
                      {t.display_name || "Unnamed therapist"}
                    </a>
                    <span className="rounded-full bg-charcoal/5 px-2 py-0.5 text-[11px] font-medium text-charcoal-muted">
                      {t.stripe_account_status || "not_connected"}
                    </span>
                  </li>
                ))}
                {k.stripeWaitList.length > 5 && (
                  <li className="text-xs text-charcoal-muted">
                    + {k.stripeWaitList.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ═════════ SECTION: Investor Headline ═════════ */}
      <section>
        <SectionLabel label="Investor Metrics" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard label="GMV (All Time)" value={`€${fmt(k.gmvAllTime)}`} sub={`€${fmt(k.gmvCurrent)} this month`} trend={gmvGrowth} icon="chart" color="berry" />
          <KPICard label="Platform Revenue" value={`€${fmt(k.platformRevAllTime)}`} sub={`€${fmt(k.platformRevCurrent)} this month`} icon="money" color="gold" />
          <KPICard label="Take Rate" value={`${k.takeRate.toFixed(1)}%`} sub="Commission on GMV" icon="percent" color="berry" />
          <KPICard label="Net Revenue Retention" value={k.nrr > 0 ? `${k.nrr.toFixed(0)}%` : "—"} sub="Same clients, month-over-month" icon="repeat" color={k.nrr >= 100 ? "success" : "warning"} />
        </div>
      </section>

      {/* ═════════ SECTION: Demand Side (Clients) ═════════ */}
      <section>
        <SectionLabel label="Demand Side — Clients" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Total Clients" value={k.totalClients} sub={`+${k.newClientsThisMonth} this month`} trend={clientGrowth} icon="users" color="berry" />
          <KPICard label="Avg Sessions / Client" value={k.avgSessionsPerClient.toFixed(1)} sub={`${k.clientsWithBookings} clients with bookings`} icon="session" color="info" />
          <KPICard label="Rebooking Rate" value={`${k.rebookingRate.toFixed(0)}%`} sub="Clients who book again" icon="repeat" color={k.rebookingRate >= 40 ? "success" : "warning"} />
          <KPICard label="Time to First Session" value={k.avgTimeToFirstSession > 0 ? `${k.avgTimeToFirstSession.toFixed(1)}d` : "—"} sub="Signup → first booking" icon="clock" color="info" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Client Churn (Monthly)" value={`${k.clientChurnRate.toFixed(0)}%`} sub="Didn't rebook this month" icon="churn" color={k.clientChurnRate <= 30 ? "success" : "error"} />
        </div>
      </section>

      {/* ═════════ SECTION: Supply Side (Therapists) ═════════ */}
      <section>
        <SectionLabel label="Supply Side — Therapists" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Approved Therapists" value={k.approvedTherapists} sub={`${k.pendingApplications} pending`} icon="verified" color="success" />
          <KPICard label="Avg Sessions / Therapist" value={k.avgSessionsPerTherapist.toFixed(1)} sub={`${k.therapistsWithBookings} with bookings`} icon="session" color="gold" />
          <KPICard label="Therapist Churn (Monthly)" value={`${k.therapistChurnRate.toFixed(0)}%`} sub="Inactive vs. last month" icon="churn" color={k.therapistChurnRate <= 15 ? "success" : "error"} />
          <KPICard label="Total Hours Booked" value={k.totalBookedHours.toFixed(0)} sub="Across all therapists" icon="clock" color="gold" />
        </div>
      </section>

      {/* ═════════ SECTION: Weekly Supply Capacity by Category ═════════ */}
      {/* Marketing aid: shows how many hours/week of each therapy category
          are currently available across the marketplace. The admin uses
          this to proportionally allocate ad budget — categories with more
          open hours need more advertising to fill them. */}
      <section>
        <SectionLabel label="Weekly Capacity by Category" />
        <CapacityByCategory data={k.capacity} />
      </section>

      {/* ═════════ SECTION: Match Quality ═════════ */}
      <section>
        <SectionLabel label="Match Quality" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Average Rating" value={k.avgRating > 0 ? `${k.avgRating.toFixed(1)} ★` : "—"} sub={`${k.totalReviews} reviews`} icon="star" color={k.avgRating >= 4 ? "success" : "warning"} />
          <KPICard label="Completion Rate" value={`${k.completionRate.toFixed(0)}%`} sub={`${k.completedBookings} completed, ${k.cancelledCount} cancelled`} icon="check" color={k.completionRate >= 80 ? "success" : "warning"} />
          <KPICard label="Client Loyalty" value={k.loyaltyRate > 0 ? `${k.loyaltyRate.toFixed(0)}%` : "—"} sub={k.loyaltyRate > 0 ? "Rebookers staying with same therapist" : "No rebookers yet"} icon="heart" color={k.loyaltyRate >= 50 ? "success" : "info"} />
          <KPICard label="Total Bookings" value={k.totalBookings} sub={`${k.activeBookings} currently active`} icon="calendar" color="berry" />
        </div>
        <p className="mt-3 text-[11px] italic text-charcoal-muted/70">
          Note: numbers include legacy bookings imported from the iOS app + early test data. Real marketplace metrics will stabilise once the web app launches with paying clients.
        </p>
      </section>

      {/* ═════════ SECTION: Unit Economics ═════════ */}
      <section>
        <SectionLabel label="Unit Economics" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Avg Session Price" value={`€${k.avgSessionPrice.toFixed(2)}`} sub="Client-side" icon="money" color="charcoal" />
          <KPICard label="Revenue / Session" value={`€${k.revPerSession.toFixed(2)}`} sub="Platform take per session" icon="money" color="berry" />
          <KPICard label="Service Fees Collected" value={`€${fmt(k.totalServiceFees)}`} sub="Stripe processing pass-through" icon="money" color="info" />
          <KPICard label="IVA Withheld" value={`€${fmt(k.totalIVA)}`} sub="22% on Italian therapists" icon="tax" color="warning" />
        </div>
      </section>

      {/* ═════════ SECTION: Recent Activity ═════════ */}
      <section>
        <SectionLabel label="Recent Activity" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Recent applications */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">Pending Applications</h3>
              <a href="/dashboard/therapists?status=pending_review" className="text-sm font-medium text-berry hover:text-berry-dark transition-colors">View all</a>
            </div>
            {k.recentApplications.length === 0 ? (
              <p className="py-8 text-center text-sm text-charcoal-muted">No pending applications</p>
            ) : (
              <div className="space-y-2">
                {k.recentApplications.map((app: any) => (
                  <a key={app.id} href={`/dashboard/therapists/${app.id}`} className="flex items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-berry-subtle/30">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-berry-subtle to-berry-muted/30 text-sm font-bold text-berry-dark">{app.display_name?.[0]?.toUpperCase() || "?"}</div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-charcoal">{app.display_name || "Unknown"}</p>
                      <p className="truncate text-xs text-charcoal-muted">{(app.categories || []).join(", ") || "No categories"}</p>
                    </div>
                    <span className="rounded-full bg-warning-light px-2.5 py-0.5 text-xs font-semibold text-gold-dark">Pending</span>
                  </a>
                ))}
              </div>
            )}
          </Card>

          {/* Recent bookings */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">Recent Bookings</h3>
              <a href="/dashboard/bookings" className="text-sm font-medium text-berry hover:text-berry-dark transition-colors">View all</a>
            </div>
            {k.recentBookings.length === 0 ? (
              <p className="py-8 text-center text-sm text-charcoal-muted">No bookings yet</p>
            ) : (
              <div className="space-y-2">
                {k.recentBookings.map((b: any) => (
                  <div key={b.id} className="flex items-center gap-3 rounded-xl p-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-charcoal">{b.service_name || "Session"}</p>
                      <p className="text-xs text-charcoal-muted">{new Date(b.scheduled_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    <span className="text-sm font-semibold text-charcoal">€{(b.price || 0).toFixed(2)}</span>
                    <StatusBadge status={b.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

/* ──────────────────────────── components ──────────────────────────── */

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(2);
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <DisplayHeading as="h2" size="md">{label}</DisplayHeading>
      <div className="flex-1 h-px bg-gradient-to-r from-berry/8 to-transparent" />
    </div>
  );
}

const iconMap: Record<string, React.ReactNode> = {
  chart: <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />,
  money: <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />,
  percent: <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 15m-13.5 0h13.5m-13.5 0L11.25 4.5m0 0L4.5 19.5" />,
  repeat: <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />,
  users: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />,
  session: <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />,
  clock: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />,
  churn: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />,
  verified: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />,
  star: <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />,
  check: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  heart: <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />,
  calendar: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />,
  tax: <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />,
};

function KPICard({ label, value, sub, trend, icon, color }: {
  label: string; value: string | number; sub?: string; trend?: number; icon: string; color: string;
}) {
  const themes: Record<string, { iconBg: string; iconText: string }> = {
    berry: { iconBg: "bg-berry-subtle", iconText: "text-berry" },
    gold: { iconBg: "bg-warning-light", iconText: "text-gold-dark" },
    success: { iconBg: "bg-success-light", iconText: "text-success" },
    error: { iconBg: "bg-error-light", iconText: "text-error" },
    warning: { iconBg: "bg-warning-light", iconText: "text-gold-dark" },
    info: { iconBg: "bg-info-light", iconText: "text-info" },
    charcoal: { iconBg: "bg-cream-dark", iconText: "text-charcoal-light" },
  };
  const t = themes[color] || themes.berry;

  return (
    <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">{label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${t.iconBg}`}>
          <svg className={`h-[18px] w-[18px] ${t.iconText}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">{iconMap[icon]}</svg>
        </div>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">{value}</p>
        {trend !== undefined && trend !== 0 && (
          <span className={`mb-0.5 flex items-center text-xs font-semibold ${trend > 0 ? "text-success" : "text-error"}`}>
            {trend > 0 ? "↑" : "↓"} {Math.abs(trend).toFixed(0)}%
          </span>
        )}
      </div>
      {sub && <p className="mt-1 text-xs text-charcoal-muted">{sub}</p>}
    </div>
  );
}

type CapacityData = {
  windowDays: number;
  totalTherapists: number;
  therapistsWithAvailability: number;
  totalFreeHours: number;
  byCategory: Array<{ category: string; hoursAvailable: number; therapistCount: number }>;
};

function CapacityByCategory({ data }: { data: CapacityData }) {
  // Budget-allocation hint: for each category, what % of total available
  // hours does it represent? That's the starting point for ad spend split.
  const totalCategoryHours = data.byCategory.reduce((s, c) => s + c.hoursAvailable, 0);
  const maxHours = data.byCategory.length > 0 ? data.byCategory[0].hoursAvailable : 1;

  if (data.byCategory.length === 0) {
    return (
      <div className="rounded-2xl border border-berry/5 bg-white/70 p-8 text-center shadow-sm backdrop-blur-sm">
        <p className="text-sm text-charcoal-muted">
          No bookable therapists yet. Therapists must be approved AND have Stripe Connect active before they appear in the marketplace and contribute to capacity.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headline row: total + counts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
            Total free hours (next {data.windowDays} days)
          </p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
            {data.totalFreeHours.toFixed(0)}h
          </p>
          <p className="mt-1 text-xs text-charcoal-muted">
            Across {data.therapistsWithAvailability} of {data.totalTherapists} bookable therapists
          </p>
        </div>
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
            Top category
          </p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-berry truncate">
            {data.byCategory[0].category}
          </p>
          <p className="mt-1 text-xs text-charcoal-muted">
            {data.byCategory[0].hoursAvailable.toFixed(0)}h / week &middot; {data.byCategory[0].therapistCount} therapist{data.byCategory[0].therapistCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="rounded-2xl border border-gold/20 bg-[#F9F0DF]/40 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-dark">
            Budget hint
          </p>
          <p className="mt-2 text-sm text-charcoal">
            Allocate ad budget roughly proportional to each category&rsquo;s share of free hours. More open hours = more demand headroom to capture.
          </p>
        </div>
      </div>

      {/* Per-category breakdown */}
      <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-[family-name:var(--font-display)] text-base font-bold text-charcoal">
            Hours available per category
          </h3>
          <span className="text-xs text-charcoal-muted">
            Next {data.windowDays} days &middot; excludes already-booked slots + buffer
          </span>
        </div>

        <div className="space-y-3">
          {data.byCategory.map((cat, idx) => {
            const sharePct = totalCategoryHours > 0
              ? (cat.hoursAvailable / totalCategoryHours) * 100
              : 0;
            const barPct = (cat.hoursAvailable / maxHours) * 100;
            return (
              <div key={cat.category} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="w-5 text-right text-xs font-semibold text-charcoal-muted">
                      {idx + 1}.
                    </span>
                    <span className="truncate text-sm font-semibold text-charcoal">
                      {cat.category}
                    </span>
                    <span className="flex-shrink-0 text-xs text-charcoal-muted">
                      {cat.therapistCount} therapist{cat.therapistCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 items-baseline gap-2">
                    <span className="font-[family-name:var(--font-display)] text-base font-bold text-berry">
                      {cat.hoursAvailable.toFixed(0)}h
                    </span>
                    <span className="w-12 text-right text-xs font-medium text-charcoal-muted">
                      {sharePct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-berry-subtle/40">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-berry to-gold transition-all"
                    style={{ width: `${Math.max(4, barPct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-[11px] text-charcoal-muted/70 italic">
          Note: only therapists with active Stripe Connect (i.e. visible in the marketplace) are counted. Categories shown are the 9 canonical practices from the catalog — legacy categories (Psicoterapia, EMDR, Mindfulness) are excluded. If a therapist offers multiple categories, their free hours count toward each — the bars show the supply ceiling per category, not a real split.
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, string> = {
    pending: "bg-warning-light text-gold-dark", confirmed: "bg-info-light text-info",
    in_progress: "bg-berry-subtle text-berry", completed: "bg-success-light text-success",
    cancelled: "bg-error-light text-error", no_show: "bg-cream-dark text-charcoal-muted",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s[status] || "bg-cream-dark text-charcoal-muted"}`}>{(status || "").replace("_", " ")}</span>;
}
