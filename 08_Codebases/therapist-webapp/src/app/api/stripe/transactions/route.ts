import { createClient } from "@/lib/supabase/server";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

/**
 * Live-fetches the therapist's Stripe charges + payouts (last 30 items
 * each), acting *as* the connected account (`Stripe-Account` header).
 *
 * Used by the Earnings page to show real Stripe activity (income +
 * payouts) regardless of whether our `bookings`/`transactions` table
 * has corresponding rows. This catches:
 *   - Charges from iOS app payments (which may not write to web DB)
 *   - Historical charges from before the current schema
 *   - Charges processed when our DB was temporarily out of sync
 *
 * The DB-driven KPI cards above the table show OUR view of sessions
 * (with category, IVA breakdown, etc); this section shows Stripe's
 * view of cash. Different lenses on the same money flow.
 */

type StripeCharge = {
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
  metadata?: Record<string, string>;
};

type StripePayout = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  arrival_date: number;
  status: string;
  description: string | null;
};

type StripeList<T> = { data?: Array<T> };

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Generous limit — earnings page may refresh + therapist may scroll
    // through periods. This costs Stripe API calls so don't overdo it.
    const limit = await withRateLimit(request, {
      key: "stripe-transactions",
      max: 30,
      windowSec: 600,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("therapist_profiles")
      .select("stripe_connected_account_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_connected_account_id) {
      return NextResponse.json({
        connected: false,
        charges: [],
        payouts: [],
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: "Stripe non configurato" },
        { status: 500 },
      );
    }

    const stripeHeaders = {
      Authorization: `Bearer ${stripeKey}`,
      "Stripe-Account": profile.stripe_connected_account_id,
    };

    // Pull in parallel — charges (income) + payouts (transfers to bank).
    // 30 items each is enough to cover ~1 month of activity for active
    // therapists; we paginate later if needed.
    const [chargesRes, payoutsRes] = await Promise.all([
      fetch("https://api.stripe.com/v1/charges?limit=30", { headers: stripeHeaders }),
      fetch("https://api.stripe.com/v1/payouts?limit=30", { headers: stripeHeaders }),
    ]);

    if (!chargesRes.ok) {
      const detail = await chargesRes.text();
      console.error("[stripe/transactions] charges fetch failed:", chargesRes.status, detail.slice(0, 200));
      return NextResponse.json(
        { error: "Impossibile leggere le transazioni Stripe" },
        { status: 502 },
      );
    }

    const chargesData: StripeList<StripeCharge> = await chargesRes.json();
    const payoutsData: StripeList<StripePayout> = payoutsRes.ok ? await payoutsRes.json() : { data: [] };

    return NextResponse.json({
      connected: true,
      charges: (chargesData.data || []).map((c) => ({
        id: c.id,
        amount: c.amount,
        amount_captured: c.amount_captured,
        amount_refunded: c.amount_refunded,
        currency: c.currency,
        created: c.created,
        status: c.status,
        description: c.description,
        refunded: c.refunded,
        paid: c.paid,
      })),
      payouts: (payoutsData.data || []).map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        created: p.created,
        arrival_date: p.arrival_date,
        status: p.status,
        description: p.description,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("[stripe/transactions] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
