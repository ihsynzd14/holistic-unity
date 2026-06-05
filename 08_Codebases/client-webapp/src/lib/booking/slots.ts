/**
 * Slot computation for the client-side booking picker.
 *
 * Given a therapist's weekly availability, the chosen service duration,
 * and the bookings already on their calendar, return a list of bookable
 * start times in the next N days. The UI renders these as clickable
 * buttons grouped by day.
 *
 * Pure function — no Supabase calls, no Date side effects (caller passes
 * `now`). Mirrors the fairness rules used by the iOS app:
 *   - respects `availability.bufferMinutes` between consecutive sessions
 *   - respects `availability.minNoticeHours` so a slot can never be booked
 *     too close to "now"
 *   - applies `availability.exceptions` (day-off + special hours)
 *   - skips slots overlapping any pending/confirmed/in_progress booking
 */

/**
 * Default booking horizon: how many calendar days ahead a client can see
 * and book. Set to 42 (6 weeks) so the picker always covers a full month
 * ahead from any start date — therapists organise availability monthly and
 * clients in-studio plan a month out. (Was 14/21 — effectively biweekly,
 * which is why a published monthly schedule was never fully bookable.)
 * The freebusy API enforces a separate hard cap (60 days) for anti-abuse.
 */
export const BOOKING_WINDOW_DAYS = 42;

export type TimeRange = { start: string; end: string }; // "HH:MM"

export type Availability = {
  timezone?: string;
  recurring?: Partial<
    Record<
      "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday",
      TimeRange[]
    >
  >;
  exceptions?: Array<{
    date: string; // "YYYY-MM-DD" in the therapist's timezone
    // Shape the therapist editor actually writes (availability/page.tsx):
    //   isAvailable=false → day off (no slots that day)
    //   isAvailable=true  → special hours in customRanges (override recurring)
    isAvailable?: boolean;
    customRanges?: TimeRange[] | null;
  }>;
  bufferMinutes?: number;
  minNoticeHours?: number;
};

export type Booking = {
  scheduled_at: string; // ISO
  duration: number; // minutes
  status: string;
};

export type Slot = {
  start: Date;
  end: Date;
};

export type DaySlots = {
  date: Date; // local midnight of the day
  slots: Slot[];
};

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayKey = (typeof DAY_KEYS)[number];

/**
 * Resolve a single day's bookable HH:MM ranges, applying availability
 * exceptions on top of the recurring weekly schedule.
 *
 * Exceptions use the shape the therapist editor actually writes —
 * `{ date, isAvailable, customRanges }`, NOT `{ type, ranges }`. Reading the
 * wrong field names (the previous bug) silently ignored every exception:
 * day-offs still showed slots, and special hours fell back to the weekly
 * schedule. Shared by computeSlots and the server-side /api/checkout/create
 * guard so the two cannot drift again.
 */
export function resolveDayRanges(
  availability: Availability | null | undefined,
  dateStr: string,
  dayKey: WeekdayKey,
): TimeRange[] {
  const av = availability ?? {};
  const exception = av.exceptions?.find((e) => e.date === dateStr);
  if (exception) {
    if (exception.isAvailable === false) return []; // explicit day off
    if (exception.customRanges && exception.customRanges.length > 0) {
      return exception.customRanges; // special hours override recurring
    }
    // isAvailable with no custom ranges → fall through to recurring
  }
  return av.recurring?.[dayKey] ?? [];
}

// Statuses that hold a slot, blocking other clients from booking it.
//
// `pending_payment` is critical here — without it, two clients can pay
// for the same slot in parallel: client A starts checkout (booking
// inserted as pending_payment), client B's slot picker sees the slot
// as free (because it filters out pending_payment), client B also
// starts checkout, both webhooks fire, both end up `confirmed` at the
// same scheduled_at.
const LIVE_STATUSES = new Set([
  "pending",
  "pending_payment",
  "confirmed",
  "in_progress",
  "reschedule_pending",
  // Synthetic status for busy intervals fetched from a therapist's
  // connected external calendar (Google / Microsoft). These aren't
  // real bookings but they must block slots all the same.
  "external_busy",
]);

