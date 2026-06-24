"use client";

import { useState, useSyncExternalStore } from "react";

function hasCookieAck() {
  return /(?:^|;\s*)hu-cookies-ack=1/.test(document.cookie);
}

function subscribeCookieAck() {
  return () => {};
}

function getCookieAckSnapshot() {
  return typeof document !== "undefined" && !hasCookieAck();
}

function getServerCookieAckSnapshot() {
  return false;
}

/**
 * Minimal cookie banner — EU Cookie Directive compliant for the
 * cookies we actually set today (essential auth + i18n + CSP nonce).
 *
 * We don't run analytics, marketing pixels, or third-party trackers
 * yet, so the banner is informational + acknowledge-only. If we
 * later add Google Analytics / Meta Pixel / hotjar, this component
 * needs to be upgraded to a full consent UI (granular toggles,
 * "reject all" button, conditional script-loading).
 *
 * State stored in `hu-cookies-ack=1` cookie (1-year TTL). Reading the
 * cookie on first render avoids the SSR flash since we hide the
 * banner until the client confirms it's needed.
 */
export default function CookieBanner() {
  const needsAck = useSyncExternalStore(
    subscribeCookieAck,
    getCookieAckSnapshot,
    getServerCookieAckSnapshot,
  );
  const [dismissed, setDismissed] = useState(false);

  function accept() {
    document.cookie = `hu-cookies-ack=1; path=/; max-age=${
      60 * 60 * 24 * 365
    }; samesite=lax${
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "; secure"
        : ""
    }`;
    setDismissed(true);
  }

  const show = needsAck && !dismissed;

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Informativa cookie"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-berry/15 bg-white/95 p-4 shadow-2xl shadow-berry/20 backdrop-blur-md sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <p className="flex-1 text-xs leading-relaxed text-charcoal-light sm:text-sm">
            Usiamo cookie tecnici essenziali per il funzionamento dell&apos;app
            (autenticazione, lingua, sicurezza). Non usiamo cookie di
            tracciamento o profilazione.{" "}
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
          <button
            onClick={accept}
            className="flex-shrink-0 rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all hover:bg-berry-dark active:scale-95"
          >
            Ho capito
          </button>
        </div>
      </div>
    </div>
  );
}
