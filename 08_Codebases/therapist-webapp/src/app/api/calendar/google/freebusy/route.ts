import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/calendar/tokens";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/calendar/google/freebusy
 * Returns the therapist's busy periods from Google Calendar.
 * Body: { timeMin: string, timeMax: string } (ISO 8601)
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

    const body = await request.json();
    const { timeMin, timeMax } = body;

    if (!timeMin || !timeMax) {
      return NextResponse.json(
        { error: "timeMin e timeMax sono richiesti" },
        { status: 400 }
      );
    }

    // Look up the therapist's Google Calendar integration
    const { data: integration, error: dbError } = await supabase
      .from("therapist_calendar_integrations")
      .select("*")
      .eq("therapist_id", user.id)
      .eq("provider", "google")
      .single();

    if (dbError || !integration) {
      return NextResponse.json(
        { error: "Integrazione Google Calendar non trovata" },
        { status: 404 }
      );
    }

    // Obtain a valid (possibly refreshed) access token
    const accessToken = await getValidAccessToken(integration, supabase);

    // Query Google FreeBusy API
    const calendarId = integration.calendar_id || "primary";
    const freeBusyRes = await fetch(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: [{ id: calendarId }],
        }),
      }
    );

    if (!freeBusyRes.ok) {
      const errorBody = await freeBusyRes.text();
      console.error("Google FreeBusy API error:", errorBody);
      return NextResponse.json(
        { error: "Errore nella richiesta a Google Calendar" },
        { status: freeBusyRes.status }
      );
    }

    const freeBusyData = await freeBusyRes.json();

    // Extract busy periods for the requested calendar
    const calendarBusy =
      freeBusyData.calendars?.[calendarId]?.busy ?? [];

    return NextResponse.json({ busy: calendarBusy });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("FreeBusy error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
