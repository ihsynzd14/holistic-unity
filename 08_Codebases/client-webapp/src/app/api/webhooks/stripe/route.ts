import Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculatePaymentAmounts } from "@/lib/payments/fee-config";
import { buildCalendarLinks } from "@/lib/booking/calendar-links";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook receiver. We verify the signature using
 * STRIPE_WEBHOOK_SECRET and handle two events:
 *
 *  - `checkout.session.completed` — the client paid. Flip the booking
 *    from `pending_payment` to `confirmed`, attach the payment_intent_id,
 *    and insert a transactions row mirroring the iOS app's fee model.
 *  - `payment_intent.payment_failed` — flip the booking to `cancelled`
 *    with a clear reason so the client (and admin) can see why.
 *
 * Everything is driven by Stripe metadata we set at checkout creation;
 * see /api/checkout/create.
 *
 * IMPORTANT: this route MUST receive the raw request body (no JSON parse)
 * for the signature verification to work. We use `request.text()` and
 * pass the raw string to Stripe SDK.
 */
export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    console.error("[stripe webhook] missing env: STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "no signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid signature";
    console.error("[stripe webhook] signature verification failed:", msg);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Idempotency: Stripe retries webhook deliveries on transient failures
  // (network blips, our own 5xx). Without dedup, a retry of
  // `checkout.session.completed` re-runs notifyBookingConfirmed → 2x
  // emails per user. We claim each event_id by INSERTing into
  // `stripe_webhook_events`; the PRIMARY KEY makes the second INSERT
  // fail with 23505, which we catch as "already processed" and 200
  // back to Stripe so it stops retrying.
  const { error: claimErr } = await supabase
    .from("stripe_webhook_events")
    .insert({ event_id: event.id, event_type: event.type });
  if (claimErr) {
    if (claimErr.code === "23505") {
      console.log(
        `[stripe webhook] duplicate event ${event.id} (${event.type}) — already processed, skipping`,
      );
      return NextResponse.json({ received: true, deduplicated: true });
    }
    // Other errors: log + still process (better to risk a duplicate
    // than to drop a real event). The retry-protection is best-effort.
    console.error("[stripe webhook] claim insert failed:", claimErr);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(stripe, supabase, session);
        break;
      }
      case "checkout.session.expired": {
        // The user opened Stripe Checkout but didn't complete payment
        // before the session's 24h expiry. Stripe fires this event so
        // we can release the held slot — the booking is currently
        // `pending_payment`, blocking the slot from being booked by
        // another client. Flip it to `cancelled`.
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = session.metadata?.booking_id;
        if (bookingId) {
          await supabase
            .from("bookings")
            .update({
              status: "cancelled",
              cancellation_reason: "Checkout Stripe scaduto senza pagamento",
              cancelled_by: "system",
              cancelled_at: new Date().toISOString(),
            })
            .eq("id", bookingId)
            .eq("status", "pending_payment");
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const bookingId = pi.metadata?.booking_id;
        if (bookingId) {
          await supabase
            .from("bookings")
            .update({
              status: "cancelled",
              cancellation_reason:
                pi.last_payment_error?.message || "Pagamento rifiutato",
            })
            .eq("id", bookingId)
            .eq("status", "pending_payment");
        }
        break;
      }
      default:
        // Unhandled event types are fine — Stripe just wants a 200 so it
        // stops retrying.
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    // Returning 500 here would trigger Stripe to retry. That's correct
    // for transient failures (DB hiccups). Keep this behavior.
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(
  stripe: Stripe,
  supabase: ReturnType<typeof createAdminClient>,
  session: Stripe.Checkout.Session,
) {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) {
    console.warn("[stripe webhook] checkout.session.completed without booking_id metadata");
    return;
  }

  // Pull the booking + therapist profile to recompute fees authoritatively
  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("id, client_id, therapist_id, price, currency, status, scheduled_at, service_name, duration")
    .eq("id", bookingId)
    .maybeSingle();

  if (bErr || !booking) {
    console.error("[stripe webhook] booking lookup failed:", bErr);
    return;
  }

  // Cross-check: the metadata on the Stripe session must match the
  // booking row in our DB. This is a defence-in-depth check — a leaked
  // STRIPE_WEBHOOK_SECRET would otherwise let an attacker forge events
  // for arbitrary booking IDs and confirm them. We refuse to process a
  // mismatch and alert loudly (the webhook still 200s back to Stripe so
  // it doesn't retry infinitely on a forged event).
  const metaClientId = session.metadata?.client_id;
  const metaTherapistId = session.metadata?.therapist_id;
  if (
    (metaClientId && metaClientId !== booking.client_id) ||
    (metaTherapistId && metaTherapistId !== booking.therapist_id)
  ) {
    console.error(
      "[stripe webhook] metadata/booking mismatch — possible forged event",
      {
        booking_id: bookingId,
        metadata_client: metaClientId,
        booking_client: booking.client_id,
        metadata_therapist: metaTherapistId,
        booking_therapist: booking.therapist_id,
      },
    );
    return;
  }

  // Resolve the payment_intent so we can store its id on the booking
  // (and reference it on the transactions row + future refunds)
  let paymentIntentId: string | null = null;
  if (typeof session.payment_intent === "string") {
    paymentIntentId = session.payment_intent;
  } else if (session.payment_intent && typeof session.payment_intent === "object") {
    paymentIntentId = session.payment_intent.id;
  }

  // ── Cancelled-but-paid edge case ─────────────────────────────────────
  //
  // Race: the cleanup-pending-payment cron flipped the booking to
  // `cancelled` (booking sat at pending_payment past the 35-min cutoff)
  // BEFORE this webhook's checkout.session.completed event arrived. The
  // user has been charged successfully but the slot has been released
  // and may already be re-booked. Three things must happen:
  //   1. Auto-refund the client (no service will be delivered).
  //   2. Capture the event in Sentry so admin sees it (rare but worth
  //      knowing).
  //   3. Skip the rest of the handler — do NOT confirm the booking, do
  //      NOT insert a transaction, do NOT send a confirmation email.
  //
  // Stripe's idempotency on refunds means a second webhook delivery
  // for the same event_id won't double-refund (we already claimed the
  // event_id at the top via `stripe_webhook_events`).
  if (booking.status === "cancelled" && paymentIntentId) {
    console.error(
      "[stripe webhook] cancelled-but-paid race — refunding charge",
      {
        booking_id: bookingId,
        payment_intent_id: paymentIntentId,
        cancelled_at: (booking as { cancelled_at?: string | null }).cancelled_at ?? null,
      },
    );
    try {
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: {
          booking_id: bookingId,
          reason: "cancelled_but_paid_race",
          context: "checkout.session.completed_after_cleanup_cron",
        },
      });
      Sentry.captureMessage(
        "stripe_webhook.cancelled_but_paid_auto_refund",
        {
          level: "warning",
          tags: { route: "webhooks/stripe", branch: "cancelled_but_paid" },
          extra: {
            booking_id: bookingId,
            payment_intent_id: paymentIntentId,
            client_id: booking.client_id,
            therapist_id: booking.therapist_id,
          },
        },
      );
    } catch (refundErr) {
      // Refund failed — admin must reconcile manually. Capture loudly.
      Sentry.captureException(
        refundErr instanceof Error
          ? refundErr
          : new Error("cancelled_but_paid_refund_failed"),
        {
          level: "error",
          tags: { route: "webhooks/stripe", branch: "cancelled_but_paid_refund_failed" },
          extra: {
            booking_id: bookingId,
            payment_intent_id: paymentIntentId,
          },
        },
      );
    }
    return;
  }

  // Persist any fiscal/contact data the client entered in Stripe Checkout
  // (legal name, billing address, tax id, phone). This is the V1.1 path
  // that lets the therapist's invoice export show real data without
  // chasing the client out-of-band.
  //
  // Best-effort: failures are logged + Sentry-captured but never abort
  // the booking-confirmation flow below — the booking is the more
  // important state to write, and the next checkout will retry the
  // persist anyway since `customer_update.address: "auto"` keeps the
  // Stripe Customer in sync regardless.
  await persistClientFiscalDataFromCheckout(supabase, session, booking.client_id);

  const { data: profile } = await supabase
    .from("therapist_profiles")
    .select("stripe_country, stripe_connected_account_id")
    .eq("id", booking.therapist_id)
    .maybeSingle();

  const sessionPriceCents = Math.round((booking.price ?? 0) * 100);
  const country = (profile?.stripe_country || "IT").toUpperCase();
  const calc = calculatePaymentAmounts(sessionPriceCents, country);

  // Flip booking to confirmed + attach video room id + payment intent.
  //
  // RACE: the Supabase Edge Function `stripe-webhook` listens to
  // `payment_intent.succeeded` (for iOS) and ALSO fires on web payment
  // intents. It can beat us to flipping status='confirmed' for *web*
  // payments. We use an optimistic-locked UPDATE that returns the row
  // ONLY if the locked filter matched — i.e. status was still
  // `pending_payment` when our UPDATE ran. The returned row is the
  // ground truth for "this webhook actually flipped the booking";
  // anything else means the Edge Function won the race. We use that
  // signal to gate notifications (notifications + emails are
  // per-event, not idempotent — sending them twice would mean two
  // confirmation emails per user).
  //
  // We still do the transaction backfill (next block) even on race
  // loss — the Edge Function writes wrong fee values for web checkouts
  // (it reads from payment_intent metadata which only iOS populates),
  // and our canonical override must run regardless.
  const videoRoom = `hu-${booking.id.replace(/-/g, "").slice(0, 16)}`;
  const { data: lockedUpdate, error: upErr } = await supabase
    .from("bookings")
    .update({
      status: "confirmed",
      stripe_payment_intent_id: paymentIntentId,
      video_room_id: videoRoom,
    })
    .eq("id", booking.id)
    .eq("status", "pending_payment")
    .select("id")
    .maybeSingle();
  if (upErr) {
    console.error("[stripe webhook] booking update failed:", upErr);
    throw upErr;
  }
  // alreadyProcessed = the Edge Function (or a previous webhook
  // delivery for the same Stripe event_id) already flipped the row to
  // confirmed before our UPDATE landed. Cannot race because the
  // optimistic-lock filter only matches `pending_payment`.
  const alreadyProcessed = !lockedUpdate;
  if (alreadyProcessed) {
    console.log(
      `[stripe webhook] booking ${bookingId} already confirmed (race lost) — backfilling transaction only, skipping notifications`,
    );
  }

  // Defensive backfill — runs only if the first UPDATE was a no-op
  // because the Edge Function got there first.
  await supabase
    .from("bookings")
    .update({ video_room_id: videoRoom })
    .eq("id", booking.id)
    .is("video_room_id", null);

  // Insert transactions row mirroring the iOS app's fee model.
  //
  // RACE CONDITION FIX (same as for bookings.video_room_id above):
  // the Edge Function `stripe-webhook` listens to
  // `payment_intent.succeeded` (for iOS) and ALSO fires on web
  // payment intents — but it reads fee breakdown from
  // `paymentIntent.metadata` which only iOS populates. For web it
  // gets all zeros and inserts amount=0, platform_fee=0,
  // therapist_payout = full charged amount. We must override that
  // row with the canonical web-side calc.
  //
  // INSERT-then-UPDATE pattern: try INSERT first; on 23505 (unique
  // violation, meaning the Edge Function got there first) fall
  // through to UPDATE WHERE booking_id. This works whether we win
  // the race or lose it. Plain `.upsert(..., { onConflict: "booking_id" })`
  // doesn't work because the unique index on booking_id is partial
  // (`WHERE booking_id IS NOT NULL`) and PostgREST onConflict can't
  // target partial indexes — the upsert fails silently and the
  // Edge Function's wrong values stick.
  const payoutAfter = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const txValues = {
    booking_id: booking.id,
    client_id: booking.client_id,
    therapist_id: booking.therapist_id,
    amount: sessionPriceCents / 100,
    platform_fee: calc.platformFeeCents / 100,
    therapist_payout: calc.therapistPayoutCents / 100,
    currency: booking.currency || "eur",
    status: "completed",
    stripe_payment_intent_id: paymentIntentId,
    payout_status: "pending",
    payout_after: payoutAfter,
    stripe_connected_account_id: profile?.stripe_connected_account_id ?? null,
    total_charged: calc.totalChargedCents / 100,
    commission_base: calc.platformFeeNetCents / 100,
    iva_amount: calc.ivaAmountCents / 100,
    iva_applied: calc.ivaApplied,
    service_fee: calc.serviceFeeCents / 100,
    therapist_country: calc.therapistCountry,
    fee_region: calc.feeRegion,
  };
  const { error: insErr } = await supabase.from("transactions").insert(txValues);
  let txErr = insErr;
  if (insErr?.code === "23505") {
    // Edge Function inserted first — overwrite with our canonical values.
    // Match on booking_id (we own this booking; can't bleed into another).
    const { error: updErr } = await supabase
      .from("transactions")
      .update(txValues)
      .eq("booking_id", booking.id);
    txErr = updErr ?? null;
  }
  if (txErr) {
    console.error("[stripe webhook] transactions write failed:", txErr);
    // Critical: booking is already confirmed but the financial record
    // is missing or wrong — therapist won't see the payout in earnings
    // until an admin backfills the row. Capture explicitly to Sentry.
    Sentry.captureException(new Error("transactions_write_failed_post_confirm"), {
      level: "error",
      tags: { route: "webhooks/stripe", step: "transactions_write" },
      extra: {
        booking_id: booking.id,
        therapist_id: booking.therapist_id,
        client_id: booking.client_id,
        payment_intent_id: paymentIntentId,
        supabase_error: txErr.message,
      },
    });
  }

  // Notify both parties that the booking is confirmed. Best-effort —
  // if Brevo or the notifications insert fails, the booking still
  // stands; the client can see it in their dashboard and the therapist
  // gets it at next login. Fire-and-forget, never blocks the webhook
  // from returning 200 to Stripe (which would trigger retries).
  //
  // Skipped when the Edge Function already processed this booking —
  // notifications are not idempotent (each call inserts new rows), so
  // re-sending here would surface duplicate notifications + emails.
  if (alreadyProcessed) return;
  await notifyBookingConfirmed(supabase, {
    bookingId: booking.id,
    clientId: booking.client_id,
    therapistId: booking.therapist_id,
    scheduledAt: booking.scheduled_at,
    serviceName: booking.service_name,
    duration: booking.duration,
    price: booking.price ?? 0,
  });

  // Reference Stripe to silence the unused-var warning while keeping the
  // import — we may want to do account.retrieve() etc. in the future.
  void stripe;
}

