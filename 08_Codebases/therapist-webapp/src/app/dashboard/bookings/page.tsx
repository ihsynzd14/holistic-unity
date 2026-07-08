"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  Calendar, Clock, CheckCircle, XCircle, AlertCircle, Video,
  MessageCircle, ArrowRightLeft, X, Check, ChevronDown,
  Ban, RotateCcw, AlertTriangle, Receipt, Copy,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

const CANCEL_CATEGORIES = [
  { value: "emergenza_salute",     label: "Emergenza salute" },
  { value: "imprevisto_familiare", label: "Imprevisto familiare" },
  { value: "conflitto_agenda",     label: "Conflitto agenda" },
  { value: "forza_maggiore",       label: "Forza maggiore" },
  { value: "altro",                label: "Altro motivo" },
] as const;

type CancelCategory = (typeof CANCEL_CATEGORIES)[number]["value"];

type Booking = {
  id: string;
  scheduled_at: string;
  status: string;
  service_name: string;
  price: number;
  duration: number;
  currency: string;
  video_room_id: string | null;
  proposed_scheduled_at: string | null;
  reschedule_count: number;
  reschedule_proposed_by: "client" | "therapist" | null;
  cancellation_reason: string | null;
  client_name: string;
  client_email: string;
  client_id: string;
};

type StatusFilter = "all" | "pending" | "reschedule_pending" | "confirmed" | "completed" | "cancelled";

