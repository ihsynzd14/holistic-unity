import { Clock, AlertTriangle } from "lucide-react";
import type { TierKey } from "./TierIcon";

export type TierRequestStatus = "pending" | "approved" | "rejected";

const TIER_LABEL: Record<TierKey, string> = {
  practitioner: "Practitioner",
  trainer: "Trainer",
  supervisor: "Supervisor",
};

type Props = {
  status: TierRequestStatus | null;
  requestedTier: TierKey | null;
  className?: string;
};

/**
 * Shows the therapist the state of their tier upgrade request.
 * Renders nothing when there's no active request to communicate
 * (status is null, approved, or no requested_tier set).
 *
 * Approved is intentionally silent — the new tier badge appearing in
 * the hero is itself the "approved" signal. Showing both would be
 * noise.
 */
export function TierPendingBanner({ status, requestedTier, className }: Props) {
  if (!status || !requestedTier || status === "approved") return null;

  if (status === "pending") {
    return (
      <div
        className={`flex items-start gap-3 rounded-2xl border border-warning/20 bg-warning-light px-4 py-3 text-sm ${className ?? ""}`}
      >
        <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
        <div>
          <p className="font-semibold text-charcoal">
            Richiesta tier {TIER_LABEL[requestedTier]} in revisione
          </p>
          <p className="mt-0.5 text-xs text-charcoal-muted">
            Vedrai il badge sul tuo profilo pubblico non appena
            l&apos;amministrazione approva i certificati che hai caricato.
          </p>
        </div>
      </div>
    );
  }

  // rejected
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-error/20 bg-error-light px-4 py-3 text-sm ${className ?? ""}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-error" />
      <div>
        <p className="font-semibold text-charcoal">
          Richiesta tier {TIER_LABEL[requestedTier]} non approvata
        </p>
        <p className="mt-0.5 text-xs text-charcoal-muted">
          Carica certificati aggiornati e invia una nuova richiesta dal tuo
          profilo.
        </p>
      </div>
    </div>
  );
}
