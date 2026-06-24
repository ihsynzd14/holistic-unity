import { createClient } from "@/lib/supabase/server";
import { revokeGoogleToken } from "@/lib/calendar/tokens";
import { NextResponse } from "next/server";

/**
 * DELETE /api/calendar/google/disconnect
 * Revokes the Google token and removes the calendar integration.
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Non autenticato" },
        { status: 401 }
      );
    }

    // Look up the therapist's Google Calendar integration
    const { data: integration, error: dbError } = await supabase
      .from("therapist_calendar_integrations")
      .select("id, refresh_token, access_token")
      .eq("therapist_id", user.id)
      .eq("provider", "google")
      .single();

    if (dbError || !integration) {
      return NextResponse.json(
        { error: "Integrazione Google Calendar non trovata" },
        { status: 404 }
      );
    }

    // Revoke the token at Google (best-effort; don't block on failure)
    try {
      const tokenToRevoke =
        integration.refresh_token || integration.access_token;
      if (tokenToRevoke) {
        await revokeGoogleToken(tokenToRevoke);
      }
    } catch {
      // Revocation failure is non-critical; proceed with deletion
    }

    // Delete the integration row from the database
    const { error: deleteError } = await supabase
      .from("therapist_calendar_integrations")
      .delete()
      .eq("id", integration.id);

    if (deleteError) {
      console.error("Failed to delete integration:", deleteError);
      return NextResponse.json(
        { error: "Errore nella rimozione dell'integrazione" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
