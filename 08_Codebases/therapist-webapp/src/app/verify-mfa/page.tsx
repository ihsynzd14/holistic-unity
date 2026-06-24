"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getMfaStatus, verifyChallenge } from "@/lib/auth/mfa";
import { ShieldCheck } from "lucide-react";
import { ErrorText } from "@/components/ui/ErrorText";
import { Spinner } from "@/components/ui/Spinner";

type Mode = "totp" | "backup";

/**
 * MFA verification page — landed here after a password sign-in when the
 * account already has a verified TOTP factor. User enters the 6-digit
 * code from their authenticator → session upgrades from aal1 → aal2 →
 * we redirect to /dashboard which now passes the AAL gate.
 *
 * If the user is already at aal2 → straight to /dashboard.
 * If not enrolled → /enroll-mfa.
 *
 * Recovery: if the user lost their authenticator device they can switch
 * to "backup code" mode and enter one of the 8 codes saved at enrollment.
 * A successful backup code DELETES the current TOTP factor (and remaining
 * codes) and redirects to /enroll-mfa for a fresh enrollment cycle.
 */
export default function VerifyMfaPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
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

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    setError("");
    try {
      const supabase = createClient();
      await verifyChallenge(supabase, factorId, code.trim());
      // Fire-and-forget audit event
      fetch("/api/security/mfa-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verified" }),
      }).catch(() => {});
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codice non valido");
      setVerifying(false);
      setCode("");
    }
  }

  async function submitBackup(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError("");
    try {
      const res = await fetch("/api/security/backup-codes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: backupCode.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.error === "rate_limited") {
          setError("Troppi tentativi. Riprova tra qualche minuto.");
        } else if (j.error === "no_codes") {
          setError("Nessun codice di backup disponibile. Contatta il supporto.");
        } else {
          setError("Codice non valido.");
        }
        setBackupCode("");
        return;
      }
      // TOTP factor deleted server-side. Dashboard layout will redirect
      // to /enroll-mfa for fresh enrollment.
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Errore di rete. Riprova.");
    } finally {
      setVerifying(false);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  function switchTo(next: Mode) {
    setMode(next);
    setError("");
    setCode("");
    setBackupCode("");
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
            {mode === "totp" ? "Verifica con il codice" : "Codice di backup"}
          </h1>
          <p className="mt-2 text-center text-sm text-charcoal-light">
            {mode === "totp"
              ? "Apri la tua app autenticatrice e inserisci il codice a 6 cifre."
              : "Inserisci uno dei codici di backup salvati al momento dell'attivazione MFA. Verrà invalidato dopo l'uso."}
          </p>

          {loading ? (
            <div className="my-12 flex justify-center">
              <Spinner />
            </div>
          ) : mode === "totp" ? (
            <form onSubmit={submitTotp} className="mt-6 space-y-4">
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
                onClick={() => switchTo("backup")}
                className="block w-full text-center text-xs font-medium text-charcoal-muted hover:text-charcoal underline underline-offset-2"
              >
                Hai perso l&apos;accesso? Usa un codice di backup
              </button>

              <button
                type="button"
                onClick={signOut}
                className="block w-full text-center text-xs text-charcoal-muted hover:text-charcoal"
              >
                Esci
              </button>
            </form>
          ) : (
            <form onSubmit={submitBackup} className="mt-6 space-y-4">
              <input
                type="text"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                maxLength={19}
                autoComplete="one-time-code"
                autoFocus
                required
                className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-center font-mono text-lg tracking-wider text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
              />

              {error && <ErrorText>{error}</ErrorText>}

              <button
                type="submit"
                disabled={verifying || backupCode.replace(/-/g, "").length !== 16}
                className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 hover:bg-berry-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verifying ? "Verifica..." : "Recupera accesso"}
              </button>

              <button
                type="button"
                onClick={() => switchTo("totp")}
                className="block w-full text-center text-xs text-charcoal-muted hover:text-charcoal"
              >
                Torna al codice TOTP
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
