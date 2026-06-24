import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { NextResponse } from "next/server";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

/**
 * POST /api/admin/set-payout-schedule
 *
 * One-off admin endpoint: sets all existing Stripe Connect accounts to
 * weekly payouts (every Friday) with a 14-day delay for dispute protection.
 *
 * Stripe holds funds for 14 days after the charge, then pays out on the
 * next Friday. This gives ~2–3 weeks of protection per transaction.
 *
 * Requires STRIPE_SECRET_KEY in environment variables.
 */
export async function POST() {
  try {
    // ── Auth: ADMIN_EMAILS whitelist AND users.is_admin DB flag ──────
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    if (!STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: "STRIPE_SECRET_KEY not configured in environment" },
        { status: 500 }
      );
    }

    // ── Fetch all connected accounts from Supabase ──────────────────
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: therapists, error: dbError } = await supabaseAdmin
      .from("therapist_profiles")
      .select("id, stripe_connected_account_id, stripe_account_status")
      .not("stripe_connected_account_id", "is", null);

    if (dbError) {
      return NextResponse.json(
        { error: "Database error", detail: dbError.message },
        { status: 500 }
      );
    }

    if (!therapists || therapists.length === 0) {
      return NextResponse.json({
        message: "No connected accounts found",
        updated: 0,
      });
    }

    // ── Update each connected account's payout schedule ─────────────
    const results: Array<{
      account_id: string;
      therapist_id: string;
      status: string;
      payout_schedule?: string;
      error?: string;
    }> = [];

    for (const therapist of therapists) {
      const accountId = therapist.stripe_connected_account_id;
      try {
        const res = await fetch(
          `https://api.stripe.com/v1/accounts/${accountId}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              "settings[payouts][schedule][interval]": "weekly",
              "settings[payouts][schedule][weekly_anchor]": "friday",
              "settings[payouts][schedule][delay_days]": "14",
            }).toString(),
          }
        );

        const data = await res.json();

        if (!res.ok) {
          results.push({
            account_id: accountId,
            therapist_id: therapist.id,
            status: "error",
            error: data.error?.message || `HTTP ${res.status}`,
          });
        } else {
          const schedule = data.settings?.payouts?.schedule;
          results.push({
            account_id: accountId,
            therapist_id: therapist.id,
            status: "updated",
            payout_schedule: schedule
              ? `${schedule.interval}, delay ${schedule.delay_days}d, anchor ${schedule.weekly_anchor || schedule.monthly_anchor || "n/a"}`
              : "updated",
          });
        }
      } catch (err) {
        results.push({
          account_id: accountId,
          therapist_id: therapist.id,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.status === "updated").length;

    return NextResponse.json({
      message: `Updated ${successCount}/${therapists.length} connected accounts → weekly payouts (Friday) with 14-day delay`,
      updated: successCount,
      total: therapists.length,
      results,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
