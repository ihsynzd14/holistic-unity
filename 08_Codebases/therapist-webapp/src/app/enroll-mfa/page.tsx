"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { enrollFactor, verifyEnrollment, getMfaStatus } from "@/lib/auth/mfa";
import { ErrorText } from "@/components/ui/ErrorText";
import { Spinner } from "@/components/ui/Spinner";

type WizardStep = "install" | "scan" | "verify" | "backup";

/**
 * MFA enrollment page — 4-step wizard.
 *
 * Forced for therapists since 2026-04-25 (dashboard layout redirects
 * here if no verified TOTP factor). Optional for admins (admin layout
 * uses its own pre-existing enforcement).
 *
 * Flow:
 *   1. Install — pick an authenticator app (links + suggestions)
 *   2. Scan — show QR + secret
 *   3. Verify — submit 6-digit code → upgrade session to aal2
 *   4. Backup — display 8 backup codes + require acknowledgment
 *
 * After step 4 acknowledgment → /dashboard.
 */
export default function EnrollMfaPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("install");
  const [enrollData, setEnrollData] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Enrollment failed");
      }
    }
    void init();
  }, [router]);

  async function onVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollData) return;
    setVerifying(true);
    setError("");
    try {
      const supabase = createClient();
      await verifyEnrollment(supabase, enrollData.factorId, code.trim());
      // sync therapist_profiles.has_mfa (best-effort)
      try { await fetch("/api/security/mfa-status", { method: "POST" }); } catch {}
      // generate backup codes (now AAL2 — the regen endpoint requires it)
      const res = await fetch("/api/security/backup-codes", { method: "POST" });
      if (!res.ok) throw new Error("backup_codes_failed");
      const { codes } = await res.json();
      setBackupCodes(codes);
      setStep("backup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codice non valido");
    } finally {
      setVerifying(false);
    }
  }

  async function onFinish() {
    if (!acknowledged) return;
    setSubmitting(true);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
      style={{ background: "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)" }}
    >
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-[22px] border border-white/60 bg-white/90 p-8 shadow-xl shadow-berry/8 backdrop-blur-xl">
          <StepHeader step={step} />

          {step === "install" && <Step1Install onNext={() => setStep("scan")} />}

          {step === "scan" && (
            <Step2Scan
              data={enrollData}
              loading={!enrollData}
              error={!enrollData ? error : ""}
              onBack={() => setStep("install")}
              onNext={() => setStep("verify")}
            />
          )}

          {step === "verify" && (
            <Step3Verify
              code={code}
              setCode={setCode}
              verifying={verifying}
              error={error}
              onBack={() => setStep("scan")}
              onSubmit={onVerifySubmit}
            />
          )}

          {step === "backup" && (
            <Step4Backup
              codes={backupCodes}
              acknowledged={acknowledged}
              setAcknowledged={setAcknowledged}
              submitting={submitting}
              onSubmit={onFinish}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Header ─── */

const STEP_LABELS: Record<WizardStep, string> = {
  install: "Installa un'app authenticator",
  scan: "Scansiona il QR",
  verify: "Inserisci il codice",
  backup: "Salva i codici di backup",
};

const STEP_ORDER: WizardStep[] = ["install", "scan", "verify", "backup"];

function StepHeader({ step }: { step: WizardStep }) {
  const idx = STEP_ORDER.indexOf(step) + 1;
  return (
    <div className="mb-6">
      <p className="text-xs font-medium text-charcoal-muted">Step {idx} di 4</p>
      <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
        {STEP_LABELS[step]}
      </h1>
    </div>
  );
}

/* ─── Step 1 — Install authenticator app ─── */

function Step1Install({ onNext }: { onNext: () => void }) {
  return (
    <>
      <p className="text-sm text-charcoal-light">
        Per attivare MFA serve un&apos;app authenticator sul tuo telefono. Ne basta una.
        Se ne hai gi&agrave; una (1Password, Authy, Google Authenticator), salta al prossimo step.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AppCard
          name="Google Authenticator"
          ios="https://apps.apple.com/app/google-authenticator/id388497605"
          android="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2"
        />
        <AppCard
          name="1Password"
          ios="https://apps.apple.com/app/1password-7-password-manager/id1333542190"
          android="https://play.google.com/store/apps/details?id=com.onepassword.android"
        />
        <AppCard
          name="Authy"
          ios="https://apps.apple.com/app/twilio-authy/id494168017"
          android="https://play.google.com/store/apps/details?id=com.authy.authy"
        />
      </div>

      <button
        type="button"
        onClick={onNext}
        className="mt-6 w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark"
      >
        Avanti
      </button>
    </>
  );
}

function AppCard({ name, ios, android }: { name: string; ios: string; android: string }) {
  return (
    <div className="rounded-2xl border border-berry-subtle bg-white/60 p-4">
      <p className="text-sm font-semibold text-charcoal">{name}</p>
      <div className="mt-2 flex flex-col gap-1">
        <a
          href={ios}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-berry hover:text-berry-dark underline-offset-2 hover:underline"
        >iOS</a>
        <a
          href={android}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-berry hover:text-berry-dark underline-offset-2 hover:underline"
        >Android</a>
      </div>
    </div>
  );
}

/* ─── Step 2 — Scan QR ─── */

function Step2Scan({
  data,
  loading,
  error,
  onBack,
  onNext,
}: {
  data: { factorId: string; qrCode: string; secret: string } | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <p className="text-sm text-charcoal-light">
        Apri l&apos;app authenticator e scansiona il QR. Apparir&agrave;{" "}
        <strong>Holistic Unity</strong> tra i tuoi account.
      </p>

      {loading || !data ? (
        <div className="my-12 flex justify-center">
          <Loader />
        </div>
      ) : (
        <>
          <div className="mt-6 flex justify-center rounded-2xl bg-white p-4 shadow-inner">
            <Image src={data.qrCode} alt="QR per autenticatore" width={200} height={200} unoptimized />
          </div>
          <details className="mt-3 text-xs text-charcoal-muted">
            <summary className="cursor-pointer hover:text-charcoal">
              Non riesci a scansionare? Inserimento manuale
            </summary>
            <p className="mt-2 break-all rounded-lg bg-cream-dark/30 p-3 font-mono text-[11px] text-charcoal">
              {data.secret}
            </p>
          </details>
        </>
      )}

      {error && <ErrorText className="mt-3">{error}</ErrorText>}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-full border border-berry/20 py-3 font-medium text-charcoal hover:bg-berry/5"
        >
          Indietro
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!data}
          className="flex-1 rounded-full bg-berry py-3 font-semibold text-white shadow-md hover:bg-berry-dark disabled:opacity-50"
        >
          Avanti
        </button>
      </div>
    </>
  );
}

function Loader() {
  return <Spinner />;
}

/* ─── Step 3 — Verify code ─── */

function Step3Verify({
  code,
  setCode,
  verifying,
  error,
  onBack,
  onSubmit,
}: {
  code: string;
  setCode: (v: string) => void;
  verifying: boolean;
  error: string;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <p className="text-sm text-charcoal-light">
        Inserisci il codice a 6 cifre che vedi nell&apos;app. Cambia ogni 30 secondi.
      </p>

      <div className="mt-5">
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
          className="w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-charcoal outline-none focus:border-berry focus:ring-2 focus:ring-berry/10"
        />
      </div>

      {error && <ErrorText className="mt-3">{error}</ErrorText>}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-full border border-berry/20 py-3 font-medium text-charcoal hover:bg-berry/5"
        >
          Indietro
        </button>
        <button
          type="submit"
          disabled={verifying || code.length !== 6}
          className="flex-1 rounded-full bg-berry py-3 font-semibold text-white shadow-md hover:bg-berry-dark disabled:opacity-50"
        >
          {verifying ? "Verifica…" : "Conferma"}
        </button>
      </div>
    </form>
  );
}

/* ─── Step 4 — Backup codes display + acknowledgment ─── */

function Step4Backup({
  codes,
  acknowledged,
  setAcknowledged,
  submitting,
  onSubmit,
}: {
  codes: string[];
  acknowledged: boolean;
  setAcknowledged: (v: boolean) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  function downloadTxt() {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "holisticunity-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyAll() {
    await navigator.clipboard.writeText(codes.join("\n"));
  }

  return (
    <>
      <div className="rounded-2xl border-2 border-warning bg-warning/10 p-4 text-sm text-charcoal">
        <strong>Salva questi codici ora.</strong> Se perdi il telefono, ti permettono di
        recuperare l&apos;accesso senza contattare il supporto. <em>NON verranno mostrati di nuovo.</em>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-cream-dark/30 p-4">
        {codes.map((c) => (
          <code key={c} className="font-mono text-sm text-charcoal text-center py-1">
            {c}
          </code>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={downloadTxt}
          className="flex-1 rounded-full border border-berry/20 py-2 text-xs font-medium text-charcoal hover:bg-berry/5"
        >
          Scarica .txt
        </button>
        <button
          type="button"
          onClick={copyAll}
          className="flex-1 rounded-full border border-berry/20 py-2 text-xs font-medium text-charcoal hover:bg-berry/5"
        >
          Copia tutti
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex-1 rounded-full border border-berry/20 py-2 text-xs font-medium text-charcoal hover:bg-berry/5"
        >
          Stampa
        </button>
      </div>

      <label className="mt-5 flex items-start gap-2 text-sm text-charcoal">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-berry/20 text-berry focus:ring-berry/20"
        />
        <span>Ho salvato i miei codici di backup in un posto sicuro.</span>
      </label>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!acknowledged || submitting}
        className="mt-5 w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 hover:bg-berry-dark disabled:opacity-50"
      >
        {submitting ? "Apro la dashboard…" : "Vai alla dashboard"}
      </button>
    </>
  );
}