/**
 * Fires two transactional emails (client + therapist) via the
 * send-brevo-email Edge Function, and inserts two in-app
 * notifications rows. Safe to call multiple times per booking in normal
 * webhook retry paths: we pre-check the short composite key
 * `(booking_id, user_id, type)` before inserting.
 *
 * Note: this is not a substitute for a DB-level UNIQUE constraint under a
 * true concurrent race; add one if duplicate notifications become noisy.
 */
async function notifyBookingConfirmed(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    bookingId: string;
    clientId: string;
    therapistId: string;
    scheduledAt: string;
    serviceName: string | null;
    duration: number | null;
    price: number;
  },
) {
  const { bookingId, clientId, therapistId, scheduledAt, serviceName, duration, price } = args;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://app.holisticunity.app";

  // Fetch therapist display name for the calendar event title — a
  // small extra round-trip but worth it since the calendar button is
  // the primary "did I book?" artefact for clients.
  const { data: therapistRow } = await admin
    .from("therapist_profiles")
    .select("display_name")
    .eq("id", therapistId)
    .maybeSingle();
  const therapistName = therapistRow?.display_name ?? "Operatore";

  const calendar = buildCalendarLinks({
    bookingId,
    scheduledAt,
    durationMinutes: duration ?? 60,
    serviceName: serviceName ?? "Sessione",
    therapistName,
    callUrl: `${appOrigin}/call/${bookingId}`,
  });

  // Brevo template IDs mirrored from iOS App/supabase/functions/_shared/brevo.ts
  const TPL_CLIENT = 3; // BOOKING_CONFIRMED_CLIENT
  const TPL_THERAPIST = 4; // BOOKING_CONFIRMED_THERAPIST

  // Brevo template params: the new `google_cal_url` / `outlook_cal_url`
  // / `ics_url` fields are consumed by the templates once the owner
  // updates them in the Brevo dashboard to add "Add to Calendar" CTAs.
  // Until then these keys are silently ignored — no risk, just no UI.
  // Pre-compute the human-readable date/time + amount so the Brevo
  // template renders them directly without needing template-side
  // date formatting (which Brevo doesn't natively support).
  const sessionDate = new Date(scheduledAt);
  // Format in Europe/Rome — `scheduled_at` is stored as UTC in Postgres.
  // Without an explicit timeZone, Node renders in the server's local TZ
  // (UTC on Vercel), shifting times by 1-2h depending on DST.
  const TZ = "Europe/Rome";
  const sessionDateStr = sessionDate.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });
  const sessionTimeStr = sessionDate.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
  const amountStr = price > 0 ? `€ ${price.toFixed(2).replace(".", ",")}` : "Gratuita";

  const sendEmail = (userId: string, templateId: number) =>
    fetch(`${supabaseUrl}/functions/v1/send-brevo-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: templateId,
        user_id: userId,
        params: {
          // Legacy param names — what the EXISTING Brevo template uses.
          // Without these the template renders "Data:", "Ora:", "Totale:"
          // empty, which is what Marcello reported.
          session_date: sessionDateStr,
          session_time: sessionTimeStr,
          amount: amountStr,
          // New richer params — wired here so the template can be
          // upgraded later (calendar buttons, full ISO timestamp, etc.)
          // without another code change. Until the template references
          // them they are silently ignored by Brevo.
          booking_id: bookingId,
          service_name: serviceName ?? "Sessione",
          scheduled_at: scheduledAt,
          duration_minutes: duration ?? 60,
          therapist_name: therapistName,
          google_cal_url: calendar.googleCalUrl,
          outlook_cal_url: calendar.outlookCalUrl,
          ics_url: calendar.icsDataUrl,
          call_url: `${appOrigin}/call/${bookingId}`,
        },
        tags: ["booking_confirmed"],
      }),
    }).catch((err) => {
      console.warn("[stripe webhook] brevo send failed (non-blocking):", err);
    });

  const clientNotification = {
    user_id: clientId,
    type: "booking_confirmed",
    title: "Prenotazione confermata",
    body: `La tua sessione "${serviceName ?? "Sessione"}" è confermata.`,
    booking_id: bookingId,
    therapist_id: therapistId,
  };
  const therapistNotification = {
    user_id: therapistId,
    type: "booking_confirmed",
    title: "Nuova prenotazione",
    body: `Hai una nuova sessione "${serviceName ?? "Sessione"}" in calendario.`,
    booking_id: bookingId,
    client_id: clientId,
  };

  // In-app notifications + emails in parallel. Errors are swallowed —
  // the booking state is the source of truth; these channels are
  // ancillary.
  await Promise.allSettled([
    insertBookingNotification(admin, clientNotification),
    insertBookingNotification(admin, therapistNotification),
    sendEmail(clientId, TPL_CLIENT),
    sendEmail(therapistId, TPL_THERAPIST),
  ]);
}

/**
 * Persist the fiscal/contact data the client entered in Stripe Checkout
 * onto the `users` row. Source of truth: `session.customer_details`,
 * which Stripe populates with the legal name, billing address, phone,
 * and (when `tax_id_collection.enabled = true`) the first tax ID the
 * user filled in.
 *
 * Why we do this in the webhook (and not lazily on read):
 *  - The therapist may export the invoice data days/weeks after the
 *    booking. Stripe sessions older than ~30 days are harder to look
 *    up by id, and we'd add a Stripe API roundtrip to every export.
 *  - Reading Stripe at export time would also leak fiscal data
 *    timing info — a therapist quietly probing their booking list
 *    would generate a Stripe API call per booking.
 *  - Persisting once makes the audit trail (data_access_log) cleaner:
 *    "therapist X read users.tax_id of client Y" is one row, not a
 *    chain of "fetched stripe customer Z → wrote user Y → read Y".
 *
 * Field-by-field policy:
 *  - `legal_name`, `legal_address`, `tax_id*` — always overwrite. The
 *    client just typed these into Checkout for THIS transaction; they
 *    are by definition the most current fiscal data.
 *  - `stripe_customer_id` — always overwrite (almost always identical
 *    after the first booking; the upsert is harmless).
 *  - `phone_number` — only set when null. The user may have a
 *    different account-level phone they prefer for app contact; the
 *    one entered in Stripe Checkout is for that single transaction's
 *    receipt and shouldn't override their primary contact pref.
 */
async function persistClientFiscalDataFromCheckout(
  admin: ReturnType<typeof createAdminClient>,
  session: Stripe.Checkout.Session,
  clientId: string,
) {
  try {
    const cd = session.customer_details;
    const stripeCustomerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;

    // No customer_details + no customer id → nothing to persist.
    // Possible if the session was created by an old build that didn't
    // enable any of the collection fields. The booking still confirms.
    if (!cd && !stripeCustomerId) return;

    // Tax id comes from our `custom_fields` entry with key="cf"
    // (set in /api/checkout/create). It is a free-text, optional
    // field — Italian clients typically enter their Codice Fiscale,
    // foreign clients may enter the local equivalent, most leave it
    // blank. We do NOT use Stripe's `tax_id_collection` because that
    // is a B2B-flavoured VAT-type dropdown and misleading for our
    // B2C-only service (see checkout/create comment for details).
    //
    // The country for the tax id is taken from the billing address —
    // Stripe doesn't tell us what kind of identifier the user typed
    // (CF, NIF, EIN, etc.), so the therapist UI labels it based on
    // `tax_id_country` instead of a Stripe type prefix.
    const cfField = (session.custom_fields ?? []).find(
      (f) => f.key === "cf",
    );
    const taxIdValue = cfField?.text?.value?.trim() || null;
    const taxIdCountry = cd?.address?.country ?? null;

    const update: Record<string, unknown> = {};
    if (stripeCustomerId) update.stripe_customer_id = stripeCustomerId;
    if (cd?.name) update.legal_name = cd.name;
    if (cd?.address) update.legal_address = cd.address;
    if (taxIdValue) {
      update.tax_id = taxIdValue;
      // Don't pretend to know the type — the user typed a free-text
      // value. Country is the meaningful classifier.
      update.tax_id_type = null;
      if (taxIdCountry) update.tax_id_country = taxIdCountry;
    }

    // Phone: only fill when null. We don't want a one-off Checkout
    // phone overriding the user's primary contact pref. Read-modify-write
    // is fine here because each user only has one Checkout in flight.
    if (cd?.phone) {
      const { data: existing } = await admin
        .from("users")
        .select("phone_number")
        .eq("id", clientId)
        .maybeSingle();
      if (!existing?.phone_number) {
        update.phone_number = cd.phone;
      }
    }

    if (Object.keys(update).length === 0) return;

    const { error } = await admin
      .from("users")
      .update(update)
      .eq("id", clientId);
    if (error) {
      console.warn(
        "[stripe webhook] persist client fiscal data failed:",
        error,
      );
      Sentry.captureException(
        new Error("client_fiscal_data_persist_failed"),
        {
          level: "warning",
          tags: { route: "webhooks/stripe", step: "client_fiscal_data" },
          extra: {
            client_id: clientId,
            session_id: session.id,
            supabase_error: error.message,
          },
        },
      );
    }
  } catch (err) {
    // Defensive catch: under no circumstances should this break the
    // booking-confirmation flow. Log + Sentry, then swallow.
    console.warn(
      "[stripe webhook] persist client fiscal data unexpected error:",
      err,
    );
    Sentry.captureException(
      err instanceof Error
        ? err
        : new Error("client_fiscal_data_persist_unexpected"),
      {
        level: "warning",
        tags: { route: "webhooks/stripe", step: "client_fiscal_data" },
        extra: { client_id: clientId, session_id: session.id },
      },
    );
  }
}

async function insertBookingNotification(
  admin: ReturnType<typeof createAdminClient>,
  row: {
    user_id: string;
    type: string;
    title: string;
    body: string;
    booking_id: string;
    client_id?: string;
    therapist_id?: string;
  },
) {
  const { data: existing, error: existingErr } = await admin
    .from("notifications")
    .select("id")
    .eq("booking_id", row.booking_id)
    .eq("user_id", row.user_id)
    .eq("type", row.type)
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    console.warn("[stripe webhook] notification idempotency check failed:", existingErr);
    return;
  }
  if (existing) return;

  const { error: insertErr } = await admin.from("notifications").insert(row);
  if (insertErr) {
    console.warn("[stripe webhook] notification insert failed:", insertErr);
  }
}
