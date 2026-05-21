"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { Sparkles, Search } from "lucide-react";

/**
 * Cammino — editorial timeline of the client's completed sessions.
 *
 * Why a separate page (vs another tile on the home): the home is about the
 * *next* session. This page is about the *journey* — accretive, slow,
 * editorial. The KPI strip up top replaces the soft "Hai completato N
 * sessioni" line on the home with three Cormorant-numeral cards. Below
 * them, a vertical timeline of every completed session with the journal
 * note (if any) rendered as an italic Cormorant pull-quote.
 *
 * Data: one query for completed bookings (FK-embedded therapist), one
 * for the user's journal entries (mapped by booking_id). Both run in
 * parallel. The synthetic "start of journey" item at the bottom is
 * derived from auth.users.created_at — we don't store it as a row.
 */

type Booking = {
  id: string;
  scheduled_at: string;
  service_name: string | null;
  duration: number | null;
  therapist_id: string | null;
  therapist: {
    display_name: string | null;
    photo_url: string | null;
    categories: string[] | null;
  } | null;
};

type Entry = {
  booking_id: string | null;
  body: string;
};

// Kebab-case practice slug → display label (Italian; mirrors
// therapists/[id]/page.tsx). The image path follows the existing
// /public/practices/heroes/{slug}.jpg convention.
const PRACTICES: Record<string, { label: string; image: string; tint: string }> = {
  "theta-healing":            { label: "ThetaHealing",             image: "/practices/heroes/theta-healing.jpg",            tint: "#D9F2DD" },
  "costellazioni-familiari":  { label: "Costellazioni Familiari",  image: "/practices/heroes/costellazioni-familiari.jpg",  tint: "#E8DEFA" },
  "costellazioni-sistemiche": { label: "Costellazioni Sistemiche", image: "/practices/heroes/costellazioni-sistemiche.jpg", tint: "#E8DEFA" },
  reiki:                      { label: "Reiki",                    image: "/practices/heroes/reiki.jpg",                    tint: "#FAE0EB" },
  naturopatia:                { label: "Naturopatia",              image: "/practices/heroes/naturopatia.jpg",              tint: "#FCE8D6" },
  astrologia:                 { label: "Astrologia",               image: "/practices/heroes/astrologia.jpg",               tint: "#FCF5D9" },
  "human-design":             { label: "Human Design",             image: "/practices/heroes/human-design.jpg",             tint: "#FCF5D9" },
  numerologia:                { label: "Numerologia",              image: "/practices/heroes/numerologia.jpg",              tint: "#E8DEFA" },
  ayurveda:                   { label: "Ayurveda",                 image: "/practices/heroes/ayurveda.jpg",                 tint: "#FCE8D6" },
  sciamanesimo:               { label: "Sciamanesimo",             image: "/practices/heroes/sciamanesimo.jpg",             tint: "#FCE8D6" },
};

const FALLBACK_PRACTICE = { label: "Sessione", image: "", tint: "#F5E0EB" };

function practiceFor(b: Booking) {
  const slug = b.therapist?.categories?.[0] ?? "";
  return PRACTICES[slug] ?? FALLBACK_PRACTICE;
}

/**
 * Render an i18n template with `{italicOpen}…{italicClose}` markers as
 * React nodes with the marked spans wrapped in <em>. Mirrors the helper
 * in src/app/dashboard/page.tsx; duplicated here rather than extracted
 * because the existing one is comment-documented in place and adding a
 * third consumer (the journal page) doesn't yet justify a shared file.
 */
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

