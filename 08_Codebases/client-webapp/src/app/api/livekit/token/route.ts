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
 *
 * Without this gate a malicious or curious client could keep posting
 * roomName=hu-... at any time of day and get a working token. The
 * Edge Function only checks ownership, not timing — by design, so we
 * don't have to redeploy it for policy tweaks.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    // Use getUser() — validates the JWT against Supabase auth on every
    // request. getSession() reads from cookies WITHOUT verifying the
    // token signature, which means a tampered/expired cookie could
    // pass auth on this critical route (LiveKit token mints a JWT
    // that lets the holder join the video room).
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Rate limit: 30 token requests per hour per user. A typical
    // session needs 1-3 tokens (initial + reconnects). 30 covers
    // multi-device + flaky network without being abusive.
    const rl = await withRateLimit(request, {
      key: "livekit-token",
      max: 30,
      windowSec: 3600,
      userId: user.id,
    });
    if (rl.response) return rl.response;

    // We still need the access_token to forward to the Edge Function,
    // which expects a Supabase user JWT. After getUser() succeeded the
    // session is known-valid, so reading it is safe.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Sessione mancante" }, { status: 401 });
    }

    const body = await request.json();
    const { roomName, participantName } = body;

    if (!roomName || !participantName) {
      return NextResponse.json({ error: "roomName e participantName richiesti" }, { status: 400 });
    }

    // Look up the booking by video_room_id (set at booking creation /
    // payment confirmation — see /api/checkout/create and the Stripe
    // webhook). If we can't find it the token API returns 404 rather
    // than calling the Edge Function with a bogus room name.
    //
    // RLS on bookings already restricts SELECT to client_id = auth.uid()
    // OR therapist_id = auth.uid(), so an unrelated user can't even
    // discover the booking exists.
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
        { status: 425 }, // Too Early
      );
    }
    if (window.state === "closed") {
      return NextResponse.json(
        {
          error:
            "Questa sessione è terminata. La stanza video resta disponibile per 3 ore dall'orario d'inizio.",
        },
        { status: 410 }, // Gone
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
