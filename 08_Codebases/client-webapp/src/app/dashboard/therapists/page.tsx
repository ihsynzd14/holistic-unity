"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { Search, Star, MapPin, ShieldCheck, Globe, Sparkles } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

type Therapist = {
  id: string;
  display_name: string | null;
  tagline: string | null;
  photo_url: string | null;
  years_experience: number | null;
  categories: string[] | null;
  languages: string[] | null;
  city: string | null;
  country: string | null;
  average_rating: number | null;
  total_reviews: number | null;
  is_verified: boolean | null;
  has_mfa: boolean | null;
  has_free_intro: boolean;
  created_at?: string | null;
};

export default function BrowseTherapistsPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      // Public VIEW `therapist_profiles_public` exposes only safe
      // columns (no Stripe account IDs, no VAT numbers) and already
      // bakes in the three visibility predicates: is_approved +
      // approval_status = 'approved' + stripe_account_status = 'active'.
      // No explicit `applyClientVisibilityFilters` needed here.
      const { data } = await supabase
        .from("therapist_profiles_public")
        .select(
          "id, display_name, tagline, photo_url, years_experience, categories, languages, city, country, average_rating, total_reviews, is_verified, has_mfa, created_at"
        );

      // Detect therapists offering a free "sessione conoscitiva". The
      // intro flag and price=0 are both required: a paid 15-min call
      // is not a conversion driver and shouldn't get the green badge.
      const ids = (data ?? []).map((t) => t.id as string);
      const introSet = new Set<string>();
      if (ids.length > 0) {
        const { data: introServices } = await supabase
          .from("therapist_services")
          .select("therapist_id")
          .in("therapist_id", ids)
          .eq("is_intro_call", true)
          .eq("is_active", true)
          .eq("price", 0);
        for (const s of introServices ?? []) introSet.add(s.therapist_id as string);
      }

      const enriched: Therapist[] = (data ?? []).map((t) => ({
        ...(t as Omit<Therapist, "has_free_intro">),
        has_free_intro: introSet.has(t.id as string),
      }));

      // Sort algorithm — replaces the previous `ORDER BY average_rating
      // DESC NULLS LAST` which buried every brand-new therapist (no
      // reviews yet → null → last) and killed cold-start conversion
      // for the marketplace.
      //
      // Buckets, descending priority:
      //   1. has_free_intro && rating >= 4 (or no rating): top-of-fold
      //      because they're the highest-converting first impression.
      //   2. average_rating DESC for therapists with >= 1 review.
      //   3. New therapists (no reviews, joined < 30 days ago):
      //      randomly mixed into the top-half so they get exposure.
      //   4. The rest: by created_at DESC (newest first) within the
      //      no-rating cohort, then everyone else.
      //
      // Ties broken by display_name for stable ordering.
      const RECENT_DAYS = 30;
      const recentCutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
      const scored = enriched.map((th) => {
        const created = th.created_at ? new Date(th.created_at).getTime() : 0;
        const isRecent = created > recentCutoff;
        const reviewed = (th.total_reviews ?? 0) > 0;
        const rating = th.average_rating ?? 0;
        let bucket: number;
        if (th.has_free_intro && (!reviewed || rating >= 4)) bucket = 0;
        else if (reviewed) bucket = 1;
        else if (isRecent) bucket = 2;
        else bucket = 3;
        return { th, bucket, rating, created };
      });
      scored.sort((a, b) => {
        if (a.bucket !== b.bucket) return a.bucket - b.bucket;
        if (a.bucket === 1) return b.rating - a.rating;
        if (a.bucket === 2 || a.bucket === 3) return b.created - a.created;
        return (a.th.display_name ?? "").localeCompare(b.th.display_name ?? "");
      });
      setTherapists(scored.map((s) => s.th));
      setLoading(false);
    }
    void load();
  }, []);

  // All distinct categories across the visible therapists, for filter chips.
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const th of therapists) for (const c of th.categories ?? []) set.add(c);
    return Array.from(set).sort();
  }, [therapists]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return therapists.filter((th) => {
      if (activeCategory && !(th.categories ?? []).includes(activeCategory)) return false;
      if (!q) return true;
      const haystack = [
        th.display_name,
        th.tagline,
        th.city,
        ...(th.categories ?? []),
        ...(th.languages ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [therapists, query, activeCategory]);

  return (
    <div className="space-y-6">
      {/* Header — never show "0 professionisti" during load (kills
          conversion for ad traffic). Show a soft loading shimmer
          instead and only render the real count once data arrives. */}
      <div className="animate-reveal">
        <DisplayHeading>
          {t.browse.title}
        </DisplayHeading>
        {loading ? (
          <p className="mt-1 inline-block h-4 w-40 animate-pulse rounded bg-berry-subtle/50" aria-hidden="true" />
        ) : (
          <p className="mt-1 text-sm text-charcoal-muted">
            {t.browse.subtitle.replace("{n}", String(therapists.length))}
          </p>
        )}
      </div>

      {/* Search */}
      <div className="animate-reveal" style={{ animationDelay: "40ms" }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.browse.searchPlaceholder}
            className="w-full rounded-2xl border border-berry-subtle bg-white py-3 pl-11 pr-4 text-sm text-charcoal placeholder-charcoal-muted/50 outline-none transition-all focus:border-berry focus:ring-2 focus:ring-berry/10"
          />
        </div>
      </div>

      {/* Category chips */}
      {allCategories.length > 0 && (
        <div
          className="animate-reveal -mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 pb-1 lg:flex-wrap lg:overflow-visible"
          style={{ animationDelay: "80ms" }}
        >
          <button
            onClick={() => setActiveCategory(null)}
            className={`flex-shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
              activeCategory === null
                ? "bg-berry text-white"
                : "border border-berry/10 bg-white/70 text-charcoal-light hover:border-berry/30 hover:bg-berry-subtle/50"
            }`}
          >
            {t.browse.allCategories}
          </button>
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                activeCategory === cat
                  ? "bg-berry text-white"
                  : "border border-berry/10 bg-white/70 text-charcoal-light hover:border-berry/30 hover:bg-berry-subtle/50"
              }`}
            >
              {prettyCategory(cat)}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex h-[40vh] items-center justify-center">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-berry/5 bg-white/60 p-12 text-center">
          <p className="text-sm text-charcoal-muted">{t.browse.noResults}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((th, idx) => (
            <Link
              key={th.id}
              href={`/dashboard/therapists/${th.id}`}
              className="group animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              style={{ animationDelay: `${120 + idx * 40}ms` }}
            >
              {/* Avatar + name */}
              <div className="flex items-start gap-3">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-berry-subtle to-gold/20 text-lg font-bold text-berry-dark">
                  {th.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={th.photo_url} alt={th.display_name ?? ""} className="h-full w-full object-cover" />
                  ) : (
                    initials(th.display_name)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-charcoal truncate">
                      {th.display_name?.trim() || "—"}
                    </p>
                    {th.is_verified && (
                      <ShieldCheck
                        className="h-3.5 w-3.5 flex-shrink-0 text-info"
                        strokeWidth={2}
                        aria-label="Profilo verificato dall'admin"
                      />
                    )}
                  </div>
                  {th.tagline && (
                    <p className="mt-0.5 text-xs text-charcoal-muted line-clamp-2">{th.tagline}</p>
                  )}
                  {th.has_free_intro && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                      <Sparkles className="h-3 w-3" strokeWidth={2.25} />
                      Sessione conoscitiva gratuita
                    </span>
                  )}
                </div>
              </div>

              {/* Meta row */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-charcoal-muted">
                {(th.average_rating ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-gold text-gold" />
                    {(th.average_rating ?? 0).toFixed(1)} ({th.total_reviews ?? 0})
                  </span>
                )}
                {th.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {th.city}
                  </span>
                )}
                {(th.languages ?? []).length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {(th.languages ?? []).slice(0, 2).join(", ")}
                  </span>
                )}
              </div>

              {/* Categories */}
              {(th.categories ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(th.categories ?? []).slice(0, 3).map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-berry-subtle/50 px-2 py-0.5 text-[10px] font-medium text-berry-dark"
                    >
                      {prettyCategory(c)}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/**
 * Translate a `practices.slug` value to its display label in the
 * current locale. Italian today; when the platform goes EN/PT,
 * replace this with a translation lookup. The slug is the canonical
 * identifier stored on `therapist_profiles.categories[]` (since the
 * 2026-05-05 migration). Legacy snake_case values from older DB rows
 * fall through to a "snake_case → Title Case" pretty-printer so
 * nothing renders as raw `theta_healing`.
 */
const PRACTICE_LABELS_LOCALE: Record<string, string> = {
  "theta-healing": "ThetaHealing",
  "costellazioni-familiari": "Costellazioni Familiari",
  "costellazioni-sistemiche": "Costellazioni Sistemiche",
  reiki: "Reiki",
  naturopatia: "Naturopatia",
  astrologia: "Astrologia",
  "human-design": "Human Design",
  numerologia: "Numerologia",
  ayurveda: "Ayurveda",
  sciamanesimo: "Sciamanesimo",
};

function prettyCategory(c: string): string {
  const label = PRACTICE_LABELS_LOCALE[c];
  if (label) return label;
  // Fallback for legacy DB rows (snake_case or other non-slug values).
  if (c.includes("_")) {
    return c
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
  }
  return c;
}
