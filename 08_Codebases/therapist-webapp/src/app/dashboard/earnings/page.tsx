"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  TrendingUp, ArrowDownRight, ArrowUpRight, CreditCard, Wallet,
  Download, Clock, BarChart3, ChevronDown,
  Banknote, RefreshCw,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

type StripeMoney = { amount: number; currency: string };

type StripeLiveBalance = {
  connected: boolean;
  account_status?: string | null;
  available: Array<StripeMoney>;
  pending: Array<StripeMoney>;
  next_payout: { amount: number; currency: string; arrival_date: number; status: string } | null;
};

type StripeChargeRow = {
  id: string;
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: string;
  description: string | null;
  refunded: boolean;
  paid: boolean;
};

type StripePayoutRow = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  arrival_date: number;
  status: string;
  description: string | null;
};

type StripeLiveTransactions = {
  connected: boolean;
  charges: StripeChargeRow[];
  payouts: StripePayoutRow[];
};

function formatStripeMoney(amount: number, currency: string): string {
  // Stripe amounts are in the smallest currency unit (cents for EUR/USD).
  // Convert to major units before formatting.
  const major = amount / 100;
  const symbol =
    currency === "eur" ? "\u20AC" :
    currency === "usd" ? "$" :
    currency === "gbp" ? "\u00A3" :
    currency === "brl" ? "R$" : currency.toUpperCase() + " ";
  return `${symbol}${major.toFixed(2)}`;
}

type Transaction = {
  id: string;
  booking_id: string;
  amount: number;
  platform_fee: number;
  therapist_payout: number;
  currency: string;
  status: string;
  payout_status: string;
  payout_after: string | null;
  refund_amount: number | null;
  created_at: string;
  total_charged: number | null;
  commission_base: number | null;
  iva_amount: number | null;
  iva_applied: boolean | null;
  service_fee: number | null;
  therapist_country: string | null;
  fee_region: string | null;
};

type Period = "week" | "month" | "last_month" | "all";

