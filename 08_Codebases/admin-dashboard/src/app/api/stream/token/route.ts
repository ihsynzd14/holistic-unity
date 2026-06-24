import { StreamChat } from "stream-chat";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { NextResponse } from "next/server";

const SUPPORT_USER_ID = "holistic-unity-support";

/**
 * POST /api/stream/token
 * Generates a Stream Chat token for the admin support user.
 * Only accessible by authenticated admin users.
 * Auth: ADMIN_EMAILS env whitelist AND users.is_admin DB flag (via requireAdmin).
 */
export async function POST() {
  try {
    // Defense-in-depth: ADMIN_EMAILS env AND users.is_admin DB flag.
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
    const apiSecret = process.env.STREAM_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "Stream Chat credentials not configured" },
        { status: 500 }
      );
    }

    // Create a server-side Stream client
    const serverClient = StreamChat.getInstance(apiKey, apiSecret);

    // Upsert the support user so it exists in Stream with proper branding
    await serverClient.upsertUser({
      id: SUPPORT_USER_ID,
      name: "Holistic Unity",
      image: "https://admin.holisticunity.app/logo.png",
      role: "admin",
    });

    // Generate a token for the support user
    const token = serverClient.createToken(SUPPORT_USER_ID);

    return NextResponse.json({
      token,
      userId: SUPPORT_USER_ID,
      apiKey,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
