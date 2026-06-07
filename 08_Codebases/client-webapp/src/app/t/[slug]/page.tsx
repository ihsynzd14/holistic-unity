import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchPublicProfileBySlug } from "@/lib/therapists/public-profile";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { TierIcon, type TierKey } from "@/components/ui/TierIcon";
import { TierLabel } from "@/components/ui/TierLabel";
import {
  MapPin,
  Globe,
  Star,
  CreditCard,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

const PUBLIC_BASE_URL =
  process.env.NEXT_PUBLIC_PUBLIC_APP_URL ?? "https://app.holisticunity.app";

// Mirrors the map in dashboard/therapists/[id]/page.tsx — keep in sync.
const PRACTICE_LABELS: Record<string, string> = {
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

type Locale = "it" | "en";

const STR = {
  it: {
    verified: "Verificata",
    experience: "anni di esperienza",
    reviews: "recensioni",
    about: "Chi sono",
    disciplines: "Discipline",
    helpsWith: "Aiuta con",
    languages: "Lingue",
    book: "Prenota una sessione",
    haveAccount: "Ho già un account",
    trustTitle: "Prenotazione sicura",
    trustBody:
      "Ripianifichi fino a 48h prima, IVA inclusa. Pagamento sicuro via Stripe.",
    onHU: "su Holistic Unity",
    explore: "Scopri Holistic Unity",
    role: "Operatore olistico",
  },
  en: {
    verified: "Verified",
    experience: "years of experience",
    reviews: "reviews",
    about: "About",
    disciplines: "Disciplines",
    helpsWith: "Helps with",
    languages: "Languages",
    book: "Book a session",
    haveAccount: "I already have an account",
    trustTitle: "Secure booking",
    trustBody:
      "Reschedule up to 48h before, VAT included. Secure payment via Stripe.",
    onHU: "on Holistic Unity",
    explore: "Discover Holistic Unity",
    role: "Holistic practitioner",
  },
} as const;

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
}

function roleLabelFor(categories: unknown, fallback: string): string {
  const first = asStringArray(categories)[0];
  return (first && PRACTICE_LABELS[first]) || fallback;
}

async function getLocale(): Promise<Locale> {
  const c = await cookies();
  return c.get("hu-locale")?.value === "en" ? "en" : "it";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const profile = await fetchPublicProfileBySlug(slug);
  if (!profile) {
    return { title: "Operatore non trovato · Holistic Unity" };
  }

  const locale = await getLocale();
  const t = STR[locale];
  const name = profile.display_name?.trim() || "Operatore";
  const role = roleLabelFor(profile.categories, t.role);
  const tagline = typeof profile.tagline === "string" ? profile.tagline.trim() : "";
  const bio = typeof profile.bio === "string" ? profile.bio.trim() : "";
  const description = (tagline || bio || `${role} ${t.onHU}.`).slice(0, 160);
  const url = `${PUBLIC_BASE_URL}/t/${profile.slug}`;
  const photo = typeof profile.photo_url === "string" ? profile.photo_url : undefined;

  return {
    title: `${name} · ${role} | Holistic Unity`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${name} · ${role}`,
      description,
      url,
      siteName: "Holistic Unity",
      type: "profile",
      images: photo ? [{ url: photo, alt: name }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} · ${role}`,
      description,
      images: photo ? [photo] : undefined,
    },
  };
}

