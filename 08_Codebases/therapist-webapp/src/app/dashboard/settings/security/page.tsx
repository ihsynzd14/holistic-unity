"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, KeyRound, RefreshCw, Loader2 } from "lucide-react";

/**
 * Security settings page — MFA status + backup codes management.
 *
 * Features:
 *  - Shows MFA enrolled state + current AAL.
 *  - Shows count of unused backup codes.
 *  - "Rigenera codici" button (requires AAL2 — current TOTP must work).
 *  - Display of newly-generated codes (one-time, with acknowledgment).
 *
 * Disabling MFA is intentionally NOT exposed: enrollment is mandatory
 * for therapists. Admin override exists for genuine recovery needs.
 */
export default function SecurityPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [aal, setAal] = useState<"aal1" | "aal2" | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [showNewCodes, setShowNewCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError("");
    try {
      const supabase = createClient();
      const [{ data: factors }, { data: aalData }, codesRes] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        fetch("/api/security/backup-codes/count"),
      ]);
      const verified = (factors?.totp ?? []).some((f) => f.status === "verified");
      setEnrolled(verified);
      setAal((aalData?.currentLevel ?? "aal1") as "aal1" | "aal2");
      if (codesRes.ok) {
        const j = await codesRes.json();
        setRemaining(j.remaining);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore caricamento");
    }
  }

  async function regenerate() {
    if (aal !== "aal2") {
      setError("Devi essere in sessione AAL2 (TOTP attivo) per rigenerare.");
      return;
    }
    if (!confirm(
      "Vuoi rigenerare i codici di backup? I codici attuali smetteranno di funzionare immediatamente.",
    )) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/security/backup-codes", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "regen_failed");
      }
      const { codes } = await res.json();
      setShowNewCodes(codes);
      setAcknowledged(false);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore rigenerazione");
    } finally {
      setBusy(false);
    }
  }

  function downloadTxt() {
    if (!showNewCodes) return;
    const blob = new Blob([showNewCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "holisticunity-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (enrolled === null) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Loader2 className="h-6 w-6 animate-spin text-berry" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
        Sicurezza
      </h1>

      {/* MFA status card */}
      <section className="rounded-2xl border border-berry/10 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-berry-subtle">
            <ShieldCheck className="h-5 w-5 text-berry" strokeWidth={1.75} />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-charcoal">Autenticazione a due fattori (MFA)</h2>
            <p className="mt-1 text-sm text-charcoal-light">
              {enrolled ? "Attivo" : "Non attivo"} · Sessione{" "}
              <span className="font-mono text-xs">{aal === "aal2" ? "AAL2 (TOTP verificato)" : "AAL1 (solo password)"}</span>
            </p>
          </div>
        </div>
      </section>

      {/* Backup codes card */}
      {enrolled && (
        <section className="rounded-2xl border border-berry/10 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-berry-subtle">
              <KeyRound className="h-5 w-5 text-berry" strokeWidth={1.75} />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-charcoal">Codici di backup</h2>
              <p className="mt-1 text-sm text-charcoal-light">
                Codici rimanenti: <strong>{remaining ?? "—"} su 8</strong>
              </p>
              <p className="mt-1 text-xs text-charcoal-muted">
                Servono a recuperare l&apos;accesso se perdi il telefono. Rigenerali se ne hai usati troppi
                o sospetti che siano compromessi — i vecchi smetteranno di funzionare immediatamente.
              </p>

              {showNewCodes ? (
                <div className="mt-4 rounded-2xl border-2 border-warning bg-warning/10 p-4">
                  <p className="text-sm font-semibold text-charcoal">
                    Nuovi codici (mostrati una volta sola):
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-cream-dark/30 p-3">
                    {showNewCodes.map((c) => (
                      <code key={c} className="font-mono text-xs text-charcoal text-center py-1">
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
                      onClick={() => navigator.clipboard.writeText(showNewCodes.join("\n"))}
                      className="flex-1 rounded-full border border-berry/20 py-2 text-xs font-medium text-charcoal hover:bg-berry/5"
                    >
                      Copia tutti
                    </button>
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm text-charcoal">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    <span>Ho salvato i nuovi codici.</span>
                  </label>
                  <button
                    type="button"
                    disabled={!acknowledged}
                    onClick={() => setShowNewCodes(null)}
                    className="mt-3 rounded-full bg-berry px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    Chiudi
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy || aal !== "aal2"}
                  onClick={regenerate}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white shadow-md hover:bg-berry-dark disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {busy ? "Rigenerazione…" : "Rigenera codici"}
                </button>
              )}
              {aal !== "aal2" && !showNewCodes && (
                <p className="mt-2 text-xs text-charcoal-muted">
                  Per rigenerare devi avere TOTP attivo nella sessione corrente (AAL2).
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {error && (
        <p className="rounded-xl bg-error/10 px-4 py-2 text-sm text-error">{error}</p>
      )}
    </div>
  );
}
