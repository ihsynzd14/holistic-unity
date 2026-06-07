"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { CheckCircle2, Calendar, MessageCircle, CalendarPlus, Download, ChevronRight } from "lucide-react";
import { buildCalendarLinks } from "@/lib/booking/calendar-links";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";

function SuccessInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const isFree = searchParams.get("free") === "1";
  const [booking, setBooking] = useState<{
    scheduled_at: string;
    service_name: string | null;
    duration: number | null;
    therapist_id: string | null;
    therapist: { display_name: string | null; slug: string | null } | null;
    status: string;
    price: number | null;
    currency: string | null;
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [webhookTimeout, setWebhookTimeout] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  // Track Purchase exactly once per success-page mount, even if the
  // poll re-fires after webhook confirmation. We use a ref (not state)
  // because the polling closure captures the initial value — a state
  // setter would only update *after* the effect re-mounts, so the
  // first 2-3 ticks after confirmation would all double-fire Purchase.
  const purchaseTrackedRef = useRef(false);

  // Open the 1:1 chat between this client and the therapist they just
  // booked. The actual chat is on Stream Chat (not Postgres), so we
  // pass the therapist_id as a query param and let the messages page
  // create the Stream channel + auto-select it once Stream Chat is
  // initialised. This avoids dragging the Stream SDK into this page
  // (which would slow first paint of the success screen) and keeps
  // all Stream-Chat plumbing in one file.
  function openChatWithTherapist() {
    if (!booking?.therapist_id) {
      router.push("/dashboard/messages");
      return;
    }
    setOpeningChat(true);
    router.push(`/dashboard/messages?to=${booking.therapist_id}`);
  }

  // Stripe webhook flips status from `pending_payment` → `confirmed`. The
  // success redirect can land here BEFORE the webhook runs, so we poll
  // for a few seconds to give the user real feedback.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    let attempts = 0;
    const supabase = createClient();
    setPolling(true);

    async function tick(): Promise<void> {
      if (cancelled) return;
      const { data } = await supabase
        .from("bookings")
        .select(
          // FK targets therapist_profiles, not users — see note in
          // dashboard/bookings/page.tsx for the full context. Also
          // pull therapist_id (not just the embedded display_name) so
          // the "Scrivi all'operatore" button can create a 1:1 chat.
          // price + currency are needed for the Meta Pixel Purchase
          // event below.
          "scheduled_at, service_name, duration, status, therapist_id, price, currency, therapist:therapist_profiles!bookings_therapist_id_fkey(display_name, slug)",
        )
        .eq("id", bookingId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setBooking(data as unknown as typeof booking);

        // Fire Purchase exactly once when the booking flips to
        // `confirmed` (paid) or for free bookings (request placed).
        // Use bookingId as transaction_id for Meta dedup safety.
        if (
          !purchaseTrackedRef.current &&
          (data.status === "confirmed" || isFree)
        ) {
          purchaseTrackedRef.current = true;
          import("@/lib/analytics/meta-pixel").then(({ trackPurchase }) => {
            trackPurchase({
              value: Number(data.price ?? 0),
              currency: (data.currency || "EUR").toUpperCase(),
              content_ids: bookingId ? [bookingId] : undefined,
              content_name: data.service_name ?? undefined,
              num_items: 1,
              transaction_id: bookingId ?? undefined,
            });
          });
        }

        if (data.status === "confirmed" || isFree) {
          setPolling(false);
          return;
        }
        if (attempts >= 12) {
          // Webhook hasn't arrived yet (rare but possible — Stripe queues
          // can take 30s+ during outages). Stop polling but flag so the
          // UI shows "payment received, confirmation in progress" rather
          // than the full-success message.
          //
          // 12 attempts × 1.5s = 18s window. Extended from 8 (12s) after
          // observing real-world Stripe→webhook latency hitting 13–15s on
          // the destination-charge path during high traffic.
          setPolling(false);
          setWebhookTimeout(true);
          return;
        }
      }
      attempts++;
      setTimeout(tick, 1500);
    }
    void tick();

    return () => {
      cancelled = true;
    };
  }, [bookingId, isFree]);

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-8 w-8 text-success" strokeWidth={1.75} />
        </div>
        <h1 className="mt-5 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
          {isFree ? t.checkoutSuccess.requestSent : t.checkoutSuccess.paymentReceived}
        </h1>
        <p className="mt-2 text-sm text-charcoal-light">
          {polling
            ? t.checkoutSuccess.confirmingBooking
            : webhookTimeout
            ? "Pagamento ricevuto. La conferma è ancora in elaborazione — riceverai un'email a breve. Se non vedi la prenotazione tra qualche minuto, contatta il supporto."
            : isFree
            ? t.checkoutSuccess.requestSentBody
            : t.checkoutSuccess.paymentReceivedBody}
        </p>
      </div>

      {booking && (
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-xs uppercase tracking-wide text-charcoal-muted font-semibold">
            {t.checkoutSuccess.bookingDetails}
          </p>
          <p className="mt-2 text-base font-semibold text-charcoal">
            {booking.therapist?.display_name || t.checkoutSuccess.therapist}
          </p>
          <p className="mt-1 text-sm text-charcoal-muted">
            {booking.service_name || t.checkoutSuccess.session}
            {" \u00b7 "}
            {booking.duration ?? 60} min
          </p>
          <p className="mt-3 text-sm text-charcoal">
            {new Date(booking.scheduled_at).toLocaleDateString("it-IT", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}{" "}
            {t.checkoutSuccess.at}{" "}
            {new Date(booking.scheduled_at).toLocaleTimeString("it-IT", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>

          {/* Add-to-Calendar row. The deep-link for Google/Outlook
              opens a pre-filled "new event" form in the respective
              web UI; the .ics data URL is the universal fallback —
              downloads a file that iOS Calendar / Apple Mail /
              Outlook desktop / any RFC 5545 client can import. */}
          {bookingId && (
            <AddToCalendarRow
              bookingId={bookingId}
              scheduledAt={booking.scheduled_at}
              duration={booking.duration ?? 60}
              serviceName={booking.service_name ?? "Sessione"}
              therapistName={booking.therapist?.display_name ?? "Operatore"}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/dashboard/bookings"
          className="flex items-center justify-center gap-2 rounded-full bg-berry px-5 py-3 text-sm font-semibold text-white shadow-md shadow-berry/15 transition-all hover:bg-berry-dark"
        >
          <Calendar className="h-4 w-4" />
          {t.checkoutSuccess.seeBookings}
        </Link>
        <button
          type="button"
          onClick={openChatWithTherapist}
          disabled={openingChat || !booking?.therapist_id}
          className="flex items-center justify-center gap-2 rounded-full border border-berry/20 bg-white/70 px-5 py-3 text-sm font-semibold text-berry transition-all hover:bg-berry-subtle/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {openingChat ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <MessageCircle className="h-4 w-4" />
          )}
          {t.checkoutSuccess.messageTherapist}
        </button>
      </div>

      {/* Follow-up CTA — surface a "book another session" path while
          intent is still high. Conversion data shows the post-checkout
          window is the single best moment to nudge a repeat purchase
          (the client just experienced friction-free booking + has
          their dashboard open). Link points to the therapist's profile
          where the booking sidebar is pre-loaded with all services. */}
      {booking?.therapist_id && booking.therapist?.display_name && (
        <Link
          href={`/dashboard/therapists/${booking.therapist?.slug ?? booking.therapist_id}#prenota`}
          className="group flex items-center justify-between gap-3 rounded-2xl border border-berry/10 bg-gradient-to-br from-berry/5 via-white to-gold/5 px-5 py-4 text-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="text-charcoal-muted">
            Vuoi un&apos;altra sessione con{" "}
            <span className="font-semibold text-charcoal">
              {(booking.therapist.display_name || "").split(" ")[0]}
            </span>
            ? Esplora gli altri servizi.
          </span>
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-berry text-white transition-transform group-hover:translate-x-0.5">
            <ChevronRight className="h-4 w-4" />
          </span>
        </Link>
      )}
    </div>
  );
}

function AddToCalendarRow({
  bookingId,
  scheduledAt,
  duration,
  serviceName,
  therapistName,
}: {
  bookingId: string;
  scheduledAt: string;
  duration: number;
  serviceName: string;
  therapistName: string;
}) {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://app.holisticunity.app";
  const cal = buildCalendarLinks({
    bookingId,
    scheduledAt,
    durationMinutes: duration,
    serviceName,
    therapistName,
    callUrl: `${origin}/call/${bookingId}`,
  });

  return (
    <div className="mt-5 border-t border-berry/5 pt-4">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-charcoal-muted">
        <CalendarPlus className="h-3.5 w-3.5" />
        Aggiungi al calendario
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={cal.googleCalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-berry/15 bg-white/80 px-3 py-1.5 text-xs font-medium text-charcoal-light transition-all hover:border-berry/30 hover:bg-berry-subtle/30"
        >
          Google Calendar
        </a>
        <a
          href={cal.outlookCalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-berry/15 bg-white/80 px-3 py-1.5 text-xs font-medium text-charcoal-light transition-all hover:border-berry/30 hover:bg-berry-subtle/30"
        >
          Outlook
        </a>
        <a
          href={cal.icsDataUrl}
          download={`holistic-unity-${bookingId}.ics`}
          className="inline-flex items-center gap-1.5 rounded-full border border-berry/15 bg-white/80 px-3 py-1.5 text-xs font-medium text-charcoal-light transition-all hover:border-berry/30 hover:bg-berry-subtle/30"
        >
          <Download className="h-3 w-3" />
          Apple / .ics
        </a>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <LoadingContainer>
          <Spinner />
        </LoadingContainer>
      }
    >
      <SuccessInner />
    </Suspense>
  );
}
