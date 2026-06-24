"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  ChevronLeft, ChevronRight, CalendarOff, CalendarCheck,
  Clock, Plus, X, RotateCcw, Check,
} from "lucide-react";

export type TimeRange = { id: string; start: string; end: string };
export type AvailabilityException = {
  id: string;
  date: string; // "YYYY-MM-DD" in the therapist's timezone
  isAvailable: boolean;
  customRanges: TimeRange[] | null;
};

// Sunday-first to match Date#getDay() (0 = Sunday … 6 = Saturday).
const WEEKDAY_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

const pad = (n: number) => n.toString().padStart(2, "0");
// Build a YYYY-MM-DD string from calendar parts directly — never via
// toISOString(), which would shift the date across the UTC boundary for
// users east/west of UTC and silently write the wrong day's exception.
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const uid = () => crypto.randomUUID();

type DayKind = "default" | "custom" | "full" | "closed";

interface MonthlyCalendarProps {
  /** The recurring weekly pattern — the baseline every non-overridden day follows. */
  recurring: Record<string, TimeRange[]>;
  /** Per-date overrides (day-off / special hours). */
  exceptions: AvailabilityException[];
  /** Live booking count per "YYYY-MM-DD" (therapist tz) — shown as a density badge. */
  bookingsByDate?: Record<string, number>;
  /** Shared HH:MM options from the parent (keeps the grid identical to the weekly editor). */
  timeOptions: string[];
  /** Create/replace the override for a date (one exception per date — upsert). */
  onUpsert: (date: string, isAvailable: boolean, customRanges: TimeRange[] | null) => void;
  /** Remove any override for a date (the day reverts to the weekly pattern). */
  onClear: (date: string) => void;
}

