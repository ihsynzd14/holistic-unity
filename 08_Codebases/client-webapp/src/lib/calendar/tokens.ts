/**
 * Calendar OAuth token helpers — read-only counterpart of the therapist
 * webapp's calendar/tokens module. The client webapp needs to refresh
 * tokens and call FreeBusy APIs to merge external calendar busy
 * intervals into the slot picker, but never initiates a new connection
 * (that flow lives in the therapist webapp).
 */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const MS_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";

async function refreshGoogleToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  return res.json();
}

async function refreshMicrosoftToken(refreshToken: string) {
  const res = await fetch(
    `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    },
  );
  return res.json();
}

export type CalendarIntegration = {
  id: string;
  therapist_id: string;
  provider: "google" | "microsoft";
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  calendar_id: string | null;
};

export async function getValidAccessToken(
  integration: CalendarIntegration,
  // Caller passes an admin Supabase client so we can persist refreshed
  // tokens without RLS getting in the way (the row belongs to the
  // therapist, not the requesting client user).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
): Promise<string> {
  const expiresAt = new Date(integration.token_expires_at).getTime();
  // Refresh if expiring within 5 minutes.
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return integration.access_token;
  }

  const data =
    integration.provider === "google"
      ? await refreshGoogleToken(integration.refresh_token)
      : await refreshMicrosoftToken(integration.refresh_token);

  if (data.error) {
    throw new Error(
      `Token refresh failed (${integration.provider}): ${
        data.error_description || data.error
      }`,
    );
  }

  const newExpiry = new Date(
    Date.now() + Number(data.expires_in) * 1000,
  ).toISOString();

  await admin
    .from("therapist_calendar_integrations")
    .update({
      access_token: data.access_token,
      token_expires_at: newExpiry,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  return data.access_token;
}

/**
 * Fetch busy intervals from the therapist's connected external calendar
 * (Google or Microsoft) within `[timeMin, timeMax]`. Returns intervals
 * shaped like the bookings table so the slot picker can treat them
 * uniformly: `{ scheduled_at, duration }` with a synthetic
 * `status: "external_busy"` so the LIVE_STATUSES filter accepts them.
 *
 * Failures are non-fatal — we log and return [] so a transient calendar
 * outage doesn't take down the whole booking page. Worst case the slot
 * picker shows an externally-busy slot as free, the platform-side
 * booking still goes through, and the therapist sees the conflict in
 * their own calendar — same outcome as today, no regression.
 */
export async function fetchExternalCalendarBusy(
  integration: CalendarIntegration,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  timeMin: string,
  timeMax: string,
): Promise<Array<{ scheduled_at: string; duration: number; status: string }>> {
  try {
    const accessToken = await getValidAccessToken(integration, admin);
    let raw: Array<{ start: string; end: string }> = [];

    if (integration.provider === "google") {
      const calendarId = integration.calendar_id || "primary";
      const res = await fetch(
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
        },
      );
      if (!res.ok) {
        console.error(
          "[calendar] google freebusy",
          res.status,
          await res.text(),
        );
        return [];
      }
      const json = await res.json();
      raw = (json.calendars?.[calendarId]?.busy ?? []) as Array<{
        start: string;
        end: string;
      }>;
    } else if (integration.provider === "microsoft") {
      // Microsoft Graph getSchedule returns availability windows. We use
      // calendarView and filter to non-cancelled/non-free events instead
      // because getSchedule needs the user's email which we don't always
      // have stored.
      const url = new URL(
        "https://graph.microsoft.com/v1.0/me/calendarview",
      );
      url.searchParams.set("startDateTime", timeMin);
      url.searchParams.set("endDateTime", timeMax);
      url.searchParams.set("$select", "start,end,showAs,isCancelled");
      url.searchParams.set("$top", "200");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        console.error(
          "[calendar] microsoft calendarview",
          res.status,
          await res.text(),
        );
        return [];
      }
      const json = await res.json();
      type MsEvent = {
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
        showAs?: string;
        isCancelled?: boolean;
      };
      raw = ((json.value ?? []) as MsEvent[])
        .filter(
          (e) =>
            !e.isCancelled &&
            e.showAs !== "free" &&
            e.showAs !== "workingElsewhere",
        )
        .map((e) => ({
          // Microsoft returns dateTime without 'Z' even when UTC. Append
          // it so JS Date parses correctly.
          start: e.start.dateTime.endsWith("Z")
            ? e.start.dateTime
            : `${e.start.dateTime}Z`,
          end: e.end.dateTime.endsWith("Z")
            ? e.end.dateTime
            : `${e.end.dateTime}Z`,
        }));
    }

    return raw.map((b) => {
      const startMs = new Date(b.start).getTime();
      const endMs = new Date(b.end).getTime();
      const durationMin = Math.max(1, Math.round((endMs - startMs) / 60000));
      return {
        scheduled_at: new Date(startMs).toISOString(),
        duration: durationMin,
        status: "external_busy",
      };
    });
  } catch (err) {
    console.error("[calendar] fetchExternalCalendarBusy error:", err);
    return [];
  }
}