export default function CamminoPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [entries, setEntries] = useState<Map<string, string>>(new Map());
  const [accountCreatedAt, setAccountCreatedAt] = useState<string | null>(null);
  // "Now" lives in state so the day-count and this-month bucket can be
  // recomputed inside useMemo without lint flagging Date.now() as impure.
  // Same minute-tick pattern as src/app/dashboard/page.tsx:198-206.
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setLoading(false);
        return;
      }
      setAccountCreatedAt(user.created_at ?? null);

      // Same FK-embed pattern the home + bookings list use. The
      // `bookings_therapist_id_fkey` is required because bookings.therapist_id
      // points at therapist_profiles (not users) — without the explicit FK
      // name PostgREST refuses to embed and returns the row with therapist
      // = null. categories[] gives us the practice slug for the portrait.
      const [bookingsRes, entriesRes] = await Promise.all([
        supabase
          .from("bookings")
          .select(
            "id, scheduled_at, service_name, duration, therapist_id, therapist:therapist_profiles!bookings_therapist_id_fkey(display_name, photo_url, categories)",
          )
          .eq("client_id", user.id)
          .eq("status", "completed")
          .order("scheduled_at", { ascending: false })
          .limit(200),
        supabase
          .from("journal_entries")
          .select("booking_id, body")
          .eq("user_id", user.id)
          .not("booking_id", "is", null),
      ]);

      if (cancelled) return;

      setBookings((bookingsRes.data as unknown as Booking[]) ?? []);
      const entryMap = new Map<string, string>();
      for (const e of ((entriesRes.data ?? []) as Entry[])) {
        if (e.booking_id) entryMap.set(e.booking_id, e.body);
      }
      setEntries(entryMap);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dateFmtLocale = locale === "it" ? "it-IT" : "en-US";

  const stats = useMemo(() => {
    const sessions = bookings.length;
    const therapists = new Set(bookings.map((b) => b.therapist_id).filter(Boolean)).size;
    const totalMinutes = bookings.reduce((sum, b) => sum + (b.duration ?? 60), 0);
    const totalHours = Math.round(totalMinutes / 60);
    // Days in cammino: from the oldest completed session to today.
    // Fall back to account-created-at if there are no sessions yet.
    const earliest =
      bookings.length > 0
        ? new Date(bookings[bookings.length - 1].scheduled_at)
        : accountCreatedAt
          ? new Date(accountCreatedAt)
          : null;
    const days = earliest
      ? Math.max(0, Math.floor((now - earliest.getTime()) / 86_400_000))
      : 0;
    // Sessions in the last 30 days, for the KPI sub-label.
    const cutoff = now - 30 * 86_400_000;
    const thisMonth = bookings.filter((b) => new Date(b.scheduled_at).getTime() >= cutoff).length;
    return { sessions, therapists, totalHours, days, thisMonth };
  }, [bookings, accountCreatedAt, now]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-berry" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  const hasSessions = bookings.length > 0;
  const dayWord = stats.days === 1 ? t.cammino.day : t.cammino.days;
  const sessionWord = stats.sessions === 1 ? t.cammino.session : t.cammino.sessions;
  const personWord = stats.therapists === 1 ? t.cammino.person : t.cammino.persons;

  return (
    <div className="space-y-10">
      {/* ─── Header ─── */}
      <header className="animate-reveal">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-dark">
          {t.cammino.eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl font-[family-name:var(--font-display)] text-3xl font-medium leading-tight tracking-tight text-charcoal sm:text-4xl">
          {hasSessions
            ? renderEditorial(t.cammino.headlineDays, {
                italicOpen: "{italicOpen}",
                italicClose: "{italicClose}",
                days: stats.days,
                dayWord,
              })
            : renderEditorial(t.cammino.headlineNoSessions, {
                italicOpen: "{italicOpen}",
                italicClose: "{italicClose}",
              })}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-charcoal-muted">
          {hasSessions
            ? t.cammino.subline
                .replace("{sessions}", String(stats.sessions))
                .replace("{sessionWord}", sessionWord)
                .replace("{therapists}", String(stats.therapists))
                .replace("{therapistWord}", personWord)
            : t.cammino.sublineEmpty}
        </p>
      </header>

      {/* ─── KPI strip ─── */}
      <section
        className="animate-reveal grid grid-cols-1 gap-4 sm:grid-cols-3"
        style={{ animationDelay: "40ms" }}
      >
        <KpiCard
          label={t.cammino.kpiSessionsLabel}
          value={String(stats.sessions)}
          sub={
            stats.sessions > 0
              ? t.cammino.kpiSessionsSub
                  .replace("{n}", String(stats.thisMonth || stats.sessions))
                  .replace(
                    "{dir}",
                    stats.thisMonth > 0
                      ? t.cammino.kpiSessionsDirThisMonth
                      : t.cammino.kpiSessionsDirSoFar,
                  )
              : ""
          }
          image="/practices/heroes/theta-healing.jpg"
          delay={60}
        />
        <KpiCard
          label={t.cammino.kpiPeopleLabel}
          value={String(stats.therapists)}
          sub={
            stats.therapists > 0
              ? bookingsFirstNames(bookings)
              : t.cammino.kpiPeopleSubEmpty
          }
          image="/practices/heroes/costellazioni-familiari.jpg"
          delay={100}
        />
        <KpiCard
          label={t.cammino.kpiTimeLabel}
          value={`${stats.totalHours}h`}
          sub={t.cammino.kpiTimeSub.replace("{days}", String(stats.days))}
          image="/practices/heroes/reiki.jpg"
          delay={140}
        />
      </section>

      {/* ─── Timeline (or empty CTA if no completed sessions yet) ─── */}
      {hasSessions ? (
        <section className="animate-reveal" style={{ animationDelay: "180ms" }}>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-dark">
            {t.cammino.storyEyebrow}
          </p>
          <h2 className="mt-2 mb-7 font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-charcoal sm:text-3xl">
            {renderEditorial(t.cammino.storyHeadline, {
              italicOpen: "{italicOpen}",
              italicClose: "{italicClose}",
            })}
          </h2>
          <Timeline
            bookings={bookings}
            entries={entries}
            accountCreatedAt={accountCreatedAt}
            t={t}
            dateFmtLocale={dateFmtLocale}
          />
        </section>
      ) : (
        <Link
          href="/dashboard/therapists"
          className="animate-reveal block overflow-hidden rounded-3xl border border-berry/10 bg-gradient-to-br from-cream-dark via-white to-berry-subtle/30 p-8 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
          style={{ animationDelay: "180ms" }}
        >
          <Search className="mx-auto h-8 w-8 text-berry/50" strokeWidth={1.5} />
          <p className="mt-4 font-[family-name:var(--font-display)] text-xl text-charcoal">
            {t.cammino.emptyTitle}
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white shadow-md shadow-berry/20">
            {t.cammino.emptyCta}
          </p>
        </Link>
      )}
    </div>
  );
}

// Helper for the "people" KPI sub-label — first-name list (max 4), comma-
// joined. Falls back gracefully when display_name is null.
function bookingsFirstNames(bookings: Booking[]): string {
  const names = new Map<string, string>();
  for (const b of bookings) {
    if (b.therapist_id && b.therapist?.display_name && !names.has(b.therapist_id)) {
      names.set(b.therapist_id, b.therapist.display_name.split(" ")[0]);
    }
    if (names.size >= 4) break;
  }
  return Array.from(names.values()).join(", ");
}

/**
 * Editorial KPI card: gold-dark eyebrow, big Cormorant numeral in berry,
 * small body-font subline, and a painted hero image bleeding off the
 * bottom-right corner at 35% opacity. The image is decorative — aria-
 * hidden, empty alt.
 */
function KpiCard({
  label,
  value,
  sub,
  image,
  delay,
}: {
  label: string;
  value: string;
  sub: string;
  image: string;
  delay: number;
}) {
  return (
    <div
      className="animate-reveal relative overflow-hidden rounded-2xl border border-berry/5 bg-white/70 p-6 shadow-sm backdrop-blur-sm"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-dark">
        {label}
      </p>
      <p
        className="mt-3 font-[family-name:var(--font-display)] text-[56px] font-medium leading-none tracking-tight text-berry"
        style={{ letterSpacing: "-0.025em" }}
      >
        {value}
      </p>
      {sub && <p className="mt-2 text-xs text-charcoal-muted">{sub}</p>}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 -bottom-3 h-24 w-24 object-cover opacity-35 mix-blend-multiply"
        />
      )}
    </div>
  );
}

