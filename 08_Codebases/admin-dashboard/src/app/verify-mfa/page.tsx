"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getMfaStatus, verifyChallenge } from "@/lib/auth/mfa";
import { ShieldCheck } from "lucide-react";
import { ErrorText } from "@/components/ui/ErrorText";
import { Spinner } from "@/components/ui/Spinner";

/**
 * MFA verification page — landed here after a password sign-in when the
 * account already has a verified TOTP factor. User enters the 6-digit
 * code from their authenticator → session upgrades from aal1 → aal2 →
 * we redirect to /dashboard which now passes the AAL gate.
 *
 * If the user is already at aal2 → straight to /dashboard.
 * If not enrolled → /enroll-mfa.
 */
export default function VerifyMfaPage() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const status = await getMfaStatus(supabase);
      if (!status.enrolled) {
        router.push("/enroll-mfa");
        return;
      }
      if (status.aal === "aal2") {
        router.push("/dashboard");
        return;
      }
      setFactorId(status.factorId);
      setLoading(false);
    }
    void init();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    setError("");
    try {
      const supabase = createClient();
      await verifyChallenge(supabase, factorId, code.trim());
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codice non valido");
      setVerifying(false);
      setCode("");
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4"
      style={{ background: "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)" }}
    >
      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-[22px] border border-white/60 bg-white/90 p-8 shadow-xl shadow-berry/8 backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-berry-subtle">
            <ShieldCheck className="h-7 w-7 text-berry" strokeWidth={1.5} />
          </div>

          <h1 className="text-center font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
            Verifica con il codice
          </h1>
          <p className="mt-2 text-center text-sm text-charcoal-light">
            Apri la tua app autenticatrice e inserisci il codice a 6 cifre.
          </p>

          {loading ? (
            <div className="my-12 flex justify-center">
              <Spinner />
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                autoFocus
                required
                className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-charcoal outline-none transition-all focus:border-berry focus:ring-2 focus:ring-berry/10"
              />

              {error && <ErrorText>{error}</ErrorText>}

              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verifying ? "Verifica..." : "Conferma"}
              </button>

              <button
                type="button"
                onClick={signOut}
                className="w-full text-center text-xs text-charcoal-muted hover:text-charcoal"
              >
                Esci
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
