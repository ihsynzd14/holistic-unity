/**
 * Cross-therapist capacity aggregation for the admin dashboard.
 *
 * Purpose: answer the marketing question "how many hours per week of each
 * therapy category can the marketplace currently supply?" so the admin can
 * proportionally allocate ad budget (e.g. if ThetaHealing has 100h/week
 * available and Numerology only 20h, invest ~83% in ThetaHealing ads).
 *
 * Attribution rule ("Option A")
 * ─────────────────────────────
 * A therapist's free hours count FULLY toward every category they offer.
 * If therapist T has 10h free and offers both ThetaHealing and Numerology,
 * then ThetaHealing += 10h AND Numerology += 10h. This mirrors "supply
 * ceiling per category": each category could consume up to that many
 * hours, though in practice filling one category reduces the others
 * because the underlying therapist hours are shared.
 *
 * For budget allocation this is the right framing — it shows the demand
 * ceiling per category rather than some arbitrary split. The admin card
 * UI makes this explicit with a tooltip.
 */

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
    date: string;
    // Therapist editor shape (availability/page.tsx): isAvailable=false → day
    // off; isAvailable=true → special hours in customRanges (override
    // recurring). The old type/ranges fields were never written by anything,
    // so reading them silently ignored every exception (capacity overcounted
    // a therapist's free hours on their days off).
    isAvailable?: boolean;
    customRanges?: TimeRange[] | null;
  }>;
  bufferMinutes?: number;
  minNoticeHours?: number;
};

export type TherapistInput = {
  id: string;
  availability: Availability | null;
  /** Categories this therapist offers (distinct strings from therapist_services.category) */
  categories: string[];
  bookings: Array<{
    id: string;
    scheduled_at: string;
    duration: number;
    status: string;
  }>;
};

export type CategoryCapacity = {
  category: string;
  hoursAvailable: number;
  therapistCount: number;
};

export type AggregateCapacityResult = {
  windowDays: number;
  totalTherapists: number;
  therapistsWithAvailability: number;
  totalFreeHours: number; // raw sum of per-therapist free hours (not double-counted by category)
  byCategory: CategoryCapacity[]; // sorted desc by hoursAvailable
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

type Interval = { start: number; end: number };

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
  if (interval.start < bufferedStart) remaining.push({ start: interval.start, end: bufferedStart });
  if (interval.end > bufferedEnd) remaining.push({ start: bufferedEnd, end: interval.end });
  return remaining;
}

/**
 * Compute total free minutes for one therapist in [now, now + windowDays].
 * See therapist-webapp's capacity.ts for the same algorithm applied to a
 * single therapist with per-service slot counts.
 */
export function computeTherapistFreeMinutes(
  availability: Availability | null,
  bookings: TherapistInput["bookings"],
  now: Date,
  windowDays: number,
): number {
  const av = availability ?? {};
  const buffer = av.bufferMinutes ?? 30;
  const bufferMs = buffer * 60_000;
  const minNoticeMs = (av.minNoticeHours ?? 2) * 60 * 60 * 1000;
  const earliestBookableMs = now.getTime() + minNoticeMs;

  const LIVE = new Set([
    "pending",
    "confirmed",
    "in_progress",
    "reschedule_pending",
  ]);
  const liveBookings = bookings.filter((b) => LIVE.has(b.status));

  let totalMs = 0;

  for (let i = 0; i < windowDays; i++) {
    const day = new Date(now);
    day.setDate(day.getDate() + i);
    day.setHours(0, 0, 0, 0);

    const dayKey = DAY_KEYS[day.getDay()];
    const dateStr = [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, "0"),
      String(day.getDate()).padStart(2, "0"),
    ].join("-");

    const exception = av.exceptions?.find((e) => e.date === dateStr);
    let ranges: TimeRange[];
    if (exception && exception.isAvailable === false) {
      ranges = []; // explicit day off
    } else if (exception?.customRanges && exception.customRanges.length > 0) {
      ranges = exception.customRanges; // special hours override recurring
    } else {
      ranges = av.recurring?.[dayKey] ?? [];
    }

    let intervals: Interval[] = [];
    for (const r of ranges) {
      const [sh, sm] = r.start.split(":").map(Number);
      const [eh, em] = r.end.split(":").map(Number);
      const s = new Date(day);
      s.setHours(sh, sm, 0, 0);
      const e = new Date(day);
      e.setHours(eh, em, 0, 0);

      let startMs = s.getTime();
      const endMs = e.getTime();
      if (endMs <= earliestBookableMs) continue;
      if (startMs < earliestBookableMs) startMs = earliestBookableMs;
      if (startMs < endMs) intervals.push({ start: startMs, end: endMs });
    }

    // Subtract bookings that fall on this day (with buffer)
    const dayStartMs = day.getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    for (const b of liveBookings) {
      const bStart = new Date(b.scheduled_at).getTime();
      const bEnd = bStart + b.duration * 60_000;
      if (bEnd <= dayStartMs || bStart >= dayEndMs) continue;
      intervals = intervals.flatMap((iv) =>
        subtractBookingFromInterval(iv, bStart, bEnd, bufferMs),
      );
    }

    for (const iv of intervals) totalMs += iv.end - iv.start;
  }

  return Math.round(totalMs / 60_000);
}

/**
 * Main entry point — aggregate per category across all therapists.
 */
export function aggregateCapacityByCategory(args: {
  therapists: TherapistInput[];
  now?: Date;
  windowDays?: number;
}): AggregateCapacityResult {
  const now = args.now ?? new Date();
  const windowDays = args.windowDays ?? 7;

  const categoryTotals = new Map<string, { minutes: number; therapistIds: Set<string> }>();
  let rawTotalMinutes = 0;
  let therapistsWithAvailability = 0;

  for (const t of args.therapists) {
    const minutes = computeTherapistFreeMinutes(
      t.availability,
      t.bookings,
      now,
      windowDays,
    );
    if (minutes > 0) {
      therapistsWithAvailability++;
      rawTotalMinutes += minutes;
    }

    // Attribute minutes to each category this therapist offers
    for (const rawCat of t.categories) {
      const cat = (rawCat || "").trim();
      if (!cat) continue;
      const entry = categoryTotals.get(cat) ?? {
        minutes: 0,
        therapistIds: new Set<string>(),
      };
      entry.minutes += minutes;
      entry.therapistIds.add(t.id);
      categoryTotals.set(cat, entry);
    }
  }

  const byCategory: CategoryCapacity[] = Array.from(categoryTotals.entries())
    .map(([category, data]) => ({
      category,
      hoursAvailable: Math.round((data.minutes / 60) * 10) / 10,
      therapistCount: data.therapistIds.size,
    }))
    .sort((a, b) => b.hoursAvailable - a.hoursAvailable);

  return {
    windowDays,
    totalTherapists: args.therapists.length,
    therapistsWithAvailability,
    totalFreeHours: Math.round((rawTotalMinutes / 60) * 10) / 10,
    byCategory,
  };
}
