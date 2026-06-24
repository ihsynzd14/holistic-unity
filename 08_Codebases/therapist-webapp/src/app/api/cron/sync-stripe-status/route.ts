import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface StripeAccount {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  country?: string;
  requirements?: { disabled_reason?: string | null };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * GET /api/cron/sync-stripe-status
 *
 * Runs every 15 minutes via Vercel Cron (see vercel.json). For each
 * therapist whose Stripe Connect onboarding is still pending and was
 * last updated >5 min ago, fetch the account and update the cached
 * status (active / restricted / onboarding_pending).
 *
 * Authenticated via CRON_SECRET header (Vercel Cron sets Bearer).
 */
export async function GET(req: NextRequest) {
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const admin = createAdminClient();
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

  // Include BOTH `onboarding_pending` AND `restricted` in the sweep.
  // Previously this only queried `onboarding_pending`, which meant
  // any therapist who slipped into `restricted` (even momentarily,
  // e.g. while Stripe was doing KYC checks) would be permanently
  // orphaned by the cron — once `restricted`, no automatic recheck
  // would ever resolve them back to `active`, regardless of what
  // Stripe actually said.
  //
  // This bit Laura Meraviglia, Luz Elsy Duarte Zapata and Roberta
  // Pagliani in May 2026: all three had completed onboarding and
  // Stripe's live API reported them with charges_enabled=true,
  // payouts_enabled=true, disabled_reason=null — but our DB still
  // showed `restricted` because the `account.updated` webhook had
  // dropped/misfired and the cron filter excluded them. They sat
  // stuck for 3-4 days unable to receive payments.
  //
  // Including `restricted` here makes the cron the resilient
  // recovery path: a webhook miss now self-heals within 15 min
  // instead of requiring manual intervention.
  const { data: rows, error } = await admin
    .from("therapist_profiles")
    .select("id, stripe_connected_account_id, stripe_country, stripe_account_status, updated_at")
    .in("stripe_account_status", ["onboarding_pending", "restricted"])
    .not("stripe_connected_account_id", "is", null)
    .lt("updated_at", fiveMinAgo)
    .limit(30);

  if (error) {
    console.error("[cron/sync-stripe-status] lookup failed:", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ checked: 0, updated: 0 });
  }

  let updated = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const res = await fetch(
        `https://api.stripe.com/v1/accounts/${row.stripe_connected_account_id}`,
        { headers: { Authorization: `Bearer ${stripeKey}` } },
      );
      if (!res.ok) {
        errors++;
        continue;
      }
      const acct = (await res.json()) as StripeAccount;
      let next = "onboarding_pending";
      if (acct.charges_enabled && acct.payouts_enabled) {
        next = "active";
      } else if (acct.requirements?.disabled_reason) {
        next = "restricted";
      } else if (acct.details_submitted) {
        next = "onboarding_pending";
      }
      if (next !== row.stripe_account_status) {
        await admin
          .from("therapist_profiles")
          .update({
            stripe_account_status: next,
            ...(acct.country ? { stripe_country: acct.country } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        updated++;
      } else {
        // Status unchanged — bump `updated_at` anyway so the next cron
        // run's `.lt("updated_at", fiveMinAgo)` filter excludes this
        // row. Without this, every still-pending therapist gets
        // re-queued every 15 min indefinitely, burning Stripe API
        // quota. The bump implements an implicit 5-min backoff.
        await admin
          .from("therapist_profiles")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    } catch (e) {
      errors++;
      console.error(
        `[cron/sync-stripe-status] therapist ${row.id} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return NextResponse.json({ checked: rows.length, updated, errors });
}
