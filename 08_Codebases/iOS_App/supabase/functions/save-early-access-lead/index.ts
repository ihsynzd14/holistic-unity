// Pre-launch lead capture for the /early landing page
// (holistic-unity-website/early_access.html).
//
// Public endpoint (verify_jwt = false): cold ad traffic has no session.
// It only ever WRITES to early_access_leads and never returns row data to
// the caller, so there's nothing to authorize — abuse is bounded by an
// email + IP rate limit. Uses the service-role key so RLS (which blocks
// ALL public access to the table) is bypassed server-side.
//
// Accepts POST JSON with any combination of fields. Always upserts on
// `email`, updating only the columns present in the request:
//   { email, source }                           → create / refresh the row
//   { email, answers }                           → save the 6 quiz answers
//   { email, operator_id, operator_name, tier }  → append a saved operator
//
// Safe to call repeatedly: the hero + sticky forms both fire it and page
// refreshes re-fire it. The client calls it fire-and-forget, so a failure
// here must never block the funnel.
//
// NOTE on saved_operators: this read-modify-writes the JSONB array, so two
// near-simultaneous saves could theoretically drop one. In practice saves
// are deliberate clicks seconds apart; the Pixel event + email/answers are
// captured regardless, so this is an acceptable pre-launch tradeoff.
//
// Deploy: `supabase functions deploy save-early-access-lead`

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SavedOperator {
  id: string;
  name?: string;
  tier?: string;
  saved_at: string;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Parse + validate ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";

  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "Invalid email" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Rate limit (per email + coarse per IP) ---
  // 20/email/10min covers: email submit + 6 quiz steps + a handful of
  // operator saves + a refresh, with headroom. IP cap blunts scripting.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (await isRateLimited(`ea-lead:email:${email}`, 20, 10 * 60_000)) {
    return rateLimitResponse(corsHeaders);
  }
  if (await isRateLimited(`ea-lead:ip:${ip}`, 60, 10 * 60_000)) {
    return rateLimitResponse(corsHeaders);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // --- Build the partial upsert payload from whatever was sent ---
  // PostgREST's generated ON CONFLICT DO UPDATE only touches the columns
  // present here, so each call merges cleanly into the existing row.
  const row: Record<string, unknown> = { email };

  if (typeof body.source === "string" && body.source) {
    row.source = body.source;
  }

  if (body.answers && typeof body.answers === "object") {
    row.quiz_answers = body.answers;
    row.quiz_completed_at = new Date().toISOString();
  }

  // Saved operator: read-modify-write the JSONB array, dedupe by id.
  const operatorId = typeof body.operator_id === "string"
    ? body.operator_id
    : undefined;
  if (operatorId) {
    const { data: existing, error: readErr } = await admin
      .from("early_access_leads")
      .select("saved_operators")
      .eq("email", email)
      .maybeSingle();

    if (readErr) {
      console.error("[save-early-access-lead] read failed:", readErr.message);
    }

    const current: SavedOperator[] = Array.isArray(existing?.saved_operators)
      ? (existing!.saved_operators as SavedOperator[])
      : [];

    if (!current.some((o) => o.id === operatorId)) {
      current.push({
        id: operatorId,
        name: typeof body.operator_name === "string"
          ? body.operator_name
          : undefined,
        tier: typeof body.tier === "string" ? body.tier : undefined,
        saved_at: new Date().toISOString(),
      });
    }
    row.saved_operators = current;
  }

  // --- Upsert ---
  const { error } = await admin
    .from("early_access_leads")
    .upsert(row, { onConflict: "email" });

  if (error) {
    console.error("[save-early-access-lead] upsert failed:", error.message);
    return new Response(JSON.stringify({ error: "Database error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
