"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { enrollFactor, verifyEnrollment, getMfaStatus } from "@/lib/auth/mfa";
import { Label } from "@/components/ui/Label";
import { ErrorText } from "@/components/ui/ErrorText";
import { Spinner } from "@/components/ui/Spinner";

/**
 * MFA enrollment page.
 *
 * Flow:
 *   1. Page loads → check session, ensure not already enrolled
 *   2. Auto-call enrollFactor() to get QR code + secret
 *   3. User scans QR with Authenticator app, enters first 6-digit code
 *   4. verifyEnrollment() upgrades session to aal2 + flips factor to verified
 *   5. Redirect to /dashboard
 *
 * Used as MANDATORY for admin (admin layout redirects here if not enrolled)
 * and OPTIONAL for therapists (link from settings).
 */
export default function EnrollMfaPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [enrollData, setEnrollData] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const status = await getMfaStatus(supabase);
      if (status.enrolled) {
        // Already has MFA — go to dashboard (or verify if AAL not yet upgraded)
        router.push(status.aal === "aal2" ? "/dashboard" : "/verify-mfa");
        return;
      }
      try {
        const data = await enrollFactor(supabase);
        setEnrollData({
          factorId: data.factorId,
          qrCode: data.qrCode,
          secret: data.secret,
        });
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Enrollment failed");
        setLoading(false);
      }
    }
    void init();
  }, [router]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollData) return;
    setVerifying(true);
    setError("");
    try {
      const supabase = createClient();
      await verifyEnrollment(supabase, enrollData.factorId, code.trim());
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codice non valido");
      setVerifying(false);
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4"
      style={{ background: "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)" }}
    >
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-[22px] border border-white/60 bg-white/90 p-8 shadow-xl shadow-berry/8 backdrop-blur-xl">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
            Attiva l&apos;autenticazione a due fattori
          </h1>
          <p className="mt-2 text-sm text-charcoal-light">
            Scansiona il codice QR con la tua app autenticatrice (Google Authenticator, 1Password, Authy) e inserisci il codice a 6 cifre per confermare.
          </p>

          {loading && (
            <div className="my-12 flex justify-center">
              <Spinner />
            </div>
          )}

          {enrollData && (
            <>
              <div className="mt-6 flex justify-center rounded-2xl bg-white p-4 shadow-inner">
                {/* Supabase returns the QR as a data URL svg */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Image
                  src={enrollData.qrCode}
                  alt="QR per autenticatore"
                  width={200}
                  height={200}
                  unoptimized
                />
              </div>

              <details className="mt-3 text-xs text-charcoal-muted">
                <summary className="cursor-pointer hover:text-charcoal">Non riesci a scansionare? Inserimento manuale</summary>
                <p className="mt-2 break-all rounded-lg bg-cream-dark/30 p-3 font-mono text-[11px] text-charcoal">
                  {enrollData.secret}
                </p>
              </details>

              <form onSubmit={submitCode} className="mt-6 space-y-4">
                <div>
                  <Label>Codice a 6 cifre dall&apos;autenticatore</Label>
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
                </div>

                {error && <ErrorText>{error}</ErrorText>}

                <button
                  type="submit"
                  disabled={verifying || code.length !== 6}
                  className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all duration-300 hover:bg-berry-dark disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {verifying ? "Verifica in corso..." : "Conferma e attiva"}
                </button>
              </form>
            </>
          )}

          {error && !enrollData && (
            <ErrorText className="mt-6">{error}</ErrorText>
          )}
        </div>
      </div>
    </div>
  );
}
