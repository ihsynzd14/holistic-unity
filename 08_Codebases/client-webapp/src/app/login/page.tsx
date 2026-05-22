"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ErrorText } from "@/components/ui/ErrorText";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  // If a therapist tried to log in here by mistake, the dashboard layout
  // bounces them to /login?error=wrong_portal — show a friendly note.
  const wrongPortal = searchParams.get("error") === "wrong_portal";
  const { t } = useI18n();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // Verify user is a client (NOT a therapist). The therapist portal lives at
    // a different domain (therapistportal.holisticunity.app) — sending them
    // there avoids confusion if they signed up there but tried to log in here.
    if (data.user) {
      const { data: userData } = await supabase
        .from("users")
        .select("role")
        .eq("id", data.user.id)
        .single();

      if (userData?.role === "therapist") {
        await supabase.auth.signOut();
        setError(t.login.useTherapistPortal);
        setLoading(false);
        return;
      }
      // If role is null (brand-new signup whose DB trigger hasn't fired yet),
      // we still let them in — the dashboard layout will provision the row
      // defensively if needed.
    }

    // Audit: log this successful sign-in. Best-effort — never blocks
    // the redirect, fires fire-and-forget.
    fetch("/api/security/log-login", { method: "POST" }).catch(() => {});

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      {wrongPortal && (
        <div className="mb-5 rounded-2xl bg-warning-light px-4 py-3 text-center text-sm text-charcoal-light">
          {t.login.useTherapistPortal}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <Label>{t.login.email}</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.login.emailPlaceholder}
            autoComplete="email"
            required
          />
        </div>

        <div>
          <Label>{t.login.password}</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.login.passwordPlaceholder}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <ErrorText>{error}</ErrorText>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark hover:shadow-xl hover:shadow-berry/25 hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {t.login.signingIn}
            </span>
          ) : (
            t.login.signIn
          )}
        </button>
      </form>

      <p className="mt-3 text-center text-xs">
        <Link
          href="/forgot-password"
          className="font-medium text-charcoal-muted hover:text-berry transition-colors"
        >
          Password dimenticata?
        </Link>
      </p>

      <p className="mt-5 text-center text-xs text-charcoal-muted">
        {t.login.noAccount}{" "}
        <Link
          href="/register"
          className="font-medium text-berry hover:text-berry-dark transition-colors"
        >
          {t.login.registerHere}
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  const { t } = useI18n();

  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden px-4"
      style={{ background: "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)" }}
    >
      {/* Floating orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-20 -right-20 h-80 w-80 rounded-full opacity-20 animate-float"
          style={{ background: "radial-gradient(circle, #C9A96E 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-15 animate-float-delayed"
          style={{ background: "radial-gradient(circle, #7B2252 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-1/3 right-1/4 h-40 w-40 rounded-full opacity-10 animate-float-delayed"
          style={{ background: "radial-gradient(circle, #D4BC8E 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 w-full max-w-sm animate-reveal">
        {/* Brand */}
        <div className="mb-8 text-center">
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
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal">
            {t.login.title}
          </h1>
          <p className="mt-1 text-sm font-medium tracking-wide text-berry-muted">{t.login.subtitle}</p>
        </div>

        {/* Login card */}
        <div className="rounded-[22px] border border-white/60 bg-white/80 p-8 shadow-xl shadow-berry/8 backdrop-blur-xl">
          <Suspense fallback={<div className="py-8 text-center text-charcoal-muted">{t.common.loading}</div>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-berry-muted/60">
          {t.login.company}
        </p>
      </div>
    </div>
  );
}