/**
 * Vertical timeline. Each item has a 56px circular portrait on the left
 * (category illustration on a tinted gradient) and a card on the right
 * with date/practice/therapist meta in small caps, an italic Cormorant
 * note, and a single soft-pink tag pill (the practice category).
 *
 * The synthetic "start of journey" item at the end is derived from
 * accountCreatedAt — no row exists for it.
 */
function Timeline({
  bookings,
  entries,
  accountCreatedAt,
  t,
  dateFmtLocale,
}: {
  bookings: Booking[];
  entries: Map<string, string>;
  accountCreatedAt: string | null;
  t: ReturnType<typeof useI18n>["t"];
  dateFmtLocale: string;
}) {
  return (
    <div className="relative">
      {/* Gold → soft-pink → transparent gradient line, anchored under the
       * portrait dots (28px = portrait left edge + radius). */}
      <div
        aria-hidden="true"
        className="absolute top-[30px] bottom-[30px] left-[27px] w-[1.5px]"
        style={{
          background:
            "linear-gradient(180deg, rgba(201,169,110,0.4), #F0DFE5 50%, transparent)",
        }}
      />
      <div className="flex flex-col gap-5">
        {bookings.map((b) => (
          <TimelineItem
            key={b.id}
            booking={b}
            entryBody={entries.get(b.id) ?? null}
            t={t}
            dateFmtLocale={dateFmtLocale}
          />
        ))}
        {accountCreatedAt && (
          <TimelineStartItem
            createdAt={accountCreatedAt}
            t={t}
            dateFmtLocale={dateFmtLocale}
          />
        )}
      </div>
    </div>
  );
}

