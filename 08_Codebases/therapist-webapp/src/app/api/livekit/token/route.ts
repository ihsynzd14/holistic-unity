import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getJoinWindow } from "@/lib/booking/join-window";
import { withRateLimit } from "@/lib/auth/rateLimit";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * POST /api/livekit/token
 *
 * Proxies the LiveKit token request to the Supabase Edge Function. Adds
 * a server-side gate so a token can only be minted while the booking's
 * join window is open (15 min before scheduled_at, for 3 hours total).
 * Mirrors the client-webapp gate — both endpoints look at the same
 * `bookings.scheduled_at` so therapist and client see the same window.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    // getUser() validates the JWT against the Supabase auth server. Do
    // NOT use getSession() here — that only reads the cookie and would
    // accept a tampered/expired token. The LiveKit token grants live
    // video-call access; this is the highest-stakes auth endpoint in
    // the app.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // We still need the session for its access_token (forwarded to the
    // Edge Function below). Re-read it AFTER the getUser() validation.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const limit = await withRateLimit(request, {
      key: "livekit-token",
      max: 30,
      windowSec: 300,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    const body = await request.json();
    const { roomName, participantName } = body;

    if (!roomName || !participantName) {
      return NextResponse.json({ error: "roomName e participantName richiesti" }, { status: 400 });
    }

    // RLS restricts SELECT to client_id = auth.uid() OR
    // therapist_id = auth.uid(); plus the therapist webapp only ever
    // hits this with the therapist logged in, so a stranger can't
    // probe room ids.
    const { data: booking } = await supabase
      .from("bookings")
      .select("scheduled_at, status")
      .eq("video_room_id", roomName)
      .maybeSingle();

    if (!booking) {
      return NextResponse.json(
        { error: "Sessione non trovata" },
        { status: 404 },
      );
    }
    if (booking.status === "cancelled") {
      return NextResponse.json(
        { error: "Questa sessione è stata annullata." },
        { status: 410 },
      );
    }

    const window = getJoinWindow(booking.scheduled_at);
    if (window.state === "too_early") {
      const mins = window.minutesUntilOpen;
      const human =
        mins > 60
          ? `tra circa ${Math.round(mins / 60)} ore`
          : `tra ${mins} minuti`;
      return NextResponse.json(
        {
          error: `La stanza apre 15 minuti prima della sessione. Riprova ${human}.`,
        },
        { status: 425 },
      );
    }
    if (window.state === "closed") {
      return NextResponse.json(
        {
          error:
            "Questa sessione è terminata. La stanza video resta disponibile per 3 ore dall'orario d'inizio.",
        },
        { status: 410 },
      );
    }

    // Call the Supabase Edge Function
    const res = await fetch(`${SUPABASE_URL}/functions/v1/livekit-token`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roomName, participantName }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Errore nel generare il token" },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
