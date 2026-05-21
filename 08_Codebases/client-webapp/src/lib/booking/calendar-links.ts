/**
 * Helpers that turn a booking into calendar-import links + a
 * self-signed iCalendar (.ics) payload.
 *
 * Used in two places:
 *   1. The booking-confirmed email (we hand the URLs to Brevo as
 *      template params; the Brevo template is responsible for
 *      rendering the buttons — owner updates the template HTML to
 *      add `{{ params.google_cal_url }}` and `{{ params.ics_data_url }}`).
 *   2. /checkout/success — we render the "Add to Calendar" row
 *      inline after the booking is confirmed, so the UX works even
 *      before the email arrives (or if the user never reads it).
 *
 * Keep this module dependency-free so it runs in the Stripe webhook
 * (Node runtime) AND in the success page (client/edge runtime).
 */

export interface CalendarLinkInput {
  bookingId: string;
  scheduledAt: string | Date;
  durationMinutes: number;
  serviceName: string;
  therapistName: string;
  /** Absolute URL to open the video call for this booking. */
  callUrl: string;
}

export interface CalendarLinks {
  googleCalUrl: string;
  outlookCalUrl: string;
  /** Base64-encoded data URL (application/octet-stream). Opens the
   *  native calendar app on iOS / macOS and downloads as a .ics file
   *  on Android / Windows / Linux. */
  icsDataUrl: string;
  /** Raw .ics content — pass this to a mail MIME attachment or upload
   *  to storage if an email template needs a hosted file URL. */
  icsContent: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Calendar formats demand "YYYYMMDDTHHMMSSZ" in UTC.
function toCalendarDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// ISO 8601 with explicit Z suffix for Outlook's `startdt` / `enddt`.
function toOutlookDate(d: Date): string {
  return d.toISOString();
}

// iCalendar text fields must escape commas, semicolons, backslashes,
// and newlines per RFC 5545 §3.3.11.
function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");
}

function base64Utf8(s: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(s, "utf8").toString("base64");
  }
  // Browser / edge runtime fallback.
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildCalendarLinks(input: CalendarLinkInput): CalendarLinks {
  const start =
    typeof input.scheduledAt === "string"
      ? new Date(input.scheduledAt)
      : input.scheduledAt;
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);

  const title = `${input.serviceName} · ${input.therapistName}`;
  const description = [
    "Sessione su Holistic Unity.",
    "",
    `Per entrare nella stanza video: ${input.callUrl}`,
    "",
    "La stanza si apre 15 minuti prima dell'orario e resta attiva per 3 ore.",
  ].join("\n");

  // Google Calendar web: action=TEMPLATE prefills the event form.
  const googleCalUrl =
    "https://www.google.com/calendar/render?" +
    new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${toCalendarDate(start)}/${toCalendarDate(end)}`,
      details: description,
      location: input.callUrl,
    }).toString();

  // Outlook web deep-link.
  const outlookCalUrl =
    "https://outlook.live.com/calendar/0/deeplink/compose?" +
    new URLSearchParams({
      path: "/calendar/action/compose",
      rru: "addevent",
      subject: title,
      startdt: toOutlookDate(start),
      enddt: toOutlookDate(end),
      body: description,
      location: input.callUrl,
    }).toString();

  // Self-signed iCalendar payload. PRODID identifies us (recommended
  // per RFC 5545); UID is stable so re-downloads overwrite existing
  // events in the user's calendar rather than duplicating.
  const dtstamp = toCalendarDate(new Date());
  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Holistic Unity//Bookings//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.bookingId}@holisticunity.app`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toCalendarDate(start)}`,
    `DTEND:${toCalendarDate(end)}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(input.callUrl)}`,
    `URL:${input.callUrl}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:La sessione inizia tra 15 minuti",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const icsDataUrl = `data:text/calendar;charset=utf-8;base64,${base64Utf8(icsContent)}`;

  return { googleCalUrl, outlookCalUrl, icsDataUrl, icsContent };
}
