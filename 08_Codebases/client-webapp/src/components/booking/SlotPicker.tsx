"use client";

import { useMemo, useState } from "react";
import type { Availability, Booking, DaySlots } from "@/lib/booking/slots";
import { computeSlots, BOOKING_WINDOW_DAYS } from "@/lib/booking/slots";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";

interface SlotPickerProps {
  availability: Availability | null | undefined;
  bookings: Booking[];
  durationMinutes: number;
  onSelect: (slotStart: Date) => void;
  selected: Date | null;
  /** BCP-47 locale tag used for time formatting in the slot grid.
   *  Defaults to "it-IT" for backwards compat with the original behaviour. */
  locale?: string;
  /** Localised strings — passed in by the parent so we don't bind to a
   *  specific i18n provider here. Keeps the component reusable. */
  labels: {
    selectDay: string;
    selectTime: string;
    noSlots: string;
    noSlotsHelp: string;
    weekdayShort: string[]; // 7 items, sunday-first to match Date#getDay()
  };
}

export default function SlotPicker({
  availability,
  bookings,
  durationMinutes,
  onSelect,
  selected,
  locale = "it-IT",
  labels,
}: SlotPickerProps) {
  // Monthly window (BOOKING_WINDOW_DAYS = 42 days / 6 weeks): therapists
  // organise availability month-by-month and in-studio clients plan a full
  // month ahead, so the picker must surface the whole upcoming month — not
  // just the next 2-3 weeks. The week strip still pages 7 days at a time, so
  // a longer horizon doesn't overwhelm the UI; it just adds more pages.
  const days = useMemo(
    () =>
      computeSlots({
        availability,
        bookings,
        durationMinutes,
        windowDays: BOOKING_WINDOW_DAYS,
      }),
    [availability, bookings, durationMinutes],
  );

  // Helpful fallback when the entire window has no slots — without it
  // the user just sees an empty grid and assumes the therapist is
  // permanently unavailable.
  const firstAvailableIdx = days.findIndex((d) => d.slots.length > 0);
  const noSlotsAtAll = firstAvailableIdx === -1;

  // Default-select the first day that actually has slots so the time grid
  // isn't empty on initial render.
  const initialDayIdx = days.findIndex((d) => d.slots.length > 0);
  const [activeDayIdx, setActiveDayIdx] = useState(
    initialDayIdx === -1 ? 0 : initialDayIdx,
  );
  const [pageStart, setPageStart] = useState(0); // first day index in the visible week strip
  const PAGE_SIZE = 7;

  const visibleDays = days.slice(pageStart, pageStart + PAGE_SIZE);
  const canPagePrev = pageStart > 0;
  const canPageNext = pageStart + PAGE_SIZE < days.length;
  const activeDay: DaySlots | undefined = days[activeDayIdx];

  return (
    <div className="space-y-4">
      {/* Week strip */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-muted">
          {labels.selectDay}
        </p>
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setPageStart(Math.max(0, pageStart - PAGE_SIZE))}
            disabled={!canPagePrev}
            className="flex h-16 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-berry/10 bg-white/60 text-charcoal-muted transition-all hover:bg-berry-subtle/40 disabled:opacity-30"
            aria-label="prev week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex flex-1 gap-1.5 overflow-x-auto">
            {visibleDays.map((d, i) => {
              const idx = pageStart + i;
              const isActive = idx === activeDayIdx;
              const hasSlots = d.slots.length > 0;
              return (
                <button
                  key={d.date.toISOString()}
                  type="button"
                  onClick={() => setActiveDayIdx(idx)}
                  disabled={!hasSlots}
                  aria-pressed={isActive}
                  aria-label={
                    hasSlots
                      ? `${d.date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })} \u2014 ${d.slots.length} slot disponibili`
                      : `${d.date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })} \u2014 nessuno slot disponibile`
                  }
                  className={`flex h-16 flex-1 flex-col items-center justify-center rounded-xl border transition-all ${
                    isActive
                      ? "border-berry bg-berry text-white shadow-md shadow-berry/15"
                      : hasSlots
                      ? "border-berry/10 bg-white/70 text-charcoal hover:border-berry/30 hover:bg-berry-subtle/40"
                      : "border-berry/5 bg-white/30 text-charcoal-muted/40 cursor-not-allowed"
                  }`}
                >
                  <span aria-hidden="true" className="text-[10px] font-semibold uppercase tracking-wide">
                    {labels.weekdayShort[d.date.getDay()]}
                  </span>
                  <span aria-hidden="true" className="font-[family-name:var(--font-display)] text-lg font-bold leading-none">
                    {d.date.getDate()}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setPageStart(pageStart + PAGE_SIZE)}
            disabled={!canPageNext}
            className="flex h-16 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-berry/10 bg-white/60 text-charcoal-muted transition-all hover:bg-berry-subtle/40 disabled:opacity-30"
            aria-label="next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Time grid */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-muted">
          {labels.selectTime}
        </p>
        {!activeDay || activeDay.slots.length === 0 ? (
          <div className="rounded-2xl border border-berry/5 bg-white/60 p-6 text-center">
            <Clock className="mx-auto h-8 w-8 text-berry-muted/40" strokeWidth={1.25} />
            <p className="mt-2 text-sm font-medium text-charcoal-muted">{labels.noSlots}</p>
            <p className="mt-1 text-xs text-charcoal-muted/70">
              {noSlotsAtAll
                ? "Nessuna disponibilità nel prossimo mese. Scrivi al terapista per concordare un orario."
                : firstAvailableIdx > activeDayIdx
                ? `Prossimo slot disponibile: ${days[firstAvailableIdx].date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}.`
                : labels.noSlotsHelp}
            </p>
            {!noSlotsAtAll && firstAvailableIdx !== -1 && firstAvailableIdx !== activeDayIdx && (
              <button
                type="button"
                onClick={() => {
                  setActiveDayIdx(firstAvailableIdx);
                  if (firstAvailableIdx >= pageStart + PAGE_SIZE || firstAvailableIdx < pageStart) {
                    setPageStart(Math.floor(firstAvailableIdx / PAGE_SIZE) * PAGE_SIZE);
                  }
                }}
                className="mt-3 rounded-full bg-berry px-4 py-1.5 text-xs font-semibold text-white hover:bg-berry-dark"
              >
                Vai al primo slot disponibile
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {activeDay.slots.map((s) => {
              const isSelected = selected?.getTime() === s.start.getTime();
              return (
                <button
                  key={s.start.toISOString()}
                  type="button"
                  onClick={() => onSelect(s.start)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-all ${
                    isSelected
                      ? "border-berry bg-berry text-white shadow-md shadow-berry/15"
                      : "border-berry/10 bg-white/70 text-charcoal hover:border-berry/30 hover:bg-berry-subtle/40"
                  }`}
                >
                  {s.start.toLocaleTimeString(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