type Interval = { start: number; end: number }; // epoch ms

// ─── Timezone helpers ──────────────────────────────────────────────
//
// The therapist sets their availability in their own wall-clock time
// (e.g. "09:00–18:00 Europe/Rome"). The viewer can be in any
// timezone. Without these helpers we'd interpret "09:00" in the
// viewer's local zone, which on a non-IT viewer gives the wrong UTC
// instant.

/**
 * Convert a wall-clock date/time in `tz` to a UTC Date. Handles DST
 * by round-tripping through `Intl.DateTimeFormat` to discover the
 * actual offset at that moment.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // First, build a "naive UTC" date from the desired components.
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  // What does that UTC instant look like as a wall-clock in `tz`?
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(naiveUtc));
  const pick = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  let h = pick("hour");
  if (h === 24) h = 0; // Intl quirk on midnight
  const tzWallAsUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    h,
    pick("minute"),
    pick("second"),
  );
  // Difference is the offset of `tz` at this instant.
  const offset = tzWallAsUtc - naiveUtc;
  return new Date(naiveUtc - offset);
}

/**
 * Compute the calendar date (year/month/day/weekday) of `instant`
 * as it would appear on a wall clock in `tz`.
 */
function dateInZone(
  instant: Date,
  tz: string,
): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function subtractBookingFromInterval(
  interval: Interval,
  bookingStart: number,
  bookingEnd: number,
  bufferMs: number,
): Interval[] {
  const bufferedStart = bookingStart - bufferMs;
  const bufferedEnd = bookingEnd + bufferMs;
  if (bufferedEnd <= interval.start || bufferedStart >= interval.end) {
    return [interval];
  }
  const remaining: Interval[] = [];
  if (interval.start < bufferedStart)
    remaining.push({ start: interval.start, end: bufferedStart });
  if (interval.end > bufferedEnd)
    remaining.push({ start: bufferedEnd, end: interval.end });
  return remaining;
}

/**
 * Compute bookable slots for a single therapist + service duration over
 * the next `windowDays` calendar days.
 *
 * Slot cadence: starts every `slotStepMinutes` (default 15 min). So for a
 * 60-minute service in a 09:00–13:00 window, we get start times at 09:00,
 * 09:15, 09:30, 09:45, 10:00, ..., 12:00 (last fitting start). Each
 * candidate start is kept only if its `[start, start+duration]` interval
 * fits entirely within a free window.
 */
