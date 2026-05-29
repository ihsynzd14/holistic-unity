/**
 * check-dormant-users — Identifies dormant clients and triggers re-engagement.
 *
 * Triggered by: pg_cron weekly on Monday at 9:00 UTC
 *
 * Dormant = client with marketing_consent who hasn't had a booking in 14+ days.
 * Sends re-engagement emails via Brevo and tracks events for automation workflows.
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { addToLists, removeFromLists, trackEvent, BREVO_LISTS } from "../_shared/brevo.ts";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
function timingSafeEqualString(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for(let i = 0; i < a.length; i++){
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // Internal auth: only callers with the service-role key OR the
    // CRON_SECRET may invoke this function. Without it, anyone could
    // enumerate the entire user base + trigger Brevo email spam.
    const authHeader = req.headers.get("Authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const ok = provided.length > 0 && timingSafeEqualString(provided, supabaseServiceKey) || cronSecret.length > 0 && timingSafeEqualString(provided, cronSecret);
    if (!ok) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Get all clients
    const { data: clients, error: clientsErr } = await supabase.from("users").select("id, email, display_name, marketing_consent").eq("role", "client").not("email", "is", null);
    if (clientsErr || !clients) {
      return new Response(JSON.stringify({
        error: "Failed to fetch clients"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let activeCount = 0;
    let dormantCount = 0;
    let reengagementTriggered = 0;
    for (const client of clients){
      if (!client.email) continue;
      // Find latest booking for this client
      const { data: latestBooking } = await supabase.from("bookings").select("scheduled_at").eq("client_id", client.id).eq("status", "confirmed").order("scheduled_at", {
        ascending: false
      }).limit(1).maybeSingle();
      const lastBookingDate = latestBooking?.scheduled_at || null;
      const isActive = lastBookingDate && lastBookingDate > thirtyDaysAgo;
      const isDormant = !lastBookingDate || lastBookingDate < fourteenDaysAgo;
      if (isActive) {
        // Move to Active Clients list
        await addToLists(client.email, [
          BREVO_LISTS.CLIENTS_ACTIVE
        ]);
        await removeFromLists(client.email, [
          BREVO_LISTS.CLIENTS_DORMANT
        ]);
        activeCount++;
      } else if (isDormant) {
        // Move to Dormant Clients list
        await addToLists(client.email, [
          BREVO_LISTS.CLIENTS_DORMANT
        ]);
        await removeFromLists(client.email, [
          BREVO_LISTS.CLIENTS_ACTIVE
        ]);
        dormantCount++;
        // Track event for Brevo automation (triggers re-engagement workflow)
        // Only trigger for users with marketing consent
        if (client.marketing_consent) {
          await trackEvent(client.email, "account_dormant_14d", {
            user_id: client.id,
            last_booking_date: lastBookingDate || "never",
            days_inactive: lastBookingDate ? Math.floor((now.getTime() - new Date(lastBookingDate).getTime()) / (24 * 60 * 60 * 1000)) : 999
          });
          reengagementTriggered++;
        }
      }
      // Rate limit Brevo calls
      await new Promise((r)=>setTimeout(r, 120));
    }
    return new Response(JSON.stringify({
      total_clients: clients.length,
      active: activeCount,
      dormant: dormantCount,
      reengagement_triggered: reengagementTriggered
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("check-dormant-users error:", err);
    return new Response(JSON.stringify({
      error: err.message || "Internal error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
