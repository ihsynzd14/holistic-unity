"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Google Analytics 4 — Consent Mode v2 with cookieless pings.
 *
 * Architecture:
 *   - Reads NEXT_PUBLIC_GA_MEASUREMENT_ID at build time
 *   - Loads `gtag.js` IMMEDIATELY (no consent gate on the script itself)
 *   - Sets default consent state to DENIED for all signals before any
 *     network call — Google's `consent default` MUST come before `config`
 *   - When the user accepts marketing in CookieBanner, fires
 *     `consent('update', { granted })` — gtag promotes the prior pings
 *     to full conversions
 *   - When the user denies, gtag still sends *cookieless pings* without
 *     PII; Google reconstructs missed conversions via behavioral modeling
 *   - Tracks SPA route changes by emitting `page_view` events on pathname
 *     change (App Router doesn't reload gtag.js between pages)
 *
 * Why this beats the consent-gated approach:
 *   - Consent Mode v2 is mandatory in EU (March 2024+) for Google Ads
 *     personalization; without it, attribution breaks
 *   - Modeled conversions recover ~15-30% of users who deny cookies
 *     (Safari iOS users, GDPR-conscious EU users)
 *   - The cookieless pings carry no PII so they remain GDPR-safe
 */

type GTagFn = (
  command: "config" | "event" | "set" | "consent" | "js",
  ...args: unknown[]
) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GTagFn;
  }
}

function hasMarketingConsent(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)hu-marketing-ack=1/.test(document.cookie);
}

/**
 * Initialise dataLayer + gtag function and set the default consent state.
 * This MUST run before gtag.js is loaded so the script picks up the
 * `denied` defaults on first request.
 */
function bootstrapGtag() {
  if (typeof window === "undefined") return;
  if (window.gtag) return; // already bootstrapped

  window.dataLayer = window.dataLayer || [];
  const gtag: GTagFn = function (...args: unknown[]) {
    (window.dataLayer as unknown[]).push(args);
  };
  window.gtag = gtag;

  // Consent Mode v2 default — denied for all signals.
  // `wait_for_update` gives the page 500ms to call consent('update', ...)
  // before sending the first ping, so an immediate "Accetta tutti" click
  // is reflected in the first event rather than firing a denied ping
  // followed by a granted one.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    wait_for_update: 500,
  });
}

function loadGtagScript(measurementId: string) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[data-hu-gtag="${measurementId}"]`)) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
    measurementId,
  )}`;
  script.dataset.huGtag = measurementId;
  document.head.appendChild(script);

  // `js` MUST come first, then config.
  // `anonymize_ip` keeps us GDPR-friendly (PII stripped).
  // `send_page_view: false` because we fire PageView ourselves on every
  // route change (App Router won't reload gtag.js).
  // `linker.domains` stitches sessions when the user crosses from the
  // marketing site (holisticunity.app) into this webapp
  // (app.holisticunity.app) — without it, the GA client_id resets at the
  // subdomain boundary and Google Ads sees the post-signup /welcome hit
  // as a new session, breaking conversion attribution.
  window.gtag?.("js", new Date());
  window.gtag?.("config", measurementId, {
    anonymize_ip: true,
    send_page_view: false,
    linker: {
      domains: ["holisticunity.app", "app.holisticunity.app"],
      accept_incoming: true,
    },
  });
}

function grantConsent() {
  window.gtag?.("consent", "update", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  });
}

export default function GoogleAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scriptLoaded = useRef(false);
  const consentGranted = useRef(false);

  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  // 1) Bootstrap gtag + load the script ONCE per session.
  //    The script itself loads regardless of consent (Consent Mode v2 pattern).
  useEffect(() => {
    if (!measurementId) return;
    if (scriptLoaded.current) return;

    bootstrapGtag();
    loadGtagScript(measurementId);
    scriptLoaded.current = true;

    // If the user already accepted in a prior session, propagate it now.
    if (hasMarketingConsent() && !consentGranted.current) {
      grantConsent();
      consentGranted.current = true;
    }
  }, [measurementId]);

  // 2) Listen for consent changes from CookieBanner. Promote denied → granted
  //    when the user accepts marketing; we never demote granted → denied
  //    in-session (the user would have to clear cookies to revoke).
  useEffect(() => {
    function onConsentChange() {
      if (consentGranted.current) return;
      if (!hasMarketingConsent()) return;
      grantConsent();
      consentGranted.current = true;
    }
    window.addEventListener("hu-consent-changed", onConsentChange);
    return () => window.removeEventListener("hu-consent-changed", onConsentChange);
  }, []);

  // 3) Fire a page_view on every route change (SPA navigation). Even with
  //    consent denied, this sends a cookieless ping that fuels Google's
  //    behavioral modeling for recovered conversions.
  useEffect(() => {
    if (!measurementId) return;
    if (!scriptLoaded.current) return;

    const path = pathname + (searchParams?.toString() ? `?${searchParams}` : "");
    window.gtag?.("event", "page_view", {
      page_path: path,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, searchParams, measurementId]);

  return null;
}
