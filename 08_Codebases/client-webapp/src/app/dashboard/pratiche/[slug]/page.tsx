"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  ArrowLeft,
  Sparkles,
  Clock,
  Users,
  ChevronDown,
  ShieldCheck,
  Star,
  ArrowRight,
  Mail,
} from "lucide-react";

type Practice = {
  id: string;
  slug: string;
  category_key: string;
  title: string;
  tagline: string;
  hero_image_url: string | null;
  what_is_it: string;
  who_benefits: string;
  what_to_expect: string;
  duration_typical_min: number | null;
  faq: Array<{ q: string; a: string }> | null;
  related_keys: string[] | null;
};

type RelatedPractice = {
  slug: string;
  title: string;
  tagline: string;
  category_key: string;
};

type Therapist = {
  id: string;
  display_name: string | null;
  tagline: string | null;
  photo_url: string | null;
  city: string | null;
  average_rating: number | null;
  total_reviews: number | null;
  is_verified: boolean | null;
};

export default function PracticeDetailPage() {
  const { t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [related, setRelated] = useState<RelatedPractice[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [interestSent, setInterestSent] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: practiceData } = await supabase
        .from("practices")
        .select(
          "id, slug, category_key, title, tagline, hero_image_url, what_is_it, who_benefits, what_to_expect, duration_typical_min, faq, related_keys",
        )
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();

      if (!practiceData) {
        setLoading(false);
        return;
      }
      setPractice(practiceData as Practice);

      // Therapists offering this practice — match on the practice's
      // `slug` inside the public view's `categories[]`. Migrated from
      // `category_key` (Italian-flavored display string) to `slug`
      // (language-neutral identifier) on 2026-05-05 so English-speaking
      // therapists can pick the same dropdown option as Italian ones.
      // The view already excludes therapists with non-active Stripe.
      const { data: therapistsData } = await supabase
        .from("therapist_profiles_public")
        .select(
          "id, display_name, tagline, photo_url, city, average_rating, total_reviews, is_verified, categories",
        )
        .contains("categories", [(practiceData as Practice).slug])
        .order("average_rating", { ascending: false, nullsFirst: false })
        .limit(6);
      setTherapists((therapistsData as unknown as Therapist[]) || []);

      // Related practices — `practices.related_keys` was migrated from
      // category_key strings to slugs on 2026-05-05 (same UPDATE that
      // touched therapist_profiles.categories). The lookup column
      // therefore changes from `category_key` to `slug`.
      if (practiceData.related_keys && practiceData.related_keys.length > 0) {
        const { data: relatedData } = await supabase
          .from("practices")
          .select("slug, title, tagline, category_key")
          .in("slug", practiceData.related_keys)
          .eq("is_published", true);
        setRelated((relatedData as RelatedPractice[]) || []);
      }

      setLoading(false);
    }
    void load();
  }, [slug]);

  function expressInterest() {
    // For now: just acknowledge in UI. A future iteration writes a row in
    // public.practice_interest (slug, user_id, created_at) so admin can
    // see demand by category and recruit therapists accordingly.
    setInterestSent(true);
    setTimeout(() => setInterestSent(false), 4000);
  }

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

  if (!practice) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/pratiche" className="inline-flex items-center gap-1.5 text-sm text-berry hover:text-berry-dark">
          <ArrowLeft className="h-4 w-4" /> {t.practiceDetail.back}
        </Link>
        <div className="rounded-2xl border border-berry/5 bg-white/60 p-12 text-center">
          <p className="text-sm text-charcoal-muted">{t.practiceDetail.notFound}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <Link
        href="/dashboard/pratiche"
        className="inline-flex items-center gap-1.5 text-sm text-berry hover:text-berry-dark"
      >
        <ArrowLeft className="h-4 w-4" /> {t.practiceDetail.back}
      </Link>

      {/* Hero — image-led. The FAL hero fills a 21:9 (mobile) → 12:5
          (desktop) banner. Title and metadata sit on a glassy panel that
          fades in over the bottom of the image so you immediately see
          the practice's visual identity, then the words. */}
      <div className="animate-reveal overflow-hidden rounded-3xl border border-berry/10 bg-gradient-to-br from-berry-subtle/40 via-white to-gold/10 shadow-sm">
        <div className="relative aspect-[21/9] w-full overflow-hidden lg:aspect-[12/5]">
          {practice.hero_image_url ? (
            <Image
              src={practice.hero_image_url}
              alt={practice.title}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 768px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-berry-subtle/40 via-white to-gold/10">
              <Sparkles className="h-12 w-12 text-berry/40" strokeWidth={1} />
            </div>
          )}

          {/* Soft cream wash from the bottom so the title panel sits
              readably regardless of which hero we're showing. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white/95 via-white/60 to-transparent" />
        </div>

        <div className="relative -mt-14 px-6 pb-6 pt-0 sm:-mt-16 sm:px-8">
          <div className="rounded-2xl bg-white/85 p-5 shadow-sm backdrop-blur-md sm:p-6">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal sm:text-[34px]">
              {practice.title}
            </h1>
            <p className="mt-2 text-base text-charcoal-light">{practice.tagline}</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-charcoal-muted">
              {practice.duration_typical_min && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {practice.duration_typical_min} {t.practiceDetail.minSession}
                </span>
              )}
              {therapists.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {therapists.length} {t.practiceDetail.availableTherapists}
                </span>
              )}
            </div>

            {therapists.length > 0 && (
              <a
                href="#operatori"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/15 transition-all hover:bg-berry-dark hover:shadow-lg hover:-translate-y-0.5"
              >
                {t.practiceDetail.seeTherapistsCta}
                <ArrowRight className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* What is it */}
      <Section heading={t.practiceDetail.whatIsItHeading}>
        <Paragraphs text={practice.what_is_it} />
      </Section>

      {/* Who benefits */}
      <Section heading={t.practiceDetail.whoBenefitsHeading}>
        <BulletList text={practice.who_benefits} />
      </Section>

      {/* What to expect */}
      <Section heading={t.practiceDetail.whatToExpectHeading}>
        <Paragraphs text={practice.what_to_expect} />
      </Section>

      {/* FAQ */}
      {practice.faq && practice.faq.length > 0 && (
        <Section heading={t.practiceDetail.faqHeading}>
          <div className="space-y-2">
            {practice.faq.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="block w-full rounded-2xl border border-berry/5 bg-white/70 px-5 py-4 text-left shadow-sm transition-all hover:bg-berry-subtle/20"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-charcoal">{item.q}</p>
                    <ChevronDown
                      className={`h-4 w-4 flex-shrink-0 text-charcoal-muted transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                  {isOpen && (
                    <p className="mt-3 text-sm text-charcoal-light leading-relaxed">{item.a}</p>
                  )}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Therapists */}
      <Section
        heading={`${t.practiceDetail.therapistsForHeading} ${practice.title}`}
        anchor="operatori"
      >
        {therapists.length === 0 ? (
          <div className="rounded-2xl border border-gold/20 bg-[#F9F0DF]/40 p-6 text-center">
            <Mail className="mx-auto h-7 w-7 text-gold-dark" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-semibold text-charcoal">
              {t.practiceDetail.comingSoonTitle}
            </p>
            <p className="mt-1 text-sm text-charcoal-light">
              {t.practiceDetail.comingSoonBody.replace("{practice}", practice.title)}
            </p>
            <button
              type="button"
              onClick={expressInterest}
              disabled={interestSent}
              className="mt-4 rounded-full bg-berry px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-berry-dark disabled:opacity-60"
            >
              {interestSent ? t.practiceDetail.interestRecorded : t.practiceDetail.notifyMeCta}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {therapists.map((th) => (
              <Link
                key={th.id}
                href={`/dashboard/therapists/${th.id}`}
                className="group flex items-start gap-3 rounded-2xl border border-berry/5 bg-white/70 p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-berry-subtle to-gold/20 text-base font-bold text-berry-dark">
                  {th.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={th.photo_url} alt={th.display_name ?? ""} className="h-full w-full object-cover" />
                  ) : (
                    (th.display_name?.[0] || "?").toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-semibold text-charcoal truncate">
                      {th.display_name?.trim() || "—"}
                    </p>
                    {th.is_verified && (
                      <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-info" strokeWidth={2} />
                    )}
                  </div>
                  {th.tagline && (
                    <p className="mt-0.5 text-xs text-charcoal-muted line-clamp-2">{th.tagline}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-charcoal-muted">
                    {(th.average_rating ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 fill-gold text-gold" />
                        {(th.average_rating ?? 0).toFixed(1)} ({th.total_reviews ?? 0})
                      </span>
                    )}
                    {th.city && <span>{th.city}</span>}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 self-center text-berry opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* Related practices */}
      {related.length > 0 && (
        <Section heading={t.practiceDetail.relatedHeading}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/dashboard/pratiche/${r.slug}`}
                className="group rounded-2xl border border-berry/5 bg-white/70 p-4 shadow-sm transition-all hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <Sparkles className="h-4 w-4 flex-shrink-0 text-berry" strokeWidth={1.75} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-charcoal">{r.title}</p>
                    <p className="mt-0.5 text-xs text-charcoal-muted line-clamp-2">{r.tagline}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-berry opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  heading,
  anchor,
  children,
}: {
  heading: string;
  anchor?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-reveal" id={anchor}>
      <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
        {heading}
      </h2>
      {children}
    </section>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i} className="text-sm leading-relaxed text-charcoal-light">
          {para}
        </p>
      ))}
    </div>
  );
}

function BulletList({ text }: { text: string }) {
  // Lines like "- foo" become bullets; everything else becomes a paragraph.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <ul className="space-y-2">
      {lines.map((line, i) => {
        const stripped = line.replace(/^[-*•]\s*/, "");
        return (
          <li key={i} className="flex items-start gap-2 text-sm text-charcoal-light leading-relaxed">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-berry" />
            <span>{stripped}</span>
          </li>
        );
      })}
    </ul>
  );
}
