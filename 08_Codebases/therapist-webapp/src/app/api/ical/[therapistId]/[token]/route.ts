import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateIcalToken } from "@/lib/calendar/tokens";
import { withRateLimit } from "@/lib/auth/rateLimit";

// ── helpers ─────────────────────────────────────────────────────

/** Format a JS Date to iCal UTC: YYYYMMDDTHHMMSSZ */
function toICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape special characters in iCal text values (RFC 5545 sec 3.3.11) */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// ── GET handler ─────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ therapistId: string; token: string }> }
) {
  const { therapistId, token } = await params;

  // Rate limit: the iCal feed is a PUBLIC endpoint (HMAC token, not JWT).
  // Per-therapistId + per-IP limit slows brute-force token guessing.
  const limit = await withRateLimit(request, {
    key: `ical:${therapistId}`,
    max: 60,
    windowSec: 3600, // 60/hour — calendar clients poll every 15-30min
  });
  if (limit.response) return limit.response;

  // 1. Validate the HMAC token
  if (!validateIcalToken(therapistId, token)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Create a Supabase client.
  //
  // IMPORTANT: this is a PUBLIC, unauthenticated endpoint. The HMAC token
  // verified on line 40 IS the authorization — there's no JWT/cookie. By
  // the time we get here we know the caller possesses the right HMAC for
  // this therapistId.
  //
  // The bookings table has RLS that requires `auth.uid()` to match either
  // therapist_id or client_id; with no JWT, anon-key reads return zero
  // rows. So we MUST use the service-role key to fulfil this query, and
  // we do so explicitly (no env fallback) — if the key isn't configured,
  // we fail loud rather than silently returning empty calendars.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[iCal] missing SUPABASE_SERVICE_ROLE_KEY or URL");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 3. Query bookings: confirmed / in_progress, from 7 days ago to 90 days ahead
  const now = new Date();
  const pastBound = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const futureBound = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    // `format` column dropped on 2026-04-16 (all sessions are virtual).
    .select("id, client_id, service_name, duration, scheduled_at, status")
    .eq("therapist_id", therapistId)
    .in("status", ["confirmed", "in_progress"])
    .gte("scheduled_at", pastBound.toISOString())
    .lte("scheduled_at", futureBound.toISOString())
    .order("scheduled_at", { ascending: true });

  if (bookingsError) {
    console.error("[iCal feed] bookings query error:", bookingsError);
    return NextResponse.json(
      { error: "Failed to fetch bookings" },
      { status: 500 }
    );
  }

  // 4. Build iCal output without exposing client or service PII in a public feed URL.
  const events = (bookings ?? []).map((b) => {
    const start = new Date(b.scheduled_at);
    const end = new Date(start.getTime() + (b.duration ?? 60) * 60 * 1000);
    const status = b.status === "confirmed" ? "CONFIRMED" : "TENTATIVE";

    return [
      "BEGIN:VEVENT",
      `DTSTART:${toICalDate(start)}`,
      `DTEND:${toICalDate(end)}`,
      `SUMMARY:${escapeICalText("Holistic Unity Session")}`,
      `DESCRIPTION:${escapeICalText(`Reserved appointment - ${b.duration ?? 60} min`)}`,
      `UID:${b.id}@holisticunity.app`,
      `STATUS:${status}`,
      "END:VEVENT",
    ].join("\r\n");
  });

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Holistic Unity//Therapist Portal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Holistic Unity - Sessioni",
    "X-WR-TIMEZONE:Europe/Rome",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  // 6. Return with appropriate headers
  return new NextResponse(ical, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="holistic-unity.ics"',
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
