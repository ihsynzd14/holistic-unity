"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const PIXEL_ID = "1445760663897743";

/**
 * Meta (Facebook) Pixel — consent-gated marketing tracker.
 *
 * GDPR / Italian Garante Privacy compliance:
 *   - The pixel does NOT load until `hu-marketing-ack=1` cookie is
 *     present. The cookie is set by `CookieBanner.tsx` only when the
 *     user clicks "Accetta tutti".
 *   - If the user clicks "Solo essenziali" (or hasn't seen the banner
 *     yet), nothing is loaded — no script tag, no network requests.
 *   - We listen for `hu-consent-changed` window events so that
 *     accepting consent fires the pixel immediately without a full
 *     page reload.
 *
 * Why a custom component (not a third-party SDK)?
 *   The official Meta snippet is small and stable. Wrapping it in a
 *   React component lets us (a) gate it behind consent, (b) handle
 *   App Router SPA navigation (which doesn't trigger fbq("PageView")
 *   automatically — we have to do it on every `pathname` change).
 *
 * What's tracked today: PageView only. To add conversion events
 * later (Lead, CompleteRegistration, Purchase), call `fbq("track",
 * ...)` from the relevant client component — `window.fbq` is
 * available globally once this component has fired.
 */
type FbqFn = (...args: unknown[]) => void;
type FbqStub = FbqFn & {
  callMethod?: (...args: unknown[]) => void;
  push: FbqFn | FbqStub;
  loaded: boolean;
  version: string;
  queue: unknown[][];
};

declare global {
  interface Window {
    fbq?: FbqStub;
    _fbq?: FbqStub;
  }
}

function hasMarketingConsent(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)hu-marketing-ack=1/.test(document.cookie);
}

function loadPixel() {
  if (typeof window === "undefined") return;
  // Idempotent: if already loaded, skip the script-injection step.
  if (window.fbq) return;

  // Standard Meta Pixel install snippet, transcribed to TS-safe form.
  const b: Document = document;
  const e = "script";
  const v = "https://connect.facebook.net/en_US/fbevents.js";
  if (window.fbq) return;
  const n = function (...args: unknown[]) {
    if (n.callMethod) {
      n.callMethod(...args);
      return;
    }
    n.queue.push(args);
  } as FbqStub;
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  const t = b.createElement(e) as HTMLScriptElement;
  t.async = true;
  t.src = v;
  const s = b.getElementsByTagName(e)[0];
  s.parentNode?.insertBefore(t, s);

  // Use the local stub so init/PageView queue safely before fbevents.js
  // finishes loading and replaces the queue with the real implementation.
  n("init", PIXEL_ID);
  n("track", "PageView");
}

export default function MetaPixel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialised = useRef(false);

  // Initial load + react to consent changes.
  useEffect(() => {
    function tryInit() {
      if (initialised.current) return;
      if (!hasMarketingConsent()) return;
      loadPixel();
      initialised.current = true;
    }

    tryInit();
    window.addEventListener("hu-consent-changed", tryInit);
    return () => window.removeEventListener("hu-consent-changed", tryInit);
  }, []);

  // Track route changes (App Router SPA navigation doesn't trigger
  // fbevents.js's automatic PageView — we have to call it manually).
  useEffect(() => {
    if (!initialised.current) return;
    if (!hasMarketingConsent()) return;
    window.fbq?.("track", "PageView");
  }, [pathname, searchParams]);

  return null;
}
