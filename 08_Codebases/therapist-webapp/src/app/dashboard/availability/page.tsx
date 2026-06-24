"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  Plus, Trash2, Save, Globe, Timer, ArrowRightLeft,
  CalendarOff, CalendarCheck, Check, AlertTriangle, Info, ChevronDown,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";
import MonthlyCalendar from "@/components/availability/MonthlyCalendar";

type TimeRange = { id: string; start: string; end: string };
type AvailabilityException = {
  id: string;
  date: string;
  isAvailable: boolean;
  customRanges: TimeRange[] | null;
};
type Availability = {
  recurring: Record<string, TimeRange[]>;
  exceptions: AvailabilityException[];
  timezone: string;
  minNoticeHours: number;
  bufferMinutes: number;
};

const DAYS = [
  { key: "monday", labelKey: "monday" as const },
  { key: "tuesday", labelKey: "tuesday" as const },
  { key: "wednesday", labelKey: "wednesday" as const },
  { key: "thursday", labelKey: "thursday" as const },
  { key: "friday", labelKey: "friday" as const },
  { key: "saturday", labelKey: "saturday" as const },
  { key: "sunday", labelKey: "sunday" as const },
];

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  for (let m = 0; m < 60; m += 30) {
    TIME_OPTIONS.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
  }
}

function uid() { return crypto.randomUUID(); }

const defaultAvailability: Availability = {
  recurring: {
    monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
  },
  exceptions: [],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  minNoticeHours: 24,
  bufferMinutes: 15,
};

