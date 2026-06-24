import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/calendar/tokens";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/calendar/microsoft/freebusy
 * Returns busy time slots from the therapist's Outlook calendar.
 * Body: { timeMin: string, timeMax: string } (ISO 8601 dates)
 */
export async function POST(request: NextRequest) {
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

    const { timeMin, timeMax } = await request.json();

    if (!timeMin || !timeMax) {
      return NextResponse.json(
        { error: "timeMin and timeMax are required" },
        { status: 400 }
      );
    }

    // Look up the therapist's Microsoft calendar integration
    const { data: integration, error: queryError } = await supabase
      .from("therapist_calendar_integrations")
      .select("*")
      .eq("therapist_id", user.id)
      .eq("provider", "microsoft")
      .single();

    if (queryError || !integration) {
      return NextResponse.json(
        { error: "Integrazione Microsoft non trovata" },
        { status: 404 }
      );
    }

    // Get a valid (possibly refreshed) access token
    const accessToken = await getValidAccessToken(integration, supabase);

    // Call the Microsoft Graph getSchedule API
    const graphRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schedules: [integration.calendar_email],
          startTime: { dateTime: timeMin, timeZone: "UTC" },
          endTime: { dateTime: timeMax, timeZone: "UTC" },
          availabilityViewInterval: 30,
        }),
      }
    );

    if (!graphRes.ok) {
      const errorBody = await graphRes.text();
      console.error("[Microsoft freebusy] Graph API error:", errorBody);
      return NextResponse.json(
        { error: "Errore nel recupero disponibilità da Microsoft" },
        { status: 502 }
      );
    }

    const graphData = await graphRes.json();

    // Extract busy slots from the response
    // The response contains a value array with schedule entries per user
    const scheduleItems =
      graphData.value?.[0]?.scheduleItems ?? [];

    const busy = scheduleItems.map(
      (item: { start: { dateTime: string }; end: { dateTime: string } }) => ({
        start: item.start.dateTime,
        end: item.end.dateTime,
      })
    );

    return NextResponse.json({ busy });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("[Microsoft freebusy] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