export default async function PublicTherapistPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await fetchPublicProfileBySlug(slug);
  if (!profile) notFound();

  // Login state decides the booking funnel target.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  const locale = await getLocale();
  const t = STR[locale];

  const name = profile.display_name?.trim() || "Operatore";
  const role = roleLabelFor(profile.categories, t.role);
  const tagline = typeof profile.tagline === "string" ? profile.tagline.trim() : "";
  const bio = typeof profile.bio === "string" ? profile.bio.trim() : "";
  const photo = typeof profile.photo_url === "string" ? profile.photo_url : null;
  const city = typeof profile.city === "string" ? profile.city.trim() : "";
  const tier = (profile.tier as TierKey | null) ?? null;
  const isVerified = profile.is_verified === true;
  const years =
    typeof profile.years_experience === "number" && profile.years_experience > 0
      ? profile.years_experience
      : null;
  const rating =
    typeof profile.average_rating === "number" && profile.average_rating > 0
      ? profile.average_rating
      : null;
  const totalReviews =
    typeof profile.total_reviews === "number" ? profile.total_reviews : 0;
  const languages = asStringArray(profile.languages).slice(0, 4);
  const categories = asStringArray(profile.categories);
  const helpsWith = asStringArray(profile.helps_with).slice(0, 8);

  // Booking funnel: logged-in → straight to the in-app booking section;
  // logged-out → sign-up wall, returning to that same section afterward.
  // Use the slug (this page was reached by it) so the funnel + next=
  // param never carry the UUID either.
  const dest = `/dashboard/therapists/${profile.slug}#prenota`;
  const nextParam = encodeURIComponent(dest);

  return (
    <main className="min-h-[100dvh] bg-cream">
      {/* Minimal public header */}
      <header className="border-b border-berry/5 bg-white/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <a
            href="https://holisticunity.app"
            className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-berry"
          >
            Holistic Unity
          </a>
          <Link
            href="/login"
            className="text-sm font-semibold text-berry transition-colors hover:text-berry-dark"
          >
            {t.haveAccount}
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
        <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-10">
          {/* Portrait */}
          <div className="mx-auto mb-7 w-full max-w-[320px] lg:mx-0 lg:mb-0">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] bg-gradient-to-br from-berry-subtle via-cream-dark to-gold/30 shadow-[0_30px_60px_-15px_rgba(229,193,233,0.55)] ring-1 ring-berry/5">
              {photo ? (
                <Image
                  src={photo}
                  alt={name}
                  fill
                  sizes="(max-width: 1024px) 320px, 320px"
                  unoptimized
                  priority
                  className="object-cover object-[center_25%]"
                />
              ) : (
                <div className="absolute inset-0 flex items-end justify-center pb-6 font-[family-name:var(--font-display)] text-[110px] font-medium leading-none tracking-tight text-berry-dark">
                  {name[0]?.toUpperCase() || "?"}
                </div>
              )}
              {isVerified && (
                <div className="absolute -right-2 -top-2 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-white px-3 py-1.5 shadow-md">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success text-[10px] font-extrabold text-white">
                    ✓
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-success">
                    {t.verified}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="min-w-0">
            {tier && (
              <div className="mb-3 flex items-center gap-2.5">
                <span className="inline-flex flex-shrink-0 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-berry/5">
                  <TierIcon tier={tier} size={38} />
                </span>
                <TierLabel tier={tier} />
              </div>
            )}
            <Eyebrow>{role}</Eyebrow>
            <h1 className="mt-2.5 font-[family-name:var(--font-display)] text-[40px] font-medium leading-[1.05] tracking-tight text-charcoal sm:text-5xl">
              {name}
            </h1>
            {tagline && (
              <p
                className="mt-3 max-w-2xl font-[family-name:var(--font-display)] text-[19px] italic leading-[1.45] text-berry"
                style={{ fontStyle: "italic" }}
              >
                &ldquo;{tagline}&rdquo;
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-charcoal-muted">
              {city && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {city}
                </span>
              )}
              {languages.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  {languages.join(" · ")}
                </span>
              )}
            </div>

            {/* Stats */}
            {(rating || years) && (
              <div className="mt-5 flex flex-wrap items-stretch gap-x-8 gap-y-4 border-t border-berry/10 pt-5">
                {rating && (
                  <div>
                    <p className="font-[family-name:var(--font-display)] text-3xl font-medium leading-none tracking-tight text-charcoal">
                      <Star
                        className="mr-1 inline-block h-4 w-4 translate-y-[-2px] fill-gold text-gold"
                        strokeWidth={0}
                      />
                      {rating.toFixed(1)}
                    </p>
                    <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-charcoal-muted">
                      {totalReviews} {t.reviews}
                    </p>
                  </div>
                )}
                {years && (
                  <div>
                    <p className="font-[family-name:var(--font-display)] text-3xl font-medium leading-none tracking-tight text-charcoal">
                      {years}
                    </p>
                    <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-charcoal-muted">
                      {t.experience}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Booking CTA + trust */}
            <div className="mt-7 rounded-2xl border border-berry/10 bg-white/80 p-5 shadow-sm">
              {isLoggedIn ? (
                <Link
                  href={dest}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-berry px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark"
                >
                  <CreditCard className="h-4 w-4" />
                  {t.book}
                </Link>
              ) : (
                <Link
                  href={`/register?next=${nextParam}`}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-berry px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark"
                >
                  <CreditCard className="h-4 w-4" />
                  {t.book}
                </Link>
              )}
              <div className="mt-3 flex items-start gap-2.5">
                <RefreshCcw className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-berry" />
                <div>
                  <p className="text-[12.5px] font-semibold text-charcoal">
                    {t.trustTitle}
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-[1.55] text-charcoal-light">
                    {t.trustBody}
                  </p>
                </div>
              </div>
              {!isLoggedIn && (
                <p className="mt-3 text-center text-[11.5px] text-charcoal-muted">
                  <Link
                    href={`/login?next=${nextParam}`}
                    className="font-semibold text-berry underline-offset-2 hover:underline"
                  >
                    {t.haveAccount}
                  </Link>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* About */}
        {bio && (
          <section className="mt-12">
            <Eyebrow>{t.about}</Eyebrow>
            <p className="mt-3 max-w-3xl whitespace-pre-line text-[15px] leading-[1.7] text-charcoal-light">
              {bio}
            </p>
          </section>
        )}

        {/* Disciplines */}
        {categories.length > 0 && (
          <section className="mt-10">
            <Eyebrow>{t.disciplines}</Eyebrow>
            <div className="mt-3 flex flex-wrap gap-2">
              {categories.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-berry-subtle/50 px-3.5 py-1.5 text-[12px] font-medium text-berry-dark"
                >
                  {PRACTICE_LABELS[c] ?? c}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Helps with */}
        {helpsWith.length > 0 && (
          <section className="mt-8">
            <Eyebrow>{t.helpsWith}</Eyebrow>
            <div className="mt-3 flex flex-wrap gap-2">
              {helpsWith.map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-1.5 rounded-full border border-berry/10 bg-white px-3.5 py-1.5 text-[12px] font-medium text-charcoal-light"
                >
                  <Sparkles className="h-3 w-3 text-gold-dark" strokeWidth={2.25} />
                  {h}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-16 border-t border-berry/5 pt-6 text-center">
          <p className="text-sm text-charcoal-muted">{t.onHU}</p>
          <a
            href="https://holisticunity.app"
            className="mt-1 inline-block font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-berry transition-colors hover:text-berry-dark"
          >
            {t.explore} →
          </a>
        </footer>
      </div>
    </main>
  );
}