export function computeSlots(args: {
  availability: Availability | null | undefined;
  bookings: Booking[];
  durationMinutes: number;
  now?: Date;
  windowDays?: number;
  slotStepMinutes?: number;
}): DaySlots[] {
  const now = args.now ?? new Date();
  const windowDays = args.windowDays ?? BOOKING_WINDOW_DAYS;
  const stepMinutes = args.slotStepMinutes ?? 15;
  const stepMs = stepMinutes * 60_000;
  const av = args.availability ?? {};
  // Defaults aligned with the therapist UI (availability/page.tsx):
  //   bufferMinutes default 15, minNoticeHours default 24.
  // Previously this file defaulted to 30 / 2 — silently producing
  // slots a real therapist would have rejected.
  const buffer = av.bufferMinutes ?? 15;
  const bufferMs = buffer * 60_000;
  const minNoticeMs = (av.minNoticeHours ?? 24) * 60 * 60 * 1000;
  const earliestBookableMs = now.getTime() + minNoticeMs;
  const durationMs = args.durationMinutes * 60_000;
  // The therapist's wall-clock time zone. Falls back to the viewer's
  // local zone when the field isn't set on the profile (legacy data
  // pre-availability-page) — that produces the old behaviour, so
  // existing IT-only flows keep working unchanged.
  const tz =
    av.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const liveBookings = args.bookings.filter((b) => LIVE_STATUSES.has(b.status));

  const result: DaySlots[] = [];

  // Anchor the day iteration on the therapist's calendar. We start at
  // *today in tz* and advance one calendar day at a time, also in tz.
  // Without this, near-midnight viewers in other zones could see
  // "Friday" slots when the therapist already considers it Saturday.
  const startDateInTz = dateInZone(now, tz);

  for (let i = 0; i < windowDays; i++) {
    // Compute "day i" in the therapist's tz by building UTC midnight
    // of (today + i) in tz, then re-extracting the calendar parts.
    const dayUtc = zonedTimeToUtc(
      startDateInTz.year,
      startDateInTz.month,
      startDateInTz.day + i,
      0,
      0,
      tz,
    );
    const dayParts = dateInZone(dayUtc, tz);
    const dayKey = DAY_KEYS[dayParts.weekday];
    const dateStr = [
      dayParts.year,
      String(dayParts.month).padStart(2, "0"),
      String(dayParts.day).padStart(2, "0"),
    ].join("-");

    // Resolve the day's ranges — exceptions (day-off / special hours) on top
    // of the recurring schedule, via the shared helper so the server-side
    // checkout guard applies identical semantics.
    const ranges = resolveDayRanges(av, dateStr, dayKey);

    // Convert HH:MM ranges (in `tz`) → UTC epoch intervals, clipped
    // to earliestBookable.
    let freeIntervals: Interval[] = [];
    for (const r of ranges) {
      const [sh, sm] = r.start.split(":").map(Number);
      const [eh, em] = r.end.split(":").map(Number);
      const s = zonedTimeToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        sh,
        sm,
        tz,
      );
      const e = zonedTimeToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        eh,
        em,
        tz,
      );
      let startMs = s.getTime();
      const endMs = e.getTime();
      if (endMs <= earliestBookableMs) continue;
      if (startMs < earliestBookableMs) startMs = earliestBookableMs;
      if (startMs < endMs) freeIntervals.push({ start: startMs, end: endMs });
    }

    // Subtract bookings that overlap this day. The day boundaries are
    // computed in `tz` too — a booking at "23:30 Rome" should belong
    // to today (Rome) even if a UTC viewer would call it tomorrow.
    const dayStartMs = dayUtc.getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    for (const b of liveBookings) {
      const bStart = new Date(b.scheduled_at).getTime();
      const bEnd = bStart + b.duration * 60_000;
      if (bEnd <= dayStartMs || bStart >= dayEndMs) continue;
      freeIntervals = freeIntervals.flatMap((iv) =>
        subtractBookingFromInterval(iv, bStart, bEnd, bufferMs),
      );
    }

    // Generate slot start times within each free interval. Rounding
    // happens on the wall-clock in `tz` so we get clean :00/:15/:30
    // labels for the therapist (and a clean conversion for the viewer).
    const slots: Slot[] = [];
    for (const iv of freeIntervals) {
      const ivStartParts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(new Date(iv.start));
      const ivStartHour = parseInt(
        ivStartParts.find((p) => p.type === "hour")?.value ?? "0",
        10,
      );
      const ivStartMinute = parseInt(
        ivStartParts.find((p) => p.type === "minute")?.value ?? "0",
        10,
      );
      const roundedMinutes =
        Math.ceil(ivStartMinute / stepMinutes) * stepMinutes;
      let candidate = zonedTimeToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        ivStartHour + Math.floor(roundedMinutes / 60),
        roundedMinutes % 60,
        tz,
      ).getTime();
      // If rounding moved us before the interval start (rare — only on
      // weird DST edges), snap forward.
      if (candidate < iv.start) candidate += stepMs;

      while (candidate + durationMs <= iv.end) {
        slots.push({
          start: new Date(candidate),
          end: new Date(candidate + durationMs),
        });
        candidate += stepMs;
      }
    }

    if (slots.length > 0 || i < 7) {
      // Always show the first 7 days even when empty so the user sees a
      // calendar grid; days 8–14 only appear if they have slots.
      result.push({ date: dayUtc, slots });
    }
  }

  return result;
}
