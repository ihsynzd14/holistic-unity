import { createClient } from "@/lib/supabase/server";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

/**
 * Live-fetches the therapist's Stripe Connect balance and next scheduled
 * payout, acting *as* the connected account (`Stripe-Account` header).
 *
 * Used by the Earnings page to show "Saldo Stripe" alongside the
 * DB-driven session/commission metrics. The Balance API is the source
 * of truth for actual money — Postgres is only the source of truth for
 * session metadata + commission breakdown (which Stripe doesn't track).
 *
 * Why a Next.js route and not direct from the client?
 *   The client doesn't have STRIPE_SECRET_KEY (and never will). All
 *   Stripe API calls must be server-side; the route also enforces auth
 *   + rate limiting before forwarding to Stripe.
 */

type Money = { amount: number; currency: string };

type StripeBalance = {
  available?: Array<Money>;
  pending?: Array<Money>;
};

type StripePayout = {
  id: string;
  amount: number;
  currency: string;
  arrival_date: number; // unix seconds
  status: string;
};

type StripePayoutsList = {
  data?: Array<StripePayout>;
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Rate limit: 60 reads / 10 min — generous for page refresh + the
    // 60-second polling we set up on the Earnings page.
    const limit = await withRateLimit(request, {
      key: "stripe-balance",
      max: 60,
      windowSec: 600,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    // Use admin client to read the connected account ID — column-level
    // grants block stripe_connected_account_id from anon/authenticated
    // roles. This endpoint already verified the caller is the owner.
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("therapist_profiles")
      .select("stripe_connected_account_id, stripe_account_status")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_connected_account_id) {
      return NextResponse.json({
        connected: false,
        available: [],
        pending: [],
        next_payout: null,
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
      // Act as the connected account — required for all reads on
      // Express accounts (their Balance is segregated from the
      // platform's main balance).
      "Stripe-Account": profile.stripe_connected_account_id,
    };

    // Fetch balance + next pending payout in parallel
    const [balanceRes, payoutsRes] = await Promise.all([
      fetch("https://api.stripe.com/v1/balance", { headers: stripeHeaders }),
      fetch(
        "https://api.stripe.com/v1/payouts?limit=1&status=pending",
        { headers: stripeHeaders },
      ),
    ]);

    if (!balanceRes.ok) {
      const detail = await balanceRes.text();
      console.error("[stripe/balance] balance fetch failed:", balanceRes.status, detail);
      return NextResponse.json(
        { error: "Impossibile leggere il saldo Stripe" },
        { status: 502 },
      );
    }

    const balance: StripeBalance = await balanceRes.json();
    const payouts: StripePayoutsList = payoutsRes.ok ? await payoutsRes.json() : { data: [] };
    const nextPayout = payouts.data?.[0] ?? null;

    return NextResponse.json({
      connected: true,
      account_status: profile.stripe_account_status,
      // Stripe returns amounts in the smallest currency unit (cents for EUR).
      // We pass through as-is so the UI can format consistently.
      available: balance.available || [],
      pending: balance.pending || [],
      next_payout: nextPayout
        ? {
            amount: nextPayout.amount,
            currency: nextPayout.currency,
            arrival_date: nextPayout.arrival_date,
            status: nextPayout.status,
          }
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("[stripe/balance] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
