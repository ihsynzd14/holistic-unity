import { createClient } from "@/lib/supabase/server";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { NextRequest, NextResponse } from "next/server";

/**
 * Generates a single-use Stripe Express dashboard login link for the
 * authenticated therapist. Routes through the `connect-dashboard` Edge
 * Function so the Stripe secret key never leaves the server.
 *
 * The previous client-side `window.open(dashboard.stripe.com/<id>)` was
 * wrong — that URL goes to Stripe's main login screen, not the therapist's
 * Connect dashboard. Express accounts require a generated login link.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Rate limit: 20 dashboard openings per 10 min per user.
    // Generous because legit therapists may click multiple times.
    const limit = await withRateLimit(request, {
      key: "stripe-dashboard",
      max: 20,
      windowSec: 600,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (userData?.role !== "therapist") {
      return NextResponse.json(
        { error: "Accesso riservato ai terapisti" },
        { status: 403 }
      );
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return NextResponse.json(
        { error: "Sessione non valida" },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await fetch(
      `${supabaseUrl}/functions/v1/connect-dashboard`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ therapist_id: user.id }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Impossibile aprire la dashboard Stripe" },
        { status: res.status }
      );
    }

    // The Edge Function returns `dashboard_url` (the Stripe Express
    // login link). The iOS Swift client reads that key too — keeping
    // it stable. Here we forward it as `url` because the settings page
    // expects `data.url` to navigate to.
    return NextResponse.json({ url: data.dashboard_url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
