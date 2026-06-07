"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { TierIcon, type TierKey } from "@/components/ui/TierIcon";
import { TierLabel } from "@/components/ui/TierLabel";
import {
  ArrowLeft,
  Star,
  MapPin,
  Globe,
  Clock,
  CreditCard,
  AlertCircle,
  MessageSquare,
  ChevronRight,
  Sparkles,
  RefreshCcw,
  Play,
  X,
  Heart,
  Calendar,
  Check,
} from "lucide-react";
import SlotPicker from "@/components/booking/SlotPicker";
import type { Availability, Booking as SlotBooking } from "@/lib/booking/slots";
import { BOOKING_WINDOW_DAYS } from "@/lib/booking/slots";
import { calculatePaymentAmounts } from "@/lib/payments/fee-config";

// `therapist_profiles.categories[]` stores `practices.slug` values
// (since the 2026-05-05 migration that aligned these with
// `practices.slug` for multilingual readiness). The map below
// translates the slug to its display label in the current locale —
// today only Italian; when the platform goes EN/PT, replace the
// literal label with a translation lookup keyed on the slug. The
// slug doubles as the URL to the public practice page, so the chip
// also becomes a link to `/dashboard/pratiche/<slug>`.
//
// Categories not in this map render as plain text without a link —
// defensive fallback for legacy rows that pre-date the migration or
// any future practice slug not yet added here.
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

type Profile = {
  id: string;
  display_name: string | null;
  tagline: string | null;
  bio: string | null;
  photo_url: string | null;
  video_intro_url: string | null;
  gallery_image_urls: string[] | null;
  years_experience: number | null;
  categories: string[] | null;
  // Problem-based specialisations ("Ansia", "Traumi familiari", …)
  // separate from categories which are method-based ("ThetaHealing").
  // Optional — column may not exist yet on older deployments;
  // the SELECT uses a graceful fallback.
  helps_with: string[] | null;
  languages: string[] | null;
  city: string | null;
  country: string | null;
  average_rating: number | null;
  total_reviews: number | null;
  is_verified: boolean | null;
  has_mfa: boolean | null;
  cancellation_policy: string | null;
  currency: string | null;
  availability: Availability | null;
  // stripe_country removed from the public view (sensitive). Use
  // `country` for display fee logic — the actual checkout uses
  // stripe_country admin-side, which is fine.
  accepts_bookings: boolean | null;
  tier: TierKey | null;
};

/**
 * Map common video sharing URLs to their embeddable player URL.
 * Returns null for unsupported / malformed inputs.
 */
function videoEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Vimeo: https://vimeo.com/{id} or https://player.vimeo.com/video/{id}
    if (u.hostname.includes("vimeo.com")) {
      const m = u.pathname.match(/\/(\d+)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
    // YouTube: youtube.com/watch?v={id}, youtu.be/{id}, youtube.com/embed/{id}
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      const id = parseYouTubeId(u);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    // Allowlist-only: any URL outside YouTube/Vimeo is rejected. The
    // therapist webapp validates new URLs at save time, but defense-in-
    // depth here protects against legacy rows or admin-side edits that
    // slipped a non-allowlisted host through. Returning the URL as-is
    // would let a `data:text/html,...` or attacker-controlled host
    // render inside an iframe with autoplay + fullscreen permissions.
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a YouTube video id out of any common URL shape (full,
 * shortened, embed, /shorts/). Returns null on no match.
 */
function parseYouTubeId(u: URL): string | null {
  if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
  if (u.pathname.startsWith("/embed/")) return u.pathname.slice(7).split("/")[0] || null;
  if (u.pathname.startsWith("/shorts/")) return u.pathname.slice(8).split("/")[0] || null;
  return u.searchParams.get("v");
}

/**
 * Resolve a poster (thumbnail) image URL for a given therapist
 * video_intro_url. Returns either:
 *   - a synchronous result for YouTube (image.youtube.com pattern), OR
 *   - null synchronously, with `fetchVimeoPoster` available to load
 *     it asynchronously via Vimeo's oEmbed endpoint.
 */
function videoPosterUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      const id = parseYouTubeId(u);
      if (id) return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    }
    return null; // Vimeo: handled async via fetchVimeoPoster.
  } catch {
    return null;
  }
}

async function fetchVimeoPoster(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("vimeo.com")) return null;
    const oembed = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembed);
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail_url?: string };
    return data?.thumbnail_url ?? null;
  } catch {
    return null;
  }
}

type Service = {
  id: string;
  name: string;
  description: string | null;
  duration: number;
  price: number;
  category: string | null;
  is_intro_call: boolean;
};

type Certification = {
  id: string;
  name: string;
  issuing_organization: string | null;
  year_obtained: number | null;
};

type Review = {
  id: string;
  rating: number;
  text: string | null;
  client_name: string | null;
  client_photo_url: string | null;
  therapist_reply: string | null;
  created_at: string;
};

// Tab labels for the editorial "Chi sono davvero" story section.
// Index 0 = Formazione (driven by certifications), 1 = Approccio
// (driven by bio, default tab), 2 = Cosa aspettarti (platform-standard
// copy — call format, reminders, cancellation reference).
// A fourth "Quando NON sono per te" tab was prototyped but pulled:
// without a therapist-editable column it would have rendered identical
// brand-default copy on every profile, undermining the honesty framing
// it was meant to carry. Revisit if/when we add the editor.
const STORY_TAB_LABELS = [
  "Formazione",
  "Approccio",
  "Cosa aspettarti",
] as const;
type StoryTabIndex = 0 | 1 | 2;