export default function EarningsPage() {
  const { t } = useI18n();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("month");
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [stripeCountry, setStripeCountry] = useState<string | null>(null);
  const [liveBalance, setLiveBalance] = useState<StripeLiveBalance | null>(null);
  const [liveBalanceLoading, setLiveBalanceLoading] = useState(true);
  const [liveBalanceError, setLiveBalanceError] = useState(false);
  const [liveTx, setLiveTx] = useState<StripeLiveTransactions | null>(null);
  const [liveTxLoading, setLiveTxLoading] = useState(true);
  const [liveTxError, setLiveTxError] = useState(false);

  const periodLabels: Record<Period, string> = {
    week: t.earnings.thisWeek,
    month: t.earnings.thisMonth,
    last_month: t.earnings.lastMonth,
    all: t.earnings.allTime,
  };

  useEffect(() => {
    let cancelled = false;

    async function loadTransactions() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const [{ data }, { data: profileData }] = await Promise.all([
        supabase
          .from("transactions")
          .select("*")
          .eq("therapist_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("therapist_profiles")
          .select("stripe_country")
          .eq("id", user.id)
          .single(),
      ]);

      if (cancelled) return;

      setTransactions(data || []);
      setStripeCountry(profileData?.stripe_country || null);
      setLoading(false);
    }

    void loadTransactions();

    return () => {
      cancelled = true;
    };
  }, []);

  // Live Stripe balance — fetched on mount + every 60s while the tab is
  // visible. We poll instead of using a webhook->push because the volume
  // is low (1 user, 1 page) and polling avoids the complexity of
  // per-user SSE/WebSocket plumbing. The tab-visibility gate prevents
  // burning Stripe API quota on backgrounded tabs the user isn't watching.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchLiveBalance() {
      try {
        const res = await fetch("/api/stripe/balance", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setLiveBalanceError(true);
            setLiveBalanceLoading(false);
          }
          return;
        }
        const data: StripeLiveBalance = await res.json();
        if (!cancelled) {
          setLiveBalance(data);
          setLiveBalanceError(false);
          setLiveBalanceLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLiveBalanceError(true);
          setLiveBalanceLoading(false);
        }
      }
    }

    function startPolling() {
      if (timer) return;
      timer = setInterval(fetchLiveBalance, 60_000);
    }
    function stopPolling() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchLiveBalance();
        startPolling();
      } else {
        stopPolling();
      }
    }

    void fetchLiveBalance();
    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Live Stripe transactions — charges + payouts. Poll less frequently
  // (every 2 min vs 60s for balance) since these change less often and
  // each call is more expensive (2 Stripe API calls + 30 items each).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchLiveTx() {
      try {
        const res = await fetch("/api/stripe/transactions", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setLiveTxError(true);
            setLiveTxLoading(false);
          }
          return;
        }
        const data: StripeLiveTransactions = await res.json();
        if (!cancelled) {
          setLiveTx(data);
          setLiveTxError(false);
          setLiveTxLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLiveTxError(true);
          setLiveTxLoading(false);
        }
      }
    }

    function startPolling() {
      if (timer) return;
      timer = setInterval(fetchLiveTx, 120_000);
    }
    function stopPolling() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchLiveTx();
        startPolling();
      } else {
        stopPolling();
      }
    }

    void fetchLiveTx();
    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Filter by period
  function getDateRange(p: Period): { from: Date; to: Date } {
    const now = new Date();
    const to = now;
    let from: Date;

    switch (p) {
      case "week":
        from = new Date(now);
        from.setDate(from.getDate() - from.getDay() + 1); // Monday
        from.setHours(0, 0, 0, 0);
        break;
      case "month":
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "last_month":
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return { from, to: new Date(now.getFullYear(), now.getMonth(), 1) };
      case "all":
        from = new Date(2020, 0, 1);
        break;
    }
    return { from, to };
  }

  const { from: periodFrom, to: periodTo } = getDateRange(period);
  const periodTx = transactions.filter((t) => {
    const d = new Date(t.created_at);
    return d >= periodFrom && d < periodTo;
  });

  const completedTx = periodTx.filter((t) => t.status === "completed" || t.status === "processing");
  const totalEarnings = completedTx.reduce((sum, t) => sum + (t.therapist_payout || 0), 0);
  const totalSessions = completedTx.length;
  const avgPerSession = totalSessions > 0 ? totalEarnings / totalSessions : 0;

  // Pending payouts (across all time).
  //
  // Includes:
  //   • status='completed', payout_status='pending'     (normal happy path)
  //   • status='partially_refunded', payout_status='pending'
  //       (50% refund pre-escrow — un-refunded half is still owed)
  //
  // Excludes (deliberately):
  //   • payout_status='paid'              → already paid out
  //   • payout_status='partially_refunded' → already paid out post-escrow,
  //                                          refund clawback already
  //                                          accounted for; net is in
  //                                          earned-period totals via
  //                                          (therapist_payout - refund_amount)
  //   • payout_status='refunded'           → full refund, nothing owed
  //
  // For partial-refund pre-escrow rows, only the un-refunded half is still
  // pending. The therapist's original `therapist_payout` was 80% of the
  // session price; on a 50% refund Stripe pulls 50% of the captured total
  // back from the connected account, which corresponds to ~50% of the
  // therapist's payout. We approximate the un-refunded half as
  // `therapist_payout - refund_amount * (therapist_payout / total_charged)`
  // when those fields exist, falling back to half of `therapist_payout`.
  const pendingPayouts = transactions
    .filter(
      (t) =>
        t.payout_status === "pending" &&
        (t.status === "completed" || t.status === "partially_refunded"),
    )
    .reduce((sum, t) => {
      if (t.status === "partially_refunded") {
        const totalCharged = t.total_charged || t.amount || 0;
        const refunded = t.refund_amount || 0;
        const therapistShare =
          totalCharged > 0
            ? (t.therapist_payout || 0) * (1 - refunded / totalCharged)
            : (t.therapist_payout || 0) / 2;
        return sum + Math.max(0, therapistShare);
      }
      return sum + (t.therapist_payout || 0);
    }, 0);

  // Derive the main currency symbol from the most recent transaction (therapist works in one currency)
  const mainCurrency = completedTx[0]?.currency || transactions[0]?.currency || "eur";
  const mainCurrSymbol = mainCurrency === "eur" ? "€" : mainCurrency === "usd" ? "$" : mainCurrency === "gbp" ? "£" : mainCurrency === "brl" ? "R$" : "€";

  // Comparison with previous period
  function getPrevRange(p: Period): { from: Date; to: Date } {
    const now = new Date();
    switch (p) {
      case "week": {
        const from = new Date(now);
        from.setDate(from.getDate() - from.getDay() + 1 - 7);
        from.setHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setDate(to.getDate() + 7);
        return { from, to };
      }
      case "month":
        return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
      case "last_month":
        return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: new Date(now.getFullYear(), now.getMonth() - 1, 1) };
      default:
        return { from: new Date(2020, 0, 1), to: new Date(2020, 0, 1) };
    }
  }

  const { from: prevFrom, to: prevTo } = getPrevRange(period);
  const prevEarnings = transactions
    .filter((t) => {
      const d = new Date(t.created_at);
      return d >= prevFrom && d < prevTo && (t.status === "completed" || t.status === "processing");
    })
    .reduce((sum, t) => sum + (t.therapist_payout || 0), 0);

  const growth = prevEarnings > 0 ? ((totalEarnings - prevEarnings) / prevEarnings * 100) : 0;
  const isUp = growth >= 0;

  // Weekly chart data
  const chartData = (() => {
    const days = [t.earnings.chartDays.mon, t.earnings.chartDays.tue, t.earnings.chartDays.wed, t.earnings.chartDays.thu, t.earnings.chartDays.fri, t.earnings.chartDays.sat, t.earnings.chartDays.sun];
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    periodTx.forEach((t) => {
      if (t.status === "completed" || t.status === "processing") {
        const dayIndex = (new Date(t.created_at).getDay() + 6) % 7; // Mon=0
        buckets[dayIndex] += t.therapist_payout || 0;
      }
    });
    const maxVal = Math.max(...buckets, 1);
    return days.map((label, i) => ({ label, value: buckets[i], pct: (buckets[i] / maxVal) * 100 }));
  })();

  // CSV export
  function exportCSV() {
    if (periodTx.length === 0) return; // Nothing to export
    const headers = [
      t.earnings.csvHeaders.date, t.earnings.csvHeaders.sessionAmount,
      t.earnings.csvHeaders.therapistPayout, t.earnings.csvHeaders.platformFee,
      t.earnings.csvHeaders.iva, t.earnings.csvHeaders.serviceFee,
      t.earnings.csvHeaders.totalCharged, t.earnings.csvHeaders.currency,
      t.earnings.csvHeaders.status, t.earnings.csvHeaders.payoutStatus,
      t.earnings.csvHeaders.therapistCountry, t.earnings.csvHeaders.feeRegion,
    ];
    const rows = periodTx.map((t) => {
      const currLabel = (t.currency || "eur").toUpperCase();
      return [
        new Date(t.created_at).toLocaleDateString("it-IT"),
        (t.amount || 0).toFixed(2),
        (t.therapist_payout || 0).toFixed(2),
        (t.platform_fee || 0).toFixed(2),
        (t.iva_amount || 0).toFixed(2),
        (t.service_fee || 0).toFixed(2),
        (t.total_charged || 0).toFixed(2),
        currLabel,
        t.status,
        t.payout_status,
        t.therapist_country || "",
        t.fee_region || "",
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `guadagni_${period}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  return (
    <div className="space-y-8">
      <div className="animate-reveal flex items-center justify-between">
        <div>
          <DisplayHeading>{t.earnings.title}</DisplayHeading>
          <p className="mt-1 text-sm text-charcoal-muted">{t.earnings.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 rounded-full border border-berry/20 px-4 py-2 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
          >
            <Download className="h-3.5 w-3.5" />
            {t.earnings.exportCSV}
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="animate-reveal flex flex-wrap gap-2" style={{ animationDelay: "20ms" }}>
        {(Object.keys(periodLabels) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
              period === p
                ? "bg-berry text-white"
                : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
            }`}
          >
            {periodLabels[p]}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "40ms" }}>
          <div className="flex items-center gap-2 text-xs font-medium text-charcoal-muted">
            <TrendingUp className="h-4 w-4" />
            {periodLabels[period]}
          </div>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
            {mainCurrSymbol}{totalEarnings.toFixed(2)}
          </p>
          {period !== "all" && prevEarnings > 0 && (
            <span className={`mt-1 inline-flex items-center gap-0.5 text-xs font-medium ${isUp ? "text-success" : "text-error"}`}>
              {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(growth).toFixed(0)}% {t.earnings.vsPrevPeriod}
            </span>
          )}
        </div>

        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center gap-2 text-xs font-medium text-charcoal-muted">
            <Wallet className="h-4 w-4" />
            {t.earnings.sessions}
          </div>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
            {totalSessions}
          </p>
          <span className="text-xs text-charcoal-muted">{t.earnings.completedInPeriod}</span>
        </div>

        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center gap-2 text-xs font-medium text-charcoal-muted">
            <Clock className="h-4 w-4" />
            {t.earnings.inEscrow}
          </div>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-gold-dark">
            {mainCurrSymbol}{pendingPayouts.toFixed(2)}
          </p>
          <span className="text-xs text-charcoal-muted">{t.earnings.escrowDays}</span>
        </div>

        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "160ms" }}>
          <div className="flex items-center gap-2 text-xs font-medium text-charcoal-muted">
            <CreditCard className="h-4 w-4" />
            {t.earnings.avgPerSession}
          </div>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
            {mainCurrSymbol}{avgPerSession.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Live Stripe balance — single source of truth for actual money.
          The KPI cards above show DB-derived metrics (sessions count,
          gross volume, commission breakdown — none of which Stripe knows
          about); this box shows the real cash that has settled or is
          still in transit to the therapist's bank. */}
      {liveBalance?.connected && !liveBalanceError && (
        <div
          className="animate-reveal rounded-2xl border border-berry/15 bg-gradient-to-br from-berry-subtle/30 to-cream-dark/40 p-5 shadow-sm backdrop-blur-sm"
          style={{ animationDelay: "170ms" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-berry" />
              <h3 className="font-[family-name:var(--font-display)] text-sm font-bold text-charcoal">
                Saldo Stripe in tempo reale
              </h3>
              <span className="rounded-full bg-success-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                Live
              </span>
            </div>
            {liveBalanceLoading && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-charcoal-muted" />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Available — money settled and ready for payout */}
            <div className="rounded-xl bg-white/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">
                Disponibile per payout
              </p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-success">
                {liveBalance.available.length > 0
                  ? formatStripeMoney(liveBalance.available[0].amount, liveBalance.available[0].currency)
                  : "\u20AC0.00"}
              </p>
            </div>

            {/* Pending — money in transit (escrow + processing) */}
            <div className="rounded-xl bg-white/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">
                In transito
              </p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-gold-dark">
                {liveBalance.pending.length > 0
                  ? formatStripeMoney(liveBalance.pending[0].amount, liveBalance.pending[0].currency)
                  : "\u20AC0.00"}
              </p>
            </div>

            {/* Next scheduled payout */}
            <div className="rounded-xl bg-white/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">
                Prossimo bonifico
              </p>
              {liveBalance.next_payout ? (
                <>
                  <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
                    {formatStripeMoney(liveBalance.next_payout.amount, liveBalance.next_payout.currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-charcoal-muted">
                    {new Date(liveBalance.next_payout.arrival_date * 1000).toLocaleDateString("it-IT", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-charcoal-muted italic">Nessun payout programmato</p>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-charcoal-muted">
            Aggiornato live da Stripe ogni 60 secondi. I valori qui rappresentano i fondi reali sul tuo account Stripe Express.
          </p>
        </div>
      )}

      {/* Live Stripe transactions — charges + payouts pulled directly
          from the Stripe API for this connected account. Shows real
          activity even for charges that don't have a matching row in
          our `transactions` table (e.g. iOS app payments processed
          before web schema was complete, or pre-cleanup history). */}
      {liveTx?.connected && !liveTxError && (liveTx.charges.length > 0 || liveTx.payouts.length > 0) && (
        <div
          className="animate-reveal rounded-2xl border border-berry/15 bg-white/70 p-5 shadow-sm backdrop-blur-sm"
          style={{ animationDelay: "175ms" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-berry" />
              <h3 className="font-[family-name:var(--font-display)] text-sm font-bold text-charcoal">
                Attività Stripe (ultimi {liveTx.charges.length + liveTx.payouts.length} movimenti)
              </h3>
              <span className="rounded-full bg-success-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                Live
              </span>
            </div>
            {liveTxLoading && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-charcoal-muted" />
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-berry/10 text-left text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">
                  <th className="pb-2 pr-3">Data</th>
                  <th className="pb-2 pr-3">Tipo</th>
                  <th className="pb-2 pr-3">Stato</th>
                  <th className="pb-2 pr-3 text-right">Importo</th>
                  <th className="pb-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...liveTx.charges.map((c) => ({
                    kind: "charge" as const,
                    id: c.id,
                    ts: c.created,
                    amount: c.amount_captured - c.amount_refunded,
                    currency: c.currency,
                    status: c.refunded ? "Rimborsato" : c.paid ? "Pagato" : c.status,
                    note: c.description ?? "Pagamento cliente",
                  })),
                  ...liveTx.payouts.map((p) => ({
                    kind: "payout" as const,
                    id: p.id,
                    ts: p.created,
                    amount: -p.amount,
                    currency: p.currency,
                    status: p.status === "paid" ? "Pagato" : p.status === "in_transit" ? "In transito" : p.status,
                    note: p.description ?? "Bonifico su IBAN",
                  })),
                ]
                  .sort((a, b) => b.ts - a.ts)
                  .slice(0, 30)
                  .map((row) => (
                    <tr key={row.id} className="border-b border-berry/5 last:border-0">
                      <td className="py-2.5 pr-3 text-xs text-charcoal-light">
                        {new Date(row.ts * 1000).toLocaleDateString("it-IT", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            row.kind === "charge"
                              ? "bg-success-light text-success"
                              : "bg-info-light text-info"
                          }`}
                        >
                          {row.kind === "charge" ? "Pagamento" : "Bonifico"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-charcoal-light capitalize">
                        {row.status}
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right font-semibold ${
                          row.amount >= 0 ? "text-charcoal" : "text-charcoal-muted"
                        }`}
                      >
                        {formatStripeMoney(row.amount, row.currency)}
                      </td>
                      <td className="py-2.5 text-xs text-charcoal-muted truncate max-w-[200px]">
                        {row.note}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-charcoal-muted">
            Sorgente: Stripe Charges + Payouts API. Aggiornato ogni 2 minuti. Include
            anche transazioni iOS o storiche non presenti nel database web.
          </p>
        </div>
      )}

      {/* Earnings chart */}
      <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm" style={{ animationDelay: "180ms" }}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-berry" />
          <h3 className="text-sm font-bold text-charcoal">{t.earnings.earningsByDay}</h3>
        </div>
        <div className="flex items-end gap-2" style={{ height: "120px" }}>
          {chartData.map((d) => (
            <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] font-semibold text-charcoal-muted">
                {d.value > 0 ? `${mainCurrSymbol}${d.value.toFixed(0)}` : ""}
              </span>
              <div className="w-full rounded-t-lg bg-berry-subtle/30 relative" style={{ height: "80px" }}>
                <div
                  className="absolute bottom-0 w-full rounded-t-lg bg-gradient-to-t from-berry to-berry/70 transition-all duration-500"
                  style={{ height: `${d.pct}%` }}
                />
              </div>
              <span className="text-[10px] font-medium text-charcoal-muted">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction history */}
      <div className="animate-reveal" style={{ animationDelay: "200ms" }}>
        <DisplayHeading as="h2" size="md" className="mb-4">
          {t.earnings.transactions} {periodLabels[period].toLowerCase()}
        </DisplayHeading>

        {periodTx.length === 0 ? (
          <div className="rounded-2xl border border-berry/5 bg-white/50 p-8 text-center">
            <CreditCard className="mx-auto h-8 w-8 text-charcoal-muted/30" strokeWidth={1} />
            <p className="mt-3 text-sm text-charcoal-muted">{t.earnings.noTransactions}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm">
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 bg-cream-dark/50 px-5 py-3">
              <div className="col-span-3 text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">{t.earnings.csvHeaders.date}</div>
              <div className="col-span-2 text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">{t.earnings.sessions}</div>
              <div className="col-span-2 text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">Fee</div>
              <div className="col-span-2 text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">{t.earnings.netPayout}</div>
              <div className="col-span-2 text-[11px] font-semibold uppercase tracking-widest text-charcoal-muted">{t.earnings.csvHeaders.status}</div>
              <div className="col-span-1"></div>
            </div>

            <div className="divide-y divide-berry/5">
              {periodTx.map((tx) => {
                const date = new Date(tx.created_at);
                const isFullRefund = tx.status === "refunded";
                const isPartialRefund = tx.status === "partially_refunded";
                const isRefund = isFullRefund || isPartialRefund;
                const isPaid = tx.payout_status === "paid";
                const isPartiallyPaid = tx.payout_status === "partially_refunded";
                const currSymbol = tx.currency === "eur" ? "€" : tx.currency === "usd" ? "$" : tx.currency === "gbp" ? "£" : tx.currency === "brl" ? "R$" : "€";
                const isExpanded = expandedTx === tx.id;

                return (
                  <div key={tx.id}>
                    <div
                      className="grid grid-cols-12 gap-2 px-5 py-3.5 transition-colors hover:bg-berry-subtle/10 cursor-pointer"
                      onClick={() => setExpandedTx(isExpanded ? null : tx.id)}
                    >
                      <div className="col-span-3 text-sm text-charcoal">
                        {date.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                      <div className="col-span-2 text-sm text-charcoal">
                        {currSymbol}{(tx.amount || 0).toFixed(2)}
                      </div>
                      <div className="col-span-2 text-sm text-charcoal-muted">
                        {currSymbol}{(tx.platform_fee || 0).toFixed(2)}
                        {tx.iva_applied ? " (IVA incl.)" : ""}
                      </div>
                      <div className="col-span-2 text-sm font-semibold">
                        {isFullRefund ? (
                          <span className="text-error">-{currSymbol}{(tx.refund_amount || tx.therapist_payout || 0).toFixed(2)}</span>
                        ) : isPartialRefund ? (
                          // Partial refund: show the therapist's NET kept
                          // amount (original payout minus the proportional
                          // refund) rather than the absolute refund value,
                          // so the dashboard reflects what was actually
                          // earned. Falls back to therapist_payout / 2 when
                          // we lack `total_charged` for the proportional calc.
                          (() => {
                            const totalCharged = tx.total_charged || tx.amount || 0;
                            const refunded = tx.refund_amount || 0;
                            const net =
                              totalCharged > 0
                                ? (tx.therapist_payout || 0) * (1 - refunded / totalCharged)
                                : (tx.therapist_payout || 0) / 2;
                            return (
                              <span className="text-warning">
                                {currSymbol}{Math.max(0, net).toFixed(2)}
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-success">{currSymbol}{(tx.therapist_payout || 0).toFixed(2)}</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isPaid ? "bg-success-light text-success" :
                          isPartiallyPaid ? "bg-warning-light text-warning" :
                          tx.status === "failed" ? "bg-error-light text-error" :
                          isFullRefund ? "bg-error-light text-error" :
                          isPartialRefund ? "bg-warning-light text-warning" :
                          "bg-warning-light text-warning"
                        }`}>
                          {isPaid ? t.earnings.paid :
                           isPartiallyPaid ? t.earnings.partiallyRefunded :
                           tx.status === "failed" ? t.earnings.failed :
                           isFullRefund ? t.earnings.refunded :
                           isPartialRefund ? t.earnings.partiallyRefunded :
                           t.earnings.pendingPayout}
                        </span>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <ChevronDown className={`h-4 w-4 text-charcoal-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </div>
                    </div>

                    {/* Expanded fee breakdown */}
                    {isExpanded && (
                      <div className="px-5 py-3 bg-cream-dark/20 border-t border-berry/5">
                        <div className="grid grid-cols-2 gap-3 text-xs max-w-md">
                          <div>
                            <p className="text-charcoal-muted">{t.earnings.sessionPrice}</p>
                            <p className="font-medium text-charcoal">{currSymbol}{(tx.amount || 0).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-charcoal-muted">{t.earnings.commission}</p>
                            <p className="font-medium text-charcoal">-{currSymbol}{(tx.commission_base || tx.platform_fee || 0).toFixed(2)}</p>
                          </div>
                          {tx.iva_applied && tx.iva_amount && tx.iva_amount > 0 && (
                            <div>
                              <p className="text-charcoal-muted">{t.earnings.iva}</p>
                              <p className="font-medium text-charcoal">-{currSymbol}{tx.iva_amount.toFixed(2)}</p>
                            </div>
                          )}
                          {tx.service_fee && tx.service_fee > 0 && (
                            <div>
                              <p className="text-charcoal-muted">{t.earnings.serviceFee}</p>
                              <p className="font-medium text-charcoal">-{currSymbol}{tx.service_fee.toFixed(2)}</p>
                            </div>
                          )}
                          <div className="col-span-2 border-t border-berry/10 pt-2">
                            <div className="flex justify-between">
                              <p className="font-semibold text-charcoal">{t.earnings.netPayout}</p>
                              <p className="font-bold text-success">{currSymbol}{(tx.therapist_payout || 0).toFixed(2)}</p>
                            </div>
                          </div>
                          {tx.payout_after && tx.payout_status === "pending" && (
                            <div className="col-span-2">
                              <p className="text-[10px] text-charcoal-muted">
                                {t.earnings.availableFrom} {new Date(tx.payout_after).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Fee explanation */}
      <div className="animate-reveal rounded-2xl border border-gold/20 bg-[#FFFDF8] p-5" style={{ animationDelay: "240ms" }}>
        <p className="text-sm font-semibold text-gold-dark">{t.earnings.howItWorks}</p>
        <p className="mt-1 text-xs text-charcoal-muted leading-relaxed">
          {stripeCountry?.toUpperCase() === "IT"
            ? t.earnings.howItWorksDescIT
            : stripeCountry
              ? t.earnings.howItWorksDescIntl
              : t.earnings.howItWorksDesc}
        </p>
      </div>
    </div>
  );
}
