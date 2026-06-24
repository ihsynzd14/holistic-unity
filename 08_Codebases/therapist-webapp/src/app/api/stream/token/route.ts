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

    const limit = await withRateLimit(request, {
      key: "stream-token",
      max: 30,
      windowSec: 300,
      userId: user.id,
    });
    if (limit.response) return limit.response;

    // Verify user is a therapist
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (userData?.role !== "therapist") {
      return NextResponse.json({ error: "Accesso riservato ai terapisti" }, { status: 403 });
    }

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
