"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { validatePasswordShape } from "@/lib/security/password";
import { Input } from "@/components/ui/Input";

/**
 * /reset-password — landed here from the recovery email after
 * /auth/callback exchanged the recovery code for a session. The user is
 * now signed in (from the recovery flow) and we let them set a new
 * password via supabase.auth.updateUser({ password }).
 *
 * If the user lands here without a session (e.g. opened the page
 * directly), we bounce to /forgot-password.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setHasSession(!!session);
      setCheckingSession(false);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  function validate(): string | null {
    // Reuse the shared shape validator so register + reset stay in sync —
    // previously this page enforced a stricter rule (12 chars, mixed case)
    // than the register page, which surprised users who set a password at
    // signup and then couldn't reuse the same one here.
    const shapeErr = validatePasswordShape(password);
    if (shapeErr) return shapeErr;
    if (password !== confirm) {
      return "Le password non corrispondono.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setSuccess(true);
    // Sign out so the next login uses the new password — the recovery
    // session is short-lived but we'd rather end it explicitly.
    setTimeout(async () => {
      await supabase.auth.signOut();
      router.push("/login?password_reset=1");
    }, 1500);
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
            Nuova password
          </h1>
          <p className="mt-1 text-sm font-medium tracking-wide text-berry-muted">
            Scegli una password sicura
          </p>
        </div>

        <div className="rounded-[22px] border border-white/60 bg-white/80 p-6 shadow-xl shadow-berry/8 backdrop-blur-xl">
          {checkingSession ? (
            <div className="py-8 text-center text-charcoal-muted">
              Verifica del link in corso…
            </div>
          ) : !hasSession ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-charcoal-light">
                Il link di recupero non è valido o è scaduto. Richiedine
                uno nuovo.
              </p>
              <Link
                href="/forgot-password"
                className="inline-block w-full rounded-full bg-berry py-3 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark"
              >
                Richiedi nuovo link
              </Link>
            </div>
          ) : success ? (
            <div className="space-y-4 text-center">
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
                Password aggiornata
              </h2>
              <p className="text-sm text-charcoal-light">
                Ti stiamo riportando al login…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
                  Nuova password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <p className="mt-1 text-xs text-charcoal-muted/70">
                  Almeno 8 caratteri, con numeri e lettere.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-charcoal-light">
                  Conferma nuova password
                </label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
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
                {loading ? "Salvando…" : "Aggiorna password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
