"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";

/**
 * Journal — private per-session reflections written by the client.
 *
 * Two halves: a "new entry" card up top (avatar + today's date + mood
 * picker + serif italic textarea + save) and a list of past entries
 * below. Entries linked to a completed booking show the practice +
 * therapist as meta; standalone entries just show the date.
 *
 * RLS on journal_entries scopes every read/write to auth.uid() — no
 * server-side filtering needed in this page; the .eq("user_id", …)
 * clause is defensive (RLS would block the read anyway).
 */

type Mood = "stressed" | "tender" | "lighter" | "empty" | "curious";

type EntryRow = {
  id: string;
  body: string;
  mood: Mood | null;
  booking_id: string | null;
  created_at: string;
};

type BookingMeta = {
  id: string;
  service_name: string | null;
  therapist: { display_name: string | null } | null;
};

const MOOD_EMOJI: Record<Mood, string> = {
  stressed: "🌬️",
  tender:   "🌗",
  lighter:  "☀️",
  empty:    "◯",
  curious:  "✦",
};

function renderEditorial(template: string, replacements: Record<string, string | number> = {}): ReactNode[] {
  let s = template;
  for (const [k, v] of Object.entries(replacements)) {
    if (k === "italicOpen" || k === "italicClose") continue;
    s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  const parts = s.split(/(\{italicOpen\}.*?\{italicClose\})/);
  return parts.map((part, i) => {
    if (part.startsWith("{italicOpen}")) {
      const inner = part.replace("{italicOpen}", "").replace("{italicClose}", "");
      return (
        <em
          key={i}
          className="font-[family-name:var(--font-display)] italic text-berry"
          style={{ fontStyle: "italic" }}
        >
          {inner}
        </em>
      );
    }
    return part;
  });
}

export default function JournalPage() {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [bookingMetaById, setBookingMetaById] = useState<Map<string, BookingMeta>>(new Map());
  const [firstName, setFirstName] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<Mood | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setLoading(false);
        return;
      }
      const [profileRes, entriesRes] = await Promise.all([
        supabase.from("users").select("display_name, gender").eq("id", user.id).maybeSingle(),
        supabase
          .from("journal_entries")
          .select("id, body, mood, booking_id, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      setFirstName((profileRes.data?.display_name ?? "").split(" ")[0] ?? "");
      setGender((profileRes.data as { display_name: string | null; gender: string | null } | null)?.gender ?? null);
      const rows = (entriesRes.data ?? []) as EntryRow[];
      setEntries(rows);

      // Fetch booking metadata for entries that reference a session — used
      // to render the "con {therapist}" meta line. We don't try to be
      // clever and pre-join: a separate IN-query keeps the row shape simple
      // and PostgREST can't embed bookings from journal_entries without a
      // declared FK relationship name anyway.
      const bookingIds = rows
        .map((e) => e.booking_id)
        .filter((id): id is string => Boolean(id));
      if (bookingIds.length > 0) {
        const { data: bookingData } = await supabase
          .from("bookings")
          .select(
            "id, service_name, therapist:therapist_profiles!bookings_therapist_id_fkey(display_name)",
          )
          .in("id", bookingIds);
        if (cancelled) return;
        const map = new Map<string, BookingMeta>();
        for (const b of ((bookingData ?? []) as unknown as BookingMeta[])) {
          map.set(b.id, b);
        }
        setBookingMetaById(map);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveEntry() {
    if (body.trim().length === 0) return;
    setSaving(true);
    setSaveError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("journal_entries")
        .insert({
          user_id: user.id,
          mood,
          body: body.trim(),
        })
        .select("id, body, mood, booking_id, created_at")
        .single();
      if (error) throw error;
      setEntries((prev) => [data as EntryRow, ...prev]);
      setBody("");
      setMood(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : (gender === "male" ? t.journal.saveErrorMale : t.journal.saveError));
    } finally {
      setSaving(false);
    }
  }

  const dateFmtLocale = locale === "it" ? "it-IT" : "en-US";
  const today = useMemo(() => new Date(), []);

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  return (
    <div className="space-y-8">
      {/* ─── Header ─── */}
      <header className="animate-reveal">
        <Eyebrow>{t.journal.eyebrow}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-[family-name:var(--font-display)] text-3xl font-medium leading-tight tracking-tight text-charcoal sm:text-4xl">
          {renderEditorial(t.journal.headline, {
            italicOpen: "{italicOpen}",
            italicClose: "{italicClose}",
          })}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-charcoal-muted">
          {t.journal.intro}
        </p>
      </header>

      {/* ─── New entry card ─── */}
      <section
        className="animate-reveal rounded-2xl border border-berry/5 bg-white p-6 shadow-sm"
        style={{ animationDelay: "40ms" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-[family-name:var(--font-display)] text-base font-semibold text-berry"
            style={{ background: "#F0DFE5" }}
          >
            {firstName ? firstName[0]?.toUpperCase() : "·"}
          </div>
          <div>
            <p className="text-sm font-semibold text-charcoal">
              {today.toLocaleDateString(dateFmtLocale, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <p className="text-xs text-charcoal-muted">{t.journal.todayPrompt}</p>
          </div>
        </div>

        {/* Mood picker — 5 buttons. The journal_entries CHECK constraint
         * accepts 7 values (stressed/tender/lighter/calm/curious/empty/
         * grateful); we surface 5 in the UI per the design — schema is
         * deliberately wider so future expansion needs no migration. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { k: "stressed", label: gender === "male" ? t.journal.moodStressedLabelMale : t.journal.moodStressedLabel },
              { k: "tender",   label: t.journal.moodTenderLabel },
              { k: "lighter",  label: gender === "male" ? t.journal.moodLighterLabelMale  : t.journal.moodLighterLabel },
              { k: "empty",    label: gender === "male" ? t.journal.moodEmptyLabelMale    : t.journal.moodEmptyLabel },
              { k: "curious",  label: gender === "male" ? t.journal.moodCuriousLabelMale  : t.journal.moodCuriousLabel },
            ] as Array<{ k: Mood; label: string }>
          ).map((m) => {
            const active = mood === m.k;
            return (
              <button
                key={m.k}
                type="button"
                onClick={() => setMood(active ? null : m.k)}
                className={`flex flex-col items-center gap-1.5 rounded-2xl px-4 py-2.5 text-[11px] font-medium transition-all ${
                  active
                    ? "bg-berry text-white shadow-md shadow-berry/20"
                    : "bg-cream-dark text-charcoal-light hover:bg-berry-subtle/60"
                }`}
                style={{ minWidth: 78 }}
              >
                <span className="text-[22px] leading-none">{MOOD_EMOJI[m.k]}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 4000))}
          placeholder={t.journal.placeholder}
          rows={4}
          className="mt-4 w-full resize-none rounded-xl border border-berry/10 bg-cream-dark/60 px-4 py-3 font-[family-name:var(--font-display)] text-base italic text-charcoal outline-none placeholder:text-charcoal-muted/60 focus:border-berry-muted focus:ring-2 focus:ring-berry/10"
          style={{ fontStyle: "italic", minHeight: 100 }}
          maxLength={4000}
        />

        {saveError && <p className="mt-2 text-xs text-error">{saveError}</p>}
        {savedFlash && <p className="mt-2 text-xs text-success">{t.journal.saved}</p>}

        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={saveEntry}
            disabled={saving || body.trim().length === 0}
            className="rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark disabled:opacity-50"
          >
            {saving ? t.journal.saving : t.journal.save}
          </button>
        </div>
      </section>

      {/* ─── Past entries ─── */}
      <section className="animate-reveal" style={{ animationDelay: "80ms" }}>
        <Eyebrow>{t.journal.pastEyebrow}</Eyebrow>
        {entries.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-berry/5 bg-white/60 p-8 text-center">
            <p className="font-[family-name:var(--font-display)] text-lg text-charcoal">
              {t.journal.emptyTitle}
            </p>
            <p className="mt-2 text-sm text-charcoal-muted">{t.journal.emptyHint}</p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {entries.map((e) => {
              const meta = e.booking_id ? bookingMetaById.get(e.booking_id) : null;
              const created = new Date(e.created_at);
              const shortTherapist = meta?.therapist?.display_name
                ?.split(" ")
                .slice(0, 2)
                .join(" ");
              return (
                <article
                  key={e.id}
                  className="rounded-2xl border border-berry/5 bg-white p-5 shadow-sm"
                >
                  <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-charcoal-muted">
                    <span className="font-semibold uppercase tracking-[0.04em] text-berry">
                      {created.toLocaleDateString(dateFmtLocale, {
                        day: "numeric",
                        month: "long",
                      })}
                    </span>
                    {shortTherapist && (
                      <>
                        <span>·</span>
                        {meta?.service_name && <span>{meta.service_name}</span>}
                        {meta?.service_name && <span>·</span>}
                        <span>
                          {t.journal.bookingMetaWith.replace(
                            "{therapist}",
                            shortTherapist,
                          )}
                        </span>
                      </>
                    )}
                    {e.mood && (
                      <span className="text-[14px]">{MOOD_EMOJI[e.mood]}</span>
                    )}
                  </p>
                  <p
                    className="mt-3 font-[family-name:var(--font-display)] text-[18px] italic leading-relaxed text-charcoal"
                    style={{ fontStyle: "italic" }}
                  >
                    “{e.body}”
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
