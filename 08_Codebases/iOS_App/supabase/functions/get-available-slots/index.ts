import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightOrNull } from "../_shared/cors.ts";
// ── OAuth client IDs (for token refresh) ──────────────────────
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const MS_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
const MS_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "";
const MS_TENANT = "common";
// ── Timezone helpers ──────────────────────────────────────────
/**
 * Returns the UTC offset for a given IANA timezone on a given date, in minutes.
 * E.g., "Europe/Rome" on a summer date returns 120 (UTC+2).
 * Relationship: local_time = UTC + offset
 */ function getTimezoneOffsetMinutes(dateStr, timezone) {
  // Use noon UTC as reference to avoid DST edge cases at midnight
  const refUtc = new Date(`${dateStr}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(refUtc);
  const localYear = parseInt(parts.find((p)=>p.type === "year")?.value || "0");
  const localMonth = parseInt(parts.find((p)=>p.type === "month")?.value || "0");
  const localDay = parseInt(parts.find((p)=>p.type === "day")?.value || "0");
  const localHour = parseInt(parts.find((p)=>p.type === "hour")?.value || "0");
  const localMinute = parseInt(parts.find((p)=>p.type === "minute")?.value || "0");
  // Construct "local" date in UTC terms to compute the ms difference
  const localAsUtc = new Date(Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute));
  return Math.round((localAsUtc.getTime() - refUtc.getTime()) / 60_000);
}
/**
 * Converts minutes-from-midnight on a base date to an ISO 8601 UTC string.
 * Handles negative values (previous day) and values > 1440 (next day).
 */ function minutesToISO(baseDate, totalMinutes) {
  const d = new Date(baseDate + "T00:00:00Z");
  d.setUTCMinutes(d.getUTCMinutes() + totalMinutes);
  return d.toISOString();
}
// ── Token refresh helpers ─────────────────────────────────────
async function refreshGoogleToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token"
    })
  });
  return res.json();
}
async function refreshMicrosoftToken(refreshToken) {
  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      grant_type: "refresh_token"
    })
  });
  return res.json();
}
/**
 * Returns a valid access token, refreshing if expired.
 * Updates DB with new tokens on refresh.
 */ async function getValidAccessToken(integration, // deno-lint-ignore no-explicit-any
supabaseAdmin) {
  const expiresAt = new Date(integration.token_expires_at);
  const now = new Date();
  // Still valid (more than 5 minutes remaining)
  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return integration.access_token;
  }
  const data = integration.provider === "google" ? await refreshGoogleToken(integration.refresh_token) : await refreshMicrosoftToken(integration.refresh_token);
  if (data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }
  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabaseAdmin.from("therapist_calendar_integrations").update({
    access_token: data.access_token,
    token_expires_at: newExpiry,
    ...data.refresh_token ? {
      refresh_token: data.refresh_token
    } : {},
    updated_at: new Date().toISOString()
  }).eq("id", integration.id);
  return data.access_token;
}
async function fetchGoogleBusy(accessToken, calendarId, timeMin, timeMax) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [
        {
          id: calendarId
        }
      ]
    })
  });
  if (!res.ok) {
    console.error("[get-available-slots] Google FreeBusy error:", await res.text());
    return []; // Degrade gracefully
  }
  const data = await res.json();
  return data.calendars?.[calendarId]?.busy ?? [];
}
async function fetchMicrosoftBusy(accessToken, calendarEmail, timeMin, timeMax) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      schedules: [
        calendarEmail
      ],
      startTime: {
        dateTime: timeMin,
        timeZone: "UTC"
      },
      endTime: {
        dateTime: timeMax,
        timeZone: "UTC"
      },
      availabilityViewInterval: 15
    })
  });
  if (!res.ok) {
    console.error("[get-available-slots] Microsoft Graph error:", await res.text());
    return []; // Degrade gracefully
  }
  const data = await res.json();
  const items = data.value?.[0]?.scheduleItems ?? [];
  return items.map((item)=>({
      // Microsoft returns dateTimeTimeZone objects. The dateTime field
      // is a bare string WITHOUT a Z suffix, even when timeZone is "UTC".
      // Append "Z" when the timeZone is UTC to ensure Date parsing treats
      // it as UTC rather than the runtime's local timezone.
      start: ensureUTC(item.start.dateTime, item.start.timeZone),
      end: ensureUTC(item.end.dateTime, item.end.timeZone)
    }));
}
/**
 * Ensures a dateTime string from Microsoft Graph is a proper ISO 8601 UTC string.
 * Microsoft returns bare dateTime like "2026-04-15T10:00:00.0000000" with a
 * separate timeZone field. Without the Z suffix, `new Date()` parses it as local
 * time. If the timezone is UTC, append "Z" to force correct parsing.
 */ function ensureUTC(dateTime, timeZone) {
  if (!timeZone || timeZone === "UTC" || timeZone === "Etc/UTC") {
    // Bare string without offset/Z → append Z for UTC
    if (!dateTime.endsWith("Z") && !dateTime.includes("+") && !/\d{2}:\d{2}$/.test(dateTime.slice(-5))) {
      return dateTime + "Z";
    }
  }
  // If Microsoft returns a non-UTC timezone we can't easily convert in Deno
  // without a tz library. Log a warning and treat as UTC (best-effort).
  if (timeZone && timeZone !== "UTC" && timeZone !== "Etc/UTC") {
    console.warn(`[get-available-slots] Microsoft returned non-UTC timezone: ${timeZone}. Treating as UTC.`);
  }
  return dateTime;
}
/**
 * Generates time slots for a given date, removing slots that:
 * - overlap with existing bookings or external calendar events (with buffer)
 * - are in the past or within minNotice window
 *
 * All overlap detection uses UTC. The returned slots are in the
 * therapist's local timezone (HH:MM strings).
 */ function generateSlots(date, dayRanges, serviceDuration, busyPeriods, tzOffsetMinutes, nowMs, minNoticeMs) {
  if (dayRanges.length === 0) return [];
  const slots = [];
  for (const range of dayRanges){
    const [startH, startM] = range.start.split(":").map(Number);
    const [endH, endM] = range.end.split(":").map(Number);
    let currentMinutes = startH * 60 + startM;
    const rangeEndMinutes = endH * 60 + endM;
    while(currentMinutes + serviceDuration <= rangeEndMinutes){
      const slotStartH = Math.floor(currentMinutes / 60);
      const slotStartM = currentMinutes % 60;
      const slotEndMinutes = currentMinutes + serviceDuration;
      // Convert therapist local time → UTC for comparisons
      // UTC = local - offset
      const slotStartUTCMs = new Date(minutesToISO(date, currentMinutes - tzOffsetMinutes)).getTime();
      const slotEndUTCMs = new Date(minutesToISO(date, slotEndMinutes - tzOffsetMinutes)).getTime();
      // Skip slots in the past or within min-notice window
      if (slotStartUTCMs < nowMs + minNoticeMs) {
        currentMinutes += 15;
        continue;
      }
      // Check overlap with busy periods (all in UTC)
      const hasConflict = busyPeriods.some((busy)=>{
        const busyStart = new Date(busy.start).getTime();
        const busyEnd = new Date(busy.end).getTime();
        return slotStartUTCMs < busyEnd && slotEndUTCMs > busyStart;
      });
      if (!hasConflict) {
        slots.push({
          start: `${String(slotStartH).padStart(2, "0")}:${String(slotStartM).padStart(2, "0")}`,
          end: `${String(Math.floor(slotEndMinutes / 60)).padStart(2, "0")}:${String(slotEndMinutes % 60).padStart(2, "0")}`
        });
      }
      currentMinutes += 15; // 15-minute increments (matches web computeSlots + iOS local engine)
    }
  }
  return slots;
}
// ── Main handler ──────────────────────────────────────────────
serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightOrNull(req);
  if (preflight) return preflight;
  // ── JSON response helper (captures corsHeaders from closure) ──
  function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    // ── Auth ──────────────────────────────────────────────────
    const userToken = req.headers.get("x-user-token");
    const authHeader = req.headers.get("Authorization");
    const jwt = userToken || (authHeader ? authHeader.replace("Bearer ", "") : null);
    if (!jwt) {
      return jsonResponse({
        error: "Missing authorization"
      }, 401);
    }
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !user) {
      return jsonResponse({
        error: "Unauthorized"
      }, 401);
    }
    // ── Parse body ───────────────────────────────────────────
    const body = await req.json();
    const { therapistId, serviceDuration } = body;
    // Accept either a date string ("YYYY-MM-DD") or a utcTimestamp (ms since epoch).
    // If utcTimestamp is provided, we derive the date in the therapist's timezone
    // to avoid client/therapist timezone mismatches near midnight.
    let dateFromClient = body.date;
    const utcTimestamp = body.utcTimestamp;
    if (!therapistId || !serviceDuration) {
      return jsonResponse({
        error: "therapistId and serviceDuration (minutes) are required"
      }, 400);
    }
    // ── 1. Fetch therapist profile (availability schedule) ───
    const { data: profile, error: profileError } = await supabaseAdmin.from("therapist_profiles").select("availability").eq("id", therapistId).single();
    if (profileError || !profile?.availability) {
      return jsonResponse({
        error: "Therapist not found"
      }, 404);
    }
    const avail = profile.availability;
    // ── Extract availability settings ────────────────────────
    const therapistTz = avail.timezone || "Europe/Rome";
    const bufferMinutes = avail.bufferMinutes ?? 15;
    const minNoticeHours = avail.minNoticeHours ?? 24;
    const recurring = avail.recurring || {};
    // deno-lint-ignore no-explicit-any
    const exceptions = avail.exceptions || [];
    // ── Derive the correct date in the therapist's timezone ──
    // If utcTimestamp is provided, convert it to the therapist's local date.
    // This prevents the bug where a client in a different timezone sends
    // a date string that doesn't match the therapist's local date near midnight.
    if (utcTimestamp && Number.isFinite(utcTimestamp)) {
      const refDate = new Date(utcTimestamp);
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: therapistTz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });
      // "en-CA" locale gives "YYYY-MM-DD" format
      dateFromClient = formatter.format(refDate);
    }
    if (!dateFromClient) {
      return jsonResponse({
        error: "Either date (YYYY-MM-DD) or utcTimestamp is required"
      }, 400);
    }
    const date = dateFromClient;
    // ── Compute timezone offset ──────────────────────────────
    const tzOffset = getTimezoneOffsetMinutes(date, therapistTz);
    // ── 2. Check exceptions for this specific date ───────────
    // deno-lint-ignore no-explicit-any
    const exception = exceptions.find((e)=>e.date === date);
    let dayRanges;
    if (exception) {
      if (!exception.isAvailable) {
        // Therapist marked this date as a day off
        return jsonResponse({
          slots: [],
          timezone: therapistTz
        });
      }
      // Special hours — use customRanges
      dayRanges = (exception.customRanges || []).map(// deno-lint-ignore no-explicit-any
      (r)=>({
          start: r.start,
          end: r.end
        }));
    } else {
      // Normal recurring schedule
      // Day of week: 0=Sunday … 6=Saturday
      const dateObj = new Date(date + "T12:00:00Z");
      const dayOfWeek = dateObj.getUTCDay();
      const dayNames = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ];
      const dayName = dayNames[dayOfWeek];
      // Schema: availability.recurring.monday = [{ id, start, end }]
      const rawRanges = recurring[dayName] || [];
      dayRanges = rawRanges.map((r)=>({
          start: r.start,
          end: r.end
        }));
    }
    if (dayRanges.length === 0) {
      return jsonResponse({
        slots: [],
        timezone: therapistTz
      });
    }
    // ── 3. Fetch existing bookings ───────────────────────────
    // Query using the therapist's local day boundaries in UTC
    // midnight local = (0 - offset) minutes from midnight UTC
    const dayStartUTC = minutesToISO(date, -tzOffset);
    const dayEndUTC = minutesToISO(date, 1440 - tzOffset);
    const { data: bookings } = await supabaseAdmin.from("bookings").select("scheduled_at, duration").eq("therapist_id", therapistId).gte("scheduled_at", dayStartUTC).lt("scheduled_at", dayEndUTC).in("status", [
      "pending",
      "confirmed",
      "in_progress",
      "reschedule_pending"
    ]);
    // Convert bookings to busy periods (extend by buffer on both sides)
    const bookingBusy = (bookings ?? []).map((b)=>{
      const startMs = new Date(b.scheduled_at).getTime();
      return {
        start: new Date(startMs - bufferMinutes * 60_000).toISOString(),
        end: new Date(startMs + b.duration * 60_000 + bufferMinutes * 60_000).toISOString()
      };
    });
    // ── 4. Fetch external calendar busy periods ──────────────
    const externalBusy = [];
    const { data: integrations } = await supabaseAdmin.from("therapist_calendar_integrations").select("*").eq("therapist_id", therapistId);
    if (integrations && integrations.length > 0) {
      const calendarPromises = integrations.map(async (integration)=>{
        try {
          const accessToken = await getValidAccessToken(integration, supabaseAdmin);
          if (integration.provider === "google") {
            const calendarId = integration.calendar_id || "primary";
            return await fetchGoogleBusy(accessToken, calendarId, dayStartUTC, dayEndUTC);
          } else if (integration.provider === "microsoft") {
            const email = integration.calendar_email || "";
            return await fetchMicrosoftBusy(accessToken, email, dayStartUTC, dayEndUTC);
          }
          return [];
        } catch (err) {
          console.error(`[get-available-slots] Calendar sync error (${integration.provider}):`, err);
          return []; // Degrade gracefully
        }
      });
      const results = await Promise.all(calendarPromises);
      for (const busy of results){
        externalBusy.push(...busy);
      }
    }
    // Extend external busy periods with buffer on both sides
    const bufferedExternalBusy = externalBusy.map((bp)=>({
        start: new Date(new Date(bp.start).getTime() - bufferMinutes * 60_000).toISOString(),
        end: new Date(new Date(bp.end).getTime() + bufferMinutes * 60_000).toISOString()
      }));
    // ── 5. Merge all busy periods and generate slots ─────────
    const allBusy = [
      ...bookingBusy,
      ...bufferedExternalBusy
    ];
    const nowMs = Date.now();
    const minNoticeMs = minNoticeHours * 60 * 60 * 1000;
    const slots = generateSlots(date, dayRanges, serviceDuration, allBusy, tzOffset, nowMs, minNoticeMs);
    return jsonResponse({
      slots,
      timezone: therapistTz
    });
  } catch (err) {
    console.error("[get-available-slots] Error:", err);
    return jsonResponse({
      error: err instanceof Error ? err.message : "Internal server error"
    }, 500);
  }
});
