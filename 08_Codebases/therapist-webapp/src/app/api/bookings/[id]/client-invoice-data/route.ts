import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * GET /api/bookings/[id]/client-invoice-data
 *
 * Returns all the data the therapist needs to issue THEIR OWN
 * fiscal document (fattura / ricevuta / factura) to the client for
 * a single booking. The platform does NOT issue the therapist→client
 * invoice automatically (that's a V1.1 candidate); this endpoint is
 * the V1 quick-win that gives the therapist everything in one place
 * so they (or their accountant) can fill in their own invoicing
 * software without re-typing.
 *
 * What's NOT in here:
 *   - The €X.XX service fee Stripe passed through to the client.
 *     That is OUR revenue, not the therapist's, and it MUST NOT
 *     appear on the therapist's invoice — invoicing it would be
 *     double-billing the client.
 *   - The 20% commission. The therapist pays that to us via the
 *     monthly fattura riepilogativa (16-fattura-monthly.md), not
 *     via this transaction.
 *
 * What IS in here:
 *   - `service_price` — what the therapist owes a fiscal document for
 *     (the gross session price the client paid, BEFORE the service
 *     fee). For a €80 session where the client paid €82.62 total,
 *     this is €80.
 *   - Client identity — name (preferring `legal_name` collected at
 *     Stripe Checkout, falling back to `display_name`), email,
 *     phone. **Tax ID** + **billing address** + tax-id type/country
 *     when present (V1.1: Stripe Checkout collects them via
 *     `tax_id_collection` + `billing_address_collection: required`).
 *     Field is named `tax_id` (not `codice_fiscale`) because the
 *     value is country-dependent — IT therapists see a P.IVA or CF,
 *     ES therapists see a NIF/NIE, GB therapists see a VAT number,
 *     etc. The UI labels it appropriately.
 *   - Booking metadata — date, service name, duration.
 *   - Stripe references — payment_intent_id and a short note that
 *     the funds were received via Stripe destination charge so the
 *     accountant doesn't get confused thinking it's a separate bank
 *     transfer.
 *
 * Privacy mitigations on this endpoint (GDPR Art. 6(1)(b) processing
 * basis: necessary to perform the contract — therapist must invoice
 * the client to comply with their own tax obligations, which is also
 * Art. 6(1)(c)):
 *   1. **Auth gate** — only the booking's therapist can call this.
 *      Returns 404 (not 403) on mismatch to avoid revealing booking
 *      existence to other therapists.
 *   2. **Rate limit** — 60 calls per hour per therapist. A normal
 *      therapist exports a handful of invoices per day; 60/hour is
 *      well above legitimate use and would shut down a scraping
 *      attempt fast.
 *   3. **Audit log** — every successful read inserts a row into
 *      `public.data_access_log` capturing actor, subject, resource,
 *      and IP/UA. The admin dashboard surfaces this so we can detect
 *      a therapist with anomalous access patterns (e.g. 50 different
 *      clients in one hour).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: bookingId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Rate limit: 60 invoice exports per hour per therapist. A therapist
  // doing legitimate end-of-month bookkeeping might pull 30-40 in a
  // batch; 60 leaves headroom. Anything well above that looks like
  // scraping or an account compromise — we 429 and let the admin
  // dashboard's anomaly detector flag it.
  const rl = await withRateLimit(request, {
    key: "client-invoice-data",
    max: 60,
    windowSec: 3600,
    userId: user.id,
  });
  if (rl.response) return rl.response;

  // Use admin client because:
  //   1. `transactions` and `users` have row-level grants that block
  //      cross-row reads even by the therapist (a therapist can't
  //      SELECT a `users` row that isn't their own via RLS).
  //   2. We need to read `transactions.therapist_payout` and other
  //      sensitive financial fields that have column-level grants
  //      restricted to service_role.
  //   3. The new V1.1 fiscal columns on `users` (`legal_name`,
  //      `legal_address`, `tax_id`, `tax_id_type`, `tax_id_country`)
  //      are only writable+readable via service-role — the same
  //      table-level GRANT story as the billing form fix in
  //      /api/billing/profile.
  // The auth gate above + the explicit therapist_id check below are
  // the access control.
  const admin = createAdminClient();

  // Inline types — Supabase's auto-generated DB types in this repo
  // don't always include every column in the IDE's view, so a cast
  // is the simplest way to keep TypeScript honest about the shape
  // we actually read.
  type BookingRow = {
    id: string;
    client_id: string;
    therapist_id: string;
    status: string;
    scheduled_at: string;
    service_name: string | null;
    price: number | null;
    duration: number | null;
    currency: string | null;
    stripe_payment_intent_id: string | null;
    created_at: string;
  };
  type TxRow = {
    amount: number | null;
    total_charged: number | null;
    platform_fee: number | null;
    service_fee: number | null;
    therapist_payout: number | null;
    currency: string | null;
    refund_amount: number | null;
    status: string | null;
    payout_status: string | null;
    stripe_payment_intent_id: string | null;
  };
  type ClientRow = {
    display_name: string | null;
    email: string | null;
    phone_number: string | null;
    legal_name: string | null;
    legal_address:
      | {
          line1?: string | null;
          line2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          country?: string | null;
        }
      | null;
    tax_id: string | null;
    tax_id_type: string | null;
    tax_id_country: string | null;
  };

  const { data: bookingRaw, error: bErr } = await admin
    .from("bookings")
    .select(
      "id, client_id, therapist_id, status, scheduled_at, service_name, " +
        "price, duration, currency, stripe_payment_intent_id, created_at",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (bErr || !bookingRaw) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }
  const booking = bookingRaw as unknown as BookingRow;

  // Only the booking's therapist may export the invoice data — same
  // 404 shape as the cancel route to avoid existence leakage.
  if (booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  // Refuse export for bookings that haven't been paid yet — there's
  // no fiscal event to document. We allow `confirmed`, `in_progress`,
  // `completed`, and `cancelled` (the last one because a cancelled
  // booking that received a partial refund still needs a ricevuta or
  // a nota di credito). `pending` and `pending_payment` are excluded.
  const PAID_STATUSES = new Set(["confirmed", "in_progress", "completed", "cancelled"]);
  if (!PAID_STATUSES.has(booking.status)) {
    return NextResponse.json(
      {
        error:
          "La sessione non è ancora stata pagata: nessun documento fiscale da emettere.",
      },
      { status: 409 },
    );
  }

  // Pull the client's identity + V1.1 fiscal columns.
  // `legal_name` / `legal_address` / `tax_id*` are populated by the
  // Stripe webhook from `customer_details` after a successful Checkout
  // (see client-webapp /api/webhooks/stripe). Older bookings (pre-V1.1
  // deploy) don't have these — the modal handles the null cases by
  // showing "(da chiedere al cliente)".
  const { data: clientRaw } = await admin
    .from("users")
    .select(
      "display_name, email, phone_number, legal_name, legal_address, " +
        "tax_id, tax_id_type, tax_id_country",
    )
    .eq("id", booking.client_id)
    .maybeSingle();
  const client = clientRaw as unknown as ClientRow | null;

  // Pull the transaction row so we can echo Stripe references and
  // the canonical financial breakdown. There may be 0 or 1 rows —
  // `cancelled` bookings without a transaction (rejected before
  // payment) get a null breakdown.
  const { data: txRaw } = await admin
    .from("transactions")
    .select(
      "amount, total_charged, platform_fee, service_fee, therapist_payout, " +
        "currency, refund_amount, status, payout_status, stripe_payment_intent_id",
    )
    .eq("booking_id", bookingId)
    .maybeSingle();
  const tx = txRaw as unknown as TxRow | null;

  const sessionPrice = Number(booking.price ?? 0);
  const refundAmount = Number(tx?.refund_amount ?? 0);
  const sessionPriceNet = Math.max(0, sessionPrice - refundAmount);

  // ── Audit log (V1.1 mitigation) ─────────────────────────────────────
  //
  // GDPR Art. 5(1)(f) — "integrity and confidentiality": we keep an
  // append-only log of every read of client fiscal data. This gives
  // both us (operator) and the client (data subject, on request) a
  // verifiable trail. Best-effort: an audit-log failure does NOT
  // block the export — better to serve the legitimate therapist than
  // to silently 500 because of a logging issue. Sentry catches the
  // error so we can investigate.
  //
  // Schema reminder (created in V1.1 migration):
  //   data_access_log(actor_user_id, actor_role, action, resource_type,
  //                   resource_id, subject_user_id, ip_address, user_agent,
  //                   metadata, created_at)
  try {
    const xff = request.headers.get("x-forwarded-for");
    const ip = xff ? xff.split(",")[0].trim() : (request.headers.get("x-real-ip") ?? null);
    const ua = request.headers.get("user-agent") ?? null;
    await admin.from("data_access_log").insert({
      actor_user_id: user.id,
      actor_role: "therapist",
      action: "read_client_invoice_data",
      resource_type: "booking",
      resource_id: bookingId,
      subject_user_id: booking.client_id,
      ip_address: ip,
      user_agent: ua,
      metadata: {
        service_name: booking.service_name,
        scheduled_at: booking.scheduled_at,
        has_tax_id: !!client?.tax_id,
      },
    });
  } catch (logErr) {
    // Swallow — must not block the response.
    console.warn("[client-invoice-data] audit log insert failed:", logErr);
  }

  return NextResponse.json({
    data: {
      booking: {
        id: booking.id,
        scheduled_at: booking.scheduled_at,
        service_name: booking.service_name ?? "Sessione",
        duration_min: booking.duration ?? 60,
        currency: (booking.currency ?? "eur").toLowerCase(),
        status: booking.status,
        created_at: booking.created_at,
      },
      client: {
        // Prefer the legal name the client entered at Stripe Checkout
        // (this is what goes on the invoice); fall back to display_name
        // for clients who paid before V1.1 deploy.
        legal_name: client?.legal_name ?? null,
        display_name: client?.display_name ?? null,
        email: client?.email ?? null,
        phone: client?.phone_number ?? null,
        // Country-agnostic tax identifier. The therapist UI labels it
        // based on `tax_id_type` (e.g. `it_vat` → "P.IVA",
        // `eu_vat` → "VAT UE", `us_ein` → "EIN", etc.) — keeps the
        // schema generic for international clients.
        tax_id: client?.tax_id ?? null,
        tax_id_type: client?.tax_id_type ?? null,
        tax_id_country: client?.tax_id_country ?? null,
        // Billing address as Stripe returns it. Keys mirror Stripe's
        // Address shape (line1, line2, city, state, postal_code, country)
        // so the UI can format it consistently across countries.
        legal_address: client?.legal_address ?? null,
      },
      // The amount the therapist owes a fiscal document FOR. NOT the
      // amount the client actually transferred — that includes the
      // service fee which is OUR revenue, not the therapist's.
      service_price: sessionPrice,
      // If a refund happened, this is what was actually retained.
      // The therapist may need to issue a nota di credito for the
      // refunded portion — that's a separate flow.
      service_price_net_of_refunds: sessionPriceNet,
      refund_amount: refundAmount,
      // Stripe reference data the therapist's accountant will want.
      stripe: {
        payment_intent_id:
          booking.stripe_payment_intent_id ?? tx?.stripe_payment_intent_id ?? null,
        transaction_status: tx?.status ?? null,
        payout_status: tx?.payout_status ?? null,
      },
      // Disclosure for the therapist: this is the reconciliation,
      // not the figure to invoice. Helps explain to their accountant
      // why the bank deposit doesn't equal the service price.
      reconciliation: {
        client_paid_total: tx ? Number(tx.total_charged ?? 0) : null,
        platform_commission_20pct: tx ? Number(tx.platform_fee ?? 0) : null,
        platform_service_fee: tx ? Number(tx.service_fee ?? 0) : null,
        therapist_net_received: tx ? Number(tx.therapist_payout ?? 0) : null,
      },
    },
  });
}
