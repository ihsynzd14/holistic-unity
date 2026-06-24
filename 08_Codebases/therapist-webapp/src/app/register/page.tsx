"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ErrorText } from "@/components/ui/ErrorText";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

// Status literal persisted to therapist_profiles.approval_status for
// newly-registered therapists. Admin flips this to "approved" to grant access.
const INITIAL_APPROVAL_STATUS = "pending_review" as const;

function RegisterForm() {
  const { t } = useI18n();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  function validate(): string | null {
    if (!fullName.trim()) return t.register.errorNameRequired;
    if (!/^\S+@\S+\.\S+$/.test(email)) return t.register.errorEmailInvalid;
    if (!phone.trim()) return t.register.errorPhoneRequired;
    if (password.length < 8) return t.register.errorPasswordShort;
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return t.register.errorPasswordWeak;
    }
    if (password !== passwordConfirm) return t.register.errorPasswordMismatch;
    if (!acceptTerms) return t.register.errorTerms;
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
    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored in auth.users.user_metadata — also used by any DB trigger
        // that provisions the public.users row.
        data: {
          display_name: fullName.trim(),
          full_name: fullName.trim(),
          phone: phone.trim(),
          role: "therapist",
        },
        // Explicit redirect overrides the global Supabase Site URL so the
        // confirmation link lands on THIS app's /auth/confirm (token_hash /
        // verifyOtp flow). Site URL points to app.holisticunity.app — without
        // this, therapist signups would land on the client app after confirm.
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Supabase email-enumeration protection: when the email already
    // belongs to an existing (confirmed) account, signUp returns NO error
    // and a user whose `identities` array is EMPTY — instead of leaking
    // that the address exists. Without this check we'd show the misleading
    // "check your email" screen for an email that will never receive one.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError(t.register.errorEmailAlreadyRegistered);
      setLoading(false);
      return;
    }

    // If email confirmation is ON in Supabase, there's no session yet.
    // If it is OFF, we have a session and can write the profile row,
    // then we immediately sign the user out — they must not have access
    // until the admin approves them.
    if (data.session) {
      const userId = data.user?.id;
      if (userId) {
        // Defensive: many Supabase projects have a trigger on auth.users
        // that provisions public.users automatically. Upsert so we don't
        // fail if the row already exists.
        // NOTE: column is named `phone_number` in public.users (verified
        // against the live schema), NOT `phone` — a prior version of this
        // code used `phone` and silently dropped the value on the floor.
        await supabase.from("users").upsert(
          {
            id: userId,
            email,
            display_name: fullName.trim(),
            phone_number: phone.trim(),
            role: "therapist",
          },
          { onConflict: "id" },
        );

        // Mark the therapist profile as pending so login can gate it.
        // display_name is also stored here because therapist_profiles is
        // the row the dashboard + public directory read from.
        await supabase.from("therapist_profiles").upsert(
          {
            id: userId,
            display_name: fullName.trim(),
            approval_status: INITIAL_APPROVAL_STATUS,
            is_approved: false,
          },
          { onConflict: "id" },
        );
      }
      // Log them straight out — account is blocked until admin approves.
      await supabase.auth.signOut();
    } else {
      // Email confirmation required — we can't write the profile row here
      // without a session. The DB trigger (if present) will handle it, or
      // we pick it up on first login once the email is confirmed.
      setNeedsEmailConfirm(true);
    }

    setSubmittedEmail(email);
    setLoading(false);
  }

  if (submittedEmail) {
    const bodyTemplate = needsEmailConfirm
      ? t.register.checkEmailBody
      : t.register.successBody;
    const titleText = needsEmailConfirm
      ? t.register.checkEmailTitle
      : t.register.successTitle;
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
        <DisplayHeading as="h2" size="md">
          {titleText}
        </DisplayHeading>
        <p className="text-sm text-charcoal-light">
          {bodyTemplate.replace("{email}", submittedEmail)}
        </p>
        <button
          onClick={() => router.push("/login?status=pending_review")}
          className="w-full rounded-full bg-berry py-3 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark"
        >
          {t.register.successContinue}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleRegister} className="space-y-4">
      <div>
        <Label>{t.register.fullName}</Label>
        <Input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t.register.fullNamePlaceholder}
          autoComplete="name"
          required
        />
      </div>

      <div>
        <Label>{t.register.email}</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.register.emailPlaceholder}
          autoComplete="email"
          required
        />
      </div>

      <div>
        <Label>{t.register.phone}</Label>
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t.register.phonePlaceholder}
          autoComplete="tel"
          required
        />
      </div>

      <div>
        <Label>{t.register.password}</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <p className="mt-1 text-xs text-charcoal-muted/70">
          {t.register.passwordHint}
        </p>
      </div>

      <div>
        <Label>{t.register.passwordConfirm}</Label>
        <Input
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      <label className="flex items-start gap-2 text-xs text-charcoal-light">
        <input
          type="checkbox"
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20"
        />
        <span>
          {t.register.terms}{" "}
          <a
            href="https://holisticunity.app/terms-therapists.html"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-berry hover:text-berry-dark"
          >
            {t.register.termsLink}
          </a>{" "}
          {t.register.and}{" "}
          <a
            href="https://holisticunity.app/privacy-policy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-berry hover:text-berry-dark"
          >
            {t.register.privacyLink}
          </a>
          .
        </span>
      </label>

      {error && (
        <ErrorText role="alert">{error}</ErrorText>
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
  const { t } = useI18n();

  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10"
      style={{
        background:
          "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
      }}
    >
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
