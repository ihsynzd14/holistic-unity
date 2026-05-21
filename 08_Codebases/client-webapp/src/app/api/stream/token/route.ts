import { StreamChat } from "stream-chat";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/auth/rateLimit";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    // Rate limit: 60/hour per user. Chat reconnects fire one token
    // request; 60 covers heavy reconnect cycles on a flaky network
    // (Stream Chat refreshes tokens proactively too) without letting
    // a malicious client exhaust the Stream API quota.
    const rl = await withRateLimit(request, {
      key: "stream-token",
      max: 60,
      windowSec: 3600,
      userId: user.id,
    });
    if (rl.response) return rl.response;

    // Stream tokens are issued to any authenticated user — both clients
    // and therapists need them. Channel-level membership is enforced by
    // the conversation_participants RLS policies, not here.

    const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
    const apiSecret = process.env.STREAM_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "Stream Chat non configurato" },
        { status: 500 }
      );
    }

    const serverClient = StreamChat.getInstance(apiKey, apiSecret);
    const token = serverClient.createToken(user.id);

    // H5: Do not leak apiKey in response — frontend uses NEXT_PUBLIC_STREAM_API_KEY
    return NextResponse.json({ token, userId: user.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
