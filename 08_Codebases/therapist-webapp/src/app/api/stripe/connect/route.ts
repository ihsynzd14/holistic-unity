import { createClient } from "@/lib/supabase/server";
import { withRateLimit } from "@/lib/auth/rateLimit";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Rate limit: 10 Stripe onboarding starts per 10 min per user.
    // Legit use is 1-2 (first setup + occasional restart); higher =
    // abuse or malicious Stripe account enumeration.
    const limit = await withRateLimit(request, {
      key: "stripe-connect",
      max: 10,
      windowSec: 600,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    // Verify therapist role
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

    // Read the country choice from the body. The frontend collects the
    // country with a dedicated dropdown before calling this route — the
    // Stripe account's country is permanent (set at creation time, no
    // updates allowed by Stripe), so the choice has to be explicit.
    // The Edge Function also validates against its supported list and
    // refuses creation when missing or unsupported.
    const body = await request.json().catch(() => ({}));
    const country: string | undefined =
      typeof body?.country === "string"
        ? body.country.trim().toUpperCase()
        : undefined;

    // Get session token to forward to Edge Function
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return NextResponse.json(
        { error: "Sessione non valida" },
        { status: 401 }
      );
    }

    // Call Supabase Edge Function
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await fetch(
      `${supabaseUrl}/functions/v1/create-connect-account`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ therapist_id: user.id, country }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Errore nella creazione account Stripe" },
        { status: res.status }
      );
    }

    // Return the onboarding URL to redirect the therapist
    return NextResponse.json({
      url: data.onboarding_url,
      accountId: data.account_id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