export default function MonthlyCalendar({
  recurring,
  exceptions,
  bookingsByDate,
  timeOptions,
  onUpsert,
  onClear,
}: MonthlyCalendarProps) {
  const { t, locale } = useI18n();
  const c = t.availability.calendar;
  const localeTag = locale === "it" ? "it-IT" : "en-US";

  const now = new Date();
  const todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate());

  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [editing, setEditing] = useState<string | null>(null); // YYYY-MM-DD or null
  const [mode, setMode] = useState<"default" | "full" | "custom">("default");
  const [draft, setDraft] = useState<TimeRange[]>([]);

  // Monday-first short weekday headers, locale-aware. 2024-01-01 is a Monday.
  const weekdayShort = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(localeTag, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
  }, [localeTag]);

  const monthLabel = useMemo(
    () => new Date(view.y, view.m, 1).toLocaleDateString(localeTag, { month: "long", year: "numeric" }),
    [view, localeTag],
  );

  // Index exceptions by date for O(1) lookup while rendering the grid.
  const excByDate = useMemo(() => {
    const map = new Map<string, AvailabilityException>();
    for (const e of exceptions) map.set(e.date, e);
    return map;
  }, [exceptions]);

  function dayKind(dateStr: string, weekdayKey: string): { kind: DayKind; ranges: TimeRange[] } {
    const exc = excByDate.get(dateStr);
    if (exc) {
      if (!exc.isAvailable) return { kind: "full", ranges: [] };
      return { kind: "custom", ranges: exc.customRanges ?? [] };
    }
    const rec = recurring[weekdayKey] ?? [];
    if (rec.length === 0) return { kind: "closed", ranges: [] };
    return { kind: "default", ranges: rec };
  }

  // Calendar cells: leading blanks (Monday-first) + each day + trailing blanks.
  const cells = useMemo(() => {
    const startWeekday = new Date(view.y, view.m, 1).getDay(); // 0 Sun … 6 Sat
    const lead = (startWeekday + 6) % 7; // shift so Monday is column 0
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const arr: ({ day: number; dateStr: string; weekdayKey: string } | null)[] = [];
    for (let i = 0; i < lead; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const wk = new Date(view.y, view.m, d).getDay();
      arr.push({ day: d, dateStr: ymd(view.y, view.m, d), weekdayKey: WEEKDAY_KEYS[wk] });
    }
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [view]);

  function seedRanges(weekdayKey: string): TimeRange[] {
    const rec = recurring[weekdayKey] ?? [];
    if (rec.length > 0) return rec.map((r) => ({ id: uid(), start: r.start, end: r.end }));
    return [{ id: uid(), start: "09:00", end: "13:00" }];
  }

  function openDay(dateStr: string, weekdayKey: string) {
    const exc = excByDate.get(dateStr);
    if (exc && !exc.isAvailable) {
      setMode("full");
      setDraft(seedRanges(weekdayKey));
    } else if (exc && exc.isAvailable) {
      setMode("custom");
      const seed = exc.customRanges && exc.customRanges.length > 0
        ? exc.customRanges.map((r) => ({ id: r.id ?? uid(), start: r.start, end: r.end }))
        : seedRanges(weekdayKey);
      setDraft(seed);
    } else {
      setMode("default");
      setDraft(seedRanges(weekdayKey));
    }
    setEditing(dateStr);
  }

  function close() { setEditing(null); }

  function applyFull() {
    if (!editing) return;
    onUpsert(editing, false, null);
    close();
  }

  function applyCustom() {
    if (!editing) return;
    // Keep only well-formed ranges (start < end); empty result falls back
    // to a day-off so we never write an "available with no hours" state.
    const valid = draft.filter((r) => r.start < r.end);
    if (valid.length === 0) { applyFull(); return; }
    onUpsert(editing, true, valid);
    close();
  }

  function resetDay() {
    if (!editing) return;
    onClear(editing);
    close();
  }

  const editingWeekdayKey = editing
    ? WEEKDAY_KEYS[new Date(editing + "T00:00:00").getDay()]
    : "monday";
  const editingHasException = editing ? excByDate.has(editing) : false;

  return (
    <div className="space-y-4">
      {/* Header: month nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
          aria-label={c.prevMonth}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-berry/10 bg-white/60 text-charcoal-muted transition-all hover:bg-berry-subtle/40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-[family-name:var(--font-display)] text-base font-bold capitalize text-charcoal">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
          aria-label={c.nextMonth}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-berry/10 bg-white/60 text-charcoal-muted transition-all hover:bg-berry-subtle/40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1.5">
        {weekdayShort.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-semibold uppercase tracking-wide text-charcoal-muted">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} className="aspect-square" />;
          const { kind, ranges } = dayKind(cell.dateStr, cell.weekdayKey);
          const bookingCount = bookingsByDate?.[cell.dateStr] ?? 0;
          const isPast = cell.dateStr < todayStr;
          const isToday = cell.dateStr === todayStr;
          const isActive = editing === cell.dateStr;

          const tone =
            kind === "full" ? "border-error/20 bg-error/5 text-error"
            : kind === "custom" ? "border-berry/25 bg-berry-subtle/50 text-charcoal"
            : kind === "closed" ? "border-berry/5 bg-white/30 text-charcoal-muted/40"
            : "border-berry/10 bg-white/70 text-charcoal"; // default / available

          return (
            <button
              key={cell.dateStr}
              type="button"
              disabled={isPast}
              onClick={() => openDay(cell.dateStr, cell.weekdayKey)}
              aria-label={`${new Date(cell.dateStr + "T00:00:00").toLocaleDateString(localeTag, { day: "numeric", month: "long" })} — ${
                kind === "full" ? c.legendFull
                : kind === "custom" ? c.legendCustom
                : kind === "closed" ? c.legendClosed
                : c.legendAvailable
              }`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border p-1 transition-all ${tone} ${
                isPast ? "cursor-not-allowed opacity-40" : "hover:-translate-y-0.5 hover:shadow-sm"
              } ${isActive ? "ring-2 ring-berry" : isToday ? "ring-1 ring-berry/40" : ""}`}
            >
              {bookingCount > 0 && (
                <span
                  className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-berry px-1 text-[8px] font-bold leading-none text-white"
                  title={`${bookingCount} ${c.legendBooked}`}
                >
                  {bookingCount}
                </span>
              )}
              <span className="text-sm font-semibold leading-none">{cell.day}</span>
              {kind === "full" ? (
                <CalendarOff className="mt-1 h-3 w-3" />
              ) : kind === "custom" ? (
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-berry" />
              ) : kind === "default" ? (
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-success" />
              ) : (
                <span className="mt-1 text-[9px] leading-none text-charcoal-muted/40">—</span>
              )}
              {/* Tiny hours hint on available/custom days (hidden on the most cramped widths) */}
              {(kind === "default" || kind === "custom") && ranges.length > 0 && (
                <span className="mt-0.5 hidden text-[8px] leading-none text-charcoal-muted sm:block">
                  {ranges[0].start}
                  {ranges.length > 1 ? "+" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-charcoal-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />{c.legendAvailable}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-berry" />{c.legendCustom}</span>
        <span className="flex items-center gap-1.5"><CalendarOff className="h-3 w-3 text-error" />{c.legendFull}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-charcoal-muted/30" />{c.legendClosed}</span>
        <span className="flex items-center gap-1.5"><span className="flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-berry px-1 text-[8px] font-bold leading-none text-white">N</span>{c.legendBooked}</span>
      </div>

      {/* Day editor */}
      {editing && (
        <div className="rounded-2xl border border-berry/10 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold capitalize text-charcoal">
              {new Date(editing + "T00:00:00").toLocaleDateString(localeTag, { weekday: "long", day: "numeric", month: "long" })}
            </h3>
            <button type="button" onClick={close} className="rounded-lg p-1 text-charcoal-muted hover:bg-charcoal/5" aria-label={t.common.close}>
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mode segmented control */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setMode("default")}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                mode === "default" ? "bg-charcoal text-white" : "border border-berry/10 bg-white/70 text-charcoal-light"
              }`}
            >
              <CalendarCheck className="h-3.5 w-3.5" />{c.modeDefault}
            </button>
            <button
              type="button"
              onClick={() => setMode("full")}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                mode === "full" ? "bg-error text-white" : "border border-berry/10 bg-white/70 text-charcoal-light"
              }`}
            >
              <CalendarOff className="h-3.5 w-3.5" />{c.modeFull}
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                mode === "custom" ? "bg-berry text-white" : "border border-berry/10 bg-white/70 text-charcoal-light"
              }`}
            >
              <Clock className="h-3.5 w-3.5" />{c.modeCustom}
            </button>
          </div>

          {/* Mode body */}
          {mode === "default" && (
            <div className="space-y-3">
              <p className="text-xs text-charcoal-muted">
                {(recurring[editingWeekdayKey] ?? []).length > 0 ? c.defaultHint : c.defaultClosedHint}
              </p>
              {editingHasException ? (
                <button
                  type="button"
                  onClick={resetDay}
                  className="flex items-center gap-1.5 rounded-full bg-charcoal px-4 py-2 text-xs font-semibold text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />{c.resetToDefault}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={close}
                  className="rounded-full border border-berry/10 px-4 py-2 text-xs font-medium text-charcoal-muted hover:bg-charcoal/5"
                >
                  {t.common.close}
                </button>
              )}
            </div>
          )}

          {mode === "full" && (
            <div className="space-y-3">
              <p className="text-xs text-charcoal-muted">{c.fullHint}</p>
              <button
                type="button"
                onClick={applyFull}
                className="flex items-center gap-1.5 rounded-full bg-error px-4 py-2 text-xs font-semibold text-white shadow-md shadow-error/20"
              >
                <CalendarOff className="h-3.5 w-3.5" />{c.markFull}
              </button>
            </div>
          )}

          {mode === "custom" && (
            <div className="space-y-3">
              <p className="text-xs text-charcoal-muted">{c.customHint}</p>
              <div className="space-y-2">
                {draft.map((r) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <select
                      value={r.start}
                      onChange={(e) => setDraft(draft.map((dr) => (dr.id === r.id ? { ...dr, start: e.target.value } : dr)))}
                      className="rounded-lg border border-berry/10 bg-white px-2.5 py-1.5 text-xs text-charcoal outline-none focus:border-berry/30"
                    >
                      {timeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <span className="text-xs text-charcoal-muted">—</span>
                    <select
                      value={r.end}
                      onChange={(e) => setDraft(draft.map((dr) => (dr.id === r.id ? { ...dr, end: e.target.value } : dr)))}
                      className="rounded-lg border border-berry/10 bg-white px-2.5 py-1.5 text-xs text-charcoal outline-none focus:border-berry/30"
                    >
                      {timeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setDraft(draft.filter((dr) => dr.id !== r.id))}
                      className="text-charcoal-muted hover:text-error"
                      aria-label={t.common.delete}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDraft([...draft, { id: uid(), start: "09:00", end: "13:00" }])}
                  className="flex items-center gap-1 text-xs font-medium text-berry hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />{t.availability.addTimeRange}
                </button>
              </div>
              <button
                type="button"
                onClick={applyCustom}
                className="flex items-center gap-1.5 rounded-full bg-berry px-4 py-2 text-xs font-semibold text-white shadow-md shadow-berry/20"
              >
                <Check className="h-3.5 w-3.5" />{c.apply}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
