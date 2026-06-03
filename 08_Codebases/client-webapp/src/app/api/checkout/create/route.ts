import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculatePaymentAmounts } from "@/lib/payments/fee-config";
import { buildCalendarLinks } from "@/lib/booking/calendar-links";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { resolveDayRanges, type Availability, type WeekdayKey } from "@/lib/booking/slots";

/**
 * True when a Supabase/Postgres error means the slot was taken concurrently.
 * Two sources, both added/extended in migration
 * 20260603120000_bookings_overlap_exclusion_constraint:
 *   - the `bookings_no_overlap` EXCLUDE constraint → SQLSTATE 23P01
 *     (exclusion_violation), the race-proof backstop fired at INSERT.
 *   - the `prevent_overlapping_active_bookings` trigger → SQLSTATE P0001
 *     raising "Time slot is no longer available".
 * The pre-insert conflict SELECT above catches the common case; this catches
 * the tiny TOCTOU window between that SELECT and the INSERT. We surface it as
 * a 409 so the slot picker tells the user to pick another time instead of
 * showing a generic 500.
 */
function isSlotConflictError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === "23P01" || err.code === "P0001") return true;
  return /no longer available|non è più disponibile/i.test(err.message ?? "");
}

/**
 * POST /api/checkout/create
 *
 * Body: {
 *   therapistId: string,
 *   serviceId: string,
 *   slotIso: string,         // ISO timestamp picked from the slot picker
 * }
 *
 * Creates a Stripe Checkout Session in `payment` mode with Connect's
 * `application_fee_amount` + `transfer_data.destination` so payment goes
 * directly to the therapist's connected account, minus the platform's
 * commission + service fee. Booking row is created here with
 * status='pending_payment' and stripe_payment_intent_id is filled in by
 * the webhook once the payment lands.
 *
 * The webhook (POST /api/webhooks/stripe) flips the booking to
 * `confirmed` and inserts a transactions row.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Rate limit: 10 checkout sessions per 10 min per user. Legit
    // booking flow rarely re-creates the session more than 1-2 times
    // (back-button + retry). Higher = either abuse, accidental
    // double-tap stalking the UI, or a bot enumerating therapists.
    const rl = await withRateLimit(request, {
      key: "checkout-create",
      max: 10,
      windowSec: 600,
      userId: user.id,
    });
    if (rl.response) return rl.response;

    // ── GDPR Art. 9(2)(a) consent gate ───────────────────────────────────
    //
    // A booking generates "data concerning health" (special-category
    // personal data). We require explicit recorded consent in
    // `tos_acceptances.health_data_accept = TRUE` before opening a
    // Stripe Checkout session. Without this server-side check the
    // signup-form checkbox is window dressing — a client could
    // revoke via direct DB write, come from a pre-migration NULL
    // row, or hit this route from a build that doesn't show the
    // checkbox.
    //
    // 412 Precondition Failed signals to the frontend that the
    // booking intent is valid but a missing precondition (consent)
    // blocks it. The booking page should re-prompt the user with a
    // modal that POSTs a fresh consent row before retrying.
    {
      const consentAdmin = createAdminClient();
      const { data: latestConsent } = await consentAdmin
        .from("tos_acceptances_latest")
        .select("health_data_accept")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!latestConsent?.health_data_accept) {
        return NextResponse.json(
          {
            error: "health_data_consent_required",
            detail:
              "Per prenotare una sessione devi prestare il consenso esplicito al trattamento dei dati relativi alla salute (Art. 9 GDPR). Aggiorna le preferenze nelle Impostazioni dell'account.",
          },
          { status: 412 },
        );
      }
    }

    const body = await request.json().catch(() => ({}));
    const { therapistId, serviceId, slotIso } = body as {
      therapistId?: string;
      serviceId?: string;
      slotIso?: string;
    };
    if (!therapistId || !serviceId || !slotIso) {
      return NextResponse.json(
        { error: "therapistId, serviceId e slotIso sono richiesti" },
        { status: 400 },
      );
    }

    // Validate inputs from the DB rather than trusting the client
    // payload. We use the admin client (service role) for the
    // therapist_profiles read because:
    //   1. `stripe_connected_account_id` is required to build the
    //      Connect transfer_data.destination, and that column is NOT
    //      exposed in the `therapist_profiles_public` view (by design —
    //      we never leak acct_xxx to clients).
    //   2. The caller here is always a client (not the therapist
    //      themselves) so RLS's "Therapists can read own profile"
    //      policy wouldn't match and the user-scoped client would
    //      return no rows, firing "Operatore non disponibile".
    // Service-role usage is safe here: we've already verified the
    // caller's auth session above (supabase.auth.getUser()) and we
    // only expose the *server*-side decisions derived from the data
    // (a Stripe Checkout URL, not the raw columns).
    //
    // therapist_services has NO `currency` column — only
    // therapist_profiles does. Currency is taken exclusively from
    // profile.currency below.
    const admin = createAdminClient();
    const [{ data: service }, { data: profile }] = await Promise.all([
      supabase
        .from("therapist_services")
        .select("id, name, duration, price, is_active, is_intro_call, therapist_id")
        .eq("id", serviceId)
        .maybeSingle(),
      admin
        .from("therapist_profiles")
        .select(
          "id, display_name, stripe_connected_account_id, stripe_account_status, stripe_country, currency, approval_status, is_approved, availability",
        )
        .eq("id", therapistId)
        .maybeSingle(),
    ]);

    if (!service || !service.is_active) {
      return NextResponse.json({ error: "Servizio non disponibile" }, { status: 404 });
    }
    if (service.therapist_id !== therapistId) {
      return NextResponse.json({ error: "Servizio non associato all’operatore" }, { status: 400 });
    }
    if (!profile || profile.approval_status !== "approved" || !profile.is_approved) {
      return NextResponse.json({ error: "Operatore non disponibile" }, { status: 404 });
    }
    if (!profile.stripe_connected_account_id || profile.stripe_account_status !== "active") {
      return NextResponse.json(
        {
          error:
            "L’operatore non ha ancora completato la configurazione dei pagamenti. Riprova pi\u00f9 tardi.",
        },
        { status: 422 },
      );
    }

    const slotDate = new Date(slotIso);
    if (isNaN(slotDate.getTime()) || slotDate.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Slot non valido" }, { status: 400 });
    }

    // Defense-in-depth: the SlotPicker on the client only shows slots
    // matching the therapist's availability + free of conflicts, but the
    // server must not trust the body. An attacker can POST any future
    // ISO timestamp here. Two independent checks:
    //
    //  1. Conflict check — any LIVE booking already at this slot for
    //     this therapist? Reject as 409 (the slot was just taken).
    //  2. Availability window — does the slot fall within the
    //     therapist's recurring availability for that weekday? If
    //     `availability` is missing (legacy data) we accept on the
    //     conflict-check alone.
    {
      const liveStatuses = [
        "pending",
        "pending_payment",
        "confirmed",
        "in_progress",
        "reschedule_pending",
      ];
      const slotEndMs =
        slotDate.getTime() + (service.duration ?? 60) * 60_000;
      // Anything that overlaps [slotStart, slotStart+duration) for
      // this therapist counts as a conflict — we use a tight equality
      // check on the start because slots are computed on a 15-min
      // grid and shouldn't overlap unless the therapist's availability
      // changed mid-flight.
      const { data: existing } = await admin
        .from("bookings")
        .select("id, scheduled_at, duration")
        .eq("therapist_id", therapistId)
        .in("status", liveStatuses)
        .gte("scheduled_at", new Date(slotDate.getTime() - 4 * 60 * 60 * 1000).toISOString())
        .lte("scheduled_at", new Date(slotEndMs + 4 * 60 * 60 * 1000).toISOString());
      const overlap = (existing ?? []).find((b) => {
        const bStart = new Date(b.scheduled_at).getTime();
        const bEnd = bStart + (b.duration ?? 60) * 60_000;
        return bStart < slotEndMs && bEnd > slotDate.getTime();
      });
      if (overlap) {
        return NextResponse.json(
          { error: "Questo orario non è più disponibile. Scegli un altro slot." },
          { status: 409 },
        );
      }

      const availability = profile.availability as Availability | null;
      if (availability?.recurring) {
        const tz = availability.timezone || "Europe/Rome";
        const tzParts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          weekday: "short",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(slotDate);
        const get = (t: string) => tzParts.find((p) => p.type === t)?.value ?? "";
        const dayKey = (
          {
            Sun: "sunday",
            Mon: "monday",
            Tue: "tuesday",
            Wed: "wednesday",
            Thu: "thursday",
            Fri: "friday",
            Sat: "saturday",
          } as Record<string, WeekdayKey>
        )[get("weekday")];
        const slotMins =
          parseInt(get("hour") || "0", 10) * 60 +
          parseInt(get("minute") || "0", 10);
        const slotEndMins = slotMins + (service.duration ?? 60);
        const dateStr = `${get("year")}-${get("month")}-${get("day")}`;
        // Day-off / special-hours exceptions applied on top of recurring,
        // via the shared helper (identical semantics to the slot picker).
        const ranges = resolveDayRanges(availability, dateStr, dayKey);
        const fits = ranges.some((r) => {
          const [sh, sm] = r.start.split(":").map(Number);
          const [eh, em] = r.end.split(":").map(Number);
          return slotMins >= sh * 60 + sm && slotEndMins <= eh * 60 + em;
        });
        if (!fits) {
          return NextResponse.json(
            { error: "Questo orario non è in disponibilità. Scegli uno slot dal calendario." },
            { status: 422 },
          );
        }
      }
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: "Server payments non configurato" },
        { status: 500 },
      );
    }
    const stripe = new Stripe(stripeKey);

    // Compute amounts from server-trusted fields (price + therapist country)
    const sessionPriceCents = Math.round((service.price ?? 0) * 100);
    if (sessionPriceCents <= 0) {
      // Free intro calls bypass Stripe entirely. The therapist already
      // declared this slot bookable (via their availability), so we
      // auto-confirm the booking here — no manual approval step. This
      // also generates the LiveKit room id immediately so the booking
      // shows up in both calendars (client + therapist) and the "join
      // call" CTA works the moment the slot arrives.
      //
      // The `hu-…16chars` shape mirrors what the Stripe webhook
      // generates for paid bookings — keeps the room-id format
      // consistent across the two creation paths.
      // We pre-generate the booking id here (Postgres default would
      // also work, but doing it client-side lets us derive the room
      // id in a single insert).
      const bookingId = crypto.randomUUID();
      const videoRoom = `hu-${bookingId.replace(/-/g, "").slice(0, 16)}`;
      const { data: bk, error: bkErr } = await supabase
        .from("bookings")
        .insert({
          id: bookingId,
          client_id: user.id,
          therapist_id: therapistId,
          service_id: service.id,
          service_name: service.name,
          duration: service.duration,
          price: 0,
          currency: profile.currency || "eur",
          scheduled_at: slotDate.toISOString(),
          status: "confirmed",
          video_room_id: videoRoom,
        })
        .select("id")
        .single();
      if (bkErr) {
        if (isSlotConflictError(bkErr)) {
          return NextResponse.json(
            { error: "Questo orario non è più disponibile. Scegli un altro slot." },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: bkErr.message }, { status: 500 });
      }
      // Fire booking-confirmed notifications (client + therapist). Same
      // channels as the paid path uses from the Stripe webhook — keeps
      // both flows in parallel. We `await` here: Vercel terminates the
      // serverless function once the response is sent, killing any
      // in-flight Promise-based fetches. Internally the function uses
      // `Promise.allSettled` so a Brevo outage can't fail the checkout.
      await notifyFreeBookingConfirmed({
        bookingId: bk.id,
        clientId: user.id,
        therapistId,
        therapistName: profile.display_name ?? "Operatore",
        scheduledAt: slotDate.toISOString(),
        serviceName: service.name,
        duration: service.duration,
      });
      return NextResponse.json({
        free: true,
        bookingId: bk.id,
        redirectUrl: `/checkout/success?free=1&booking_id=${bk.id}`,
      });
    }

    const country = (profile.stripe_country || "IT").toUpperCase();
    const calc = calculatePaymentAmounts(sessionPriceCents, country);
    const currency = (profile.currency || "eur").toLowerCase();

    // ── Resolve or create the Stripe Customer for this client ───────────
    //
    // We persist `users.stripe_customer_id` so that:
    //  (a) **Repeat checkouts reuse the same Customer.** Stripe surfaces
    //      the previously-saved tax IDs and billing address as prefilled
    //      defaults on the next session — much better UX than re-typing
    //      a P.IVA on every booking.
    //  (b) **`customer_update: { address, name: "auto" }` works.** That
    //      flag on the Checkout Session below tells Stripe to copy what
    //      the user enters in Checkout back onto the Customer object,
    //      keeping the fiscal-data store of record (Stripe) in sync. It
    //      is rejected by the API unless `customer` is also provided.
    //  (c) **The therapist's invoice export reads consistent data.** The
    //      Stripe webhook persists `customer_details` (name, address,
    //      tax_ids[0]) onto the `users` row using these columns added in
    //      the V1.1 migration: `legal_name`, `legal_address`, `tax_id`,
    //      `tax_id_type`, `tax_id_country`. The therapist's
    //      `/api/bookings/[id]/client-invoice-data` endpoint reads those
    //      same columns to populate the invoice export modal — so the
    //      therapist sees fresh data the moment Stripe confirms the
    //      payment.
    //
    // Fields are deliberately MINIMAL on creation: just email + name +
    // metadata. Address, phone, and tax IDs are filled in by Checkout
    // itself via `customer_update` + `tax_id_collection`.
    let stripeCustomerId: string | null = null;
    {
      const { data: u } = await admin
        .from("users")
        .select("stripe_customer_id, email, display_name")
        .eq("id", user.id)
        .maybeSingle();
      stripeCustomerId = u?.stripe_customer_id ?? null;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: user.email ?? u?.email ?? undefined,
          name: u?.display_name ?? undefined,
          metadata: {
            supabase_user_id: user.id,
          },
        });
        stripeCustomerId = customer.id;
        // Persist immediately, before the Checkout Session is even
        // created. If the session creation fails (e.g. transient
        // network error) the next retry reuses this Customer rather
        // than creating an orphan. We use the admin client here
        // because table-level grants on `users` block authenticated
        // UPDATEs to certain identity columns; service-role bypasses.
        await admin
          .from("users")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("id", user.id);
      }
    }

    // Create the booking in pending_payment first so the webhook has
    // somewhere to attach the payment_intent_id.
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .insert({
        client_id: user.id,
        therapist_id: therapistId,
        service_id: service.id,
        service_name: service.name,
        duration: service.duration,
        price: service.price,
        currency,
        scheduled_at: slotDate.toISOString(),
        status: "pending_payment",
        platform_fee: calc.platformFeeCents / 100,
        therapist_payout: calc.therapistPayoutCents / 100,
      })
      .select("id")
      .single();
    if (bookingErr || !booking) {
      // Race-proof guard fired (another client grabbed the slot in the
      // window between the conflict SELECT above and this INSERT) → 409 so
      // the UI re-prompts for a different time instead of a generic error.
      if (isSlotConflictError(bookingErr)) {
        return NextResponse.json(
          { error: "Questo orario non è più disponibile. Scegli un altro slot." },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: bookingErr?.message || "Errore nella creazione prenotazione" },
        { status: 500 },
      );
    }

    // Build absolute URLs for Stripe redirects
    const origin =
      request.headers.get("origin") ||
      `https://${request.headers.get("host") || "app.holisticunity.app"}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        // Bind the session to the persistent Customer (resolved/created
        // above). Replaces the previous `customer_email` — `customer`
        // takes precedence and gives us address+name auto-sync via
        // `customer_update`.
        customer: stripeCustomerId,
        // Sync billing address + name from Checkout back to the Customer
        // object so subsequent sessions prefill them. Without this the
        // user re-enters address every time.
        customer_update: {
          address: "auto",
          name: "auto",
        },
        // ── Fiscal data collection (V1.1) ───────────────────────────────
        //
        // We collect the data needed for the therapist to issue a fiscal
        // document (fattura/ricevuta/factura) at Checkout time rather
        // than asking the therapist to chase the client out-of-band.
        //
        //  - `billing_address_collection: "required"` — every IT B2C
        //    receipt needs a postal address; non-IT countries either
        //    need it for the cross-border invoice or for VAT MOSS/OSS.
        //    We always require it; clients never bypass this step.
        //  - `phone_number_collection.enabled: true` — useful for
        //    therapists who need to call the client (no-show etc.) and
        //    we already gather phone via the booking flow on iOS.
        //  - `custom_fields: [{ key: "cf", ... optional: true }]` — a
        //    single optional text field labelled "Codice fiscale". We
        //    deliberately do NOT use Stripe's `tax_id_collection`
        //    because that field is built for B2B (P.IVA / VAT / EIN)
        //    and exposes a country-by-country VAT-type dropdown that
        //    is misleading for our service: we sell exclusively to
        //    private individuals (B2C). An Italian individual has a
        //    Codice Fiscale, not a P.IVA — the two are different
        //    identifiers, and Stripe doesn't have an `it_cf` tax-id
        //    type. A free-text optional field is the cleanest UX:
        //    Italian clients enter their CF, foreign clients can
        //    enter their local equivalent (NIF, NIE, SSN, etc.), and
        //    everyone else just leaves it blank and gets a ricevuta.
        billing_address_collection: "required",
        phone_number_collection: { enabled: true },
        custom_fields: [
          {
            key: "cf",
            type: "text",
            label: {
              type: "custom",
              custom: "Codice fiscale (opzionale, per fattura)",
            },
            optional: true,
            text: {
              minimum_length: 1,
              maximum_length: 32,
            },
          },
        ],
        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: `${service.name} \u2014 ${profile.display_name ?? ""}`.trim(),
                description: `${service.duration} min \u00b7 ${slotDate.toLocaleString(
                  "it-IT",
                  { dateStyle: "full", timeStyle: "short" },
                )}`,
              },
              unit_amount: calc.totalChargedCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: calc.applicationFeeCents,
          transfer_data: {
            destination: profile.stripe_connected_account_id,
          },
          metadata: {
            booking_id: booking.id,
            client_id: user.id,
            therapist_id: therapistId,
            service_id: service.id,
          },
        },
        // Stripe also stores metadata at the session level — webhooks for
        // `checkout.session.completed` rely on session.metadata, while
        // `payment_intent.succeeded` uses payment_intent.metadata. Set both.
        metadata: {
          booking_id: booking.id,
          client_id: user.id,
          therapist_id: therapistId,
          service_id: service.id,
        },
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
        cancel_url: `${origin}/dashboard/therapists/${therapistId}?cancelled=1`,
        // ── Short hard expiry on the Checkout Session ────────────────────
        // Stripe's default is 24h, but we have an hourly cleanup cron at
        // `/api/cron/cleanup-pending-payment` that flips abandoned
        // `pending_payment` bookings to `cancelled` after 30 minutes so
        // the slot becomes bookable by another client. If Stripe's
        // expiry was 24h and the cron fired at minute 30, the user could
        // still complete payment any time within those 24h — leaving us
        // with a successful charge attached to a CANCELLED booking
        // (the slot may already be re-booked by someone else).
        //
        // Setting `expires_at` close to 30 min aligns Stripe's lifecycle
        // with ours: Stripe stops accepting payment before our cleanup cron
        // releases the slot, eliminating most of the race. The webhook still
        // has a defensive
        // "cancelled-but-paid" branch (in `webhooks/stripe/route.ts`)
        // that auto-refunds the rare in-flight payment, so a 30s
        // window between expiry and cron cancel can't strand a charge.
        //
        // Stripe allows custom expiry from 30 min to 24h after creation.
        // Use 31 min so API/network latency cannot turn the timestamp into
        // "less than 30 min in the future" by the time Stripe validates it.
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      },
      {
        // Idempotency key prevents a double-tap on the "Paga" button
        // from creating two Stripe Checkout Sessions for the same
        // booking — Stripe returns the same session id on retry.
        // Same pattern the iOS Edge Function uses (`pi-${bookingId}`).
        idempotencyKey: `checkout-${booking.id}`,
      },
    );

    return NextResponse.json({ url: session.url, bookingId: booking.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("[checkout/create] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Notify both parties that a free booking is confirmed. Mirrors the
 * paid-booking Stripe-webhook path (same Brevo templates 3+4, same
 * notifications rows) so the in-app + email UX is identical regardless
 * of whether the session was paid or free.
 *
 * Best-effort — any Brevo or notifications failure is swallowed so
 * it can't make the checkout response fail after we've already
 * inserted the booking.
 */
