"use client";

import { Suspense, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { CLIENT_TOS_VERSION, TOS_URLS } from "@/lib/tos/version";
import {
  validatePasswordShape,
  isPasswordBreached,
} from "@/lib/security/password";

// Cloudflare Turnstile was removed 2026-05-15: in production the
// challenges.cloudflare.com script was getting blocked routinely by
// uBlock Origin, Privacy Badger, Brave shields, iOS Safari strict
// mode, and corporate firewalls — leaving legit users (Brazilian
// Lorena, 2026-05-13) staring at "Please complete the anti-bot
// verification" with no widget visible and no way through. The
// new defence is a server-side stack in /api/auth/check-signup:
// honeypot, time-on-form, disposable-email blocklist, per-IP rate
// limit. All four signals are invisible to the user (so no third-
// party JS to block) and together they make bot signups
// unprofitable at our scale.

// Client signups are NOT gated on admin approval. Once email-confirmed,
// they can browse therapists and book immediately.

function RegisterForm() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  // Single combined checkbox for ToS + Privacy. GDPR doesn't require
  // a separate "privacy notice" acceptance (the user just needs to be
  // INFORMED — the link to the notice does that). So we can group the
  // contractual acceptance of the Terms with the acknowledgement of
  // the Privacy Notice in one box, and reduce checkbox count from 4
  // to 2. (Brazilian client report 2026-05-13: "too many things to
  // tick, can you make it shorter to the essential? if possible
  // maximum two things to click to consent".)
  const [acceptTermsAndPrivacy, setAcceptTermsAndPrivacy] = useState(false);
  // Vessatorie clauses (art. 1341/1342 c.c.) MUST stay in a separate
  // checkbox by law — Italian Cassazione has repeatedly struck down
  // bundled approvals of onerous clauses. This is the ONE check we
  // cannot merge with the ToS box above.
  const [acceptVessatorie, setAcceptVessatorie] = useState(false);
  // Art. 9(2)(a) GDPR explicit consent for health-data processing
  // is no longer captured at registration. At that point the user
  // hasn't yet engaged with any health-data processing — they're
  // only creating an account. The consent is now collected at first
  // booking attempt: the API gate in /api/checkout/create returns
  // a 412 with `error: "health_data_consent_required"` when the
  // user tries to book without consent, and the therapist detail
  // page surfaces a link to /accept-terms that captures it inline.
  // That's actually MORE compliant with EDPB guidance on Art. 9
  // (consent given closer to the actual processing context).
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  // Honeypot field. Hidden via CSS (see JSX below). Never typed into by
  // humans; routinely auto-filled by naïve form-scraper bots.
  const [honeypot, setHoneypot] = useState("");
  // Mount timestamp for the time-on-form heuristic. We snapshot
  // Date.now() once on first render via useRef so it survives re-renders
  // and we can submit it to the server as `formAgeMs`.
  const formMountedAtRef = useRef<number>(Date.now());

  function validate(): string | null {
    if (!fullName.trim()) return t.register.errorNameRequired;
    if (!/^\S+@\S+\.\S+$/.test(email)) return t.register.errorEmailInvalid;
    if (!phone.trim()) return t.register.errorPhoneRequired;
    const pwShape = validatePasswordShape(password);
    if (pwShape) return pwShape;
    if (password !== passwordConfirm) return t.register.errorPasswordMismatch;
    if (!acceptTermsAndPrivacy) return t.register.errorTermsAndPrivacyRequired;
    if (!acceptVessatorie) return t.register.errorVessatorieRequired;
    return null;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    // Block known-breached passwords via HaveIBeenPwned k-anonymity API.
    // Privacy-preserving: only the SHA-1 prefix (5 hex chars) leaves the
    // device. Fail-open if HIBP is unreachable — a temporary HIBP outage
    // shouldn't deny legitimate signups, since password strength is just
    // one of several controls.
    const breached = await isPasswordBreached(password);
    if (breached) {
      setError(t.register.errorPasswordBreached);
      setLoading(false);
      return;
    }

    // Server-side anti-abuse pre-flight. Replaces the old Turnstile
    // captcha — see /api/auth/check-signup for the four layers (honeypot,
    // form-age, disposable email, per-IP rate limit). None of the
    // signals depend on third-party JS, so ad-blockers and strict
    // browsers don't break the flow anymore.
    try {
      const checkRes = await fetch("/api/auth/check-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          honeypot,
          formAgeMs: Date.now() - formMountedAtRef.current,
          email,
        }),
      });
      if (!checkRes.ok) {
        const body = (await checkRes.json().catch(() => ({}))) as {
          error?: string;
        };
        if (body.error === "disposable_email_not_allowed") {
          setError(t.register.errorDisposableEmail);
        } else if (body.error === "form_submitted_too_fast") {
          setError(t.register.errorTooFast);
        } else if (checkRes.status === 429) {
          setError(t.register.errorTooManySignups);
        } else {
          setError(t.register.errorSignupCheck);
        }
        setLoading(false);
        return;
      }
    } catch {
      setError(t.register.errorSignupCheckNetwork);
      setLoading(false);
      return;
    }

    // Fire Lead AFTER all gating passes — captures only well-formed,
    // non-bot intent. Meta's `Lead` event is the right channel for
    // "user attempted to register".
    const { trackLead } = await import("@/lib/analytics/meta-pixel");
    trackLead({ content_name: "client_register" });

    const supabase = createClient();

    const acceptedAt = new Date().toISOString();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored in auth.users.user_metadata — read by any DB trigger
        // that auto-provisions public.users + by /welcome which mirrors
        // the TOS-acceptance state into the tos_acceptances audit table.
        data: {
          display_name: fullName.trim(),
          full_name: fullName.trim(),
          phone: phone.trim(),
          role: "client",
          // Pending TOS-acceptance signal — promoted to a permanent row in
          // tos_acceptances after email confirmation lands on /welcome.
          // We carry the version so a stale tab signing up after we bump
          // the TOS still records the version actually displayed at sign-up.
          tos_pending_version: CLIENT_TOS_VERSION,
          // The combined registration checkbox covers BOTH the general
          // ToS and the Privacy Notice — both flags reflect the same
          // user action.
          tos_pending_general: acceptTermsAndPrivacy,
          tos_pending_privacy: acceptTermsAndPrivacy,
          tos_pending_vessatorie: acceptVessatorie,
          // Health-data Art.9 GDPR consent is NOT captured at
          // registration anymore (see state comment above). It will
          // be captured later, at the first booking attempt, via the
          // /accept-terms flow gated by the /api/checkout/create 412.
          tos_pending_health_data: false,
          tos_pending_accepted_at: acceptedAt,
        },
        // Explicit redirect overrides the global Supabase Site URL so
        // the confirmation link in the email always lands on this app's
        // /auth/callback (which exchanges the code for a session and
        // redirects to /welcome). Defence in depth: even if someone
        // resets the Site URL to localhost in dev, prod stays correct.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/welcome`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // If email confirmation is OFF in Supabase, the new user already has
    // a session — write their public.users row + log them straight in.
    // If email confirmation is ON, we get no session here; show the
    // "check your email" screen and let the row be created on first
    // login (the DB trigger covers that path).
    if (data.session) {
      const userId = data.user?.id;
      if (userId) {
        // Defensive: a DB trigger on auth.users may have already
        // provisioned public.users. Upsert avoids the duplicate-key
        // failure either way.
        // Column name in the live schema is `phone_number`, not `phone`.
        await supabase.from("users").upsert(
          {
            id: userId,
            email,
            display_name: fullName.trim(),
            phone_number: phone.trim(),
            role: "client",
          },
          { onConflict: "id" },
        );
      }
      // Account fully created (no email confirm) — fire CompleteRegistration
      // for ad attribution. Status=true signals success to Meta.
      const { trackCompleteRegistration } = await import("@/lib/analytics/meta-pixel");
      trackCompleteRegistration({ content_name: "client_register", status: true });

      // Client accounts are NOT gated on admin approval — straight to
      // the dashboard.
      router.push("/dashboard");
      router.refresh();
      return;
    }

    // No session = email-confirmation flow. The actual registration
    // completes when they click the email link → tracked there.
    setSubmittedEmail(email);
    setLoading(false);
  }

  if (submittedEmail) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <svg
            className="h-7 w-7 text-success"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
          {t.register.checkEmailTitle}
        </h2>
        <p className="text-sm text-charcoal-light">
          {t.register.checkEmailBody.replace("{email}", submittedEmail)}
        </p>
        <button
          onClick={() => router.push("/login")}
          className="w-full rounded-full bg-berry py-3 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark"
        >
          {t.register.successContinue}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleRegister} className="space-y-4">
      {/*
        Honeypot field. Hidden via inline CSS rather than a class so
        ad-blockers and reset stylesheets can't accidentally reveal
        it. `tabIndex={-1}` + `autoComplete="off"` + `aria-hidden`
        keep real users away even if they tab through the form;
        screen readers also skip it. The field name `company_url` is
        a deliberate honey-trap — naïve scrapers fill anything that
        looks business-related.
      */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-10000px",
          top: "auto",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label>
          Company website (do not fill)
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            name="company_url"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
          {t.register.fullName}
        </label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t.register.fullNamePlaceholder}
          autoComplete="name"
          required
          className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-charcoal placeholder-charcoal-muted/40 outline-none transition-all duration-300 focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
          {t.register.email}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.register.emailPlaceholder}
          autoComplete="email"
          required
          className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-charcoal placeholder-charcoal-muted/40 outline-none transition-all duration-300 focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
          {t.register.phone}
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t.register.phonePlaceholder}
          autoComplete="tel"
          required
          className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-charcoal placeholder-charcoal-muted/40 outline-none transition-all duration-300 focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
          {t.register.password}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-charcoal placeholder-charcoal-muted/40 outline-none transition-all duration-300 focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
        <p className="mt-1 text-xs text-charcoal-muted/70">
          {t.register.passwordHint}
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
          {t.register.passwordConfirm}
        </label>
        <input
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
          required
          className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-charcoal placeholder-charcoal-muted/40 outline-none transition-all duration-300 focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
      </div>

      <div className="space-y-2.5 rounded-xl border border-berry-subtle bg-white/60 p-3.5">
        {/*
          Foreign-language disclaimer. Checkbox labels remain in Italian
          because the contract is governed by Italian law and the
          translation would risk arguments that the consumer didn't
          validly accept the Italian Civil Code arts. 1341/1342
          "clausole vessatorie". For non-IT users we surface a
          non-binding translation just below each checkbox.
        */}
        {locale !== "it" && (
          <div className="-mt-1 mb-1 rounded-lg bg-cream/60 px-3 py-2 text-[11px] leading-relaxed text-charcoal-muted">
            ⚠ {t.register.legalDisclaimerForeign}
          </div>
        )}

        {/* Box 1 — Combined ToS + Privacy. Two separate links so the
            user can actually OPEN each document, but a single consent
            click since GDPR doesn't require a separate "I read the
            privacy notice" box (the link alone discharges the
            informational duty). */}
        <label className="flex items-start gap-2 text-xs text-charcoal-light">
          <input
            type="checkbox"
            checked={acceptTermsAndPrivacy}
            onChange={(e) => setAcceptTermsAndPrivacy(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20"
          />
          <span>
            Ho letto e accetto i{" "}
            <a
              href={TOS_URLS.client}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-berry hover:text-berry-dark"
            >
              Termini e Condizioni per i Clienti
            </a>{" "}
            e l&rsquo;
            <a
              href={TOS_URLS.privacy}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-berry hover:text-berry-dark"
            >
              Informativa Privacy (GDPR)
            </a>
            .
            {locale !== "it" && (
              <span className="mt-0.5 block text-[10.5px] italic text-charcoal-muted/80">
                {t.register.legalTranslationPrefix} {t.register.termsAndPrivacyCheckboxIT}
              </span>
            )}
          </span>
        </label>

        {/* Box 2 — Vessatorie. Cannot be merged with anything else
            under Italian Civil Code arts. 1341/1342 (specific
            written approval requirement). */}
        <label className="flex items-start gap-2 text-xs text-charcoal-light">
          <input
            type="checkbox"
            checked={acceptVessatorie}
            onChange={(e) => setAcceptVessatorie(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20"
          />
          <span>
            <strong>Approvazione specifica</strong> ai sensi degli artt. 1341 e
            1342 c.c. delle clausole onerose: <strong>Sez. 4.2</strong> pagamento
            anticipato, <strong>Sez. 5</strong> politica cancellazione,{" "}
            <strong>Sez. 6.5/6.6</strong> limitazione di responsabilità,{" "}
            <strong>Sez. 9.2</strong> foro competente,{" "}
            <strong>Sez. 11</strong> risoluzione del contratto. Vedi{" "}
            <a
              href={`${TOS_URLS.client}#section-18`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-berry hover:text-berry-dark"
            >
              Sezione 18 dei Termini
            </a>
            .
            {locale !== "it" && (
              <span className="mt-0.5 block text-[10.5px] italic text-charcoal-muted/80">
                {t.register.legalTranslationPrefix} {t.register.vessatorieCheckboxIT}
              </span>
            )}
          </span>
        </label>

        {/* Health-data Art.9 GDPR consent intentionally NOT requested
            here. It's collected at first booking attempt via
            /accept-terms after the /api/checkout/create 412 — see
            state comment above for the rationale (GDPR-correct
            temporal proximity to the actual processing). */}
      </div>

      {error && (
        <p className="text-center text-sm text-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark hover:shadow-xl hover:shadow-berry/25 hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {t.register.submitting}
          </span>
        ) : (
          t.register.submit
        )}
      </button>

      <p className="mt-2 text-center text-xs text-charcoal-muted">
        {t.register.haveAccount}{" "}
        <Link
          href="/login"
          className="font-medium text-berry hover:text-berry-dark transition-colors"
        >
          {t.register.signInHere}
        </Link>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10"
      style={{
        background:
          "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
      }}
    >
      {/* Language toggle. Sits absolutely top-right of the page, on
          top of the floating orbs so it stays accessible no matter
          where the user scrolls. Critical for non-Italian visitors:
          a Brazilian client (2026-05-13) abandoned signup because the
          page was Italian-only with no visible way to change language.
          The page now auto-detects locale via Accept-Language in
          layout.tsx, but the toggle is here as a manual escape hatch. */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full bg-white/80 px-1 py-1 text-xs font-semibold shadow-sm backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setLocale("it")}
          aria-pressed={locale === "it"}
          className={
            "rounded-full px-3 py-1 transition " +
            (locale === "it"
              ? "bg-berry text-white"
              : "text-charcoal-muted hover:text-charcoal")
          }
        >
          IT
        </button>
        <button
          type="button"
          onClick={() => setLocale("en")}
          aria-pressed={locale === "en"}
          className={
            "rounded-full px-3 py-1 transition " +
            (locale === "en"
              ? "bg-berry text-white"
              : "text-charcoal-muted hover:text-charcoal")
          }
        >
          EN
        </button>
      </div>
      {/* Floating orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-20 -right-20 h-80 w-80 rounded-full opacity-20 animate-float"
          style={{
            background:
              "radial-gradient(circle, #C9A96E 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-15 animate-float-delayed"
          style={{
            background:
              "radial-gradient(circle, #7B2252 0%, transparent 70%)",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-sm animate-reveal">
        {/* Brand */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-white/90 shadow-lg shadow-berry/15 backdrop-blur-sm overflow-hidden">
            <Image
              src="/logo.png"
              alt="Holistic Unity"
              width={56}
              height={56}
              className="rounded-xl"
              priority
            />
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
            {t.register.title}
          </h1>
          <p className="mt-1 text-sm font-medium tracking-wide text-berry-muted">
            {t.register.subtitle}
          </p>
        </div>

        {/* Register card */}
        <div className="rounded-[22px] border border-white/60 bg-white/80 p-6 shadow-xl shadow-berry/8 backdrop-blur-xl">
          <Suspense
            fallback={
              <div className="py-8 text-center text-charcoal-muted">
                {t.common.loading}
              </div>
            }
          >
            <RegisterForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-berry-muted/60">
          {t.login.company}
        </p>
      </div>
    </div>
  );
}
