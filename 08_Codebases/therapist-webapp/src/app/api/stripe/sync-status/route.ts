import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/stripe/sync-status
 *
 * Pull the therapist's Stripe Connect account state directly from
 * Stripe and update the DB to reflect it. Used to recover from the
 * race condition where the `account.updated` webhook fires during
 * onboarding completion *before* Stripe has fully activated the
 * `charges_enabled` / `payouts_enabled` capabilities, leaving our DB
 * stuck at `onboarding_pending` while Stripe sees the account as live.
 *
 * Idempotent + safe to call repeatedly. The settings page calls this
 * on mount whenever it sees `status = 'onboarding_pending'` AND a
 * `stripe_connected_account_id` is set (i.e. onboarding completed but
 * webhook may have missed the final activation event).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Generous limit — settings page may call this on every mount,
    // therapists may also click "Refresh" manually.
    const limit = await withRateLimit(request, {
      key: "stripe-sync-status",
      max: 30,
      windowSec: 600,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("therapist_profiles")
      .select("stripe_connected_account_id, stripe_account_status, stripe_country")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_connected_account_id) {
      return NextResponse.json({
        synced: false,
        reason: "no_account",
        status: profile?.stripe_account_status ?? "not_connected",
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: "Stripe non configurato" }, { status: 500 });
    }

    // Fetch the live Stripe account state. We don't use Stripe-Account
    // header here because we're reading a connected account FROM the
    // platform's perspective (which is allowed — Connect platforms
    // can read their connected accounts directly via /v1/accounts/{id}).
    const res = await fetch(
      `https://api.stripe.com/v1/accounts/${profile.stripe_connected_account_id}`,
      { headers: { Authorization: `Bearer ${stripeKey}` } },
    );

    if (!res.ok) {
      const detail = await res.text();
      console.error("[stripe/sync-status] Stripe fetch failed:", res.status, detail.slice(0, 200));
      return NextResponse.json(
        { error: "Impossibile leggere lo stato Stripe" },
        { status: 502 },
      );
    }

    const account = await res.json();

    // Same logic as the Edge Function webhook handler — keep in sync.
    let newStatus = "onboarding_pending";
    if (account.charges_enabled && account.payouts_enabled) {
      newStatus = "active";
    } else if (account.requirements?.disabled_reason) {
      newStatus = "restricted";
    } else if (account.details_submitted) {
      newStatus = "onboarding_pending";
    }

    // Skip the write if nothing changed — saves a roundtrip + keeps
    // updated_at meaningful (only flips when actual state shifts).
    if (
      newStatus === profile.stripe_account_status &&
      (account.country ?? null) === profile.stripe_country
    ) {
      return NextResponse.json({
        synced: true,
        changed: false,
        status: newStatus,
      });
    }

    const { error: updateErr } = await admin
      .from("therapist_profiles")
      .update({
        stripe_account_status: newStatus,
        ...(account.country ? { stripe_country: account.country } : {}),
      })
      .eq("id", user.id);

    if (updateErr) {
      console.error("[stripe/sync-status] DB update failed:", updateErr);
      return NextResponse.json({ error: "Aggiornamento DB fallito" }, { status: 500 });
    }

    return NextResponse.json({
      synced: true,
      changed: true,
      previous_status: profile.stripe_account_status,
      status: newStatus,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("[stripe/sync-status] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
