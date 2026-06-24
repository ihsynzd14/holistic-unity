"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { TierLabel } from "@/components/ui/TierLabel";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayHeading } from "@/components/ui/DisplayHeading";
import type { TierKey } from "@/components/ui/TierIcon";

/**
 * First-login tier picker.
 *
 * Reached when the dashboard layout sees `requested_tier IS NULL` on the
 * therapist's row. Required to be completed once — after submit, the
 * dashboard stops redirecting here.
 *
 * Practitioner picks are auto-approved server-side (no claim to verify).
 * Trainer / Supervisor picks land as `pending` for admin review.
 */
const OPTIONS: Array<{
  tier: TierKey;
  title: string;
  requirements: string;
  reviewed: boolean;
}> = [
  {
    tier: "practitioner",
    title: "Praticante certificato",
    requirements:
      "Hai completato un percorso formativo certificato e operi con i clienti. Nessuna verifica aggiuntiva richiesta.",
    reviewed: false,
  },
  {
    tier: "trainer",
    title: "Forma altri praticanti",
    requirements:
      "Almeno 5 anni di esperienza professionale e attività di docenza. Certificazione avanzata nel tuo metodo.",
    reviewed: true,
  },
  {
    tier: "supervisor",
    title: "Livello supervisore",
    requirements:
      "Formatore di formatori, certificazione completa, esperienza pluriennale come supervisore di altri terapisti.",
    reviewed: true,
  },
];

export default function TierOnboardingPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [selected, setSelected] = useState<TierKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setAuthChecked(true);
    }
    void check();
  }, [router]);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/me/tier-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: selected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Impossibile inviare la richiesta");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Errore di rete. Riprova.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <Spinner />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-center gap-3">
          <Image
            src="/logo.png"
            alt="Holistic Unity"
            width={48}
            height={48}
            className="rounded-xl"
          />
          <div className="text-center">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-charcoal">
              Holistic Unity
            </h2>
            <p className="text-[11px] font-medium tracking-wide text-berry-muted">
              Onboarding terapista
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-berry/5 bg-white/70 p-8 shadow-sm backdrop-blur-sm">
          <DisplayHeading>Il tuo livello professionale</DisplayHeading>
          <p className="mt-2 text-sm text-charcoal-muted">
            Indica il livello che pensi di qualificare. Per <strong>Trainer</strong> e{" "}
            <strong>Supervisor</strong> la nostra amministrazione verificherà i
            certificati che hai caricato prima di rendere visibile il badge sul
            tuo profilo pubblico. <strong>Practitioner</strong> è il livello
            base e viene approvato automaticamente.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {OPTIONS.map(({ tier, title, requirements, reviewed }) => {
              const isSelected = selected === tier;
              return (
                <label
                  key={tier}
                  className={`flex cursor-pointer flex-col gap-3 rounded-2xl border-2 p-4 transition-all ${
                    isSelected
                      ? "border-berry bg-berry-subtle/30 shadow-sm"
                      : "border-berry/10 bg-white/70 hover:border-berry/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="onboarding_tier"
                    value={tier}
                    checked={isSelected}
                    onChange={() => setSelected(tier)}
                    className="sr-only"
                  />
                  <TierLabel tier={tier} compact />
                  <div>
                    <p className="text-sm font-semibold text-charcoal">{title}</p>
                    <p className="mt-1 text-xs text-charcoal-muted">{requirements}</p>
                    {reviewed && (
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-gold-dark">
                        Richiede verifica admin
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          {error && (
            <p className="mt-4 text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-berry/5 pt-5">
            <p className="text-xs text-charcoal-muted">
              Potrai cambiare la tua dichiarazione dal profilo in qualsiasi
              momento.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!selected || submitting}
              className="rounded-full bg-berry px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-berry/20 transition-all hover:bg-berry-dark active:scale-[0.97] disabled:opacity-50"
            >
              {submitting ? "Invio..." : "Continua"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
