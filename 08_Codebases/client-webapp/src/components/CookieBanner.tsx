"use client";

import { useState, useSyncExternalStore } from "react";

function hasCookieAck(): boolean {
  if (typeof document === "undefined") return true;
  return /(?:^|;\s*)hu-cookies-ack=1/.test(document.cookie);
}

function subscribeToCookieAck(onStoreChange: () => void) {
  window.addEventListener("hu-cookie-ack-changed", onStoreChange);
  queueMicrotask(onStoreChange);
  return () => {
    window.removeEventListener("hu-cookie-ack-changed", onStoreChange);
  };
}

/**
 * GDPR-compliant cookie banner with granular consent.
 *
 * Two cookies are set based on user choice:
 *   - `hu-cookies-ack=1`     → user has seen the banner (always set)
 *   - `hu-marketing-ack=1`   → user accepted marketing/analytics
 *                              (only set if they chose "Accetta tutti")
 *
 * Both cookies have a 1-year TTL. The marketing cookie gates the
 * Meta Pixel (loaded by `MetaPixel.tsx`), and any future analytics /
 * marketing trackers MUST check `hu-marketing-ack=1` before firing.
 *
 * Why two buttons (not three)?
 *   Italian Garante Privacy guidance allows a binary choice as long
 *   as "Solo essenziali" is given equal visual weight to "Accetta
 *   tutti" — both are styled as buttons of comparable prominence.
 *   The "Personalizza" granular toggle is overkill for the few
 *   trackers we run today; revisit if we add Google Analytics +
 *   Hotjar + something else and want to let users opt into a subset.
 *
 * After accepting, a `hu-consent-changed` window event is dispatched
 * so the MetaPixel component (or any other consent-gated tracker)
 * can react without a page reload.
 */
export default function CookieBanner() {
  const hasAck = useSyncExternalStore(
    subscribeToCookieAck,
    hasCookieAck,
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  function persist(marketing: boolean) {
    const isHttps =
      typeof window !== "undefined" && window.location.protocol === "https:";
    const secure = isHttps ? "; secure" : "";
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `hu-cookies-ack=1; path=/; max-age=${maxAge}; samesite=lax${secure}`;
    if (marketing) {
      document.cookie = `hu-marketing-ack=1; path=/; max-age=${maxAge}; samesite=lax${secure}`;
    }
    // Notify consent-gated trackers (e.g. Meta Pixel) so they can
    // initialise without a full page reload.
    window.dispatchEvent(new CustomEvent("hu-cookie-ack-changed"));
    window.dispatchEvent(new CustomEvent("hu-consent-changed"));
    setDismissed(true);
  }

  if (hasAck || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-label="Informativa cookie"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-berry/15 bg-white/95 p-4 shadow-2xl shadow-berry/20 backdrop-blur-md sm:p-5">
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-charcoal-light sm:text-sm">
            Usiamo cookie tecnici essenziali per il funzionamento dell&apos;app
            (autenticazione, lingua, sicurezza). Con il tuo consenso utilizziamo
            anche cookie di analisi e marketing per misurare l&apos;efficacia
            delle nostre campagne (Google Analytics, Google Ads, Meta Pixel).
            Senza il tuo consenso registriamo solo segnali aggregati e
            anonimizzati.{" "}
            <a
              href="https://holisticunity.app/cookie-policy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-berry underline hover:text-berry-dark"
            >
              Maggiori info
            </a>
            .
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <button
              onClick={() => persist(false)}
              className="flex-1 rounded-full border border-berry/30 bg-white px-5 py-2.5 text-sm font-semibold text-berry transition-all hover:bg-berry-subtle/40 active:scale-95"
            >
              Solo essenziali
            </button>
            <button
              onClick={() => persist(true)}
              className="flex-1 rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark active:scale-95"
            >
              Accetta tutti
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
