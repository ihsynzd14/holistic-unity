"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";

/**
 * /forgot-password — Client-side password recovery entry point.
 *
 * Flow:
 *   1. User enters email → call supabase.auth.resetPasswordForEmail
 *   2. Supabase sends the branded "recovery" email template (already
 *      pushed in scripts/email-templates/push-email-templates.mjs) with
 *      a link that lands on /auth/callback?code=…&next=/reset-password
 *   3. /auth/callback exchanges the code for a session
 *   4. Authenticated user arrives at /reset-password and sets a new
 *      password via supabase.auth.updateUser({ password })
 *
 * Security-wise we never reveal whether the email exists — the UI
 * always says "if that email is registered, we've sent a link" so an
 * attacker cannot enumerate users via this form.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Inserisci un indirizzo email valido.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    // Supabase sends the email regardless of whether the address exists
    // in auth.users (by design — prevents user enumeration). We mirror
    // that by ALWAYS showing the confirmation screen, so the UI is
    // consistent with what Supabase actually does.
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      },
    );
    setLoading(false);

    // Only fail-closed on rate-limit / server errors, not on
    // "user not found" (Supabase already masks that).
    if (resetErr && resetErr.status !== 400) {
      setError(
        "Si è verificato un errore. Riprova tra qualche minuto o contatta il supporto.",
      );
      return;
    }

    setSubmitted(true);
  }

  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden px-4"
      style={{
        background:
          "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
      }}
    >
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
            Recupera password
          </h1>
          <p className="mt-1 text-sm font-medium tracking-wide text-berry-muted">
            Ti mandiamo un link per reimpostarla
          </p>
        </div>

        <div className="rounded-[22px] border border-white/60 bg-white/80 p-6 shadow-xl shadow-berry/8 backdrop-blur-xl">
          {submitted ? (
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
                Controlla la tua email
              </h2>
              <p className="text-sm text-charcoal-light">
                Se <span className="font-medium">{email}</span> è
                registrato, abbiamo inviato un link per reimpostare la
                password. Controlla anche la cartella spam.
              </p>
              <Link
                href="/login"
                className="inline-block w-full rounded-full bg-berry py-3 text-center font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark"
              >
                Torna al login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tua@email.com"
                  autoComplete="email"
                  required
                />
              </div>

              {error && (
                <p
                  className="text-center text-sm text-error"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark hover:shadow-xl hover:shadow-berry/25 hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {loading ? "Invio…" : "Invia link di recupero"}
              </button>

              <p className="mt-2 text-center text-xs text-charcoal-muted">
                Ti sei ricordato?{" "}
                <Link
                  href="/login"
                  className="font-medium text-berry hover:text-berry-dark transition-colors"
                >
                  Torna al login
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
