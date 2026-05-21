import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";

// ──────────────────────────────────────────────────────────────────────────────
// process-pending-payouts
//
// With destination charges, Stripe automatically transfers the therapist's
// share to their connected account at payment time. There is NO need to create
// a separate Stripe Transfer — doing so would pay the therapist twice.
//
// This function only updates the internal payout_status column from "pending"
// to "paid" once the escrow window has elapsed, so dashboard/earnings reports
// reflect that the funds have cleared.
// ──────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  // This function is meant to be called by a pg_cron job or Supabase scheduled
  // invocation. Protect it with the service role key passed as a Bearer token.
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = authHeader ? authHeader.replace("Bearer ", "") : "";

  // Timing-safe comparison to prevent key leakage via response timing
  const encoder = new TextEncoder();
  const providedBytes = encoder.encode(token);
  const expectedBytes = encoder.encode(serviceRoleKey);
  const isAuthorized =
    providedBytes.byteLength === expectedBytes.byteLength &&
    crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
  if (!authHeader || !isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date().toISOString();

  // Fetch all transactions whose escrow window has passed and haven't been
  // marked as paid yet. With destination charges, Stripe already moved the
  // funds to the connected account — we're just updating our internal ledger.
  const { data: transactions, error: fetchError } = await supabaseAdmin
    .from("transactions")
    .select("id, therapist_payout, currency, therapist_id")
    .eq("payout_status", "pending")
    .eq("status", "completed")
    .lte("payout_after", now);

  if (fetchError) {
    console.error("Failed to fetch pending payouts:", fetchError);
    return new Response(
      JSON.stringify({ error: "Failed to fetch pending payouts" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (!transactions || transactions.length === 0) {
    console.log("No pending payouts ready to mark as paid.");
    return new Response(
      JSON.stringify({ processed: 0 }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  console.log(`Marking ${transactions.length} transaction(s) as paid (escrow window elapsed)...`);

  // Batch-update all eligible transactions to "paid" status.
  // No Stripe Transfer is created — destination charges already handled the
  // fund movement at payment time.
  const txIds = transactions.map((tx) => tx.id);

  const { error: updateError, count } = await supabaseAdmin
    .from("transactions")
    .update({ payout_status: "paid" })
    .in("id", txIds);

  if (updateError) {
    console.error("Failed to update payout statuses:", updateError);
    return new Response(
      JSON.stringify({ error: "Failed to update payout statuses" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  console.log(`Marked ${count ?? txIds.length} transaction(s) as paid.`);

  return new Response(
    JSON.stringify({ processed: count ?? txIds.length }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