async function notifyFreeBookingConfirmed(args: {
  bookingId: string;
  clientId: string;
  therapistId: string;
  therapistName: string;
  scheduledAt: string;
  serviceName: string | null;
  duration: number | null;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://app.holisticunity.app";

  const calendar = buildCalendarLinks({
    bookingId: args.bookingId,
    scheduledAt: args.scheduledAt,
    durationMinutes: args.duration ?? 60,
    serviceName: args.serviceName ?? "Sessione",
    therapistName: args.therapistName,
    callUrl: `${appOrigin}/call/${args.bookingId}`,
  });

  // Pre-formatted Italian date/time for the existing Brevo template
  // (which expects `session_date`, `session_time`, `amount` params).
  const sessionDate = new Date(args.scheduledAt);
  const sessionDateStr = sessionDate.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const sessionTimeStr = sessionDate.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const TPL_CLIENT = 3;
  const TPL_THERAPIST = 4;

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
          // Legacy param names (existing Brevo template).
          session_date: sessionDateStr,
          session_time: sessionTimeStr,
          amount: "Gratuita",
          // Richer params for future template upgrades.
          booking_id: args.bookingId,
          service_name: args.serviceName ?? "Sessione",
          scheduled_at: args.scheduledAt,
          duration_minutes: args.duration ?? 60,
          therapist_name: args.therapistName,
          google_cal_url: calendar.googleCalUrl,
          outlook_cal_url: calendar.outlookCalUrl,
          ics_url: calendar.icsDataUrl,
          call_url: `${appOrigin}/call/${args.bookingId}`,
        },
        tags: ["booking_confirmed", "free"],
      }),
    }).catch((err) => {
      console.warn("[checkout/create] brevo send failed (non-blocking):", err);
    });

  const admin = createAdminClient();
  await Promise.allSettled([
    admin.from("notifications").insert([
      {
        user_id: args.clientId,
        type: "booking_confirmed",
        title: "Prenotazione confermata",
        body: `La tua sessione "${args.serviceName ?? "Sessione"}" è confermata.`,
        booking_id: args.bookingId,
        therapist_id: args.therapistId,
      },
      {
        user_id: args.therapistId,
        type: "booking_confirmed",
        title: "Nuova prenotazione",
        body: `Hai una nuova sessione "${args.serviceName ?? "Sessione"}" in calendario.`,
        booking_id: args.bookingId,
        client_id: args.clientId,
      },
    ]),
    sendEmail(args.clientId, TPL_CLIENT),
    sendEmail(args.therapistId, TPL_THERAPIST),
  ]);
}
