import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * DELETE /api/calendar/microsoft/disconnect
 * Removes the therapist's Microsoft Outlook calendar integration.
 * Microsoft does not offer a simple token revocation endpoint,
 * so we only delete the stored integration record.
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

    // Look up the existing integration
    const { data: integration, error: queryError } = await supabase
      .from("therapist_calendar_integrations")
      .select("id")
      .eq("therapist_id", user.id)
      .eq("provider", "microsoft")
      .single();

    if (queryError || !integration) {
      return NextResponse.json(
        { error: "Integrazione Microsoft non trovata" },
        { status: 404 }
      );
    }

    // Delete the integration row
    const { error: deleteError } = await supabase
      .from("therapist_calendar_integrations")
      .delete()
      .eq("id", integration.id);

    if (deleteError) {
      throw new Error(`Failed to delete integration: ${deleteError.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("[Microsoft disconnect] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
