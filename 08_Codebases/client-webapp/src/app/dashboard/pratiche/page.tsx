"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { Sparkles, Users, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

type Practice = {
  id: string;
  slug: string;
  category_key: string;
  title: string;
  tagline: string;
  hero_image_url: string | null;
  duration_typical_min: number | null;
  display_order: number;
};

export default function PracticesListPage() {
  const { t } = useI18n();
  const [practices, setPractices] = useState<Practice[]>([]);
  const [therapistCounts, setTherapistCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: practicesData }, { data: profilesData }] = await Promise.all([
        supabase
          .from("practices")
          .select("id, slug, category_key, title, tagline, hero_image_url, duration_typical_min, display_order")
          .eq("is_published", true)
          .order("display_order"),
        // Pull bookable-therapist categories so we can render the
        // "N operatori per questa pratica" badges. The public view
        // already enforces the 3 visibility predicates (approved +
        // Stripe-active) so we don't need applyClientVisibilityFilters.
        supabase.from("therapist_profiles_public").select("categories"),
      ]);

      // `therapist_profiles.categories[]` stores `practices.slug` values
      // (since 2026-05-05 — see `validate_therapist_categories` trigger).
      // The grouping below counts therapists per slug; the `active` /
      // `comingSoon` partition then keys by `practice.slug`.
      const counts: Record<string, number> = {};
      for (const p of profilesData || []) {
        for (const c of (p.categories as string[] | null) ?? []) {
          counts[c] = (counts[c] || 0) + 1;
        }
      }
      setTherapistCounts(counts);
      setPractices((practicesData as Practice[]) || []);
      setLoading(false);
    }
    void load();
  }, []);

  // Two groups: practices with at least 1 therapist (active), and the rest
  // (coming soon). The active ones go first so users see actionable entries.
  const { active, comingSoon } = useMemo(() => {
    const active: Practice[] = [];
    const comingSoon: Practice[] = [];
    for (const p of practices) {
      // Match against `practices.slug` (the language-neutral identifier
      // that `therapist_profiles.categories[]` stores). Was previously
      // `category_key` which had Italian-flavored display values like
      // `"Naturopatia"` — when therapists with English values like
      // `"Naturopathy"` slipped in, the practice silently rendered as
      // "In arrivo" despite having bookable therapists. Slug is stable
      // across locales.
      if ((therapistCounts[p.slug] ?? 0) > 0) active.push(p);
      else comingSoon.push(p);
    }
    return { active, comingSoon };
  }, [practices, therapistCounts]);

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  return (
    <div className="space-y-8">
      <div className="animate-reveal">
        <DisplayHeading>
          {t.practices.title}
        </DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">{t.practices.subtitle}</p>
      </div>

      {active.length > 0 && (
        <section className="animate-reveal" style={{ animationDelay: "40ms" }}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted mb-3">
            {t.practices.availableNow}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((p, i) => (
              <PracticeCard
                key={p.id}
                practice={p}
                therapistCount={therapistCounts[p.slug] ?? 0}
                delay={80 + i * 40}
                ctaLabel={t.practices.exploreCta}
              />
            ))}
          </div>
        </section>
      )}

      {comingSoon.length > 0 && (
        <section className="animate-reveal" style={{ animationDelay: "120ms" }}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-charcoal-muted mb-3">
            {t.practices.comingSoon}
          </h2>
          <p className="text-xs text-charcoal-muted/70 mb-3">{t.practices.comingSoonHint}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {comingSoon.map((p, i) => (
              <PracticeCard
                key={p.id}
                practice={p}
                therapistCount={0}
                delay={160 + i * 40}
                ctaLabel={t.practices.discoverCta}
                muted
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PracticeCard({
  practice,
  therapistCount,
  delay,
  ctaLabel,
  muted = false,
}: {
  practice: Practice;
  therapistCount: number;
  delay: number;
  ctaLabel: string;
  muted?: boolean;
}) {
  const hasHero = Boolean(practice.hero_image_url);

  return (
    <Link
      href={`/dashboard/pratiche/${practice.slug}`}
      className={`group animate-reveal block overflow-hidden rounded-3xl border ${
        muted ? "border-berry/5 bg-white/60" : "border-berry/10 bg-white/80"
      } shadow-sm backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:shadow-berry/10 hover:-translate-y-1`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Hero image banner. 16:9 aspect, image scales gently on hover so
          the card feels responsive without being noisy. The muted
          overlay on "coming soon" cards tones the image down so users
          immediately read them as less actionable. */}
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-berry-subtle/40 via-cream to-gold/10">
        {hasHero ? (
          <Image
            src={practice.hero_image_url as string}
            alt={practice.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className={`object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.06] ${
              muted ? "opacity-70 saturate-75" : ""
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Sparkles className="h-10 w-10 text-berry/30" strokeWidth={1} />
          </div>
        )}

        {/* Very light cream-to-transparent gradient at the bottom so the
            therapist-count badge sits readably on any image variant. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/60 via-white/20 to-transparent" />

        {/* Status badge floating top-right */}
        <div className="absolute right-3 top-3">
          {therapistCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-success shadow-sm backdrop-blur-sm">
              <Users className="h-3 w-3" strokeWidth={2.25} />
              {therapistCount} {therapistCount === 1 ? "operatore" : "operatori"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-charcoal-muted shadow-sm backdrop-blur-sm">
              In arrivo
            </span>
          )}
        </div>
      </div>

      {/* Text block */}
      <div className="p-5">
        <p className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">
          {practice.title}
        </p>
        <p className="mt-1.5 text-sm text-charcoal-light line-clamp-2">
          {practice.tagline}
        </p>
        <p
          className={`mt-4 inline-flex items-center gap-1 text-xs font-semibold ${
            muted ? "text-charcoal-muted" : "text-berry"
          } transition-all group-hover:gap-2`}
        >
          {ctaLabel}
          <ChevronRight className="h-3 w-3" />
        </p>
      </div>
    </Link>
  );
}
