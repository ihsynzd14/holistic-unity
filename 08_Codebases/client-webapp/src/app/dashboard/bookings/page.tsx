"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { getJoinWindow } from "@/lib/booking/join-window";
import { ErrorText } from "@/components/ui/ErrorText";
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Video,
  X,
  Check,
  ChevronDown,
  Star,
  ArrowRightLeft,
} from "lucide-react";

type Booking = {
  id: string;
  scheduled_at: string;
  status: string;
  service_name: string | null;
  price: number | null;
  duration: number | null;
  currency: string | null;
  video_room_id: string | null;
  cancellation_reason: string | null;
  proposed_scheduled_at: string | null;
  reschedule_proposed_at: string | null;
  reschedule_proposed_by: string | null;
  therapist_id?: string;
  therapist: { display_name: string | null } | null;
};

type StatusFilter = "all" | "pending" | "confirmed" | "completed" | "cancelled";

export default function ClientBookingsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  // `?review=<bookingId>` opens the ReviewModal pre-populated with that
  // booking the moment the list finishes loading. Fired by the home
  // dashboard's PendingReviewCard so the client doesn't have to filter
  // + scroll + click — they arrive with the form already open. We resolve
  // the booking after `bookings` has loaded (the modal needs the full
  // row, not just the ID) and clear the param via replaceState so a
  // reload doesn't keep re-opening it.
  const reviewParam = searchParams.get("review");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>(() =>
    // Deep-link convenience: if we're being asked to open a review,
    // default the list to "completed" so the row is visible behind
    // the modal — otherwise the user closes the modal and lands on a
    // list that doesn't include the booking they just reviewed.
    reviewParam ? "completed" : "all",
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  // Set of booking IDs that already have a review. Used to hide the
  // "Lascia recensione" CTA so the client can't double-submit. We load
  // this once per page render — server-side is authoritative (a UNIQUE
  // trigger on booking_id would be cleaner, but for now the UX guard is
  // sufficient and the INSERT just fails if the user somehow races it).
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reviewingBooking, setReviewingBooking] = useState<Booking | null>(null);
  // Confirmation modals replace window.prompt() / window.confirm() — both
  // were ugly on desktop and silently blocked on mobile Safari in some
  // PWA scenarios. The cancel modal also lets the client write a longer
  // reason without the 100-char prompt() limit.
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rejectRescheduleTarget, setRejectRescheduleTarget] = useState<Booking | null>(null);

  const statusConfig: Record<
    string,
    { label: string; icon: typeof Calendar; bg: string; text: string }
  > = {
    pending: { label: t.clientBookings.statusPending, icon: Clock, bg: "bg-warning-light", text: "text-warning" },
    pending_payment: { label: t.clientBookings.statusPendingPayment, icon: Clock, bg: "bg-info-light", text: "text-info" },
    confirmed: { label: t.clientBookings.statusConfirmed, icon: CheckCircle, bg: "bg-success-light", text: "text-success" },
    in_progress: { label: t.clientBookings.statusInProgress, icon: Video, bg: "bg-info-light", text: "text-info" },
    completed: { label: t.clientBookings.statusCompleted, icon: CheckCircle, bg: "bg-info-light", text: "text-info" },
    cancelled: { label: t.clientBookings.statusCancelled, icon: XCircle, bg: "bg-error-light", text: "text-error" },
    no_show: { label: t.clientBookings.statusNoShow, icon: AlertCircle, bg: "bg-error-light", text: "text-error" },
    reschedule_pending: { label: "Riprogrammazione richiesta", icon: ArrowRightLeft, bg: "bg-warning-light", text: "text-warning" },
  };

  const filterLabels: Record<StatusFilter, string> = {
    all: t.clientBookings.filterAll,
    pending: t.clientBookings.filterPending,
    confirmed: t.clientBookings.filterConfirmed,
    completed: t.clientBookings.filterCompleted,
    cancelled: t.clientBookings.filterCancelled,
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      // bookings.therapist_id has a FK to therapist_profiles (NOT users) —
      // PostgREST refuses to embed `users!bookings_therapist_id_fkey` and
      // returns the entire query as null/error, which previously surfaced
      // as a permanently empty bookings page. therapist_profiles.id is
      // itself a 1:1 ref to users.id and carries the display_name we need.
      let query = supabase
        .from("bookings")
        .select(
          "id, scheduled_at, status, service_name, price, duration, currency, video_room_id, cancellation_reason, proposed_scheduled_at, reschedule_proposed_at, reschedule_proposed_by, therapist_id, therapist:therapist_profiles!bookings_therapist_id_fkey(display_name)"
        )
        .eq("client_id", user.id)
        .order("scheduled_at", { ascending: false })
        .limit(100);
      if (filter === "pending") {
        // "In attesa" now covers both legacy `pending` rows AND
        // `pending_payment` rows (paid bookings still being charged
        // through Stripe Checkout). Free intro calls are auto-confirmed
        // at creation time so they bypass this state entirely.
        query = query.in("status", ["pending", "pending_payment"]);
      } else if (filter !== "all") {
        query = query.eq("status", filter);
      }

      // Load bookings + the client's already-submitted reviews in
      // parallel. RLS on `reviews` lets each client read only their
      // own (`client_id = auth.uid()`), so the select is scoped
      // implicitly.
      const [bookingsRes, reviewsRes] = await Promise.all([
        query,
        supabase
          .from("reviews")
          .select("booking_id")
          .eq("client_id", user.id),
      ]);

      if (cancelled) return;
      const loaded = (bookingsRes.data as unknown as Booking[]) || [];
      const reviewedIds = new Set(
        (reviewsRes.data ?? []).map((r) => r.booking_id as string),
      );
      setBookings(loaded);
      setReviewedBookingIds(reviewedIds);
      setLoading(false);

      // Auto-open the ReviewModal if the URL has `?review=<id>` AND the
      // referenced booking is loaded, completed, and not yet reviewed.
      // Silently no-op when any guard fails — defends against stale
      // links (e.g. the user dismissed the prompt elsewhere, came back
      // hours later) without flashing an error.
      if (reviewParam) {
        const target = loaded.find(
          (b) =>
            b.id === reviewParam &&
            b.status === "completed" &&
            !reviewedIds.has(b.id),
        );
        if (target) setReviewingBooking(target);
        // Strip the param so a soft-reload doesn't re-open the modal.
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("review");
          window.history.replaceState({}, "", url.toString());
        } catch { /* ignore — non-browser SSR or restricted iframe */ }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // `reviewParam` intentionally excluded: it should only trigger
    // auto-open on the FIRST load, not on every URL change. The strip
    // above ensures we don't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Respond to a therapist-proposed reschedule. Accept moves the
  // booking to the new time (status -> confirmed); reject triggers
  // full-refund cancellation server-side.
  async function respondToReschedule(bookingId: string, action: "accept" | "reject") {
    setActionLoading(bookingId);
    setActionError("");
    try {
      const res = await fetch(`/api/bookings/${bookingId}/reschedule/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || "Errore durante la risposta");
        setActionLoading(null);
        return;
      }
      setBookings((prev) =>
        prev.map((b) => {
          if (b.id !== bookingId) return b;
          if (action === "accept") {
            return {
              ...b,
              status: "confirmed",
              scheduled_at: data.new_scheduled_at || b.proposed_scheduled_at || b.scheduled_at,
              proposed_scheduled_at: null,
              reschedule_proposed_at: null,
              reschedule_proposed_by: null,
            };
          }
          return {
            ...b,
            status: "cancelled",
            cancellation_reason: "Cliente ha rifiutato la proposta di riprogrammazione",
            proposed_scheduled_at: null,
            reschedule_proposed_at: null,
            reschedule_proposed_by: null,
          };
        }),
      );
    } catch {
      setActionError("Errore di rete. Riprova.");
    } finally {
      setActionLoading(null);
    }
  }

  async function cancelBooking(bookingId: string, reason: string) {
    setActionLoading(bookingId);
    setActionError("");
    // Server-side cancellation: enforces ownership, state machine, and
    // issues a Stripe refund if the booking was already paid. Bypasses
    // the previous direct Supabase update which could cancel completed
    // sessions without refund logic.
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || t.clientBookings.cancelError);
        setActionLoading(null);
        return;
      }
      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId
            ? { ...b, status: "cancelled", cancellation_reason: reason }
            : b
        )
      );
    } catch {
      setActionError(t.clientBookings.cancelError);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-berry" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="animate-reveal">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal">
          {t.clientBookings.title}
        </h1>
        {actionError && (
          <p className="mt-2 flex items-center gap-1 text-sm text-error">
            <XCircle className="h-4 w-4" /> {actionError}
          </p>
        )}
        <p className="mt-1 text-sm text-charcoal-muted">{t.clientBookings.subtitle}</p>
      </div>

      <div
        className="animate-reveal flex flex-wrap gap-2"
        style={{ animationDelay: "40ms" }}
      >
        {(Object.keys(filterLabels) as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setLoading(true);
            }}
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

      {bookings.length === 0 ? (
        <div
          className="animate-reveal rounded-2xl border border-berry/5 bg-white/50 p-12 text-center"
          style={{ animationDelay: "80ms" }}
        >
          <Calendar className="mx-auto h-12 w-12 text-berry-muted/40" strokeWidth={1} />
          <p className="mt-4 font-medium text-charcoal-muted">{t.clientBookings.empty}</p>
          <Link
            href="/dashboard/therapists"
            className="mt-4 inline-block rounded-full bg-berry px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-berry-dark transition-all"
          >
            {t.clientBookings.findTherapist}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b, i) => {
            const date = new Date(b.scheduled_at);
            const config = statusConfig[b.status] || statusConfig.pending;
            const StatusIcon = config.icon;
            const currSymbol = b.currency === "usd" ? "$" : b.currency === "gbp" ? "£" : "€";
            const isExpanded = expandedId === b.id;
            // Include pending_payment so a client who abandoned a Stripe
            // Checkout (or whose payment is still being processed) can
            // explicitly cancel and free the slot. The cancel API already
            // accepts this status.
            const isCancellable =
              b.status === "pending" ||
              b.status === "pending_payment" ||
              b.status === "confirmed";
            const therapistName = b.therapist?.display_name || t.clientBookings.therapist;

            return (
              <div
                key={b.id}
                className={`animate-reveal rounded-2xl border ${
                  b.status === "reschedule_pending"
                    ? "border-warning/30 ring-1 ring-warning/20"
                    : "border-berry/5"
                } bg-white/70 shadow-sm backdrop-blur-sm transition-all hover:shadow-md`}
                style={{ animationDelay: `${80 + i * 40}ms` }}
              >
                {/* Reschedule-pending banner: prominent CTA for the
                    client to accept/reject the therapist's proposed new
                    time. Auto-cancels in 24h via cron if no response. */}
                {b.status === "reschedule_pending" && b.proposed_scheduled_at && (
                  <div className="rounded-t-2xl border-b border-warning/20 bg-warning-light/40 px-5 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wider text-gold-dark flex items-center gap-1.5">
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                          {therapistName} ha proposto un nuovo orario
                        </p>
                        <p className="mt-1 text-sm text-charcoal">
                          <span className="line-through text-charcoal-muted/70">
                            {date.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}
                            {" "}
                            {date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {" → "}
                          <strong className="text-charcoal">
                            {new Date(b.proposed_scheduled_at).toLocaleDateString("it-IT", {
                              weekday: "short", day: "numeric", month: "short",
                            })}
                            {" "}
                            {new Date(b.proposed_scheduled_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                          </strong>
                        </p>
                        {b.reschedule_proposed_at && (
                          <p className="mt-0.5 text-[11px] text-charcoal-muted">
                            Proposta entro 24h dal: {new Date(b.reschedule_proposed_at).toLocaleString("it-IT", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                            })}. Senza risposta, viene cancellata con rimborso 100%.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); respondToReschedule(b.id, "accept"); }}
                          disabled={actionLoading === b.id}
                          className="flex items-center gap-1 rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-success/90 disabled:opacity-50 transition-all"
                        >
                          <Check className="h-3 w-3" />
                          Accetta
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setRejectRescheduleTarget(b); }}
                          disabled={actionLoading === b.id}
                          className="flex items-center gap-1 rounded-full border border-error/30 bg-white px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/10 disabled:opacity-50 transition-all"
                        >
                          <X className="h-3 w-3" />
                          Rifiuta
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div
                  className="flex cursor-pointer items-center gap-4 p-5"
                  onClick={() => setExpandedId(isExpanded ? null : b.id)}
                >
                  <div className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl bg-berry-subtle text-berry">
                    <span className="text-[10px] font-semibold uppercase">
                      {date.toLocaleDateString("it-IT", { month: "short" })}
                    </span>
                    <span className="text-lg font-bold leading-none">{date.getDate()}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-charcoal truncate">
                        {therapistName}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${config.bg} ${config.text}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {config.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-charcoal-muted truncate">
                      {b.service_name || t.clientBookings.session} &middot;{" "}
                      {date.toLocaleDateString("it-IT", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                      {` ${t.clientBookings.at} `}
                      {date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                      {` · ${b.duration ?? 60} min`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    {b.price !== null && (
                      <p className="text-sm font-bold text-charcoal">
                        {currSymbol}
                        {b.price.toFixed(2)}
                      </p>
                    )}

                    {b.status === "confirmed" &&
                      b.video_room_id &&
                      getJoinWindow(b.scheduled_at).state === "open" && (
                        // target="_blank" — call opens in a new tab so
                        // this bookings list stays available behind it.
                        // Pairs with the post-session "Chiudi" fallback
                        // on /call/[id] (window.close → /dashboard).
                        <Link
                          href={`/call/${b.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-success/20 hover:bg-success/90 transition-all"
                        >
                          <Video className="h-3 w-3" />
                          {t.clientBookings.join}
                        </Link>
                      )}

                    <ChevronDown
                      className={`h-4 w-4 text-charcoal-muted transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="space-y-3 border-t border-berry/5 bg-cream-dark/20 px-5 py-4">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="font-semibold text-charcoal-muted">{t.clientBookings.therapist}</p>
                        <p className="text-charcoal">{therapistName}</p>
                      </div>
                      {b.cancellation_reason && (
                        <div className="col-span-2">
                          <p className="font-semibold text-error">
                            {t.clientBookings.cancelReason}
                          </p>
                          <p className="text-charcoal">{b.cancellation_reason}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {/* Review CTA — only on completed bookings that
                          the client hasn't reviewed yet. The
                          validate_review_booking trigger in Postgres
                          enforces "completed only" server-side too so
                          this is just UX. */}
                      {b.status === "completed" &&
                        !reviewedBookingIds.has(b.id) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewingBooking(b);
                            }}
                            className="flex items-center gap-1 rounded-full bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold-dark hover:bg-gold/20 transition-all"
                          >
                            <Star className="h-3 w-3" />
                            {t.clientBookings.leaveReview ?? "Lascia recensione"}
                          </button>
                        )}
                      {b.status === "completed" &&
                        reviewedBookingIds.has(b.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1.5 text-[11px] font-medium text-success">
                            <Star className="h-3 w-3 fill-current" />
                            {t.clientBookings.reviewed ?? "Recensito"}
                          </span>
                        )}
                      {isCancellable && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCancelTarget(b);
                            setCancelReason("");
                          }}
                          disabled={actionLoading === b.id}
                          className="flex items-center gap-1 rounded-full bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 disabled:opacity-50 transition-all"
                        >
                          <X className="h-3 w-3" />
                          {t.clientBookings.cancel}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Review modal. Renders only when a booking is selected;
          submission inserts via RLS (policy: client_id = auth.uid()),
          the DB trigger validates the booking is in 'completed' state
          and that the client/therapist pair matches. */}
      {reviewingBooking && (
        <ReviewModal
          booking={reviewingBooking}
          onClose={() => setReviewingBooking(null)}
          onSubmitted={(bookingId) => {
            setReviewedBookingIds((prev) => new Set(prev).add(bookingId));
            setReviewingBooking(null);
          }}
        />
      )}

      {cancelTarget && (
        <ConfirmModal
          title={t.clientBookings.cancel}
          message={t.clientBookings.cancelPrompt}
          confirmLabel={t.clientBookings.cancel}
          cancelLabel="Indietro"
          danger
          textareaValue={cancelReason}
          onTextareaChange={setCancelReason}
          textareaPlaceholder={t.clientBookings.cancelDefaultReason}
          loading={actionLoading === cancelTarget.id}
          onCancel={() => {
            setCancelTarget(null);
            setCancelReason("");
          }}
          onConfirm={() => {
            const id = cancelTarget.id;
            const reason = cancelReason.trim() || t.clientBookings.cancelDefaultReason;
            setCancelTarget(null);
            setCancelReason("");
            void cancelBooking(id, reason);
          }}
        />
      )}

      {rejectRescheduleTarget && (
        <ConfirmModal
          title="Rifiutare la riprogrammazione?"
          message="La sessione verrà cancellata e riceverai un rimborso del 100% sul metodo di pagamento originale."
          confirmLabel="Rifiuta e annulla"
          cancelLabel="Indietro"
          danger
          loading={actionLoading === rejectRescheduleTarget.id}
          onCancel={() => setRejectRescheduleTarget(null)}
          onConfirm={() => {
            const id = rejectRescheduleTarget.id;
            setRejectRescheduleTarget(null);
            void respondToReschedule(id, "reject");
          }}
        />
      )}
    </div>
  );
}

// ─── Confirm modal ───────────────────────────────────────────────
//
// Shared confirmation dialog used for cancel + reject-reschedule.
// Replaces native window.prompt() (cancel reason) and window.confirm()
// (reject reschedule), both of which were ugly on desktop and
// occasionally blocked on mobile Safari PWAs.
function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  loading = false,
  danger = false,
  textareaValue,
  onTextareaChange,
  textareaPlaceholder,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  danger?: boolean;
  textareaValue?: string;
  onTextareaChange?: (v: string) => void;
  textareaPlaceholder?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-charcoal">{title}</h3>
        <p className="mt-2 text-sm text-charcoal-muted">{message}</p>
        {onTextareaChange && (
          <textarea
            className="mt-4 w-full rounded-lg border border-berry/15 bg-white p-3 text-sm focus:border-berry focus:outline-none focus:ring-2 focus:ring-berry/20"
            rows={3}
            value={textareaValue ?? ""}
            onChange={(e) => onTextareaChange(e.target.value)}
            placeholder={textareaPlaceholder}
            maxLength={500}
            autoFocus
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-full border border-berry/15 bg-white px-5 py-2 text-sm font-medium text-charcoal hover:bg-berry-subtle/40 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={
              danger
                ? "rounded-full bg-error px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-error/90 disabled:opacity-50"
                : "rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-berry-dark disabled:opacity-50"
            }
          >
            {loading ? "..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Review modal ───────────────────────────────────────────────

function ReviewModal({
  booking,
  onClose,
  onSubmitted,
}: {
  booking: Booking;
  onClose: () => void;
  onSubmitted: (bookingId: string) => void;
}) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (rating < 1) {
      setError(t.clientBookings.reviewRatingRequired ?? "Seleziona un punteggio.");
      return;
    }
    if (!booking.therapist_id) {
      setError("therapist_id mancante");
      return;
    }
    setSubmitting(true);
    setError("");
    // Server-mediated insert. /api/reviews validates ownership +
    // booking state, looks up display_name + photo from `users` server
    // side (so the client can't impersonate another name on a public
    // review), and 409s on double-submit via the (booking_id, client_id)
    // unique constraint.
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: booking.id,
          rating,
          text: text.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Pubblicazione fallita.");
        setSubmitting(false);
        return;
      }
      onSubmitted(booking.id);
    } catch {
      setError("Errore di rete. Riprova.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-berry/10 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
              {t.clientBookings.reviewTitle ?? "Come è andata la sessione?"}
            </h2>
            <p className="mt-1 text-xs text-charcoal-muted">
              {t.clientBookings.reviewWithTherapist?.replace(
                "{name}",
                booking.therapist?.display_name ?? "",
              ) ?? `Con ${booking.therapist?.display_name ?? ""}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-muted hover:bg-charcoal/5"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Star rating */}
        <div className="mt-5 flex items-center justify-center gap-1" role="radiogroup" aria-label="Punteggio sessione">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              className="p-1 transition-transform hover:scale-110 active:scale-95"
              role="radio"
              aria-checked={n === rating}
              aria-label={n === 1 ? "1 stella" : `${n} stelle`}
            >
              <Star
                className={`h-9 w-9 transition-colors ${
                  n <= rating
                    ? "fill-gold text-gold"
                    : "fill-transparent text-charcoal-muted/30"
                }`}
                strokeWidth={1.5}
              />
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 1000))}
          placeholder={
            t.clientBookings.reviewPlaceholder ??
            "Racconta qualcosa della tua esperienza (opzionale)"
          }
          rows={4}
          className="mt-5 w-full resize-none rounded-2xl border border-berry-subtle bg-white px-4 py-3 text-sm text-charcoal placeholder-charcoal-muted/50 outline-none transition-all focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
        <p className="mt-1 text-[11px] text-charcoal-muted/70">{text.length}/1000</p>

        {error && (
          <ErrorText className="mt-3" role="alert">{error}</ErrorText>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-full border border-charcoal/15 bg-white px-4 py-2.5 text-sm font-medium text-charcoal-muted transition-all hover:bg-charcoal/5 disabled:opacity-40"
          >
            {t.common?.cancel ?? "Annulla"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || rating < 1}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-berry px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Star className="h-3.5 w-3.5 fill-current" />
            )}
            {t.clientBookings.reviewPublish ?? "Pubblica"}
          </button>
        </div>
      </div>
    </div>
  );
}