export default function AvailabilityPage() {
  const { t } = useI18n();
  const [availability, setAvailability] = useState<Availability>(defaultAvailability);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Weekly template is collapsible (open by default) so the monthly calendar,
  // now the primary day-by-day editor, leads the page.
  const [weeklyOpen, setWeeklyOpen] = useState(true);
  // Per-date overrides are now edited through the monthly calendar below;
  // it upserts/clears entries in availability.exceptions directly.
  // Live booking count per calendar day (therapist tz), shown on the calendar
  // so the therapist can see which days are already filling up ("ho già pieno").
  const [bookingsByDate, setBookingsByDate] = useState<Record<string, number>>({});

  const fetchAvailability = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("therapist_profiles")
      .select("availability")
      .eq("id", user.id)
      .single();

    let tz = defaultAvailability.timezone;
    if (data?.availability) {
      const avail = data.availability as Availability;
      tz = avail.timezone || defaultAvailability.timezone;
      setAvailability({
        recurring: avail.recurring || defaultAvailability.recurring,
        exceptions: avail.exceptions || [],
        timezone: tz,
        minNoticeHours: avail.minNoticeHours ?? 24,
        bufferMinutes: avail.bufferMinutes ?? 15,
      });
    }

    // Booking density: count this therapist's live bookings per calendar day so
    // the calendar can flag days that are filling up. Mapped in the therapist's
    // timezone (en-CA → "YYYY-MM-DD") to match how slots/exceptions resolve.
    const now = new Date();
    const horizonMs = now.getTime() + 120 * 24 * 60 * 60 * 1000;
    const { data: bookings } = await supabase
      .from("bookings")
      .select("scheduled_at, status")
      .eq("therapist_id", user.id)
      .in("status", ["pending", "pending_payment", "confirmed", "in_progress", "reschedule_pending"])
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", new Date(horizonMs).toISOString());

    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const counts: Record<string, number> = {};
    for (const b of bookings ?? []) {
      if (!b.scheduled_at) continue;
      const day = dayFmt.format(new Date(b.scheduled_at as string));
      counts[day] = (counts[day] ?? 0) + 1;
    }
    setBookingsByDate(counts);

    setLoading(false);
  }, []);

  useEffect(() => { fetchAvailability(); }, [fetchAvailability]);

  async function saveAvailability() {
    setSaving(true);
    setSaveError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }

      const { error } = await supabase
        .from("therapist_profiles")
        .update({ availability: availability })
        .eq("id", user.id);

      if (error) throw error;

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save availability");
    } finally {
      setSaving(false);
    }
  }

  function addTimeRange(day: string) {
    const ranges = availability.recurring[day] || [];
    const lastEnd = ranges.length > 0 ? ranges[ranges.length - 1].end : "09:00";
    const startH = parseInt(lastEnd.split(":")[0]);
    const newStart = `${Math.min(startH + 1, 21).toString().padStart(2, "0")}:00`;
    const newEnd = `${Math.min(startH + 2, 22).toString().padStart(2, "0")}:00`;

    setAvailability({
      ...availability,
      recurring: {
        ...availability.recurring,
        [day]: [...ranges, { id: uid(), start: newStart, end: newEnd }],
      },
    });
  }

  function removeTimeRange(day: string, rangeId: string) {
    setAvailability({
      ...availability,
      recurring: {
        ...availability.recurring,
        [day]: (availability.recurring[day] || []).filter((r) => r.id !== rangeId),
      },
    });
  }

  function updateTimeRange(day: string, rangeId: string, field: "start" | "end", value: string) {
    setAvailability({
      ...availability,
      recurring: {
        ...availability.recurring,
        [day]: (availability.recurring[day] || []).map((r) =>
          r.id === rangeId ? { ...r, [field]: value } : r
        ),
      },
    });
  }

  // Create or replace the override for a date. One exception per date:
  // we drop any existing entry for that day first so the slot engines
  // (which look up exceptions by date) never see ambiguous duplicates.
  function upsertException(date: string, isAvailable: boolean, customRanges: TimeRange[] | null) {
    setAvailability((prev) => ({
      ...prev,
      exceptions: [
        ...prev.exceptions.filter((e) => e.date !== date),
        { id: uid(), date, isAvailable, customRanges },
      ],
    }));
  }

  // Remove any override for a date — the day reverts to the weekly pattern.
  function clearExceptionByDate(date: string) {
    setAvailability((prev) => ({
      ...prev,
      exceptions: prev.exceptions.filter((e) => e.date !== date),
    }));
  }

  function removeException(id: string) {
    setAvailability({
      ...availability,
      exceptions: availability.exceptions.filter((e) => e.id !== id),
    });
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  return (
    <div className="space-y-8">
      <div className="animate-reveal flex items-center justify-between">
        <div>
          <DisplayHeading>{t.availability.title}</DisplayHeading>
          <p className="mt-1 text-sm text-charcoal-muted">{t.availability.subtitle}</p>
          {saveError && (
            <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" /> {saveError}
            </p>
          )}
        </div>
        <button
          onClick={saveAvailability}
          disabled={saving}
          className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 active:scale-[0.97] ${
            saved ? "bg-success shadow-success/20" : "bg-berry shadow-berry/20 hover:bg-berry-dark"
          } disabled:opacity-50`}
        >
          {saving ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saved ? t.common.saved : t.common.save}
        </button>
      </div>

      {/* How it works — teaches the weekly-template -> per-day-override model
          the therapist was missing (she expected Calendly-style per-day entry). */}
      <div
        className="animate-reveal flex items-start gap-3 rounded-2xl border border-berry/10 bg-berry-subtle/30 p-4"
        style={{ animationDelay: "20ms" }}
      >
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-berry" />
        <p className="text-sm leading-relaxed text-charcoal-light">{t.availability.howItWorks}</p>
      </div>

      {/* Settings row */}
      <div className="animate-reveal grid grid-cols-1 gap-4 sm:grid-cols-3" style={{ animationDelay: "40ms" }}>
        {/* Timezone */}
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-4 w-4 text-berry" />
            <label className="text-xs font-semibold text-charcoal-muted">{t.availability.timezone}</label>
          </div>
          <select
            value={availability.timezone}
            onChange={(e) => setAvailability({ ...availability, timezone: e.target.value })}
            className="w-full rounded-xl border border-berry/10 bg-white/70 px-3 py-2 text-sm text-charcoal outline-none focus:border-berry/30 transition-all"
          >
            {(() => {
              try {
                return Intl.supportedValuesOf("timeZone").map((tz: string) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ));
              } catch {
                return ["Europe/Rome", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Zurich", "Europe/Amsterdam", "Europe/Brussels", "Europe/Vienna", "Europe/Lisbon", "Europe/Athens", "Europe/Bucharest", "Europe/Istanbul", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "America/Buenos_Aires", "America/Mexico_City", "Asia/Tokyo", "Asia/Shanghai", "Asia/Dubai", "Asia/Kolkata", "Australia/Sydney", "Pacific/Auckland"].map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ));
              }
            })()}
          </select>
        </div>

        {/* Min notice */}
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Timer className="h-4 w-4 text-berry" />
            <label className="text-xs font-semibold text-charcoal-muted">{t.availability.minNotice}</label>
          </div>
          <select
            value={availability.minNoticeHours}
            onChange={(e) => setAvailability({ ...availability, minNoticeHours: parseInt(e.target.value) })}
            className="w-full rounded-xl border border-berry/10 bg-white/70 px-3 py-2 text-sm text-charcoal outline-none focus:border-berry/30 transition-all"
          >
            {[1, 2, 3, 4, 6, 8, 12, 24, 48].map((h) => (
              <option key={h} value={h}>{h} {h === 1 ? t.common.hour : t.common.hours}</option>
            ))}
          </select>
        </div>

        {/* Buffer */}
        <div className="rounded-2xl border border-berry/5 bg-white/70 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <ArrowRightLeft className="h-4 w-4 text-berry" />
            <label className="text-xs font-semibold text-charcoal-muted">{t.availability.buffer}</label>
          </div>
          <select
            value={availability.bufferMinutes}
            onChange={(e) => setAvailability({ ...availability, bufferMinutes: parseInt(e.target.value) })}
            className="w-full rounded-xl border border-berry/10 bg-white/70 px-3 py-2 text-sm text-charcoal outline-none focus:border-berry/30 transition-all"
          >
            {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>{m === 0 ? t.common.none : `${m} ${t.common.minutes}`}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Monthly calendar (primary day-by-day editor) — drives the per-date
          exceptions model. Placed above the weekly template so it leads. */}
      <div className="animate-reveal space-y-4" style={{ animationDelay: "80ms" }}>
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">{t.availability.calendar.title}</h2>
          <p className="mt-1 text-sm text-charcoal-muted">{t.availability.calendar.subtitle}</p>
        </div>

        <MonthlyCalendar
          recurring={availability.recurring}
          exceptions={availability.exceptions}
          bookingsByDate={bookingsByDate}
          timeOptions={TIME_OPTIONS}
          onUpsert={upsertException}
          onClear={clearExceptionByDate}
        />

        {/* Scheduled exceptions — textual summary across all months */}
        {availability.exceptions.length > 0 && (
          <div className="space-y-2 border-t border-berry/5 pt-4">
            <h3 className="text-sm font-semibold text-charcoal">{t.availability.exceptions}</h3>
            {availability.exceptions
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((exc) => {
                const date = new Date(exc.date + "T00:00:00");
                const isPast = date < new Date(new Date().toDateString());
                return (
                  <div
                    key={exc.id}
                    className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
                      isPast ? "opacity-50 border-charcoal/5 bg-white/30" : exc.isAvailable ? "border-success/20 bg-success/5" : "border-error/20 bg-error/5"
                    }`}
                  >
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      exc.isAvailable ? "bg-success/10 text-success" : "bg-error/10 text-error"
                    }`}>
                      {exc.isAvailable ? <CalendarCheck className="h-4 w-4" /> : <CalendarOff className="h-4 w-4" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-charcoal">
                        {date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                      </p>
                      <p className="text-xs text-charcoal-muted">
                        {exc.isAvailable && exc.customRanges && exc.customRanges.length > 0
                          ? `${t.availability.specialHours}: ${exc.customRanges.map((r) => `${r.start}-${r.end}`).join(", ")}`
                          : exc.isAvailable ? t.availability.availableStandard : t.common.notAvailable}
                      </p>
                    </div>
                    <button
                      onClick={() => removeException(exc.id)}
                      className="rounded-lg p-1.5 text-charcoal-muted hover:bg-error-light hover:text-error transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Weekly schedule — the default template every non-overridden day follows.
          Collapsible (open by default) so the calendar above stays the primary control. */}
      <div className="animate-reveal space-y-3" style={{ animationDelay: "120ms" }}>
        <button
          type="button"
          onClick={() => setWeeklyOpen((v) => !v)}
          aria-expanded={weeklyOpen}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">{t.availability.weeklySchedule}</h2>
            <p className="mt-1 text-sm text-charcoal-muted">{t.availability.weeklyTemplateHint}</p>
          </div>
          <ChevronDown className={`h-5 w-5 shrink-0 text-charcoal-muted transition-transform ${weeklyOpen ? "rotate-180" : ""}`} />
        </button>

        {weeklyOpen && DAYS.map((day) => {
          const ranges = availability.recurring[day.key] || [];
          const hasRanges = ranges.length > 0;

          return (
            <div
              key={day.key}
              className={`rounded-2xl border p-4 transition-all ${
                hasRanges ? "border-berry/10 bg-white/70 shadow-sm" : "border-berry/5 bg-white/40"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${hasRanges ? "bg-success" : "bg-charcoal-muted/20"}`} />
                  <span className="text-sm font-semibold text-charcoal">{t.availability.days[day.labelKey]}</span>
                  {!hasRanges && (
                    <span className="text-xs text-charcoal-muted">{t.common.notAvailable}</span>
                  )}
                </div>
                <button
                  onClick={() => addTimeRange(day.key)}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
                >
                  <Plus className="h-3 w-3" />
                  {t.availability.addRange}
                </button>
              </div>

              {ranges.length > 0 && (
                <div className="space-y-2">
                  {ranges.map((range) => (
                    <div key={range.id} className="flex items-center gap-2">
                      <select
                        value={range.start}
                        onChange={(e) => updateTimeRange(day.key, range.id, "start", e.target.value)}
                        className="rounded-lg border border-berry/10 bg-white px-2.5 py-1.5 text-xs text-charcoal outline-none focus:border-berry/30 transition-all"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <span className="text-xs text-charcoal-muted">—</span>
                      <select
                        value={range.end}
                        onChange={(e) => updateTimeRange(day.key, range.id, "end", e.target.value)}
                        className="rounded-lg border border-berry/10 bg-white px-2.5 py-1.5 text-xs text-charcoal outline-none focus:border-berry/30 transition-all"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button
                        onClick={() => removeTimeRange(day.key, range.id)}
                        className="ml-1 rounded-lg p-1 text-charcoal-muted hover:bg-error-light hover:text-error transition-all"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