export default function TherapistDetailPage() {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [bookings, setBookings] = useState<SlotBooking[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  // Total completed sessions across this therapist's career, surfaced in
  // the hero KPI strip ("380 sessioni"). Counted via the same
  // `count: 'exact', head: true` trick we use for the client's lifetime
  // stat — keeps the wire payload to a single integer regardless of
  // how many bookings actually exist.
  const [completedCount, setCompletedCount] = useState<number>(0);

  // Booking flow state
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [needsHealthConsent, setNeedsHealthConsent] = useState(false);
  // Video opens in a modal so portrait-recorded videos aren't crammed
  // into the inline landscape player (which produced the rotated/letter-
  // boxed look that was destroying first-impression trust).
  const [videoOpen, setVideoOpen] = useState(false);
  // Poster (thumbnail) for the inline video tile. YouTube has a
  // deterministic URL and resolves synchronously; Vimeo needs an
  // oEmbed fetch. We start with whatever the sync function gives us
  // and upgrade async for Vimeo.
  const [videoPoster, setVideoPoster] = useState<string | null>(null);

  // Editorial UI state — local-only, no persistence in V1.
  //   storyTab → which of the four "Chi sono davvero" tabs is shown.
  //              Defaults to 1 (Approccio) because the bio is the
  //              richest field we have today; opening on Formazione
  //              would lead with a possibly-empty cert list.
  //   favorited → heart toggle. Pure UI; wiring to a real
  //               `saved_therapists` table is V2 work, the icon
  //               still gives the visitor a recognisable affordance
  //               and signals "you'll be able to come back to this".
  const [storyTab, setStoryTab] = useState<StoryTabIndex>(1);
  const [favorited, setFavorited] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const now = new Date();
      // Must match the SlotPicker's compute horizon (BOOKING_WINDOW_DAYS) —
      // otherwise the picker would render free slots for days beyond the
      // busy window we fetched, showing booked slots as available and
      // risking double-booking on the extra weeks.
      const windowEnd = new Date(
        now.getTime() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );

      // Profile is fetched via /api/therapists/[id]/profile, an
      // authenticated server route that uses the user's access token
      // for auth and a service-role read of `therapist_profiles` to
      // apply the canonical bookability filter (approval + Stripe
      // active). We hit this instead of `therapist_profiles_public`
      // directly because the public view applies stricter predicates
      // and was returning null for therapists the same client could
      // literally book a slot with via /freebusy.
      // Services + certifications stay as direct Supabase reads (RLS
      // already permits anonymous select on those tables).
      const profileReq = fetch(`/api/therapists/${id}/profile`)
        .then((r) => (r.ok ? r.json() : { profile: null }))
        .catch(() => ({ profile: null }));
      const [
        { profile: profileData },
        { data: servicesData },
        { data: certsData },
        freebusyRes,
        { data: reviewsData },
        completedRes,
      ] = await Promise.all([
        profileReq,
        supabase
          .from("therapist_services")
          .select("id, name, description, duration, price, category, is_intro_call")
          .eq("therapist_id", id)
          .eq("is_active", true)
          .order("is_intro_call", { ascending: false })
          .order("price", { ascending: true }),
        supabase
          .from("certifications")
          .select("id, name, issuing_organization, year_obtained")
          .eq("therapist_id", id)
          .order("year_obtained", { ascending: false }),
        fetch(
          `/api/therapists/${id}/freebusy?start=${encodeURIComponent(
            now.toISOString(),
          )}&end=${encodeURIComponent(windowEnd.toISOString())}`,
        ).then((r) => r.json()).catch(() => ({ busy: [] })),
        // Reviews are public — RLS lets any authenticated user select.
        // Cap at 12 so the section stays scannable; if there are more,
        // the user can see them on a future dedicated /reviews page.
        supabase
          .from("reviews")
          .select("id, rating, text, client_name, client_photo_url, therapist_reply, created_at")
          .eq("therapist_id", id)
          .order("created_at", { ascending: false })
          .limit(12),
        // Lifetime completed-sessions counter — drives the hero "Sessioni"
        // KPI. Cast to head-only count so the wire payload is just an
        // integer. RLS on `bookings`: the public view doesn't filter by
        // client_id when we count by therapist_id, but the row itself is
        // still subject to RLS — only confirmed visible bookings are
        // counted. If the table can't be read at all (RLS blocks), we
        // fall back to 0 so the KPI silently degrades to "—".
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("therapist_id", id)
          .eq("status", "completed"),
      ]);
      setProfile((profileData as Profile) || null);
      setServices((servicesData as Service[]) || []);
      setCertifications((certsData as Certification[]) || []);
      setBookings((freebusyRes?.busy as SlotBooking[]) || []);
      setReviews((reviewsData as Review[]) || []);
      setCompletedCount(completedRes.count || 0);
      setLoading(false);

      // Resolve a thumbnail for the video intro tile. YouTube hands us
      // a deterministic URL synchronously; for Vimeo we must call the
      // public oEmbed endpoint (CORS-enabled). If neither resolves we
      // keep the gradient fallback the tile shipped with originally.
      const videoUrl = (profileData as Profile | null)?.video_intro_url ?? null;
      if (videoUrl) {
        const sync = videoPosterUrl(videoUrl);
        if (sync) {
          setVideoPoster(sync);
        } else if (videoUrl.includes("vimeo.com")) {
          fetchVimeoPoster(videoUrl).then((u) => {
            if (u) setVideoPoster(u);
          });
        }
      }

      // Fire Meta Pixel ViewContent so retargeting audiences ("users
      // who visited a therapist profile but didn't book") can be built
      // on the Meta side. Consent-gated upstream by the pixel module —
      // no-op until the user accepts the marketing cookie. Fired only
      // when the profile actually loaded (not on 404 or RLS-hidden
      // rows) and only ONCE per visit (the upstream module dedups by
      // {content_ids, content_type, content_name} hash for the
      // current page session).
      if (profileData) {
        try {
          const { trackViewContent } = await import(
            "@/lib/analytics/meta-pixel"
          );
          trackViewContent({
            content_ids: [id as string],
            content_type: "product",
            content_name:
              (profileData as Profile).display_name ?? "therapist",
          });
        } catch { /* meta-pixel module / consent gating may noop */ }
      }
    }
    void load();
  }, [id]);

  async function startCheckout() {
    if (!selectedService || !selectedSlot) return;
    setSubmitting(true);
    setError("");
    setNeedsHealthConsent(false);

    // Fire InitiateCheckout BEFORE the network call so Meta sees
    // the conversion intent even if checkout fails server-side.
    // Pass the gross price (incl. service fee, what client pays).
    try {
      const { trackInitiateCheckout } = await import("@/lib/analytics/meta-pixel");
      // Service currency falls back to therapist's currency, then EUR.
      // The Service type doesn't expose currency directly — use the
      // therapist profile's currency field (already loaded in profile state).
      const currency = ((profile?.currency ?? "EUR") + "").toUpperCase();
      trackInitiateCheckout({
        value: Number(selectedService.price ?? 0),
        currency,
        content_ids: [selectedService.id],
        content_name: selectedService.name ?? undefined,
        num_items: 1,
      });
    } catch {/* tracking is best-effort */}

    try {
      const res = await fetch("/api/checkout/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          therapistId: id,
          serviceId: selectedService.id,
          slotIso: selectedSlot.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 412 && data.error === "health_data_consent_required") {
          setNeedsHealthConsent(true);
          setError(data.detail || "Per prenotare devi aggiornare il consenso al trattamento dei dati relativi alla salute.");
        } else {
          setError(data.error || t.detail.bookingError);
        }
        setSubmitting(false);
        return;
      }
      // Free intro call → straight to success page (no Stripe)
      if (data.free && data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(t.detail.bookingError);
      setSubmitting(false);
    } catch {
      setError(t.detail.bookingError);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/therapists" className="inline-flex items-center gap-1.5 text-sm text-berry hover:text-berry-dark">
          <ArrowLeft className="h-4 w-4" /> {t.detail.back}
        </Link>
        <div className="rounded-2xl border border-berry/5 bg-white/60 p-12 text-center">
          <p className="text-sm text-charcoal-muted">{t.detail.notFound}</p>
        </div>
      </div>
    );
  }

  const currSymbol = profile.currency === "usd" ? "$" : profile.currency === "gbp" ? "£" : "€";
  const therapistAcceptsPayments = profile.accepts_bookings === true;

  // Compute display total (with service fee) for the selected service
  let totalChargedCents = 0;
  if (selectedService && selectedService.price > 0) {
    const calc = calculatePaymentAmounts(
      Math.round(selectedService.price * 100),
      (profile.country || "IT").toUpperCase(),
    );
    totalChargedCents = calc.totalChargedCents;
  }

  // i18n shortcuts for the slot picker
  const weekdayShort =
    locale === "en"
      ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      : ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

  // Cheapest non-zero priced service for sticky CTA / hero quick-info
  const minPaidPrice = services
    .filter((s) => s.price > 0)
    .reduce<number | null>(
      (min, s) => (min === null || s.price < min ? s.price : min),
      null,
    );
  // Free intro call detection — a price-0 service flagged as intro is the
  // single biggest conversion lever on this page (zero-risk first contact).
  // Show the badge prominently in the hero and let the pricing CTA lead
  // with "Conoscitiva GRATIS" instead of the cheapest paid price.
  const hasFreeIntro = services.some(
    (s) => s.is_intro_call && s.price === 0,
  );
  const firstName =
    (profile.display_name?.trim().split(" ")[0] || "l'operatore");

  // Detect a "package" service for the gold-highlighted "Pacchetto
  // risparmio" tile in the sidebar. Heuristic: name or description
  // contains "pacchetto" / "pack" (case-insensitive) — multi-session
  // packs almost always self-label this way and the alternatives
  // (compute per-session price from duration, infer from price tier)
  // are fragile and locale-specific. If no service self-identifies as
  // a pack, no tile is highlighted — that's the right default.
  const packageService =
    services.find((s) =>
      /pacchetto|pack/i.test(`${s.name} ${s.description ?? ""}`),
    ) ?? null;

  // Editorial role label above the name. The reference design ("Operatore
  // olistico") is a generic placeholder; ideally this would come from a
  // therapist-set field. Today the closest signal is the primary category.
  // If we have one, surface its label; otherwise fall back to the generic.
  const primaryCategory = (profile.categories ?? [])[0];
  const roleLabel = primaryCategory
    ? (PRACTICE_LABELS[primaryCategory] ?? "Operatore olistico")
    : "Operatore olistico";

  return (
    <div className="pb-28 lg:max-w-6xl lg:pb-10">
      {/* Breadcrumb */}
      <Link
        href="/dashboard/therapists"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-berry transition-colors hover:text-berry-dark"
      >
        <ArrowLeft className="h-4 w-4" /> {t.detail.back}
      </Link>

      {/*
        HERO — editorial split.
        Layout: portrait column ~320px on the left, content on the right.
        Stacks on mobile (portrait above content). The portrait is a tall
        4:5 card with a coloured gradient surface behind the image, a
        verified pill overhanging the top-right corner, and an "Online ora"
        indicator pinned bottom-left when the operator is bookable.
        The content side carries the gold eyebrow → Cormorant name →
        italic tagline → 4-stat editorial strip → CTA cluster → practice
        chips, mirroring the home dashboard's hierarchy (May 2026
        editorial direction).
      */}
      <header className="animate-reveal">
        <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-9 lg:items-start">
          {/* Portrait column */}
          <div className="relative mx-auto mb-7 w-full max-w-[320px] lg:mx-0 lg:mb-0">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] bg-gradient-to-br from-berry-subtle via-cream-dark to-gold/30 shadow-[0_30px_60px_-15px_rgba(229,193,233,0.55)] ring-1 ring-berry/5">
              {profile.photo_url ? (
                <Image
                  src={profile.photo_url}
                  alt={profile.display_name ?? ""}
                  fill
                  sizes="(max-width: 1024px) 320px, 320px"
                  unoptimized
                  priority
                  className="object-cover object-[center_25%]"
                />
              ) : (
                <div className="absolute inset-0 flex items-end justify-center pb-6 font-[family-name:var(--font-display)] text-[110px] font-medium leading-none tracking-tight text-berry-dark">
                  {(profile.display_name?.[0] || "?").toUpperCase()}
                </div>
              )}
            </div>
            {/* Verified pill — overhangs the top-right corner */}
            {profile.is_verified && (
              <div
                className="absolute -right-2 -top-2 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-white px-3 py-1.5 shadow-md"
                title={t.detail.verifiedTooltip}
              >
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success text-[10px] font-extrabold text-white">
                  ✓
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-success">
                  Verificata
                </span>
              </div>
            )}
            {/*
              "Online ora" indicator. We don't have a real presence signal
              yet — `accepts_bookings === true` is the closest proxy
              ("this operator can be booked online right now"). When real
              presence lands, swap this condition for the live signal.
            */}
            {therapistAcceptsPayments && (
              <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur-sm">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                <span className="text-[11px] font-semibold text-success">
                  Online ora
                </span>
              </div>
            )}
          </div>

          {/* Content column */}
          <div className="min-w-0">
            {/* Tier badge — icon + chevron pill above the name (Section A of the design system) */}
            {profile.tier && (
              <div className="mb-3 flex items-center gap-2.5">
                <span className="inline-flex flex-shrink-0 rounded-full bg-white p-0.5 shadow-sm ring-1 ring-berry/5">
                  <TierIcon tier={profile.tier} size={38} />
                </span>
                <TierLabel tier={profile.tier} />
              </div>
            )}
            {/* Gold eyebrow — primary category or generic role */}
            <Eyebrow>{roleLabel}</Eyebrow>
            {/* Cormorant 48px display name */}
            <h1 className="mt-2.5 font-[family-name:var(--font-display)] text-[40px] font-medium leading-[1.05] tracking-tight text-charcoal sm:text-5xl">
              {profile.display_name?.trim() || "—"}
            </h1>
            {/* Italic intro tagline */}
            {profile.tagline && (
              <p
                className="mt-3 max-w-2xl font-[family-name:var(--font-display)] text-[19px] italic leading-[1.45] text-berry"
                style={{ fontStyle: "italic" }}
              >
                &ldquo;{profile.tagline}&rdquo;
              </p>
            )}
            {/* City — small, inline */}
            {profile.city && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-charcoal-muted">
                <MapPin className="h-3.5 w-3.5" />
                {profile.city}
              </p>
            )}

            {/*
              4-stat editorial strip. Order: Valutazione · Sessioni ·
              Esperienza · Lingue. Each stat is a Cormorant numeral
              over a 0.16em uppercase label + a small sub-line. Only
              renders when at least two stats have data — for brand-new
              operators a strip full of em-dashes reads worse than the
              "Nuovo operatore" badge below.
            */}
            {(() => {
              const hasRating = (profile.average_rating ?? 0) > 0;
              const hasSessions = completedCount > 0;
              const hasYears = !!profile.years_experience;
              const hasLangs = (profile.languages ?? []).length > 0;
              const visibleCount =
                Number(hasRating) +
                Number(hasSessions) +
                Number(hasYears) +
                Number(hasLangs);
              if (visibleCount < 2) return null;
              return (
                <div className="mt-5 flex flex-wrap items-stretch gap-x-6 gap-y-4 border-t border-berry/10 pt-5">
                  {hasRating && (
                    <Stat
                      value={
                        <>
                          <Star
                            className="inline-block h-4 w-4 translate-y-[-2px] fill-gold text-gold"
                            strokeWidth={0}
                          />{" "}
                          {(profile.average_rating ?? 0).toFixed(1)}
                        </>
                      }
                      label="Valutazione"
                      sub={`${profile.total_reviews ?? 0} ${t.detail.reviews}`}
                    />
                  )}
                  {hasSessions && (
                    <Stat
                      value={completedCount.toLocaleString("it-IT")}
                      label="Sessioni"
                      sub="completate"
                    />
                  )}
                  {hasYears && (
                    <Stat
                      value={`${profile.years_experience}`}
                      label="Esperienza"
                      sub={t.detail.yearsExperience}
                    />
                  )}
                  {hasLangs && (
                    <Stat
                      value={
                        <span className="inline-flex items-baseline gap-1.5">
                          <Globe
                            className="h-4 w-4 translate-y-[1px] text-berry"
                            strokeWidth={1.6}
                          />
                          <span className="text-xl">
                            {(profile.languages ?? []).join(" · ")}
                          </span>
                        </span>
                      }
                      label="Lingue"
                      sub=""
                    />
                  )}
                </div>
              );
            })()}

            {/*
              CTA cluster — replaces the previous single "Prenota da €X"
              pill with the four-action editorial set:
                · Prenota (primary, berry, full pill)
                · Call conoscitiva · gratis (soft pill, only when a
                  free intro call service exists)
                · Messaggio (circular ghost — scrolls to booking for
                  now; real /messages route is V2)
                · Heart (circular ghost — local-only favorite toggle)
              Deliberately NOT showing "Inizia gratis · poi da €X" here.
              That copy was removed in the May 2026 conversion review:
              it double-billed the free intro call (already a separate
              service card in #prenota) and read as marketing noise
              bolted onto the operator's name.
            */}
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <a
                href="#prenota"
                className="inline-flex items-center gap-2 rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark hover:shadow-lg"
              >
                <Calendar className="h-4 w-4" strokeWidth={1.8} />
                Prenota una sessione
              </a>
              {hasFreeIntro && (
                <a
                  href="#prenota"
                  className="inline-flex items-center gap-2 rounded-full bg-berry-subtle/60 px-4 py-2.5 text-sm font-semibold text-berry transition-colors hover:bg-berry-subtle"
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.25} />
                  Call conoscitiva · gratis
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  // TODO(messages): wire to /dashboard/messages once
                  // the in-app DM surface ships. For V1 this acts as
                  // a visual affordance and falls through to booking
                  // (the closest meaningful action right now).
                  if (typeof window !== "undefined") {
                    const el = document.getElementById("prenota");
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-berry/10 bg-white text-berry transition-colors hover:bg-berry-subtle/40"
                aria-label="Invia un messaggio"
              >
                <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => setFavorited((v) => !v)}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors ${
                  favorited
                    ? "border-berry-light/30 bg-berry-light/10 text-berry-light"
                    : "border-berry/10 bg-white text-berry-light hover:bg-berry-subtle/40"
                }`}
                aria-label={favorited ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
                aria-pressed={favorited}
              >
                <Heart
                  className={`h-4 w-4 ${favorited ? "fill-current" : ""}`}
                  strokeWidth={1.8}
                />
              </button>
            </div>

            {/*
              Secondary trust micro-row. The verified + online pills
              already live on the portrait, so this strip carries only
              the non-redundant signals: the "new operator" hook (when
              there's no rating yet) and the platform-standard "annullabile"
              policy chip (V1 policy is global — 48h/100%, 24-48h/50%,
              under 24h/0% — see docs/flows/08-refund-cancellation.md).
              `profile.cancellation_policy` exists in the schema but is
              intentionally not surfaced today: the platform owns the
              policy, not the individual operator.
            */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {(profile.average_rating ?? 0) === 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-berry-subtle/60 px-3 py-1 text-xs font-semibold text-berry-dark">
                  <Star className="h-3.5 w-3.5" />
                  Nuovo operatore
                </span>
              )}
              <a
                href="#cancellation-policy"
                className="inline-flex items-center gap-1.5 rounded-full border border-berry/15 bg-white/70 px-3 py-1 text-xs font-medium text-charcoal-light transition-colors hover:border-berry/30 hover:bg-white"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Annullabile fino a 48h
              </a>
            </div>

            {/* Practice chips */}
            {(profile.categories ?? []).length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {(profile.categories ?? []).map((c) => {
                  const label = PRACTICE_LABELS[c] ?? c;
                  const linkable = c in PRACTICE_LABELS;
                  const cls =
                    "inline-flex items-center rounded-full bg-berry-subtle/70 px-3.5 py-1.5 text-xs font-semibold text-berry transition-all hover:bg-berry-subtle hover:text-berry-darker";
                  return linkable ? (
                    <Link key={c} href={`/dashboard/pratiche/${c}`} className={cls}>
                      {label}
                    </Link>
                  ) : (
                    <span key={c} className={cls}>
                      {label}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Problem-based helps_with — clients think in problems
                ("ho ansia") not methodologies ("ThetaHealing"). */}
            {(profile.helps_with ?? []).length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-charcoal-muted">
                  Posso aiutarti se vivi
                </p>
                <div className="flex flex-wrap gap-2">
                  {(profile.helps_with ?? []).map((h) => (
                    <span
                      key={h}
                      className="inline-flex items-center rounded-full border border-berry/10 bg-white/80 px-3 py-1 text-xs font-medium text-charcoal"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/*
        Two-column body: editorial story + media + reviews + booking on
        the left, sticky sidebar (services / mini-cal / trust) on the
        right. Sidebar is desktop-only; on mobile the sections stack and
        the bottom-fixed CTA bar handles the same conversion job.
      */}
      <div className="mt-12 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-12">

          {/*
            STORY — "Chi sono davvero", three-tab structure.
            Tabs: Formazione (driven by certifications) · Approccio
            (driven by bio, default) · Cosa aspettarti (platform-standard
            copy). See STORY_TAB_LABELS for the rationale on why the
            previously-prototyped fourth "Quando NON sono per te" tab
            was pulled.
          */}
          <section className="animate-reveal" style={{ animationDelay: "40ms" }}>
            <Eyebrow>Conoscimi</Eyebrow>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-charcoal sm:text-[28px]">
              Chi sono{" "}
              <em
                className="font-[family-name:var(--font-display)] italic text-berry"
                style={{ fontStyle: "italic" }}
              >
                davvero
              </em>
              .
            </h2>
            {/* Tab row — horizontal scroll on narrow screens */}
            <div className="mt-5 flex gap-1.5 overflow-x-auto rounded-2xl bg-cream-dark/50 p-1.5 sm:gap-2">
              {STORY_TAB_LABELS.map((label, i) => {
                const active = storyTab === i;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setStoryTab(i as StoryTabIndex)}
                    aria-pressed={active}
                    className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-[12px] font-semibold transition-all sm:text-[13px] ${
                      active
                        ? "bg-berry text-white shadow-sm"
                        : "text-charcoal-light hover:text-charcoal"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* Tab body — min-height keeps the layout stable between tabs */}
            <div className="mt-5 min-h-[140px] text-[15px] leading-[1.75] text-charcoal-light">
              {storyTab === 0 && (
                certifications.length > 0 ? (
                  <ul className="space-y-3">
                    {certifications.map((c) => (
                      <li key={c.id} className="flex items-start gap-3">
                        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gold" />
                        <span>
                          <span className="font-semibold text-charcoal">{c.name}</span>
                          {(c.issuing_organization || c.year_obtained) && (
                            <span className="text-charcoal-muted">
                              {" · "}
                              {c.issuing_organization}
                              {c.issuing_organization && c.year_obtained ? " · " : ""}
                              {c.year_obtained}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-charcoal-muted">
                    Informazioni sulla formazione non ancora condivise da {firstName}.
                  </p>
                )
              )}
              {storyTab === 1 && (
                profile.bio && profile.bio.trim() ? (
                  <p className="whitespace-pre-line">{profile.bio}</p>
                ) : (
                  <p className="text-charcoal-muted">
                    {firstName} non ha ancora condiviso il suo approccio.
                  </p>
                )
              )}
              {storyTab === 2 && (
                <p className="whitespace-pre-line">
                  {hasFreeIntro
                    ? `Una prima call conoscitiva gratuita per capire se siamo in sintonia, senza impegno. `
                    : ""}
                  Le sessioni durano in media 60 minuti e si svolgono online tramite la nostra
                  piattaforma video. Riceverai conferma via email e un promemoria 24 ore prima
                  dell{"’"}appuntamento. Trovi la politica di cancellazione standard di Holistic
                  Unity più in basso.
                </p>
              )}
            </div>
          </section>

          {/*
            GALLERY — unified horizontal scroll of up to 5 media tiles.
            Mix of photos and the video intro. The video tile is wider
            (240px) and carries a circular play overlay + provider chip
            ("YouTube"/"Vimeo") + caption ("Conosci {firstName}"). Photo
            tiles are square-ish (170×200). The whole row scrolls on
            narrow screens; on desktop it usually fits without overflow.
          */}
          {(() => {
            const embed = videoEmbedUrl(profile.video_intro_url);
            const gallery = profile.gallery_image_urls ?? [];
            if (!embed && gallery.length === 0) return null;
            const videoProvider = profile.video_intro_url?.includes("vimeo")
              ? "Vimeo"
              : "YouTube";
            // Photo slot count: design calls for 5 total tiles. If we
            // have a video, leave 4 photo slots; otherwise show up to 5.
            const photoSlots = embed ? 4 : 5;
            return (
              <section className="animate-reveal" style={{ animationDelay: "60ms" }}>
                <Eyebrow>Galleria</Eyebrow>
                <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-charcoal sm:text-[28px]">
                  Foto e video{" "}
                  <em
                    className="font-[family-name:var(--font-display)] italic text-berry"
                    style={{ fontStyle: "italic" }}
                  >
                    dalla mia pratica
                  </em>
                  .
                </h2>
                <div className="mt-5 -mx-5 flex gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
                  {embed && (
                    <button
                      type="button"
                      onClick={() => setVideoOpen(true)}
                      className="group relative h-[200px] w-[240px] flex-shrink-0 overflow-hidden rounded-2xl border border-berry/10 bg-gradient-to-br from-berry-dark via-berry to-berry-light shadow-md transition-all hover:shadow-xl"
                      aria-label={`Riproduci video di presentazione di ${firstName}`}
                    >
                      {videoPoster && (
                        <Image
                          src={videoPoster}
                          alt=""
                          fill
                          sizes="240px"
                          unoptimized
                          className="object-cover"
                        />
                      )}
                      <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/55" />
                      <span className="absolute left-3 top-3 rounded-md bg-white/95 px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-berry">
                        {videoProvider}
                      </span>
                      <span className="absolute left-1/2 top-1/2 flex h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-110">
                        <Play
                          className="ml-1 h-5 w-5 fill-berry text-berry"
                          strokeWidth={0}
                        />
                      </span>
                      <span className="absolute bottom-3 left-3.5 right-3.5 text-left text-xs font-semibold text-white drop-shadow-sm">
                        Conosci {firstName}
                      </span>
                    </button>
                  )}
                  {gallery.slice(0, photoSlots).map((src, i) => (
                    <a
                      key={src}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative h-[200px] w-[170px] flex-shrink-0 overflow-hidden rounded-2xl border border-berry/10 bg-berry-subtle/20"
                    >
                      <Image
                        src={src}
                        alt={`${profile.display_name ?? "Operatore"} — foto ${i + 1}`}
                        fill
                        sizes="170px"
                        unoptimized
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </a>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* REVIEWS */}
          <section className="animate-reveal" style={{ animationDelay: "80ms" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <Eyebrow>Cosa dicono</Eyebrow>
                <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-charcoal sm:text-[28px]">
                  Recensioni{" "}
                  <em
                    className="font-[family-name:var(--font-display)] italic text-berry"
                    style={{ fontStyle: "italic" }}
                  >
                    verificate
                  </em>
                  .
                </h2>
              </div>
              {(profile.total_reviews ?? 0) > 0 && (
                <div className="flex items-baseline gap-2 text-sm text-charcoal-light">
                  <span className="font-[family-name:var(--font-display)] text-2xl font-medium leading-none text-berry">
                    {(profile.average_rating ?? 0).toFixed(1)}
                  </span>
                  <span className="text-charcoal-muted">/ 5</span>
                  <span className="text-charcoal-muted/60">·</span>
                  <span className="text-xs text-charcoal-muted">
                    {profile.total_reviews} recensioni
                  </span>
                </div>
              )}
            </div>
            {reviews.length === 0 ? (
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-dashed border-berry/15 bg-berry-subtle/15 px-5 py-4">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/60">
                  <MessageSquare className="h-4 w-4 text-berry" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-charcoal">
                    Nessuna recensione ancora
                  </p>
                  <p className="mt-0.5 text-xs text-charcoal-muted">
                    Sii il primo a recensire {firstName} dopo la tua sessione.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {reviews.map((r) => (
                  <article
                    key={r.id}
                    className="rounded-2xl border border-berry/10 bg-white/70 p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-berry-subtle/40 text-xs font-semibold text-berry">
                        {r.client_photo_url ? (
                          <Image
                            src={r.client_photo_url}
                            alt=""
                            width={36}
                            height={36}
                            unoptimized
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (r.client_name ?? "?").slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-charcoal">
                            {r.client_name ?? "Cliente"}
                          </span>
                          <span className="text-[11px] text-charcoal-muted">
                            {new Date(r.created_at).toLocaleDateString(locale, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-0.5 text-gold">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`h-3.5 w-3.5 ${
                                i < r.rating ? "fill-current" : "opacity-30"
                              }`}
                              strokeWidth={1.5}
                            />
                          ))}
                        </div>
                        {r.text && (
                          <p
                            className="mt-2 whitespace-pre-line font-[family-name:var(--font-display)] text-base italic leading-relaxed text-charcoal sm:text-[17px]"
                            style={{ fontStyle: "italic" }}
                          >
                            &ldquo;{r.text}&rdquo;
                          </p>
                        )}
                        {r.therapist_reply && (
                          <div className="mt-3 rounded-xl border-l-2 border-berry/40 bg-berry-subtle/20 px-3 py-2 text-xs text-charcoal">
                            <p className="font-semibold text-berry-dark">
                              Risposta di {firstName}
                            </p>
                            <p className="mt-1 whitespace-pre-line">
                              {r.therapist_reply}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/*
            CREDENZIALI — credentials with a green check icon on each
            card, signalling "verified by us". The check replaces the
            previous neutral Award icon to match the editorial reference.
          */}
          {certifications.length > 0 && (
            <section className="animate-reveal" style={{ animationDelay: "100ms" }}>
              <Eyebrow>Credenziali</Eyebrow>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-charcoal sm:text-[28px]">
                Verificate{" "}
                <em
                  className="font-[family-name:var(--font-display)] italic text-berry"
                  style={{ fontStyle: "italic" }}
                >
                  da noi
                </em>
                .
              </h2>
              <div className="mt-5 space-y-2">
                {certifications.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 rounded-2xl border border-berry/10 bg-white/60 px-4 py-3"
                  >
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-success/15">
                      <Check className="h-4 w-4 text-success" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-charcoal">{c.name}</p>
                      {(c.issuing_organization || c.year_obtained) && (
                        <p className="mt-0.5 text-xs text-charcoal-muted">
                          {c.issuing_organization}
                          {c.issuing_organization && c.year_obtained ? " · " : ""}
                          {c.year_obtained
                            ? `ottenuta ${c.year_obtained}`
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* PRENOTA — service picker (full inline list) */}
          <section
            id="prenota"
            className="animate-reveal scroll-mt-6 space-y-4"
            style={{ animationDelay: "120ms" }}
          >
            <div>
              <Eyebrow>Prenota</Eyebrow>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-medium leading-tight tracking-tight text-charcoal sm:text-[28px]">
                Scegli il{" "}
                <em
                  className="font-[family-name:var(--font-display)] italic text-berry"
                  style={{ fontStyle: "italic" }}
                >
                  tuo momento
                </em>
                .
              </h2>
              <p className="mt-1 text-sm text-charcoal-muted">
                {t.detail.pickService}
              </p>
            </div>

            {!therapistAcceptsPayments && (
              <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning-light/50 p-3 text-xs text-charcoal-light">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
                <span>{t.detail.paymentsUnavailable}</span>
              </div>
            )}

            <div className="space-y-2">
              {services.length === 0 ? (
                <div className="rounded-2xl border border-berry/5 bg-white/60 p-6 text-center text-sm text-charcoal-muted">
                  {t.detail.noServices}
                </div>
              ) : (
                services.map((svc) => {
                  const isSelected = selectedService?.id === svc.id;
                  const disabled = !therapistAcceptsPayments && svc.price > 0;
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setSelectedService(svc);
                        setSelectedSlot(null);
                        setError("");
                        setNeedsHealthConsent(false);
                      }}
                      className={`group block w-full rounded-2xl border p-4 text-left transition-all ${
                        isSelected
                          ? "border-berry bg-white shadow-md shadow-berry/10"
                          : "border-berry/10 bg-white/80 hover:-translate-y-0.5 hover:border-berry/30 hover:shadow-md hover:shadow-berry/5"
                      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-charcoal">
                              {svc.name}
                            </p>
                            {svc.is_intro_call && (
                              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">
                                {t.detail.introCall}
                              </span>
                            )}
                          </div>
                          {svc.description && (
                            <p className="mt-1.5 text-sm leading-snug text-charcoal-muted">
                              {svc.description}
                            </p>
                          )}
                          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-charcoal-muted">
                            <Clock className="h-3 w-3" />
                            {svc.duration} {t.detail.minutesShort}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-berry-dark">
                            {svc.price === 0
                              ? t.detail.free
                              : `${currSymbol}${svc.price.toFixed(2)}`}
                          </p>
                          <ChevronRight
                            className={`h-4 w-4 text-charcoal-muted transition-transform ${
                              isSelected ? "rotate-90 text-berry" : "group-hover:translate-x-0.5"
                            }`}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Slot picker — appears once a service is selected */}
          {selectedService && (
            <div className="animate-reveal rounded-2xl border border-berry/10 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-berry-dark font-semibold">
                  {t.detail.bookingFor}
                </p>
                <p className="font-[family-name:var(--font-display)] text-base font-bold text-charcoal">
                  {selectedService.name}
                  <span className="ml-2 text-sm font-medium text-charcoal-muted">
                    · {selectedService.duration} {t.detail.minutesShort}
                  </span>
                </p>
              </div>

              <SlotPicker
                availability={profile.availability}
                bookings={bookings}
                durationMinutes={selectedService.duration}
                onSelect={(slot) => {
                  setSelectedSlot(slot);
                  setError("");
                  setNeedsHealthConsent(false);
                }}
                selected={selectedSlot}
                labels={{
                  selectDay: t.detail.selectDay,
                  selectTime: t.detail.selectTime,
                  noSlots: t.detail.noSlots,
                  noSlotsHelp: t.detail.noSlotsHelp,
                  weekdayShort,
                }}
              />

              {selectedSlot && (
                <div className="mt-5 rounded-2xl border border-berry/10 bg-cream-dark/30 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <p className="text-xs text-charcoal-muted">{t.detail.summary}</p>
                      <p className="mt-0.5 text-sm font-semibold text-charcoal">
                        {selectedSlot.toLocaleDateString("it-IT", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}{" "}
                        {t.detail.at}{" "}
                        {selectedSlot.toLocaleTimeString("it-IT", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-charcoal-muted">{t.detail.totalToPay}</p>
                      <p className="font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
                        {selectedService.price === 0
                          ? t.detail.free
                          : `${currSymbol}${(totalChargedCents / 100).toFixed(2)}`}
                      </p>
                      {selectedService.price > 0 && totalChargedCents !== Math.round(selectedService.price * 100) && (
                        <p className="text-[10px] text-charcoal-muted">{t.detail.includesFees}</p>
                      )}
                    </div>
                  </div>

                  {error && (
                    <div className="mt-3 rounded-xl border border-error/30 bg-error/10 p-3 text-xs text-error">
                      <p>{error}</p>
                      {needsHealthConsent && (
                        <Link
                          href="/accept-terms"
                          className="mt-2 inline-flex font-semibold underline underline-offset-2"
                        >
                          Aggiorna il consenso e continua
                        </Link>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={startCheckout}
                    disabled={submitting}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-berry px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark hover:shadow-xl disabled:opacity-50"
                  >
                    {submitting ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                    {selectedService.price === 0 ? t.detail.confirmFree : t.detail.payAndConfirm}
                  </button>
                </div>
              )}
            </div>
          )}

          {/*
            Platform-standard cancellation policy. Same for every
            operator on Holistic Unity (V1 is global, three-tier — see
            docs/flows/08-refund-cancellation.md). `id` is the scroll
            target for the hero "Annullabile fino a 48h" chip and the
            sidebar "Vedi politica di cancellazione" link; `scroll-mt-6`
            leaves headroom under the sticky page header when the anchor
            jump lands here.
          */}
          <div
            id="cancellation-policy"
            className="scroll-mt-6 rounded-2xl border border-berry/5 bg-cream-dark/30 p-4 text-xs text-charcoal-muted"
          >
            <p className="font-semibold text-charcoal-light">{t.detail.cancellationPolicy}</p>
            <ul className="mt-2 space-y-1">
              <li>· Almeno 48h prima della sessione: rimborso completo</li>
              <li>· Tra 24h e 48h prima: rimborso del 50%</li>
              <li>· Meno di 24h prima: nessun rimborso (il tempo resta riservato a te)</li>
            </ul>
            <p className="mt-2 italic">
              Le cancellazioni decise dall{"’"}operatore prevedono sempre il rimborso completo.
            </p>
          </div>
        </div>

        {/*
          STICKY SIDEBAR — desktop only.
          Three blocks:
            1. Services list (vertical), with the detected "pacchetto"
               highlighted gold ("Pacchetto risparmio" label).
            2. Mini-availability strip — 4 day-pills (Oggi / Domani /
               +2 / +3) that scroll to the in-page picker. We don't
               compute actual slot times here; the real picker handles
               that once the visitor commits to a service.
            3. Trust signal — secure booking reassurance.
          On mobile the sticky bottom CTA (below) carries the same
          conversion job in a screen-friendlier form.
        */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            {/* 1. Services list */}
            <div className="overflow-hidden rounded-2xl border border-berry/10 bg-white/90 shadow-md backdrop-blur-sm">
              <div className="px-5 pt-5">
                <Eyebrow>Sessioni</Eyebrow>
                <h3 className="mt-1.5 font-[family-name:var(--font-display)] text-xl font-medium tracking-tight text-charcoal">
                  Servizi e{" "}
                  <em
                    className="font-[family-name:var(--font-display)] italic text-berry"
                    style={{ fontStyle: "italic" }}
                  >
                    prezzi
                  </em>
                  .
                </h3>
              </div>
              <div className="space-y-2.5 px-3.5 pb-3.5 pt-3">
                {services.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-charcoal-muted">
                    {t.detail.noServices}
                  </p>
                ) : (
                  services.map((svc) => {
                    const isSelected = selectedService?.id === svc.id;
                    const disabled = !therapistAcceptsPayments && svc.price > 0;
                    const isPack = packageService?.id === svc.id;
                    return (
                      <button
                        key={svc.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setSelectedService(svc);
                          setSelectedSlot(null);
                          setError("");
                          setNeedsHealthConsent(false);
                          if (typeof window !== "undefined") {
                            const el = document.getElementById("prenota");
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }}
                        className={`relative block w-full rounded-xl border p-3 text-left transition-all ${
                          isPack
                            ? "border-gold/40 bg-gradient-to-br from-cream-dark/50 to-berry-subtle/20"
                            : isSelected
                            ? "border-berry bg-berry-subtle/30"
                            : "border-berry/10 bg-white hover:border-berry/30 hover:bg-berry-subtle/20"
                        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        {isPack && (
                          <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.15em] text-gold-dark">
                            · Pacchetto risparmio
                          </p>
                        )}
                        <p className="text-[13px] font-semibold leading-snug text-charcoal">
                          {svc.name}
                        </p>
                        <p className="mt-1 text-[11px] text-charcoal-muted">
                          {svc.duration} min · Online
                        </p>
                        <div className="mt-2.5 flex items-baseline justify-between gap-2">
                          <span className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-berry">
                            {svc.price === 0
                              ? t.detail.free
                              : `${currSymbol}${svc.price.toFixed(0)}`}
                          </span>
                          {svc.is_intro_call && svc.price === 0 ? (
                            <span className="rounded-full bg-success/15 px-2 py-0.5 text-[9px] font-bold uppercase text-success">
                              Gratis
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-berry">
                              Prenota →
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2. Mini-availability */}
            <div className="rounded-2xl border border-berry/10 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
              <Eyebrow>Disponibilità</Eyebrow>
              <h3 className="mt-1.5 font-[family-name:var(--font-display)] text-lg font-medium tracking-tight text-charcoal">
                Prossimi{" "}
                <em
                  className="font-[family-name:var(--font-display)] italic text-berry"
                  style={{ fontStyle: "italic" }}
                >
                  orari liberi
                </em>
                .
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((offset) => {
                  const d = new Date();
                  d.setDate(d.getDate() + offset);
                  const label =
                    offset === 0
                      ? "Oggi"
                      : offset === 1
                      ? "Domani"
                      : d.toLocaleDateString("it-IT", {
                          weekday: "short",
                          day: "numeric",
                        });
                  return (
                    <a
                      key={offset}
                      href="#prenota"
                      className="rounded-xl border border-berry/10 bg-cream-dark/30 px-3 py-2 text-center text-[12px] font-semibold text-charcoal transition-all hover:border-berry/30 hover:bg-berry-subtle/30"
                    >
                      {label}
                    </a>
                  );
                })}
              </div>
              <a
                href="#prenota"
                className="mt-3 block rounded-xl border border-berry/20 bg-white py-2 text-center text-[12px] font-semibold text-berry transition-colors hover:bg-berry-subtle/30"
              >
                Vedi tutta la disponibilità →
              </a>
            </div>

            {/* 3. Trust signal */}
            <div className="rounded-2xl border border-gold/25 bg-cream-dark/60 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-success text-white shadow-sm">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold text-charcoal">
                    Prenotazione sicura
                  </p>
                  <p className="mt-1 text-[11.5px] leading-[1.55] text-charcoal-light">
                    {hasFreeIntro ? "Conoscitiva gratuita, " : ""}
                    ripianifichi fino a 48h prima, IVA inclusa. Pagamento sicuro via Stripe.
                  </p>
                  <a
                    href="#cancellation-policy"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-berry underline-offset-2 hover:underline"
                  >
                    <RefreshCcw className="h-3 w-3" />
                    Vedi politica di cancellazione
                  </a>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Sticky bottom CTA — mobile only. Two modes:
          1. No slot selected → anchor link that scrolls to #prenota.
          2. Slot selected → live "Paga e conferma" / "Conferma" button
             that triggers startCheckout directly. The desktop sidebar
             always has its own CTAs, but on mobile the booking widget
             scrolls below the fold once the user has picked a slot —
             without this sticky CTA they had to scroll back up to commit. */}
      {therapistAcceptsPayments && services.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-berry/10 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(123,34,82,0.15)] backdrop-blur lg:hidden">
          {selectedSlot && selectedService ? (
            <button
              type="button"
              onClick={startCheckout}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-berry px-5 py-3 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark disabled:opacity-60"
            >
              <CreditCard className="h-4 w-4" />
              {selectedService.price === 0
                ? t.detail.confirmFree
                : t.detail.payAndConfirm}
            </button>
          ) : (
            <a
              href="#prenota"
              className="flex w-full items-center justify-center gap-2 rounded-full bg-berry px-5 py-3 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark"
            >
              <CreditCard className="h-4 w-4" />
              {hasFreeIntro
                ? "Prenota la conoscitiva gratuita"
                : minPaidPrice !== null
                ? `Prenota da ${currSymbol}${minPaidPrice.toFixed(2)}`
                : "Vedi disponibilità"}
            </a>
          )}
        </div>
      )}

      {/* Video modal. Stays mounted only when open (`videoOpen`) so the
          iframe doesn't autoplay/preload audio on page load. The aspect
          box uses `aspect-[9/16]` on small screens and `aspect-video`
          on lg+ — handles both portrait phone recordings and
          horizontal webcam clips without letterboxing one or the other. */}
      {videoOpen && (() => {
        const embed = videoEmbedUrl(profile.video_intro_url);
        if (!embed) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/70 p-4 backdrop-blur-sm"
            onClick={() => setVideoOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setVideoOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Video di presentazione"
          >
            <div
              className="relative w-full max-w-md overflow-hidden rounded-2xl bg-black shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setVideoOpen(false)}
                ref={(el) => { if (el) el.focus(); }}
                className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-charcoal shadow-md transition-all hover:bg-white focus:outline-none focus:ring-2 focus:ring-berry focus:ring-offset-2"
                aria-label="Chiudi video"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="aspect-[9/16] w-full sm:aspect-video">
                <iframe
                  src={`${embed}${embed.includes("?") ? "&" : "?"}autoplay=1`}
                  title={`${profile.display_name ?? "Operatore"} — Video di presentazione`}
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Editorial KPI block. Big Cormorant numeral on top (or whatever ReactNode
 * the caller passes — lets us inline a star icon next to the rating
 * value, or a Globe icon next to languages), an ALL-CAPS uppercase
 * label in 0.16em tracking below, and an optional sub-line. Each block
 * separates itself from its siblings via the parent's `gap-x-6` flex
 * spacing — kept local to this file because it's only used here.
 */
function Stat({
  value,
  label,
  sub,
}: {
  value: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center">
      <div className="font-[family-name:var(--font-display)] text-2xl font-medium leading-none tracking-tight text-berry">
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-charcoal-muted">
        {label}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-charcoal-light">{sub}</div>
      )}
    </div>
  );
}
