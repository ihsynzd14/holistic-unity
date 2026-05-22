"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import {
  CLIENT_TOS_VERSION,
  THERAPIST_TOS_VERSION,
  TOS_URLS,
} from "@/lib/tos/version";
import { Loader2, ShieldCheck, ScrollText } from "lucide-react";
import { ErrorText } from "@/components/ui/ErrorText";

/**
 * Mandatory re-acceptance page — entered when:
 *   - A new client lands here via middleware right after email confirmation,
 *     before /welcome has had a chance to silently promote their /register
 *     acceptances. In that case `user_metadata.tos_pending_*` already covers
 *     general/privacy/vessatorie for the current version, so we only need
 *     to capture the Art.9 GDPR health-data consent (which is never ticked
 *     at registration). See the `pendingFromRegister` branch below.
 *   - A therapist signs in for the first time (no prior acceptance row).
 *   - Any user signs in after we bumped CLIENT_TOS_VERSION /
 *     THERAPIST_TOS_VERSION (Italian art. 1341 c.c. requires explicit
 *     re-acceptance for onerous-clause changes; "continued use" alone
 *     does not bind the user).
 *
 * The page locks the rest of the app via middleware until the required
 * checkboxes are ticked and the API accept route returns 200.
 */
export default function AcceptTermsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [role, setRole] = useState<"client" | "therapist">("client");
  const [acceptGeneral, setAcceptGeneral] = useState(false);
  const [acceptVessatorie, setAcceptVessatorie] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptHealthData, setAcceptHealthData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the signed-in user has `tos_pending_*` markers from /register
  // that cover the current TOS version for their role. In that mode we hide
  // the three already-ticked boxes and ask only for the health-data consent.
  const [pendingFromRegister, setPendingFromRegister] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const md = user.user_metadata as Record<string, unknown> | null;
      const detected = (md as { role?: string } | null)?.role;
      const detectedRole: "client" | "therapist" =
        detected === "therapist" ? "therapist" : "client";
      if (detectedRole === "therapist") setRole("therapist");

      // Promote-on-arrival: if the user just came from /register and their
      // pending markers cover the version we'd otherwise force them to
      // re-tick, treat the three boxes as already accepted and only ask
      // for the Art.9 GDPR health-data consent (which is NEVER captured at
      // registration — it's a separate explicit act per EDPB guidance).
      const requiredVersion =
        detectedRole === "therapist"
          ? THERAPIST_TOS_VERSION
          : CLIENT_TOS_VERSION;
      if (
        md?.tos_pending_version === requiredVersion &&
        md?.tos_pending_general === true &&
        md?.tos_pending_privacy === true &&
        md?.tos_pending_vessatorie === true
      ) {
        setPendingFromRegister(true);
        setAcceptGeneral(true);
        setAcceptPrivacy(true);
        setAcceptVessatorie(true);
      }
    })();
  }, [router]);

  const tosUrl = role === "therapist" ? TOS_URLS.therapist : TOS_URLS.client;
  const versionShown = role === "therapist" ? THERAPIST_TOS_VERSION : CLIENT_TOS_VERSION;
  const allChecked = acceptGeneral && acceptVessatorie && acceptPrivacy && acceptHealthData;

  async function submit() {
    if (!allChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tos/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          general: acceptGeneral,
          vessatorie: acceptVessatorie,
          privacy: acceptPrivacy,
          health_data: acceptHealthData,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Errore nel salvataggio. Riprova.");
        setSubmitting(false);
        return;
      }

      // Pending markers are now obsolete (audit row is written). Clear them
      // so /welcome's silent-promotion useEffect doesn't fire a redundant
      // POST that would 400 anyway because tos_pending_health_data was
      // false at registration. Best-effort — non-fatal if it fails.
      if (pendingFromRegister) {
        try {
          const supabase = createClient();
          await supabase.auth.updateUser({
            data: {
              tos_pending_version: null,
              tos_pending_general: null,
              tos_pending_vessatorie: null,
              tos_pending_privacy: null,
              tos_pending_health_data: null,
              tos_pending_accepted_at: null,
            },
          });
        } catch { /* swallow */ }
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError("Errore di rete. Riprova.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center px-4 py-10"
      style={{
        background:
          "linear-gradient(160deg, #FDF6F0 0%, #F0DFE5 40%, #7B2252 100%)",
      }}
    >
      <div className="relative z-10 w-full max-w-xl">
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
            {pendingFromRegister
              ? "Un ultimo passaggio"
              : role === "therapist"
                ? "Conferma Termini Operatore"
                : "Conferma Termini di Servizio"}
          </h1>
          <p className="mt-1 text-sm text-charcoal-light">
            {pendingFromRegister
              ? "Hai già accettato i Termini, l’Informativa Privacy e le clausole vessatorie alla registrazione. Manca solo il consenso esplicito al trattamento dei dati sulla salute."
              : role === "therapist"
                ? "Prima di accedere alla dashboard, leggi e approva i Termini Operatore."
                : "Abbiamo aggiornato i nostri Termini di Servizio. Ti chiediamo di rileggerli e confermare."}
          </p>
        </div>

        <div className="rounded-[22px] border border-white/60 bg-white/85 p-6 shadow-xl shadow-berry/10 backdrop-blur-xl space-y-5">
          {/* Read TOS link prominent — only when re-accepting the full set.
              In post-register mode the user just signed the same version,
              so a second link to the same document is just noise. */}
          {!pendingFromRegister && (
            <a
              href={tosUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border border-berry-subtle bg-white px-4 py-3 transition-all hover:border-berry"
            >
              <span className="flex items-center gap-2.5">
                <ScrollText className="h-5 w-5 text-berry" />
                <span className="text-sm font-medium text-charcoal">
                  Leggi i Termini completi (apre in nuova scheda)
                </span>
              </span>
              <span className="text-xs text-charcoal-muted">
                versione {versionShown}
              </span>
            </a>
          )}

          {pendingFromRegister ? (
            // Post-register simplified flow: three boxes are already covered
            // by the user_metadata.tos_pending_* markers stamped at signup.
            // We submit those values verbatim and only collect the missing
            // Art.9 GDPR explicit consent for health-data processing.
            <div className="space-y-3 rounded-xl border border-berry-subtle bg-berry-subtle/20 p-4">
              <label className="flex items-start gap-2.5 text-sm text-charcoal-light cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptHealthData}
                  onChange={(e) => setAcceptHealthData(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20 cursor-pointer"
                />
                <span>
                  Acconsento esplicitamente al trattamento dei dati relativi
                  alla salute necessari per l&rsquo;erogazione dei servizi
                  olistici e la gestione delle prenotazioni (art. 9, par. 2,
                  lett. a, GDPR).
                </span>
              </label>
            </div>
          ) : (
            // Full re-acceptance: four explicit checkboxes — separate boxes
            // are required for vessatorie clauses and health-data consent.
            <div className="space-y-3 rounded-xl border border-berry-subtle bg-berry-subtle/20 p-4">
              <label className="flex items-start gap-2.5 text-sm text-charcoal-light cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptPrivacy}
                  onChange={(e) => setAcceptPrivacy(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20 cursor-pointer"
                />
                <span>
                  Ho letto e accetto l&rsquo;
                  <a
                    href={TOS_URLS.privacy}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-berry hover:text-berry-dark underline"
                  >
                    Informativa Privacy (GDPR)
                  </a>
                  .
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-sm text-charcoal-light cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptGeneral}
                  onChange={(e) => setAcceptGeneral(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20 cursor-pointer"
                />
                <span>
                  Ho letto e accetto i{" "}
                  <a
                    href={tosUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-berry hover:text-berry-dark underline"
                  >
                    {role === "therapist"
                      ? "Termini e Condizioni per Operatori"
                      : "Termini e Condizioni per i Clienti"}
                  </a>{" "}
                  nella loro interezza.
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-sm text-charcoal-light cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptVessatorie}
                  onChange={(e) => setAcceptVessatorie(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20 cursor-pointer"
                />
                <span>
                  <strong>Approvazione specifica</strong> ai sensi degli artt. 1341 e
                  1342 c.c. delle clausole onerose elencate nella{" "}
                  <a
                    href={`${tosUrl}#section-${role === "therapist" ? "17" : "18"}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-berry hover:text-berry-dark underline"
                  >
                    Sezione {role === "therapist" ? "17" : "18"} dei Termini
                  </a>
                  . Confermo di aver letto ciascuna clausola e di averla compresa.
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-sm text-charcoal-light cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptHealthData}
                  onChange={(e) => setAcceptHealthData(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-berry-subtle text-berry focus:ring-berry/20 cursor-pointer"
                />
                <span>
                  Acconsento esplicitamente al trattamento dei dati relativi alla
                  salute necessari per l&rsquo;erogazione dei servizi olistici e la
                  gestione delle prenotazioni.
                </span>
              </label>
            </div>
          )}

          {error && (
            <ErrorText role="alert">{error}</ErrorText>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!allChecked || submitting}
            className="w-full rounded-full bg-berry py-3.5 font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvataggio in corso&hellip;
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Conferma e accedi
              </span>
            )}
          </button>

          <p className="text-center text-xs text-charcoal-muted/70">
            Questa accettazione viene registrata in modo permanente con data, IP
            e versione del documento per finalità di audit legale.
          </p>
        </div>
      </div>
    </div>
  );
}
