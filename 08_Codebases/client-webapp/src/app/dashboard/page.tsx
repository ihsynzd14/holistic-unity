"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  Calendar,
  Search,
  Video,
  ArrowRight,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Bell,
  Clock,
} from "lucide-react";
import { isJoinWindowOpen } from "@/lib/booking/join-window";
import { recommendPractices, type AnswerSet } from "@/lib/onboarding/steps";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

/**
 * Client home dashboard — editorial redesign (May 2026).
 *
 * What changed vs the previous version:
 *   - Greeting → serif Cormorant headline with italic+berry accent words.
 *     "Ciao Sofia. *Tre sessioni* questa settimana, la prossima oggi alle
 *     *15:30*." — the italic+berry pattern is the brand's signature
 *     editorial voice (see `holistic-unity-website/index.html` for the
 *     marketing-side equivalent on the "Find your *practitioner*" hero).
 *   - The single most important card on the page is now the **Next
 *     Session hero** — full-width magenta gradient, countdown in
 *     Cormorant numerals, therapist portrait, big "Entra" CTA. Promotes
 *     the next user action from a discreet row to the dominant element.
 *     When there's no upcoming session it gracefully falls back to a
 *     softer "find a therapist" CTA.
 *   - **Personalized suggestions** below: uses the user's onboarding
 *     `client_preferences.focus_areas` to populate the headline ("Hai
 *     detto di voler lavorare su *chiarezza*") and to filter the
 *     `therapist_profiles_public` view via the same matchmaking logic
 *     `/welcome` uses on its summary step. If preferences are empty
 *     (e.g. user skipped a step), the block is hidden — we don't fake it.
 *   - **Pull-quote** at the bottom — pure brand signal, lifts the page
 *     out of "SaaS productivity" register. No data, no logic.
 *
 * What did NOT change (deliberately):
 *   - The data model: same four parallel fetches as before plus the new
 *     preferences read. No new tables, no new edge functions.
 *   - The featured-practices grid: it already worked. Kept verbatim.
 *   - The lifetime-stat copy: kept as a small editorial line, not a
 *     "gamification" card.
 *
 * Things explicitly NOT implemented (tracked as separate task chips):
 *   - Mood-discovery chips (would need a fuzzy mood→practice mapping
 *     that doesn't exist yet — adding fake chips would be theatre).
 *   - Sidebar regrouping into Cammino / Persone / Tu (cross-app rename,
 *     muscle-memory cost outweighs the visual win).
 *   - Journal / Cammino timeline pages (new features; deferred).
 *   - Pre-session brief with previous-session notes (we don't capture
 *     session notes yet — empty state would be cringe).
 *
 * NB. Localisation: every visible string flows through `t.clientHome.*`.
 * Italic accents inside a headline are encoded as `{italicOpen}...
 * {italicClose}` in the i18n template and rendered as `<em>` via
 * `renderEditorial` below. This lets translators reorder words without
 * losing the emphasised phrase (German might italicise a noun where
 * Italian italicises a verb).
 */

type Booking = {
  id: string;
  scheduled_at: string;
  status: string;
  service_name: string | null;
  duration: number | null;
  video_room_id: string | null;
  therapist: { display_name: string | null; photo_url: string | null } | null;
};

type FeaturedPractice = {
  slug: string;
  title: string;
  tagline: string;
  hero_image_url: string | null;
};

type SuggestedTherapist = {
  id: string;
  slug: string | null;
  display_name: string | null;
  tagline: string | null;
  photo_url: string | null;
  city: string | null;
  average_rating: number | null;
  total_reviews: number | null;
  is_verified: boolean | null;
  categories: string[] | null;
};

// A single completed-but-unreviewed booking. Surfaced on the home as
// the "pending reflection" card — the biggest retention lever this
// codebase has untapped today: the review-submission modal already
// exists at `/dashboard/bookings`, but a client has to navigate there,
// switch the filter to "Completate", and find the discreet gold pill.
// Most won't, so reviews stay near zero and the marketplace's social
// proof flatlines. Promoting the prompt to the home turns this from
// a hidden affordance into the first thing a client sees after a
// session.
type PendingReview = {
  id: string;
  scheduled_at: string;
  service_name: string | null;
  therapist: { id: string; display_name: string | null; photo_url: string | null } | null;
};

