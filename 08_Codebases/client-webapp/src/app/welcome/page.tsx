"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  ONBOARDING_STEPS,
  recommendPractices,
  type AnswerSet,
} from "@/lib/onboarding/steps";
import {
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Star,
  ShieldCheck,
  KeyRound,
  Loader2,
} from "lucide-react";

const TOTAL_STEPS = ONBOARDING_STEPS.length;
const LS_KEY = "hu-onboarding-draft";
// Markers for registration conversion events so each provider fires exactly
// once per registered user. The legacy key is kept as a migration guard for
// users who already hit /welcome before the provider-specific markers existed.
const LEGACY_SIGNUP_EVENT_KEY = "hu-signup-event-fired";
const GA_SIGNUP_EVENT_KEY = "hu-ga-signup-event-fired";
const META_SIGNUP_EVENT_KEY = "hu-meta-complete-registration-fired";

type RecommendedTherapist = {
  id: string;
  display_name: string | null;
  tagline: string | null;
  photo_url: string | null;
  city: string | null;
  average_rating: number | null;
  total_reviews: number | null;
  is_verified: boolean | null;
  has_mfa: boolean | null;
  categories: string[] | null;
};

export default function WelcomePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<AnswerSet>({});
  const [submitting, setSubmitting] = useState(false);
  const [matchedTherapists, setMatchedTherapists] = useState<RecommendedTherapist[]>([]);
  const [matchedPractices, setMatchedPractices] = useState<{ slug: string; title: string; tagline: string }[]>([]);
  const [matchmakingLoading, setMatchmakingLoading] = useState(false);
  // Anonymous research consent — opt-in toggle that surfaces only on
  // the summary screen. Default false; user must positively check it.
  // Stored alongside the rest of client_preferences when they submit.
  const [researchConsent, setResearchConsent] = useState(false);

  // Promote tos_pending_* fields stamped at /register into a durable row in
  // tos_acceptances. This runs once after email confirmation lands here, so
  // the consumer's onerous-clause approval (art. 1341 c.c.) is captured with
  // server-side IP/UA before they reach any contractual feature (booking).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled || !user) return;
        const md = user.user_metadata as Record<string, unknown> | null;
        if (!md?.tos_pending_version) return; // already promoted (or therapist flow)

        const role = md.role === "therapist" ? "therapist" : "client";
        const res = await fetch("/api/tos/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            general: !!md.tos_pending_general,
            vessatorie: !!md.tos_pending_vessatorie,
            privacy: !!md.tos_pending_privacy,
            health_data: !!md.tos_pending_health_data,
          }),
        });
        if (!res.ok) return;

        // Clear the pending markers so the promotion only runs once. Failure
        // here is non-fatal — the row is already written, the markers are
        // just cosmetic at this point.
        await supabase.auth.updateUser({
          data: {
            tos_pending_version: null,
            tos_pending_general: null,
            tos_pending_vessatorie: null,
            tos_pending_privacy: null,
            tos_pending_health_data: null,
            tos_pending_accepted_at: null,
          },
        });
      } catch { /* swallow — analytics-style "must never block UX" */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Restore in-progress answers from localStorage so refresh doesn't lose work.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data?.answers) setAnswers(data.answers);
        if (typeof data?.step === "number") setCurrentStep(Math.min(data.step, TOTAL_STEPS - 1));
      }
    } catch { /* ignore */ }
  }, []);

  // Fire the Google Ads `sign_up` conversion with Enhanced Conversions data.
  // The Search campaign's bid strategy optimises on this event, so accurate
  // first-party signal here is what makes the €400 credit produce real
  // signups instead of junk clicks.
  //
  // Why on /welcome (not /register's submit handler):
  //   /welcome is reached only after Supabase email-verification redirect,
  //   so it filters out fake/typo emails — the conversion is a *confirmed*
  //   account, not a typed-in form. This matches the URL we configured in
  //   Google Ads ("URL contains app.holisticunity.app/welcome").
  //
  // Why send raw email/phone (not pre-hashed):
  //   gtag.js v2 hashes (SHA-256, normalised) automatically client-side
  //   before transmission. Sending raw is the documented pattern and
  //   avoids hash-mismatch bugs.
  //
  // The localStorage marker is cleared if the user logs out and a different
  // user signs in (the `userId` check below is keyed on Supabase user.id).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled || !user) return;

        const legacyMarker = localStorage.getItem(LEGACY_SIGNUP_EVENT_KEY);
        const gaMarker = localStorage.getItem(GA_SIGNUP_EVENT_KEY);
        const metaMarker = localStorage.getItem(META_SIGNUP_EVENT_KEY);
        const legacyAlreadyFired = legacyMarker === user.id;

        const enhancedData: { email_address?: string; phone_number?: string } = {};
        if (user.email) enhancedData.email_address = user.email;
        if (user.phone) enhancedData.phone_number = user.phone;

        // Fire the Meta CompleteRegistration event for ad attribution.
        // /register itself only fires this when Supabase returns an
        // immediate session (email-confirmation OFF). When email
        // confirmation is ON in production — which it is — /register
        // never fires it, and we'd previously leave Meta with only
        // `Lead` events from the form-submit path. Firing here on
        // /welcome (which is reached only AFTER email-verification
        // redirect) gives Meta the verified-account signal it needs
        // for campaign optimization. Keep a provider-specific marker so a
        // blocked/late GA script cannot make Meta re-fire on every revisit.
        if (!legacyAlreadyFired && metaMarker !== user.id) {
          try {
            const { trackCompleteRegistration } = await import(
              "@/lib/analytics/meta-pixel"
            );
            const didFireMeta = trackCompleteRegistration({
              content_name: "client_register",
              status: true,
            });
            if (didFireMeta) localStorage.setItem(META_SIGNUP_EVENT_KEY, user.id);
          } catch { /* meta-pixel module / consent gating may noop */ }
        }

        // gtag may not exist if the GA component hasn't mounted yet;
        // queue it on the next tick so the bootstrap has time to run.
        const fire = () => {
          if (legacyAlreadyFired || gaMarker === user.id) return true;
          if (typeof window.gtag !== "function") return false;
          window.gtag("set", "user_data", enhancedData);
          window.gtag("event", "sign_up", {
            method: "email",
            send_to: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
          });
          localStorage.setItem(GA_SIGNUP_EVENT_KEY, user.id);
          localStorage.setItem(LEGACY_SIGNUP_EVENT_KEY, user.id);
          return true;
        };
        if (!fire()) {
          // Retry briefly until gtag.js finishes loading
          const t = setInterval(() => {
            if (fire()) clearInterval(t);
          }, 250);
          // Stop polling after 5s so we don't leak the interval
          setTimeout(() => clearInterval(t), 5000);
        }
      } catch {
        /* ignore — analytics must never break the page */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist progress on every change so refresh / accidental close survives.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ answers, step: currentStep }));
    } catch { /* ignore */ }
  }, [answers, currentStep]);

  const step = ONBOARDING_STEPS[currentStep];
  const isLast = currentStep === TOTAL_STEPS - 1;
  const progressPct = ((currentStep + 1) / TOTAL_STEPS) * 100;

  const isStepValid = (() => {
    if (step.optional) return true;
    if (step.id === "summary") return true;
    if (step.type === "single") return Boolean(answers[step.id as keyof AnswerSet]);
    if (step.type === "multi") {
      const v = answers[step.id as keyof AnswerSet] as string[] | undefined;
      return Boolean(v && v.length >= (step.minSelections ?? 1));
    }
    if (step.type === "text") return true; // notes is optional
    return true;
  })();

  function setSingle(value: string) {
    setAnswers((prev) => ({ ...prev, [step.id]: value }));
  }

  function toggleMulti(value: string) {
    setAnswers((prev) => {
      const key = step.id as keyof AnswerSet;
      const current = (prev[key] as string[] | undefined) ?? [];
      // "none" sentinel deselects everything else when toggled on
      let next: string[];
      if (value === "none") {
        next = current.includes("none") ? [] : ["none"];
      } else {
        next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current.filter((v) => v !== "none"), value];
      }
      return { ...prev, [key]: next };
    });
  }

  function setText(value: string) {
    setAnswers((prev) => ({ ...prev, notes: value.slice(0, 500) }));
  }

  async function next() {
    if (!isStepValid) return;
    if (isLast) {
      await submit();
      return;
    }
    // If we're entering the summary (last) step, fetch matchmaking now
    if (currentStep === TOTAL_STEPS - 2) {
      void loadMatchmaking();
    }
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    // scroll to top on step change
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function prev() {
    setCurrentStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadMatchmaking() {
    setMatchmakingLoading(true);
    try {
      const supabase = createClient();
      const recommendedKeys = recommendPractices(answers, 3);

      // Pull practice cards for the recommended keys
      if (recommendedKeys.length > 0) {
        const { data: practicesData } = await supabase
          .from("practices")
          .select("slug, title, tagline, category_key")
          .in("category_key", recommendedKeys)
          .eq("is_published", true);
        // Sort to match the recommendedKeys order
        const sorted = recommendedKeys
          .map((k) => practicesData?.find((p) => p.category_key === k))
          .filter(Boolean) as { slug: string; title: string; tagline: string; category_key: string }[];
        setMatchedPractices(sorted);
      } else {
        setMatchedPractices([]);
      }

      // Pull bookable therapists offering any of those practices.
      //
      // IMPORTANT — `practices.category_key` is PascalCase / Italian
      // ("ThetaHealing", "Costellazioni Familiari", ...) while
      // `therapist_profiles_public.categories[]` is kebab-case
      // ("theta-healing", "costellazioni-familiari"). Both schemas
      // share the same conceptual taxonomy but they were never
      // aligned at the column level. Convert here so the overlap
      // query actually returns matches (until 2026-05-16 this was
      // silently returning an empty array on every onboarding).
      const therapistKeys = recommendedKeys.map(
        (k) => k.toLowerCase().replace(/ /g, "-"),
      );
      if (recommendedKeys.length > 0) {
        // Public VIEW already bakes in approval + Stripe-active filters.
        const { data: therapistsData } = await supabase
          .from("therapist_profiles_public")
          .select(
            "id, display_name, tagline, photo_url, city, average_rating, total_reviews, is_verified, has_mfa, categories",
          )
          .overlaps("categories", therapistKeys)
          .order("average_rating", { ascending: false, nullsFirst: false })
          .limit(3);
        setMatchedTherapists((therapistsData as RecommendedTherapist[]) ?? []);
      }
    } finally {
      setMatchmakingLoading(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const nowIso = new Date().toISOString();
      await supabase.from("client_preferences").upsert(
        {
          user_id: user.id,
          intent: answers.intent ?? null,
          focus_areas: answers.focus_areas ?? [],
          familiar_practices: answers.familiar_practices ?? [],
          approaches: answers.approaches ?? [],
          timing: answers.timing ?? null,
          // Three new psychographic fields. cosmic_marker is allowed
          // to be null (it's the only optional question with no
          // sentinel value). The others always have a value because
          // each step has a "non saprei" / "nessuna" sentinel.
          life_season: answers.life_season ?? null,
          current_practices: answers.current_practices ?? [],
          cosmic_marker: answers.cosmic_marker && answers.cosmic_marker !== "unknown"
            ? answers.cosmic_marker
            : null,
          notes: answers.notes ?? null,
          // GDPR audit trail: store the timestamp only when consent
          // is actually granted, so the row carries a verifiable
          // moment of opt-in (Art. 7(1)).
          research_consent: researchConsent,
          research_consent_at: researchConsent ? nowIso : null,
          completed_at: nowIso,
        },
        { onConflict: "user_id" },
      );
      try { localStorage.removeItem(LS_KEY); } catch {}
      router.push("/dashboard");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 lg:px-8 lg:py-10">
      {/* Header: logo + progress */}
      <header>
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Holistic Unity" width={36} height={36} className="rounded-xl" />
            <span className="font-[family-name:var(--font-display)] text-base font-bold text-charcoal">
              Holistic Unity
            </span>
          </Link>
          <span className="text-xs font-medium text-charcoal-muted">
            {Math.min(currentStep + 1, TOTAL_STEPS)} di {TOTAL_STEPS}
          </span>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-berry to-gold transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {/* Step body */}
      <main className="flex flex-1 flex-col py-10 lg:py-14">
        {step.id === "summary" ? (
          <SummaryStep
            answers={answers}
            practices={matchedPractices}
            therapists={matchedTherapists}
            loading={matchmakingLoading}
            researchConsent={researchConsent}
            onResearchConsentChange={setResearchConsent}
            onEdit={() => setCurrentStep(0)}
          />
        ) : (
          <StepRenderer
            stepIndex={currentStep}
            answers={answers}
            onSelectSingle={setSingle}
            onToggleMulti={toggleMulti}
            onSetText={setText}
          />
        )}
      </main>

      {/* Footer nav */}
      <footer className="sticky bottom-0 -mx-4 border-t border-berry/5 bg-white/80 px-4 py-4 backdrop-blur-md lg:-mx-8 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={prev}
            disabled={currentStep === 0}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-charcoal-muted transition-all hover:bg-charcoal/5 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
            Indietro
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!isStepValid || submitting}
            className="flex items-center gap-1.5 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvo...
              </>
            ) : isLast ? (
              <>
                Inizia il tuo percorso
                <Sparkles className="h-4 w-4" />
              </>
            ) : (
              <>
                Avanti
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ─── Step renderer ───────────────────────────────────────── */

function StepRenderer({
  stepIndex,
  answers,
  onSelectSingle,
  onToggleMulti,
  onSetText,
}: {
  stepIndex: number;
  answers: AnswerSet;
  onSelectSingle: (v: string) => void;
  onToggleMulti: (v: string) => void;
  onSetText: (v: string) => void;
}) {
  const step = ONBOARDING_STEPS[stepIndex];
  const copy = COPY[step.i18nKey] ?? { question: "", subtitle: "" };

  return (
    <div key={step.id} className="grid grid-cols-1 gap-8 animate-reveal lg:grid-cols-[1fr_1.2fr] lg:gap-12">
      {/* Hero column (left on desktop, top on mobile) */}
      <div className="order-2 flex flex-col justify-center lg:order-1">
        <Hero step={step} />
      </div>

      {/* Question column */}
      <div className="order-1 flex flex-col justify-center lg:order-2">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-charcoal lg:text-4xl">
          {copy.question}
        </h1>
        {copy.subtitle && (
          <p className="mt-2 text-sm text-charcoal-light lg:text-base">{copy.subtitle}</p>
        )}

        {/* Answers */}
        <div className="mt-6 space-y-2.5">
          {step.type === "single" && step.options?.map((opt) => {
            const value = answers[step.id as keyof AnswerSet];
            const selected = value === opt.value;
            return (
              <OptionCard
                key={opt.value}
                label={opt.label}
                description={opt.description}
                selected={selected}
                onClick={() => onSelectSingle(opt.value)}
              />
            );
          })}

          {step.type === "multi" && step.options?.map((opt) => {
            const arr = (answers[step.id as keyof AnswerSet] as string[] | undefined) ?? [];
            const selected = arr.includes(opt.value);
            return (
              <OptionCard
                key={opt.value}
                label={opt.label}
                description={opt.description}
                selected={selected}
                multi
                onClick={() => onToggleMulti(opt.value)}
              />
            );
          })}

          {step.type === "text" && (
            <div>
              <textarea
                value={answers.notes ?? ""}
                onChange={(e) => onSetText(e.target.value)}
                placeholder="Es. Ho gi\u00e0 fatto delle sessioni in passato, oppure preferisco un orario serale, oppure..."
                rows={5}
                className="w-full resize-none rounded-2xl border border-berry-subtle bg-white/80 p-4 text-sm text-charcoal placeholder-charcoal-muted/50 outline-none transition-all focus:border-berry focus:ring-2 focus:ring-berry/10"
              />
              <p className="mt-2 text-right text-xs text-charcoal-muted">
                {(answers.notes ?? "").length}/500 · Opzionale
              </p>
            </div>
          )}
        </div>

        {step.type === "multi" && (
          <p className="mt-3 text-xs text-charcoal-muted">
            Puoi selezionare più di una risposta
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Hero component ──────────────────────────────────────── */

function Hero({ step }: { step: { id: string; heroSrc?: string } }) {
  // Distinct soft palette per step so even with placeholder gradients
  // each step feels visually different.
  const palettes: Record<string, [string, string]> = {
    intent:             ["#F8EBD9", "#E8C8D4"],
    focus_areas:        ["#FDF6F0", "#D9C9A8"],
    familiar_practices: ["#F0DFE5", "#D4BC8E"],
    approaches:         ["#E8DCC9", "#C9A96E"],
    timing:             ["#FCEDDF", "#E5C4B0"],
    notes:              ["#F3E8DA", "#D6BFAC"],
    summary:            ["#E5D4DC", "#C9A96E"],
  };
  const [c1, c2] = palettes[step.id] ?? ["#FDF6F0", "#F0DFE5"];

  return (
    <div
      className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl shadow-xl shadow-berry/10"
      style={{ background: `linear-gradient(160deg, ${c1} 0%, ${c2} 100%)` }}
    >
      {step.heroSrc && (
        <Image
          src={step.heroSrc}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
          onError={(e) => {
            // hide broken image so we fall back to the gradient
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {/* Decorative orbs always visible (over the image too, gives signature look) */}
      <div className="pointer-events-none absolute -top-20 -right-12 h-56 w-56 rounded-full opacity-30 blur-2xl"
        style={{ background: `radial-gradient(circle, ${c2} 0%, transparent 70%)` }} />
      <div className="pointer-events-none absolute -bottom-16 -left-12 h-48 w-48 rounded-full opacity-30 blur-2xl"
        style={{ background: `radial-gradient(circle, ${c1} 0%, transparent 70%)` }} />
      {/* Subtle grain */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />
    </div>
  );
}

/* ─── Option card ─────────────────────────────────────────── */

function OptionCard({
  label,
  description,
  selected,
  multi,
  onClick,
}: {
  label: string;
  description?: string;
  selected: boolean;
  multi?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-2xl border-2 px-5 py-4 text-left transition-all duration-200 ${
        selected
          ? "border-berry bg-berry/5 shadow-md shadow-berry/10"
          : "border-berry/10 bg-white/80 hover:border-berry/30 hover:bg-white hover:-translate-y-0.5 hover:shadow-md hover:shadow-berry/5"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center transition-all ${
            multi ? "rounded-md" : "rounded-full"
          } ${selected ? "border-berry bg-berry" : "border-2 border-berry/30 bg-white"}`}
        >
          {selected && (
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-medium ${selected ? "text-charcoal" : "text-charcoal-light"}`}>{label}</p>
          {description && (
            <p className="mt-0.5 text-xs text-charcoal-muted">{description}</p>
          )}
        </div>
      </div>
    </button>
  );
}

/* ─── Summary screen (last step) ──────────────────────────── */

function SummaryStep({
  answers,
  practices,
  therapists,
  loading,
  researchConsent,
  onResearchConsentChange,
  onEdit,
}: {
  answers: AnswerSet;
  practices: { slug: string; title: string; tagline: string }[];
  therapists: RecommendedTherapist[];
  loading: boolean;
  researchConsent: boolean;
  onResearchConsentChange: (next: boolean) => void;
  onEdit: () => void;
}) {
  void answers; // keeping for future personalization in copy
  return (
    <div className="animate-reveal space-y-8">
      <div className="text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-berry-subtle/60 px-4 py-1.5 text-xs font-semibold text-berry-dark">
          <Sparkles className="h-3.5 w-3.5" />
          Il tuo percorso personalizzato
        </div>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-charcoal lg:text-4xl">
          Abbiamo qualche idea per te
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-charcoal-light lg:text-base">
          In base a quello che ci hai raccontato, queste pratiche e questi professionisti potrebbero risuonare con te.
          Esplora con calma, niente fretta.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-berry" />
        </div>
      ) : (
        <>
          {/* Practices */}
          {practices.length > 0 && (
            <section>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-charcoal-muted">
                Pratiche consigliate
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {practices.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/dashboard/pratiche/${p.slug}`}
                    className="group rounded-2xl border border-berry/10 bg-white/80 p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-berry-subtle to-gold/15 text-berry-dark">
                      <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                    </div>
                    <p className="mt-3 font-[family-name:var(--font-display)] text-base font-bold text-charcoal">
                      {p.title}
                    </p>
                    <p className="mt-1 text-xs text-charcoal-muted line-clamp-2">{p.tagline}</p>
                    <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-berry">
                      Scopri di più <ChevronRight className="h-3 w-3" />
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Therapists — show suggested operators when matched, else show
              an explicit waiting-list message instead of silently hiding the
              section (otherwise users wonder why only practices appeared) */}
          {therapists.length === 0 && practices.length > 0 && (
            <section>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-charcoal-muted">
                Professionisti olistici per te
              </h2>
              <div className="rounded-2xl border border-berry/10 bg-white/60 p-6 text-center">
                <p className="text-sm text-charcoal-light">
                  Stiamo onboardando nuovi operatori olistici per queste discipline.
                  Ti notifichiamo appena ne arrivano.
                </p>
                <p className="mt-2 text-xs text-charcoal-muted">
                  Intanto puoi esplorare le pratiche qui sopra o scriverci a{" "}
                  <a
                    href="mailto:support@holisticunity.app"
                    className="font-medium text-berry hover:text-berry-dark"
                  >
                    support@holisticunity.app
                  </a>
                  .
                </p>
              </div>
            </section>
          )}
          {therapists.length > 0 && (
            <section>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-charcoal-muted">
                Professionisti olistici per te
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {therapists.map((t) => (
                  <Link
                    key={t.id}
                    href={`/dashboard/therapists/${t.id}`}
                    className="group rounded-2xl border border-berry/10 bg-white/80 p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-berry-subtle to-gold/20 text-base font-bold text-berry-dark">
                        {t.photo_url ? (
                          <Image
                            src={t.photo_url}
                            alt={t.display_name ?? ""}
                            width={48}
                            height={48}
                            unoptimized
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (t.display_name?.[0] || "?").toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-sm font-semibold text-charcoal truncate">
                            {t.display_name?.trim() || "—"}
                          </p>
                          {t.is_verified && (
                            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-info" strokeWidth={2} />
                          )}
                          {t.has_mfa && (
                            <KeyRound className="h-3.5 w-3.5 flex-shrink-0 text-success" strokeWidth={2} />
                          )}
                        </div>
                        {t.tagline && (
                          <p className="mt-0.5 text-xs text-charcoal-muted line-clamp-2">{t.tagline}</p>
                        )}
                        {(t.average_rating ?? 0) > 0 && (
                          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-charcoal-muted">
                            <Star className="h-3 w-3 fill-gold text-gold" />
                            {(t.average_rating ?? 0).toFixed(1)} ({t.total_reviews ?? 0})
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {practices.length === 0 && therapists.length === 0 && (
            <div className="rounded-2xl border border-berry/10 bg-white/60 p-8 text-center">
              <p className="text-sm text-charcoal-light">
                Stiamo ancora completando il marketplace. Esplora il catalogo per scoprire tutte le pratiche disponibili.
              </p>
              <Link
                href="/dashboard/pratiche"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-berry px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-berry-dark"
              >
                Esplora le pratiche
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </>
      )}

      {/* Research consent — opt-in toggle for anonymous aggregate use.
          Defaults to OFF so silence ≠ consent (GDPR Art. 7(2)).
          The card lives at the bottom of the summary so the user has
          already seen what we'll do with their answers (recommend
          practices/therapists) before being asked to opt into the
          aggregate / research use. */}
      <section className="rounded-2xl border border-berry/10 bg-berry-subtle/30 p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={researchConsent}
            onChange={(e) => onResearchConsentChange(e.target.checked)}
            className="mt-0.5 h-5 w-5 flex-shrink-0 cursor-pointer accent-berry"
          />
          <span className="text-sm text-charcoal">
            <strong className="block font-semibold text-charcoal">
              Aiuta l&apos;ecosistema olistico (opzionale)
            </strong>
            <span className="mt-1 block text-xs text-charcoal-muted">
              Acconsento all&apos;uso anonimo e aggregato delle mie risposte per generare
              report di settore e migliorare l&apos;esperienza per tutti. Nessun dato
              personale identificabile viene condiviso. Puoi cambiare idea in
              qualsiasi momento dal tuo profilo.
            </span>
          </span>
        </label>
      </section>

      <button
        type="button"
        onClick={onEdit}
        className="mx-auto block text-xs font-medium text-charcoal-muted hover:text-charcoal underline underline-offset-2"
      >
        Modifica le tue risposte
      </button>
    </div>
  );
}

/* ─── Copy bundle ─────────────────────────────────────────── */

const COPY: Record<string, { question: string; subtitle?: string }> = {
  intent: {
    question: "Cosa ti porta qui, oggi?",
    subtitle: "Non c'\u00e8 una risposta giusta. Quella che senti pi\u00f9 vera per te.",
  },
  focus_areas: {
    question: "Cosa vorresti esplorare?",
    subtitle: "Scegli tutte le aree che senti vive in questo momento. Non devi essere preciso/a.",
  },
  familiar_practices: {
    question: "Hai gi\u00e0 esplorato qualcuna di queste pratiche?",
    subtitle: "Se non le conosci, va benissimo: \u00e8 il momento di scoprirle.",
  },
  approaches: {
    question: "Quale approccio risuona di pi\u00f9 con te?",
    subtitle: "Pensa a come preferisci entrare in contatto con te stesso/a.",
  },
  timing: {
    question: "Quando senti di voler iniziare?",
    subtitle: "Senza pressione: rispondi onestamente, ti aiuter\u00e0 a trovare il momento giusto.",
  },
  life_season: {
    question: "In che fase della vita ti senti?",
    subtitle: "Non c'\u00e8 una risposta giusta. Ascolta cosa risuona ora.",
  },
  current_practices: {
    question: "Cosa fa gi\u00e0 parte della tua routine?",
    subtitle: "Tutto quello che pratichi, anche solo a tratti. Ci aiuta a calibrare.",
  },
  cosmic_marker: {
    question: "Hai un riferimento simbolico che ti rappresenta?",
    subtitle: "Solo se ti riconosci. Puoi anche saltare \u2014 \u00e8 opzionale.",
  },
  notes: {
    question: "C'\u00e8 qualcosa che vuoi farci sapere?",
    subtitle: "Se senti di poter scrivere qualcosa, lo leggeremo. Altrimenti puoi anche solo passare oltre.",
  },
  summary: {
    question: "Abbiamo qualche idea per te",
    subtitle: "",
  },
};