function TimelineItem({
  booking,
  entryBody,
  t,
  dateFmtLocale,
}: {
  booking: Booking;
  entryBody: string | null;
  t: ReturnType<typeof useI18n>["t"];
  dateFmtLocale: string;
}) {
  const practice = practiceFor(booking);
  const date = new Date(booking.scheduled_at);
  const therapistName = booking.therapist?.display_name ?? "—";
  const shortName = therapistName.split(" ").slice(0, 2).join(" ");
  const note =
    entryBody?.trim() ||
    t.cammino.fallbackNote
      .replace("{practice}", practice.label)
      .replace("{therapist}", shortName);
  return (
    <div className="flex items-start gap-5">
      <Portrait image={practice.image} tint={practice.tint} />
      <div className="flex-1 rounded-2xl border border-berry/5 bg-white p-5 shadow-sm">
        <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-charcoal-muted">
          <span className="font-semibold uppercase tracking-[0.04em] text-berry">
            {date.toLocaleDateString(dateFmtLocale, { day: "numeric", month: "short" })}
          </span>
          <span>·</span>
          <span className="text-charcoal">{practice.label}</span>
          <span>·</span>
          <span>con {shortName}</span>
        </p>
        <p
          className="mt-2 font-[family-name:var(--font-display)] text-[17px] italic leading-relaxed text-charcoal"
          style={{ fontStyle: "italic", fontWeight: 500 }}
        >
          “{note}”
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-berry-subtle px-2.5 py-1 text-[10.5px] font-medium text-berry">
            {practice.label}
          </span>
        </div>
      </div>
    </div>
  );
}

function TimelineStartItem({
  createdAt,
  t,
  dateFmtLocale,
}: {
  createdAt: string;
  t: ReturnType<typeof useI18n>["t"];
  dateFmtLocale: string;
}) {
  const date = new Date(createdAt);
  return (
    <div className="flex items-start gap-5">
      <div
        className="relative h-[56px] w-[56px] flex-shrink-0 overflow-hidden rounded-full border-[3px] border-cream shadow-[0_6px_18px_rgba(240,223,229,0.5)]"
        style={{ background: "linear-gradient(135deg, #F0DFE5, #F5EFE2)" }}
      >
        <Sparkles
          className="absolute inset-0 m-auto h-5 w-5 text-berry"
          strokeWidth={1.5}
        />
      </div>
      <div className="flex-1 rounded-2xl border border-berry/5 bg-white p-5 shadow-sm">
        <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-charcoal-muted">
          <span className="font-semibold uppercase tracking-[0.04em] text-berry">
            {date.toLocaleDateString(dateFmtLocale, { day: "numeric", month: "short" })}
          </span>
          <span>·</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-gold-dark">
            {t.cammino.startEyebrow}
          </span>
        </p>
        <p
          className="mt-2 font-[family-name:var(--font-display)] text-[17px] italic leading-relaxed text-charcoal"
          style={{ fontStyle: "italic", fontWeight: 500 }}
        >
          “{t.cammino.startNote}”
        </p>
      </div>
    </div>
  );
}

function Portrait({ image, tint }: { image: string; tint: string }) {
  return (
    <div
      className="relative h-[56px] w-[56px] flex-shrink-0 overflow-hidden rounded-full border-[3px] border-cream"
      style={{
        background: `linear-gradient(135deg, ${tint}, #F5EFE2)`,
        boxShadow: `0 6px 18px ${tint}80`,
      }}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-85 mix-blend-multiply"
        />
      )}
    </div>
  );
}