export default function BookingsPage() {
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [showDeclineFor, setShowDeclineFor] = useState<string | null>(null);

  // Invoice export modal — surfaced from confirmed/completed bookings
  // to give the therapist all the data they need to issue THEIR own
  // fiscal document to the client (the platform doesn't auto-issue
  // therapist→client invoices in V1; see /api/bookings/[id]/client-invoice-data).
  const [showInvoiceFor, setShowInvoiceFor] = useState<string | null>(null);
  type InvoiceAddress = {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  };
  type InvoiceData = {
    booking: { id: string; scheduled_at: string; service_name: string; duration_min: number; currency: string; status: string; created_at: string };
    client: {
      // V1.1 fields populated by the Stripe webhook from
      // `customer_details` after the client completes Checkout. Older
      // bookings (pre-V1.1 deploy) have null fiscal fields — the modal
      // surfaces a "(da chiedere al cliente)" hint in that case.
      legal_name: string | null;
      display_name: string | null;
      email: string | null;
      phone: string | null;
      tax_id: string | null;
      tax_id_type: string | null; // Stripe type e.g. it_vat, gb_vat, us_ein
      tax_id_country: string | null;
      legal_address: InvoiceAddress | null;
    };
    service_price: number;
    service_price_net_of_refunds: number;
    refund_amount: number;
    stripe: { payment_intent_id: string | null; transaction_status: string | null; payout_status: string | null };
    reconciliation: { client_paid_total: number | null; platform_commission_20pct: number | null; platform_service_fee: number | null; therapist_net_received: number | null };
  };
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceCopied, setInvoiceCopied] = useState(false);
  // Cached therapist user id — used to scope mutations with
  // `.eq("therapist_id", therapistId)` as defence-in-depth even though
  // the load query already filters server-side. If RLS were ever
  // misconfigured to allow updates by booking id alone, this filter
  // prevents one therapist mutating another's bookings.
  const [therapistId, setTherapistId] = useState<string | null>(null);

  // Cancel-confirmed-booking modal state (therapist-initiated cancel
  // on already-paid bookings — triggers 100% refund + audit trail)
  const [showCancelModal, setShowCancelModal] = useState<string | null>(null);
  const [cancelCategory, setCancelCategory] = useState<CancelCategory | "">("");
  const [cancelReason, setCancelReason] = useState("");

  // Reschedule-propose modal state
  const [showRescheduleModal, setShowRescheduleModal] = useState<string | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [minimumRescheduleDateTime] = useState(() =>
    new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)
  );

  // Reliability snapshot — fetched on mount; used to show inline warning
  // before the therapist clicks Cancella (so they see "this is your N-th
  // cancellation, your rate is now X%" before committing).
  const [reliability, setReliability] = useState<{
    cancellation_rate_30d: number;
    reliability_tier: string;
    total_bookings_30d: number;
    cancellations_30d: number;
  } | null>(null);

  const statusConfig: Record<string, { label: string; icon: React.ElementType; bg: string; text: string }> = {
    pending: { label: t.bookings.status.pending, icon: Clock, bg: "bg-warning-light", text: "text-warning" },
    confirmed: { label: t.bookings.status.confirmed, icon: CheckCircle, bg: "bg-success-light", text: "text-success" },
    in_progress: { label: t.bookings.status.in_progress, icon: Video, bg: "bg-info-light", text: "text-info" },
    completed: { label: t.bookings.status.completed, icon: CheckCircle, bg: "bg-info-light", text: "text-info" },
    cancelled: { label: t.bookings.status.cancelled, icon: XCircle, bg: "bg-error-light", text: "text-error" },
    no_show: { label: t.bookings.status.no_show, icon: AlertCircle, bg: "bg-error-light", text: "text-error" },
    reschedule_pending: { label: t.bookings.status.reschedule_pending, icon: ArrowRightLeft, bg: "bg-warning-light", text: "text-warning" },
  };

  const filterLabels: Record<StatusFilter, string> = {
    all: t.bookings.all,
    pending: t.bookings.pending,
    reschedule_pending: t.bookings.status.reschedule_pending,
    confirmed: t.bookings.confirmed,
    completed: t.bookings.completed,
    cancelled: t.bookings.cancelled,
  };

  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadBookings() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setTherapistId(user.id);

      // Fire-and-forget the reliability fetch — used by the Cancel
      // modal to show "this is your N-th cancellation" preview.
      void supabase.rpc("get_therapist_reliability", { p_therapist_id: user.id })
        .then(({ data }) => {
          if (!cancelled && data?.[0]) setReliability(data[0]);
        });

      let query = supabase
        .from("bookings")
        .select("id, scheduled_at, status, service_name, price, duration, currency, video_room_id, proposed_scheduled_at, reschedule_count, reschedule_proposed_by, cancellation_reason, client_id")
        .eq("therapist_id", user.id)
        .order("scheduled_at", { ascending: false })
        .limit(100);

      if (filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data } = await query;
      if (cancelled) return;

      if (data && data.length > 0) {
        const clientIds = [...new Set(data.map((b) => b.client_id))];
        // Peer-read: use user_contact_info — a definer-mode view that
        // only returns rows where the caller has a legitimate
        // relationship (self OR a booking OR a conversation). Columns
        // limited to display_name/email/phone_number/photo_url/role/
        // city/country — a therapist cannot pull birth_date / fcm_token
        // / is_admin of a client even if the RLS layer slipped.
        const { data: clients } = await supabase
          .from("user_contact_info")
          .select("id, display_name, email")
          .in("id", clientIds);

        if (cancelled) return;

        const clientMap = new Map((clients || []).map((c) => [c.id, c]));

        setBookings(data.map((b) => ({
          ...b,
          client_name: clientMap.get(b.client_id)?.display_name || t.bookings.client,
          client_email: clientMap.get(b.client_id)?.email || "",
          currency: b.currency || "eur",
        })));
      } else {
        setBookings([]);
      }

      setLoading(false);
    }

    void loadBookings();

    return () => {
      cancelled = true;
    };
  }, [filter, t.bookings.client]);

  async function acceptBooking(bookingId: string) {
    setActionLoading(bookingId);
    setActionError("");

    // Server route handles ownership check, state machine, video_room
    // generation, and the client notification. Replaces the previous
    // direct-DB update which silently skipped notifications.
    const res = await fetch(`/api/bookings/${bookingId}/accept`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));
    setActionLoading(null);
    if (!res.ok) {
      setActionError(json.error || "Errore nell'accettare la prenotazione");
      return;
    }
    const videoRoom = json.video_room_id as string | undefined;
    setBookings((prev) =>
      prev.map((booking) =>
        booking.id === bookingId
          ? { ...booking, status: "confirmed", video_room_id: videoRoom ?? booking.video_room_id }
          : booking
      )
    );
  }

  async function declineBooking(bookingId: string) {
    setActionLoading(bookingId);
    setActionError("");

    // Server route handles the critical case where the booking is
    // already paid (status='confirmed' from a fast Stripe webhook):
    // it issues a 100% Stripe refund. The previous client-side update
    // would have left the client's money stuck.
    const res = await fetch(`/api/bookings/${bookingId}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: declineReason || t.bookings.declinedByTherapist }),
    });
    const json = await res.json().catch(() => ({}));

    setShowDeclineFor(null);
    setDeclineReason("");
    setActionLoading(null);
    if (!res.ok) {
      setActionError(json.error || "Errore nel rifiutare la prenotazione");
      return;
    }
    setBookings((prev) =>
      prev.map((booking) =>
        booking.id === bookingId
          ? {
              ...booking,
              status: "cancelled",
              cancellation_reason: declineReason || t.bookings.declinedByTherapist,
            }
          : booking
      )
    );
  }

  async function approveReschedule(bookingId: string) {
    setActionLoading(bookingId);
    setActionError("");
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking?.proposed_scheduled_at) { setActionLoading(null); return; }

    // Server route validates the proposed time (≥1h future, max 3
    // reschedules) and lets the bookings_overlap_guard trigger reject
    // conflicts atomically. Notification + audit handled server-side.
    const res = await fetch(`/api/bookings/${bookingId}/approve-reschedule`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));

    setActionLoading(null);
    if (!res.ok) {
      setActionError(json.error || "Errore nell'approvare la riprogrammazione");
      return;
    }
    setBookings((prev) =>
      prev.map((current) =>
        current.id === bookingId
          ? {
              ...current,
              scheduled_at: booking.proposed_scheduled_at!,
              proposed_scheduled_at: null,
              status: "confirmed",
              reschedule_count: (booking.reschedule_count || 0) + 1,
            }
          : current
      )
    );
  }

  // Cancel a confirmed booking (therapist-initiated). Triggers 100%
  // refund via the dedicated API (Stripe reverse transfer + app fee
  // refund). The friction is intentional — modal forces category +
  // 30-char reason — so therapists think before clicking.
  async function cancelConfirmedBooking(bookingId: string) {
    if (!cancelCategory) {
      setActionError("Seleziona una categoria");
      return;
    }
    if (cancelReason.trim().length < 30) {
      setActionError("Spiega brevemente il motivo (minimo 30 caratteri)");
      return;
    }
    setActionLoading(bookingId);
    setActionError("");
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cancelCategory, reason: cancelReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Errore nella cancellazione");
        setActionLoading(null);
        return;
      }
      if (data.reliability) setReliability(data.reliability);
      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId
            ? { ...b, status: "cancelled", cancellation_reason: cancelReason.trim() }
            : b,
        ),
      );
      setShowCancelModal(null);
      setCancelCategory("");
      setCancelReason("");
    } catch {
      setActionError("Errore di rete. Riprova.");
    }
    setActionLoading(null);
  }

  // Propose a new datetime for a confirmed booking. The booking moves
  // to `reschedule_pending`; the client gets 24h to accept/reject via
  // the client-webapp banner (after which a cron auto-cancels with
  // full refund).
  async function proposeReschedule(bookingId: string) {
    if (!rescheduleDateTime) {
      setActionError("Seleziona la nuova data e ora");
      return;
    }
    const proposed = new Date(rescheduleDateTime);
    if (proposed.getTime() - Date.now() < 60 * 60 * 1000) {
      setActionError("La nuova data deve essere almeno 1 ora nel futuro");
      return;
    }
    setActionLoading(bookingId);
    setActionError("");
    try {
      const res = await fetch(`/api/bookings/${bookingId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposed_scheduled_at: proposed.toISOString(),
          reason: rescheduleReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Errore nella riprogrammazione");
        setActionLoading(null);
        return;
      }
      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId
            ? {
                ...b,
                status: "reschedule_pending",
                proposed_scheduled_at: proposed.toISOString(),
              }
            : b,
        ),
      );
      setShowRescheduleModal(null);
      setRescheduleDateTime("");
      setRescheduleReason("");
    } catch {
      setActionError("Errore di rete. Riprova.");
    }
    setActionLoading(null);
  }

  async function declineReschedule(bookingId: string) {
    setActionLoading(bookingId);
    setActionError("");

    // Server route validates ownership + state and notifies the client
    // that their proposal was rejected. Previously this was a silent
    // direct-DB update — the client was left waiting forever.
    const res = await fetch(`/api/bookings/${bookingId}/decline-reschedule`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));

    setActionLoading(null);
    if (!res.ok) {
      setActionError(json.error || "Errore nel rifiutare la riprogrammazione");
      return;
    }
    setBookings((prev) =>
      prev.map((booking) =>
        booking.id === bookingId
          ? {
              ...booking,
              proposed_scheduled_at: null,
              status: "confirmed",
            }
          : booking
      )
    );
  }

  // Fetch invoice export data for a booking. Called when the
  // therapist opens the "Dati per fattura cliente" modal — keeps the
  // first GET out of the initial bookings list to avoid loading
  // financial data for every row (most therapists don't need it
  // every time they look at the booking list).
  async function openInvoiceModal(bookingId: string) {
    setShowInvoiceFor(bookingId);
    setInvoiceData(null);
    setInvoiceError("");
    setInvoiceCopied(false);
    setInvoiceLoading(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/client-invoice-data`);
      const json = await res.json();
      if (!res.ok) {
        setInvoiceError(json?.error || "Errore caricamento dati");
      } else {
        setInvoiceData(json.data);
      }
    } catch {
      setInvoiceError("Errore di rete. Riprova.");
    } finally {
      setInvoiceLoading(false);
    }
  }

  /**
   * Format the invoice payload as a CSV-style block the therapist
   * can paste into their accounting software / commercialista email.
   * Rows are tab-separated key/value pairs so a single Cmd+V into
   * Excel/Numbers/Sheets fills two columns.
   */
  /**
   * Country-aware label for the tax-id row. We use `tax_id_country`
   * rather than parsing the Stripe `tax_id_type` enum because the
   * country is what matters for the therapist (which fiscal-document
   * format applies). Falls back to a neutral "Tax ID" for ROW.
   */
  function taxIdLabelForCountry(country: string | null | undefined): string {
    const c = (country ?? "").toUpperCase();
    if (c === "IT") return "Codice fiscale / P.IVA";
    if (c === "ES") return "NIF / NIE";
    if (c === "GB") return "VAT / UTR";
    if (c === "DE") return "Steuer-IdNr";
    if (c === "FR") return "Numéro fiscal";
    if (c === "PT") return "NIF";
    if (c === "NL") return "BSN / BTW";
    if (c === "BE") return "BTW-nummer";
    if (c === "CH") return "UID / IDE";
    if (c === "AT") return "Steuer-Nr / UID";
    if (c === "US") return "EIN / SSN / ITIN";
    if (c === "CA") return "BN / SIN";
    if (c === "AU") return "ABN / TFN";
    return "Tax ID";
  }

  /** Format a Stripe-style address into 1-3 lines, IT-style. */
  function formatAddressLines(a: InvoiceAddress | null | undefined): string[] {
    if (!a) return [];
    const out: string[] = [];
    if (a.line1) out.push(a.line2 ? `${a.line1}, ${a.line2}` : a.line1);
    const cityLine = [a.postal_code, a.city, a.state].filter(Boolean).join(" ");
    if (cityLine) out.push(cityLine);
    if (a.country) out.push(a.country.toUpperCase());
    return out;
  }

  function formatInvoiceForCopy(d: InvoiceData): string {
    const cur = d.booking.currency.toUpperCase();
    const sym = d.booking.currency === "eur" ? "€" : d.booking.currency === "usd" ? "$" : d.booking.currency === "gbp" ? "£" : cur + " ";
    const date = new Date(d.booking.scheduled_at);
    const dateStr = date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
    const timeStr = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
    // Prefer the legal name the client entered at Stripe Checkout —
    // that's what should appear on the invoice. Display name is a
    // fallback for legacy bookings (pre-V1.1) or guests who never
    // typed a separate legal name.
    const clientName = d.client.legal_name ?? d.client.display_name ?? "—";
    const taxLabel = taxIdLabelForCountry(d.client.tax_id_country);
    const addressLines = formatAddressLines(d.client.legal_address);
    const lines = [
      `Booking ID\t${d.booking.id}`,
      `Servizio\t${d.booking.service_name}`,
      `Data sessione\t${dateStr} ${timeStr}`,
      `Durata\t${d.booking.duration_min} min`,
      `Stato\t${d.booking.status}`,
      ``,
      `Cliente (ragione sociale)\t${clientName}`,
      `Email cliente\t${d.client.email ?? "—"}`,
      `Telefono cliente\t${d.client.phone ?? "—"}`,
      `${taxLabel}\t${d.client.tax_id ?? "(non raccolto a checkout — chiedilo al cliente prima di emettere)"}`,
      `Indirizzo\t${addressLines.length > 0 ? addressLines.join(" / ") : "(non raccolto a checkout — chiedilo al cliente)"}`,
      ``,
      `Importo da fatturare\t${sym}${d.service_price_net_of_refunds.toFixed(2)} ${cur}`,
      ...(d.refund_amount > 0
        ? [`Rimborso parziale erogato\t${sym}${d.refund_amount.toFixed(2)} ${cur} (emettere nota di credito separata)`]
        : []),
      ``,
      `Stripe Payment Intent\t${d.stripe.payment_intent_id ?? "—"}`,
      `Stato transazione\t${d.stripe.transaction_status ?? "—"}`,
      `Stato payout\t${d.stripe.payout_status ?? "—"}`,
      ``,
      `--- Riconciliazione (NON includere in fattura) ---`,
      `Totale pagato dal cliente\t${d.reconciliation.client_paid_total !== null ? sym + d.reconciliation.client_paid_total.toFixed(2) : "—"}`,
      `Commissione piattaforma 20%\t${d.reconciliation.platform_commission_20pct !== null ? sym + d.reconciliation.platform_commission_20pct.toFixed(2) : "—"}`,
      `Service fee Stripe (nostro, non tuo)\t${d.reconciliation.platform_service_fee !== null ? sym + d.reconciliation.platform_service_fee.toFixed(2) : "—"}`,
      `Netto ricevuto dal terapista\t${d.reconciliation.therapist_net_received !== null ? sym + d.reconciliation.therapist_net_received.toFixed(2) : "—"}`,
    ];
    return lines.join("\n");
  }

  async function copyInvoiceToClipboard() {
    if (!invoiceData) return;
    try {
      await navigator.clipboard.writeText(formatInvoiceForCopy(invoiceData));
      setInvoiceCopied(true);
      setTimeout(() => setInvoiceCopied(false), 2500);
    } catch {
      setInvoiceError("Copia negli appunti non riuscita. Selezionali e copiali manualmente.");
    }
  }

  const pendingCount = bookings.filter((b) => b.status === "pending" || b.status === "reschedule_pending").length;

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  return (
    <div className="space-y-8">
      <div className="animate-reveal">
        <DisplayHeading>{t.bookings.title}</DisplayHeading>
        {actionError && (
          <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
            <XCircle className="h-4 w-4" /> {actionError}
          </p>
        )}
        <p className="mt-1 text-sm text-charcoal-muted">
          {t.bookings.subtitle}
          {pendingCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-[10px] font-semibold text-warning">
              {pendingCount} {t.bookings.pendingAction}
            </span>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="animate-reveal flex flex-wrap gap-2" style={{ animationDelay: "40ms" }}>
        {(Object.keys(filterLabels) as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setLoading(true); }}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
              filter === f
                ? "bg-berry text-white border-berry"
                : "border border-berry/10 bg-white/70 text-charcoal-light backdrop-blur-sm hover:border-berry/30 hover:bg-berry-subtle/50 hover:text-berry-dark"
            }`}
          >
            {filterLabels[f]}
          </button>
        ))}
      </div>

      {/* Bookings */}
      {bookings.length === 0 ? (
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/50 p-12 text-center" style={{ animationDelay: "80ms" }}>
          <Calendar className="mx-auto h-12 w-12 text-berry-muted/40" strokeWidth={1} />
          <p className="mt-4 font-medium text-charcoal-muted">{t.bookings.noBookings}</p>
          <p className="mt-1 text-sm text-charcoal-muted/70">{t.bookings.noBookingsDesc}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking, i) => {
            const date = new Date(booking.scheduled_at);
            const config = statusConfig[booking.status] || statusConfig.pending;
            const StatusIcon = config.icon;
            const currSymbol = booking.currency === "eur" ? "€" : booking.currency === "usd" ? "$" : booking.currency === "gbp" ? "£" : "€";
            const isPending = booking.status === "pending";
            const isReschedule = booking.status === "reschedule_pending";
            const isExpanded = expandedId === booking.id;

            return (
              <div
                key={booking.id}
                className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
                style={{ animationDelay: `${80 + i * 40}ms` }}
              >
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                >
                  {/* Date badge */}
                  <div className={`flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl ${
                    isPending || isReschedule ? "bg-warning/10 text-warning" : "bg-berry-subtle text-berry"
                  }`}>
                    <span className="text-[10px] font-semibold uppercase">
                      {date.toLocaleDateString("it-IT", { month: "short", timeZone: "Europe/Rome" })}
                    </span>
                    <span className="text-lg font-bold leading-none">{date.getDate()}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-charcoal truncate">{booking.client_name}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${config.bg} ${config.text}`}>
                        <StatusIcon className="h-3 w-3" />
                        {config.label}
                      </span>
                      {isReschedule && booking.reschedule_proposed_by && (
                        <span className="inline-flex items-center rounded-full bg-charcoal/5 px-2 py-0.5 text-[10px] font-medium text-charcoal-muted">
                          {booking.reschedule_proposed_by === "client"
                            ? t.bookings.rescheduleByClient
                            : t.bookings.rescheduleByYou}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-charcoal-muted mt-0.5">
                      {booking.service_name || t.bookings.session} &middot;{" "}
                      {date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" })}
                      {" " + t.bookings.at + " "}
                      {date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}
                      {" · "}{booking.duration} min
                    </p>
                  </div>

                  {/* Price + Actions */}
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-charcoal">{currSymbol}{booking.price.toFixed(2)}</p>

                    {isPending && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); acceptBooking(booking.id); }}
                          disabled={actionLoading === booking.id}
                          className="flex items-center gap-1 rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-success/90 disabled:opacity-50 transition-all"
                        >
                          <Check className="h-3 w-3" />
                          {t.bookings.accept}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowDeclineFor(booking.id); }}
                          disabled={actionLoading === booking.id}
                          className="flex items-center gap-1 rounded-full bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 disabled:opacity-50 transition-all"
                        >
                          <X className="h-3 w-3" />
                          {t.bookings.decline}
                        </button>
                      </div>
                    )}

                    {isReschedule && booking.proposed_scheduled_at && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); approveReschedule(booking.id); }}
                          disabled={actionLoading === booking.id}
                          className="flex items-center gap-1 rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-success/90 disabled:opacity-50 transition-all"
                        >
                          <Check className="h-3 w-3" />
                          {t.bookings.approveReschedule}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); declineReschedule(booking.id); }}
                          disabled={actionLoading === booking.id}
                          className="flex items-center gap-1 rounded-full bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 disabled:opacity-50 transition-all"
                        >
                          <X className="h-3 w-3" />
                          {t.bookings.declineReschedule}
                        </button>
                      </div>
                    )}

                    {/* Confirmed booking → therapist can Reschedule (propose
                        new slot) or Cancel (full refund). Both go through
                        dedicated API routes with auth + audit + Stripe ops. */}
                    {booking.status === "confirmed" && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowRescheduleModal(booking.id);
                            setRescheduleDateTime("");
                            setRescheduleReason("");
                            setActionError("");
                          }}
                          disabled={actionLoading === booking.id}
                          className="flex items-center gap-1 rounded-full border border-berry/20 bg-white px-3 py-1.5 text-xs font-semibold text-berry hover:bg-berry-subtle/30 disabled:opacity-50 transition-all"
                          title="Riprogramma la sessione"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Riprogramma
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowCancelModal(booking.id);
                            setCancelCategory("");
                            setCancelReason("");
                            setActionError("");
                          }}
                          disabled={actionLoading === booking.id}
                          className="flex items-center gap-1 rounded-full border border-error/20 bg-white px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/10 disabled:opacity-50 transition-all"
                          title="Cancella la sessione"
                        >
                          <Ban className="h-3 w-3" />
                          Cancella
                        </button>
                      </div>
                    )}

                    <ChevronDown className={`h-4 w-4 text-charcoal-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </div>
                </div>

                {/* Decline reason form */}
                {showDeclineFor === booking.id && (
                  <div className="border-t border-berry/5 px-5 py-4 bg-error/5">
                    <label className="text-xs font-semibold text-charcoal-muted mb-1.5 block">{t.bookings.declineReason}</label>
                    <div className="flex gap-2">
                      <input
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder={t.bookings.declinePlaceholder}
                        className="flex-1 rounded-xl border border-error/20 bg-white px-3 py-2 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-error/40"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); declineBooking(booking.id); }}
                        disabled={actionLoading === booking.id}
                        className="rounded-full bg-error px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {t.bookings.confirmDecline}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeclineFor(null); setDeclineReason(""); }}
                        className="rounded-full px-3 py-2 text-xs text-charcoal-muted hover:bg-charcoal/5"
                      >
                        {t.common.cancel}
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-berry/5 px-5 py-4 space-y-3 bg-cream-dark/20">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="font-semibold text-charcoal-muted">{t.bookings.client}</p>
                        <p className="text-charcoal">{booking.client_name}</p>
                        {booking.client_email && <p className="text-charcoal-muted">{booking.client_email}</p>}
                      </div>
                      {/* Format removed V1 — all sessions are virtual */}
                      {booking.video_room_id && (
                        <div>
                          <p className="font-semibold text-charcoal-muted">{t.bookings.videoRoom}</p>
                          <p className="text-charcoal font-mono text-[10px]">{booking.video_room_id}</p>
                        </div>
                      )}
                      {booking.reschedule_count > 0 && (
                        <div>
                          <p className="font-semibold text-charcoal-muted">{t.bookings.rescheduleCount}</p>
                          <p className="text-charcoal">{booking.reschedule_count}</p>
                        </div>
                      )}
                      {isReschedule && booking.proposed_scheduled_at && (
                        <div className="col-span-2">
                          <p className="font-semibold text-warning">{t.bookings.newDate}</p>
                          <p className="text-charcoal">
                            {new Date(booking.proposed_scheduled_at).toLocaleDateString("it-IT", {
                              weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome"
                            })}
                            {" " + t.bookings.at + " "}
                            {new Date(booking.proposed_scheduled_at).toLocaleTimeString("it-IT", {
                              hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome"
                            })}
                          </p>
                        </div>
                      )}
                      {booking.cancellation_reason && (
                        <div className="col-span-2">
                          <p className="font-semibold text-error">{t.bookings.cancelReason}</p>
                          <p className="text-charcoal">{booking.cancellation_reason}</p>
                        </div>
                      )}
                    </div>

                    {/* Invoice export — only shown for paid bookings.
                        Surfaces all the data the therapist needs to
                        issue THEIR own fiscal document to the client.
                        The platform doesn't auto-issue therapist→client
                        invoices in V1; this is the bridge to V1.1. */}
                    {(["confirmed", "in_progress", "completed", "cancelled"] as const).includes(
                      booking.status as "confirmed" | "in_progress" | "completed" | "cancelled",
                    ) && (
                      <div className="mt-3 border-t border-berry/5 pt-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); openInvoiceModal(booking.id); }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-berry/20 bg-white px-3 py-1.5 text-xs font-semibold text-berry hover:bg-berry-subtle/30 transition-all"
                          title="Mostra i dati che ti servono per emettere la tua fattura/ricevuta al cliente"
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          Dati per fattura cliente
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Invoice export modal ─── */}
      {showInvoiceFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 backdrop-blur-sm p-4"
          onClick={() => setShowInvoiceFor(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-berry/5 px-6 py-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-berry" />
                <h2 className="text-base font-bold text-charcoal">Dati per fattura cliente</h2>
              </div>
              <button
                onClick={() => setShowInvoiceFor(null)}
                className="rounded-full p-1 text-charcoal-muted hover:bg-charcoal/5"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5 space-y-4">
              {invoiceLoading && (
                <div className="flex items-center justify-center py-10">
                  <svg className="h-6 w-6 animate-spin text-berry" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}

              {invoiceError && !invoiceLoading && (
                <p className="rounded-xl bg-error/10 px-4 py-3 text-sm text-error">{invoiceError}</p>
              )}

              {invoiceData && !invoiceLoading && (() => {
                const d = invoiceData;
                const sym = d.booking.currency === "eur" ? "€" : d.booking.currency === "usd" ? "$" : d.booking.currency === "gbp" ? "£" : d.booking.currency.toUpperCase() + " ";
                const date = new Date(d.booking.scheduled_at);
                return (
                  <>
                    <div className="rounded-xl bg-cream/40 p-4 text-xs text-charcoal-muted leading-relaxed">
                      <p className="font-semibold text-charcoal mb-1">Come usare questi dati</p>
                      <p>
                        La piattaforma genera automaticamente solo la <strong>nostra fattura della commissione mensile</strong> (20%) verso di te. La <strong>fattura della sessione al cliente</strong> la devi emettere tu (sei il venditore del servizio). Copia i dati qui sotto nel tuo software di fatturazione o gestionale.
                      </p>
                    </div>

                    <Section title="Sessione">
                      <Row label="Servizio" value={d.booking.service_name} />
                      <Row
                        label="Data e ora"
                        value={`${date.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Rome" })} alle ${date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}`}
                      />
                      <Row label="Durata" value={`${d.booking.duration_min} min`} />
                      <Row label="ID Booking" value={d.booking.id} mono />
                    </Section>

                    <Section title="Cliente">
                      {/*
                        Show BOTH the legal name (for the invoice) and
                        the display name (the chat handle) when they
                        differ — sometimes the client uses a nickname
                        in chat and a different legal entity for
                        invoicing. If only one is present, show that
                        one as "Nome".
                      */}
                      {d.client.legal_name && d.client.display_name && d.client.legal_name !== d.client.display_name ? (
                        <>
                          <Row label="Ragione sociale" value={d.client.legal_name} />
                          <Row label="Nome utente" value={d.client.display_name} />
                        </>
                      ) : (
                        <Row label="Nome" value={d.client.legal_name ?? d.client.display_name ?? "—"} />
                      )}
                      <Row label="Email" value={d.client.email ?? "—"} />
                      {d.client.phone && <Row label="Telefono" value={d.client.phone} />}
                      <Row
                        label={taxIdLabelForCountry(d.client.tax_id_country)}
                        value={d.client.tax_id ?? "(non raccolto a checkout — chiedilo al cliente prima di emettere)"}
                        muted={!d.client.tax_id}
                      />
                      {(() => {
                        const addressLines = formatAddressLines(d.client.legal_address);
                        if (addressLines.length === 0) {
                          return (
                            <Row
                              label="Indirizzo"
                              value="(non raccolto a checkout — chiedilo al cliente)"
                              muted
                            />
                          );
                        }
                        return (
                          <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
                            <span className="text-charcoal-muted">Indirizzo</span>
                            <span className="text-right text-charcoal whitespace-pre-line">
                              {addressLines.join("\n")}
                            </span>
                          </div>
                        );
                      })()}
                    </Section>

                    <Section title="Importo da fatturare">
                      <div className="rounded-xl bg-success/10 px-4 py-3">
                        <p className="text-2xl font-bold text-success">
                          {sym}{d.service_price_net_of_refunds.toFixed(2)}
                        </p>
                        {d.refund_amount > 0 && (
                          <p className="text-xs text-charcoal-muted mt-1">
                            (lordo sessione {sym}{d.service_price.toFixed(2)} meno rimborso {sym}{d.refund_amount.toFixed(2)} — emettere nota di credito separata)
                          </p>
                        )}
                      </div>
                      <p className="text-[11px] text-charcoal-muted mt-2 leading-relaxed">
                        Questo è il prezzo della sessione, NON include il service fee Stripe (2.5% + €0.25) che è ricavo della piattaforma. Non includerlo in fattura: faresti doppia fatturazione al cliente.
                      </p>
                    </Section>

                    <Section title="Riferimenti Stripe (per il commercialista)">
                      <Row label="Payment Intent ID" value={d.stripe.payment_intent_id ?? "—"} mono />
                      <Row label="Stato transazione" value={d.stripe.transaction_status ?? "—"} />
                      <Row label="Stato payout" value={d.stripe.payout_status ?? "—"} />
                    </Section>

                    <details className="rounded-xl border border-berry/5 bg-white/70 px-4 py-3">
                      <summary className="cursor-pointer text-xs font-semibold text-charcoal-muted">
                        Riconciliazione (NON includere in fattura)
                      </summary>
                      <div className="mt-3 space-y-1 text-xs">
                        <Row label="Totale pagato dal cliente" value={d.reconciliation.client_paid_total !== null ? `${sym}${d.reconciliation.client_paid_total.toFixed(2)}` : "—"} />
                        <Row label="Commissione piattaforma 20%" value={d.reconciliation.platform_commission_20pct !== null ? `${sym}${d.reconciliation.platform_commission_20pct.toFixed(2)}` : "—"} />
                        <Row label="Service fee Stripe (nostro)" value={d.reconciliation.platform_service_fee !== null ? `${sym}${d.reconciliation.platform_service_fee.toFixed(2)}` : "—"} />
                        <Row label="Netto ricevuto da te" value={d.reconciliation.therapist_net_received !== null ? `${sym}${d.reconciliation.therapist_net_received.toFixed(2)}` : "—"} />
                      </div>
                    </details>
                  </>
                );
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-berry/5 bg-cream/20 px-6 py-3">
              <button
                onClick={() => setShowInvoiceFor(null)}
                className="rounded-full px-4 py-1.5 text-xs font-medium text-charcoal-muted hover:bg-charcoal/5"
              >
                Chiudi
              </button>
              {invoiceData && (
                <button
                  onClick={copyInvoiceToClipboard}
                  className="inline-flex items-center gap-1.5 rounded-full bg-berry px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-berry-dark"
                >
                  {invoiceCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {invoiceCopied ? "Copiato" : "Copia tutto"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Cancel-confirmed-booking modal ─── */}
      {showCancelModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 backdrop-blur-sm p-4"
          onClick={() => setShowCancelModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-berry/10 px-5 py-4">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-error" />
                Cancella sessione
              </h3>
              <p className="mt-1 text-xs text-charcoal-muted">
                Il cliente riceverà un rimborso del 100% e una notifica via email.
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
              {reliability && reliability.cancellations_30d > 0 && (
                <div
                  className={`rounded-xl px-3 py-2.5 text-xs ${
                    reliability.reliability_tier === "warning"
                      ? "bg-warning-light text-gold-dark"
                      : reliability.reliability_tier === "high"
                      ? "bg-error-light text-error"
                      : reliability.reliability_tier === "critical"
                      ? "bg-error-light text-error font-semibold"
                      : "bg-info-light text-info"
                  }`}
                >
                  Negli ultimi 30 giorni hai cancellato{" "}
                  <strong>{reliability.cancellations_30d}</strong> sessioni
                  {reliability.total_bookings_30d > 0 && (
                    <> su {reliability.total_bookings_30d} ({reliability.cancellation_rate_30d}%)</>
                  )}.
                  {reliability.reliability_tier === "warning" && " Attenzione: sopra il 10% riceverai un alert."}
                  {(reliability.reliability_tier === "high" || reliability.reliability_tier === "critical") &&
                    " Hai superato la soglia consentita — questa cancellazione potrebbe essere bloccata."}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-charcoal-muted block mb-1.5">
                  Categoria <span className="text-error">*</span>
                </label>
                <select
                  value={cancelCategory}
                  onChange={(e) => setCancelCategory(e.target.value as CancelCategory)}
                  className="w-full rounded-xl border border-berry/20 bg-white px-3 py-2 text-sm text-charcoal outline-none focus:border-berry"
                >
                  <option value="">Seleziona categoria…</option>
                  {CANCEL_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-charcoal-muted block mb-1.5">
                  Motivo <span className="text-error">*</span>{" "}
                  <span className="text-charcoal-muted/70">(min 30 caratteri, lo vede l&apos;admin)</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder="Es: Visita medica urgente non rinviabile…"
                  className="w-full rounded-xl border border-berry/20 bg-white px-3 py-2 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry resize-none"
                />
                <p className="mt-1 text-[10px] text-charcoal-muted">
                  {cancelReason.trim().length}/30
                </p>
              </div>

              {actionError && (
                <p className="text-xs text-error bg-error-light rounded-lg px-3 py-2">
                  {actionError}
                </p>
              )}
            </div>

            <div className="border-t border-berry/10 px-5 py-3 flex justify-end gap-2">
              <button
                onClick={() => setShowCancelModal(null)}
                disabled={actionLoading === showCancelModal}
                className="rounded-full px-4 py-2 text-xs font-semibold text-charcoal-muted hover:bg-charcoal/5 disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={() => cancelConfirmedBooking(showCancelModal)}
                disabled={actionLoading === showCancelModal || !cancelCategory || cancelReason.trim().length < 30}
                className="rounded-full bg-error px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-error/90 disabled:opacity-50 transition-all"
              >
                {actionLoading === showCancelModal ? "Cancellazione…" : "Conferma cancellazione"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reschedule-propose modal ─── */}
      {showRescheduleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 backdrop-blur-sm p-4"
          onClick={() => setShowRescheduleModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-berry/10 px-5 py-4">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-berry" />
                Proponi nuovo orario
              </h3>
              <p className="mt-1 text-xs text-charcoal-muted">
                Il cliente riceverà la richiesta e avrà 24h per accettare. Se non risponde,
                la sessione viene cancellata automaticamente con rimborso al 100%.
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-charcoal-muted block mb-1.5">
                  Nuova data e ora <span className="text-error">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={rescheduleDateTime}
                  onChange={(e) => setRescheduleDateTime(e.target.value)}
                  min={minimumRescheduleDateTime}
                  className="w-full rounded-xl border border-berry/20 bg-white px-3 py-2 text-sm text-charcoal outline-none focus:border-berry"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-charcoal-muted block mb-1.5">
                  Motivo <span className="text-charcoal-muted/70">(opzionale, lo vede il cliente)</span>
                </label>
                <textarea
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  rows={2}
                  placeholder="Es: Conflitto con altra emergenza, mi scuso per il disagio…"
                  className="w-full rounded-xl border border-berry/20 bg-white px-3 py-2 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry resize-none"
                />
              </div>

              {actionError && (
                <p className="text-xs text-error bg-error-light rounded-lg px-3 py-2">
                  {actionError}
                </p>
              )}
            </div>

            <div className="border-t border-berry/10 px-5 py-3 flex justify-end gap-2">
              <button
                onClick={() => setShowRescheduleModal(null)}
                disabled={actionLoading === showRescheduleModal}
                className="rounded-full px-4 py-2 text-xs font-semibold text-charcoal-muted hover:bg-charcoal/5 disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={() => proposeReschedule(showRescheduleModal)}
                disabled={actionLoading === showRescheduleModal || !rescheduleDateTime}
                className="rounded-full bg-berry px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-berry-dark disabled:opacity-50 transition-all"
              >
                {actionLoading === showRescheduleModal ? "Invio…" : "Proponi al cliente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-charcoal-muted">{title}</h3>
      <div className="rounded-xl border border-berry/5 bg-white/70 p-4 space-y-1.5">
        {children}
      </div>
    </section>
  );
}

function Row({ label, value, mono = false, muted = false }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="font-semibold text-charcoal-muted whitespace-nowrap">{label}</span>
      <span className={`text-right ${mono ? "font-mono text-[11px]" : ""} ${muted ? "text-charcoal-muted italic" : "text-charcoal"}`}>
        {value}
      </span>
    </div>
  );
}