// onboarding `focus_areas` value → i18n key. We surface ONE of the
// user's chosen focus areas in the headline italic — pick the first.
const FOCUS_LABEL_KEYS: Record<
  string,
  | "focusBody"
  | "focusMind"
  | "focusEnergy"
  | "focusRelationships"
  | "focusLifeDirection"
  | "focusDailyRitual"
  | "focusFamilyRoots"
  | "focusInnerListening"
> = {
  body: "focusBody",
  mind: "focusMind",
  energy: "focusEnergy",
  relationships: "focusRelationships",
  life_direction: "focusLifeDirection",
  daily_ritual: "focusDailyRitual",
  family_roots: "focusFamilyRoots",
  inner_listening: "focusInnerListening",
};

/**
 * Render an i18n template that contains `{italicOpen}…{italicClose}`
 * markers as React nodes with the marked spans wrapped in `<em>`. Any
 * other `{key}` placeholders are interpolated as plain strings from
 * `replacements`. The italic span gets the brand's editorial styling
 * (serif Cormorant + italic + berry). Splits run on the literal marker
 * tokens so they can't be confused with real `{key}` placeholders that
 * happen to appear inside the italic span.
 */
function renderEditorial(
  template: string,
  replacements: Record<string, string | number> = {},
): React.ReactNode[] {
  // Replace simple placeholders first (but NOT the italic markers).
  let s = template;
  for (const [k, v] of Object.entries(replacements)) {
    if (k === "italicOpen" || k === "italicClose") continue;
    s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  const parts = s.split(/(\{italicOpen\}.*?\{italicClose\})/);
  return parts.map((part, i) => {
    if (part.startsWith("{italicOpen}")) {
      const inner = part
        .replace("{italicOpen}", "")
        .replace("{italicClose}", "");
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

/**
 * Returns countdown components for a future ISO timestamp, or `null` if
 * the target is in the past. Buckets:
 *   < 15 min  → "soon" (the booking is in the join window — we'll show
 *               a pulsing dot + "Entra" CTA, not a number)
 *   < 24 h    → hours + minutes ("06 ORE 30 MIN")
 *   else      → whole days ("3 GIORNI")
 */
function getCountdown(
  targetIso: string,
  now: Date,
): { kind: "soon" | "hm" | "days"; primary: string; secondary?: string } | null {
  const target = new Date(targetIso);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 15) return { kind: "soon", primary: "" };
  if (diffMin < 24 * 60) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return { kind: "hm", primary: String(h).padStart(2, "0"), secondary: String(m).padStart(2, "0") };
  }
  const days = Math.floor(diffMin / (24 * 60));
  return { kind: "days", primary: String(days) };
}

export default function ClientDashboardPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState<string>("");
  const [gender, setGender] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [pastCount, setPastCount] = useState(0);
  const [featuredPractices, setFeaturedPractices] = useState<FeaturedPractice[]>(
    [],
  );
  const [suggested, setSuggested] = useState<SuggestedTherapist[]>([]);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Tick once a minute so the countdown stays live without a full
  // re-fetch. Cheaper than polling the server; the booking data only
  // matters at minute resolution.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Parallel reads — primary five plus two retention-loop reads
      // (recent completed bookings + the client's own reviews). The
      // anti-join "completed sessions without a review yet" can't be
      // expressed through Supabase JS, so we pull both sides and
      // diff them in memory — cheap for the typical row count
      // (<100 completed sessions per client). Keeping the reads
      // parallel avoids any waterfall on first paint.
      const nowIso = new Date().toISOString();
      const [
        userRes,
        upcomingRes,
        pastRes,
        practicesRes,
        prefsRes,
        completedRecentRes,
        myReviewsRes,
      ] = await Promise.all([
        supabase
          .from("users")
          .select("display_name, gender")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("bookings")
          .select(
            "id, scheduled_at, status, service_name, duration, video_room_id, therapist:therapist_profiles!bookings_therapist_id_fkey(display_name, photo_url)",
          )
          .eq("client_id", user.id)
          .in("status", ["pending", "confirmed", "in_progress"])
          .gte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(5),
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("client_id", user.id)
          .eq("status", "completed"),
        supabase
          .from("practices")
          .select("slug, title, tagline, hero_image_url")
          .eq("is_published", true)
          .order("display_order")
          .limit(4),
        supabase
          .from("client_preferences")
          .select("intent, focus_areas, familiar_practices, approaches, timing")
          .eq("user_id", user.id)
          .maybeSingle(),
        // Pull the 3 most recent completed sessions and pick the
        // first unreviewed one as the pending-review surface. We pull
        // 3 (not 1) so that if the client dismissed/ignored their
        // very last session's prompt the one BEFORE it can still get
        // an ask — the marketplace needs that review surface to keep
        // attracting clients regardless of which session was most
        // recent.
        supabase
          .from("bookings")
          .select(
            "id, scheduled_at, service_name, therapist:therapist_profiles!bookings_therapist_id_fkey(id, display_name, photo_url)",
          )
          .eq("client_id", user.id)
          .eq("status", "completed")
          .order("scheduled_at", { ascending: false })
          .limit(3),
        // Reviews the client has already submitted. The "Clients can
        // read own reviews" RLS policy auto-scopes this to the
        // current user; the explicit `.eq("client_id", …)` is
        // belt-and-braces against future RLS relaxation.
        supabase
          .from("reviews")
          .select("booking_id")
          .eq("client_id", user.id),
      ]);

      setFirstName((userRes.data?.display_name || "").split(" ")[0]);
      setGender((userRes.data as { display_name: string | null; gender: string | null } | null)?.gender ?? null);
      setUpcoming((upcomingRes.data as unknown as Booking[]) || []);
      setPastCount(pastRes.count || 0);
      setFeaturedPractices((practicesRes.data as FeaturedPractice[]) || []);

      // Resolve "pending review" — first completed session without a
      // review. The `myReviewsRes` payload is already auto-scoped by
      // RLS to this client, so the set difference correctly excludes
      // sessions the client has already reflected on.
      const reviewedIds = new Set(
        ((myReviewsRes.data ?? []) as Array<{ booking_id: string | null }>)
          .map((r) => r.booking_id)
          .filter((x): x is string => !!x),
      );
      const completedList = (completedRecentRes.data ?? []) as unknown as PendingReview[];
      const firstUnreviewed = completedList.find((b) => !reviewedIds.has(b.id));
      setPendingReview(firstUnreviewed ?? null);

      // Matchmaking — only if onboarding answers exist. We reuse the
      // same `recommendPractices` helper `/welcome` uses on its summary
      // step so the suggestions on the home stay in sync with what the
      // user saw at the end of onboarding (avoids a confusing "different
      // recommendations on different pages" feeling).
      const prefs = prefsRes.data;
      if (prefs) {
        const answers: AnswerSet = {
          intent: prefs.intent ?? undefined,
          focus_areas: prefs.focus_areas ?? undefined,
          familiar_practices: prefs.familiar_practices ?? undefined,
          approaches: prefs.approaches ?? undefined,
          timing: prefs.timing ?? undefined,
        };
        const recommendedKeys = recommendPractices(answers, 3);
        if (recommendedKeys.length > 0) {
          // Same kebab-casing as `/welcome` — `practices.category_key` is
          // PascalCase (e.g. "ThetaHealing") whereas
          // `therapist_profiles_public.categories[]` is kebab-case
          // ("theta-healing"). Until 2026-05-16 the two were never
          // aligned and the overlap query silently returned []. See
          // `src/app/welcome/page.tsx:294-305` for the original fix.
          const therapistKeys = recommendedKeys.map((k) =>
            k.toLowerCase().replace(/ /g, "-"),
          );
          const { data: thData } = await supabase
            .from("therapist_profiles_public")
            .select(
              "id, slug, display_name, tagline, photo_url, city, average_rating, total_reviews, is_verified, categories",
            )
            .overlaps("categories", therapistKeys)
            .order("average_rating", { ascending: false, nullsFirst: false })
            .limit(3);
          setSuggested((thData as SuggestedTherapist[]) || []);
        }
        // Pick the FIRST chosen focus area for the headline italic.
        // The user may have selected multiple — we don't try to OR them
        // in copy ("la mente *e* l'energia" reads clunky); one accent
        // word keeps the editorial rhythm tight.
        const firstFocus = (prefs.focus_areas as string[] | null)?.[0];
        if (firstFocus && FOCUS_LABEL_KEYS[firstFocus]) {
          setFocusKey(firstFocus);
        }
      }

      setLoading(false);
    }
    void load();
  }, []);

  // ── Derived values for render ───────────────────────────────────
  const nextBooking = upcoming[0];
  const countdown = nextBooking ? getCountdown(nextBooking.scheduled_at, now) : null;
  const joinable = nextBooking
    ? isJoinWindowOpen(nextBooking.scheduled_at)
    : false;

  const dateFmtLocale = locale === "it" ? "it-IT" : "en-US";
  const greeting = useMemo(() => {
    const h = now.getHours();
    if (h < 12) return t.clientHome.greetingMorning;
    if (h < 18) return t.clientHome.greetingAfternoon;
    return t.clientHome.greetingEvening;
  }, [now, t.clientHome.greetingMorning, t.clientHome.greetingAfternoon, t.clientHome.greetingEvening]);

  const eyebrowDate = useMemo(
    () =>
      `${greeting}, ${now.toLocaleDateString(dateFmtLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}`,
    [greeting, dateFmtLocale, now],
  );

  const focusLabel = focusKey
    ? t.clientHome[FOCUS_LABEL_KEYS[focusKey]!]
    : null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* ─── Header: gold eyebrow + serif Cormorant headline ─────── */}
      <header className="animate-reveal">
        <Eyebrow>{eyebrowDate}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-[family-name:var(--font-display)] text-3xl font-medium leading-tight tracking-tight text-charcoal sm:text-4xl">
          {firstName ? (
            <>
              {renderEditorial(t.clientHome.headlineHelloName, {
                name: firstName,
              })}{" "}
            </>
          ) : null}
          {nextBooking
            ? renderEditorial(
                upcoming.length === 1
                  ? t.clientHome.headlineUpcomingOne
                  : t.clientHome.headlineUpcomingMany,
                {
                  italicOpen: "{italicOpen}",
                  italicClose: "{italicClose}",
                  n: upcoming.length,
                  when: nextSessionWhenLabel(nextBooking.scheduled_at, now, t),
                  time: new Date(nextBooking.scheduled_at).toLocaleTimeString(
                    dateFmtLocale,
                    { hour: "2-digit", minute: "2-digit" },
                  ),
                },
              )
            : renderEditorial(
                gender === "male"
                  ? t.clientHome.headlineNoUpcomingMale
                  : t.clientHome.headlineNoUpcoming
              )}
        </h1>
      </header>

      {/* ─── Next session hero OR fallback CTA ──────────────────── */}
      {nextBooking ? (
        <NextSessionHero
          booking={nextBooking}
          countdown={countdown}
          joinable={joinable}
          t={t}
          locale={locale}
          gender={gender}
        />
      ) : (
        <FindTherapistFallback t={t} />
      )}

      {/* ─── Pending review card (retention loop) ───────────────── */}
      {/* Placed immediately after the next-session hero so it's the
          first thing a returning client sees post-session, ahead of
          any explore/discover sections. Without this surface the
          review submission lived inside /dashboard/bookings under a
          status filter — discoverability so low that reviews were
          functionally never written. Linking out to the bookings page
          (rather than embedding the modal here) keeps this component
          a teaser and lets the existing ReviewModal stay the single
          source of submission UX. */}
      {pendingReview && (
        <PendingReviewCard
          pending={pendingReview}
          t={t}
          locale={locale}
        />
      )}

      {/* ─── Featured practices grid (kept from previous design) ── */}
      {featuredPractices.length > 0 && (
        <section className="animate-reveal" style={{ animationDelay: "60ms" }}>
          <div className="mb-3 flex items-end justify-between">
            <DisplayHeading as="h2" size="md">
              {t.clientHome.exploreTitle}
            </DisplayHeading>
            <Link
              href="/dashboard/pratiche"
              className="text-xs font-medium text-berry hover:text-berry-dark"
            >
              {t.clientHome.exploreAll}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {featuredPractices.map((p, i) => (
              <Link
                key={p.slug}
                href={`/dashboard/pratiche/${p.slug}`}
                className="group overflow-hidden rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-berry/10"
                style={{ animationDelay: `${100 + i * 30}ms` }}
              >
                <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-berry-subtle/40 via-cream to-gold/10">
                  {p.hero_image_url ? (
                    <Image
                      src={p.hero_image_url}
                      alt={p.title}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      className="object-cover transition-transform duration-[700ms] ease-out group-hover:scale-110"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Sparkles className="h-7 w-7 text-berry/30" strokeWidth={1} />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-1 text-sm font-semibold text-charcoal">{p.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-charcoal-muted">{p.tagline}</p>
                  <p className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-berry transition-all group-hover:gap-1">
                    {t.clientHome.discover}
                    <ChevronRight className="h-3 w-3" />
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── Personalized suggestions (only when we have prefs) ─── */}
      {suggested.length > 0 && (
        <section className="animate-reveal" style={{ animationDelay: "100ms" }}>
          <div className="mb-4">
            <Eyebrow>{t.clientHome.personalizedEyebrow}</Eyebrow>
            <div className="mt-2 flex items-baseline justify-between gap-4">
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-charcoal sm:text-3xl">
                {focusLabel
                  ? renderEditorial(t.clientHome.personalizedHeadlineFocus, {
                      focus: focusLabel,
                      italicOpen: "{italicOpen}",
                      italicClose: "{italicClose}",
                    })
                  : renderEditorial(t.clientHome.personalizedHeadlineGeneric, {
                      italicOpen: "{italicOpen}",
                      italicClose: "{italicClose}",
                    })}
              </h2>
              <Link
                href="/welcome"
                className="whitespace-nowrap text-xs font-semibold text-berry hover:text-berry-dark"
              >
                {t.clientHome.editIntent}
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {suggested.map((th, i) => (
              <Link
                key={th.id}
                href={`/dashboard/therapists/${th.slug ?? th.id}`}
                className="group overflow-hidden rounded-2xl border border-berry/5 bg-white/80 p-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-berry/10"
                style={{ animationDelay: `${140 + i * 40}ms` }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-berry-subtle/60 to-cream-dark">
                    {th.photo_url ? (
                      <Image
                        src={th.photo_url}
                        alt={th.display_name ?? ""}
                        width={56}
                        height={56}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-[family-name:var(--font-display)] text-lg font-semibold text-berry">
                        {(th.display_name?.[0] || "?").toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-charcoal">
                        {th.display_name?.trim() || "—"}
                      </p>
                      {th.is_verified && (
                        <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-info" strokeWidth={2} />
                      )}
                    </div>
                    {th.tagline && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-charcoal-muted">{th.tagline}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-charcoal-light">
                      {(th.average_rating ?? 0) > 0 && (
                        <span className="text-gold-dark">
                          ★ <strong className="text-charcoal">{(th.average_rating ?? 0).toFixed(1)}</strong>{" "}
                          <span className="text-charcoal-muted">({th.total_reviews ?? 0})</span>
                        </span>
                      )}
                      {th.city && (
                        <>
                          <span className="text-charcoal-muted/50">·</span>
                          <span>{th.city}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-end">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-berry px-3 py-1.5 text-[11px] font-semibold text-white shadow-md shadow-berry/20 transition-all group-hover:shadow-lg group-hover:shadow-berry/30">
                    {t.clientHome.bookCta}
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── Lifetime stat (only if user has completed sessions) ── */}
      {pastCount > 0 && (
        <div
          className="animate-reveal flex items-center gap-3 rounded-2xl border border-gold/15 bg-[#F9F0DF]/40 px-5 py-4"
          style={{ animationDelay: "160ms" }}
        >
          <Sparkles className="h-5 w-5 text-gold-dark" strokeWidth={1.75} />
          <p className="text-sm text-charcoal">
            {t.clientHome.lifetimeStat
              .replace("{n}", String(pastCount))
              .replace(
                "{plural}",
                pastCount === 1 ? t.clientHome.session : t.clientHome.sessions,
              )}
          </p>
        </div>
      )}

      {/* ─── Remaining upcoming (rows 2..N — already showed #1 in hero) ── */}
      {upcoming.length > 1 && (
        <section className="animate-reveal" style={{ animationDelay: "180ms" }}>
          <div className="flex items-end justify-between">
            <DisplayHeading as="h2" size="md">
              {t.clientHome.upcomingSessions}
            </DisplayHeading>
            <Link
              href="/dashboard/bookings"
              className="text-xs font-medium text-berry hover:text-berry-dark"
            >
              {t.clientHome.viewAll}
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {upcoming.slice(1).map((b, i) => {
              const date = new Date(b.scheduled_at);
              const tomorrow = new Date(now);
              tomorrow.setDate(tomorrow.getDate() + 1);
              const isToday = date.toDateString() === now.toDateString();
              const isTomorrow = date.toDateString() === tomorrow.toDateString();
              const therapistName = b.therapist?.display_name || t.clientHome.therapist;
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-4 rounded-2xl border border-berry/5 bg-white/70 p-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  style={{ animationDelay: `${200 + i * 40}ms` }}
                >
                  <div
                    className={`flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl ${
                      isToday ? "bg-berry text-white" : "bg-berry-subtle text-berry"
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase">
                      {isToday
                        ? t.clientHome.today
                        : isTomorrow
                          ? t.clientHome.tomorrow
                          : date.toLocaleDateString(dateFmtLocale, { month: "short" })}
                    </span>
                    <span className="text-lg font-bold leading-none">
                      {isToday || isTomorrow
                        ? date.toLocaleTimeString(dateFmtLocale, { hour: "2-digit", minute: "2-digit" })
                        : date.getDate()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-charcoal">{therapistName}</p>
                    <p className="truncate text-xs text-charcoal-muted">
                      {b.service_name || t.clientHome.session} ·{" "}
                      {date.toLocaleDateString(dateFmtLocale, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}{" "}
                      {t.clientHome.at}{" "}
                      {date.toLocaleTimeString(dateFmtLocale, { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {b.video_room_id && isJoinWindowOpen(b.scheduled_at) && (
                    // target="_blank" so the dashboard tab stays open
                    // while the visitor is in the call. Lets them keep
                    // their context (other bookings, chat) accessible
                    // and — combined with the post-session "Chiudi"
                    // button on /call/[id] which falls back to redirect
                    // — eliminates the "stranded on the post-call
                    // screen" failure mode.
                    <Link
                      href={`/call/${b.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-success/20 transition-all hover:bg-success/90"
                    >
                      <Video className="h-3.5 w-3.5" />
                      {t.clientHome.joinSession}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Editorial pull-quote (brand signal, no data) ─────── */}
      <PullQuote t={t} />
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────── */

/**
 * The hero card. Magenta gradient surface, big Cormorant time on the
 * left, countdown numerals on the right, therapist portrait + "Entra"
 * CTA. The single most prominent element on the page when a session
 * is upcoming — replaces what used to be a small row in a list.
 */
function NextSessionHero({
  booking,
  countdown,
  joinable,
  t,
  locale,
  gender,
}: {
  booking: Booking;
  countdown: ReturnType<typeof getCountdown>;
  joinable: boolean;
  t: ReturnType<typeof useI18n>["t"];
  locale: ReturnType<typeof useI18n>["locale"];
  gender: string | null;
}) {
  const dateFmtLocale = locale === "it" ? "it-IT" : "en-US";
  const date = new Date(booking.scheduled_at);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = date.toDateString() === new Date().toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const therapistName = booking.therapist?.display_name?.trim() || t.clientHome.therapist;

  return (
    <div
      className="animate-reveal relative overflow-hidden rounded-3xl text-white shadow-[0_25px_60px_rgba(139,34,82,0.25)]"
      style={{
        background:
          "linear-gradient(135deg, var(--berry) 0%, var(--berry-dark) 100%)",
        animationDelay: "30ms",
      }}
    >
      {/* Decorative orbs — subtle gold glow on the magenta surface */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 h-72 w-72 rounded-full opacity-40 blur-2xl"
        style={{
          background:
            "radial-gradient(circle, rgba(212,188,142,0.45), transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -left-12 h-56 w-56 rounded-full opacity-30 blur-2xl"
        style={{
          background: "radial-gradient(circle, rgba(201,169,110,0.4), transparent 70%)",
        }}
      />

      <div className="relative grid grid-cols-1 md:grid-cols-[1.3fr_1fr]">
        {/* Left — session details */}
        <div className="p-6 sm:p-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-light">
            {t.clientHome.nextSessionEyebrow}
          </p>
          <div className="mt-4 flex items-baseline gap-3">
            <div
              className="font-[family-name:var(--font-display)] text-5xl font-medium leading-none tracking-tight text-white sm:text-6xl"
            >
              {date.toLocaleTimeString(dateFmtLocale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-light">
              ·{" "}
              {isToday
                ? t.clientHome.today
                : isTomorrow
                  ? t.clientHome.tomorrow
                  : date.toLocaleDateString(dateFmtLocale, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
            </div>
          </div>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-white sm:text-3xl">
            {booking.service_name || t.clientHome.session}{" "}
            <em className="font-[family-name:var(--font-display)] italic text-gold-light" style={{ fontStyle: "italic" }}>
              con {therapistName}
            </em>
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px] text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
              {booking.duration ?? 60} min
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" strokeWidth={1.8} />
              Video call
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {booking.video_room_id && joinable ? (
              // target="_blank" — see the matching join button in the
              // upcoming-sessions list above for the rationale.
              <Link
                href={`/call/${booking.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-berry shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Video className="h-4 w-4" strokeWidth={2} />
                {t.clientHome.enterSession}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white/80">
                <Video className="h-4 w-4" strokeWidth={2} />
                {t.clientHome.enterSession}
              </span>
            )}
            <Link
              href="/dashboard/bookings"
              className="text-sm font-semibold text-gold-light underline-offset-4 hover:underline"
            >
              {t.clientHome.rescheduleOrCancel}
            </Link>
          </div>
        </div>

        {/* Right — countdown + therapist portrait */}
        <div className="flex flex-col justify-between gap-6 border-t border-white/10 p-6 sm:border-l sm:border-t-0 sm:p-8">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-light">
              {t.clientHome.countdownEyebrow}
            </p>
            {countdown ? (
              countdown.kind === "soon" ? (
                <div className="mt-3 flex items-center gap-3">
                  <span className="relative inline-flex h-3 w-3 items-center justify-center">
                    <span
                      className="absolute inset-0 rounded-full bg-success"
                      style={{ animation: "huPulse 2s infinite" }}
                    />
                    <span className="relative h-2 w-2 rounded-full bg-success" />
                  </span>
                  <span className="font-[family-name:var(--font-display)] text-2xl italic text-gold-light">
                    {t.clientHome.countdownSoon}
                  </span>
                </div>
              ) : countdown.kind === "hm" ? (
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-[family-name:var(--font-display)] text-5xl font-medium leading-none tracking-tight text-gold-light">
                    {countdown.primary}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">
                    {t.clientHome.countdownHours}
                  </span>
                  <span className="ml-2 font-[family-name:var(--font-display)] text-5xl font-medium leading-none tracking-tight text-gold-light">
                    {countdown.secondary}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">
                    {t.clientHome.countdownMinutes}
                  </span>
                </div>
              ) : (
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-[family-name:var(--font-display)] text-5xl font-medium leading-none tracking-tight text-gold-light">
                    {countdown.primary}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">
                    {t.clientHome.countdownDays}
                  </span>
                </div>
              )
            ) : null}
            <div className="mt-4 rounded-xl bg-white/8 p-3 text-[12px] leading-relaxed text-white/75">
              {gender === "male" ? t.clientHome.preparePromptMale : t.clientHome.preparePrompt}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/20 bg-berry-subtle">
              {booking.therapist?.photo_url ? (
                <Image
                  src={booking.therapist.photo_url}
                  alt={therapistName}
                  width={48}
                  height={48}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="font-[family-name:var(--font-display)] text-base font-semibold text-berry">
                  {therapistName[0]?.toUpperCase() || "?"}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{therapistName}</p>
              {booking.service_name && (
                <p className="truncate text-[11px] text-gold-light">{booking.service_name}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The retention card. Shown only when the client has at least one
 * completed session for which they haven't yet submitted a review.
 * Visually distinct from the next-session hero (cream surface + gold
 * accent) so it reads as "an invitation, not an obligation". CTA
 * deeplinks to the bookings page where the existing ReviewModal
 * picks up — anchored to the specific booking via `?review=<id>` so
 * the modal opens immediately (saves a click; see
 * `/dashboard/bookings/page.tsx` for the param handler that has to
 * be added if it doesn't yet — graceful degradation: if it doesn't
 * exist the user just lands on the bookings list with the right
 * filter already applied via `?status=completed`).
 */
function PendingReviewCard({
  pending,
  t,
  locale,
}: {
  pending: PendingReview;
  t: ReturnType<typeof useI18n>["t"];
  locale: ReturnType<typeof useI18n>["locale"];
}) {
  const dateFmtLocale = locale === "it" ? "it-IT" : "en-US";
  const date = new Date(pending.scheduled_at);
  const therapistName = pending.therapist?.display_name?.trim() || t.clientHome.therapist;
  return (
    <Link
      href={`/dashboard/bookings?review=${pending.id}#review`}
      className="group animate-reveal relative block overflow-hidden rounded-3xl border border-gold/25 bg-gradient-to-br from-[#FCF3E2] via-cream to-berry-subtle/30 p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-7"
      style={{ animationDelay: "45ms" }}
    >
      {/* Decorative open-quote glyph in gold, sits behind the copy */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-2 -top-4 font-[family-name:var(--font-display)] text-[120px] italic leading-none text-gold/15 sm:text-[140px]"
      >
        “
      </div>
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white bg-gradient-to-br from-berry-subtle/60 to-cream-dark shadow-sm">
          {pending.therapist?.photo_url ? (
            <Image
              src={pending.therapist.photo_url}
              alt={therapistName}
              width={64}
              height={64}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="font-[family-name:var(--font-display)] text-2xl font-medium text-berry">
              {therapistName[0]?.toUpperCase() || "?"}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Eyebrow>{t.clientHome.pendingReviewEyebrow}</Eyebrow>
          <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-xl font-medium leading-tight tracking-tight text-charcoal sm:text-2xl">
            {renderEditorial(t.clientHome.pendingReviewHeadline, {
              italicOpen: "{italicOpen}",
              italicClose: "{italicClose}",
              therapist: therapistName,
            })}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-charcoal-muted">
            {pending.service_name || t.clientHome.session}
            {" · "}
            {date.toLocaleDateString(dateFmtLocale, {
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-berry px-4 py-2 text-xs font-semibold text-white shadow-md shadow-berry/20 transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg sm:self-center">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          {t.clientHome.leaveReviewCta}
        </span>
      </div>
    </Link>
  );
}

/**
 * The fallback when the user has no upcoming sessions. Softer than a
 * red-empty-state — it's the brand's "find a therapist" CTA but
 * dressed in the editorial register (eyebrow + serif headline + pill
 * button) so the home doesn't suddenly look unbranded.
 */
function FindTherapistFallback({
  t,
}: {
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <Link
      href="/dashboard/therapists"
      className="group animate-reveal block overflow-hidden rounded-3xl border border-berry/10 bg-gradient-to-br from-cream-dark via-white to-berry-subtle/30 p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-8"
      style={{ animationDelay: "30ms" }}
    >
      <div className="flex items-center gap-5">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-berry text-white shadow-md shadow-berry/20">
          <Search className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <p className="font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
            {t.clientHome.findTherapistTitle}
          </p>
          <p className="mt-0.5 text-sm text-charcoal-muted">
            {t.clientHome.findTherapistSubtitle}
          </p>
        </div>
        <ArrowRight className="h-5 w-5 text-berry transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

/**
 * Static brand signal — cream gradient surface, gold eyebrow, italic
 * Cormorant pull-quote in berry. No data, no logic. The point is
 * that the home doesn't end on a chart or a stats row; it ends on a
 * sentence that reminds the user this is a *practice*, not an app.
 */
function PullQuote({ t }: { t: ReturnType<typeof useI18n>["t"] }) {
  return (
    <div
      className="animate-reveal relative overflow-hidden rounded-3xl px-8 py-10 text-center"
      style={{
        background:
          "linear-gradient(160deg, var(--cream-dark) 0%, rgba(240,223,229,0.5) 100%)",
        animationDelay: "200ms",
      }}
    >
      <div
        aria-hidden="true"
        className="absolute left-6 top-2 font-[family-name:var(--font-display)] text-[88px] italic leading-none text-berry/15"
      >
        “
      </div>
      <Eyebrow>{t.clientHome.pullQuoteEyebrow}</Eyebrow>
      <p className="mx-auto mt-4 max-w-xl font-[family-name:var(--font-display)] text-2xl leading-snug tracking-tight text-berry sm:text-[28px]">
        {renderEditorial(t.clientHome.pullQuote)}
      </p>
    </div>
  );
}

/**
 * Helper for the headline copy: returns the localised "today" / "tomorrow"
 * / weekday label depending on how far the next booking is from now.
 * Falls back to the weekday name for bookings >2 days out so we don't
 * say "today" for something three days away.
 */
function nextSessionWhenLabel(
  iso: string,
  now: Date,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const target = new Date(iso);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (target.toDateString() === now.toDateString()) return t.clientHome.whenToday;
  if (target.toDateString() === tomorrow.toDateString()) return t.clientHome.whenTomorrow;
  // For sessions further out, the headline reads better with the weekday
  // name in lowercase (matches the rest of the sentence) rather than a
  // raw date — "la prossima lunedì alle 15:30" feels more natural than
  // "la prossima 18 maggio alle 15:30".
  return target.toLocaleDateString("it-IT", { weekday: "long" });
}
