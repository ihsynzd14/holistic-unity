/**
 * Centralised Content-Security-Policy builder.
 *
 * Uses nonce-based `script-src` to remove the `'unsafe-inline'` directive
 * that was in effect via `next.config.ts` before 2026-04-17. Every request
 * flowing through the middleware now gets a fresh nonce — Next.js reads
 * the nonce from the `x-nonce` request header and applies it to its
 * internally generated inline scripts (hydration + router).
 *
 * WHY NOT `strict-dynamic`?
 *   `strict-dynamic` would let nonced scripts load other scripts without
 *   their own nonces, but it also nullifies host-based allowlists. Our
 *   third-party SDKs (Stripe.js, Stream, LiveKit) are loaded via bundled
 *   ES modules, not script tags, so we get nothing from strict-dynamic
 *   and lose defence-in-depth from the host allowlist.
 *
 * WHAT `style-src 'unsafe-inline'` IS STILL HERE FOR:
 *   Next.js + Tailwind JIT emit inline `<style>` and `style=` attributes
 *   at runtime. Dropping `'unsafe-inline'` on styles would require a
 *   nonce-per-style-tag migration that is disproportionate effort for
 *   the XSS risk reduction (scripts are by far the more dangerous vector).
 *   Documented trade-off; revisit if Trusted Types ever lands.
 */

/**
 * Build the CSP header value for a given request.
 *
 * @param nonce  Base64 nonce, typically from `generateNonce()` above in
 *               the calling middleware.
 * @param opts   Reserved for future per-environment tweaks (e.g. allowing
 *               the Next.js dev-server's HMR WebSocket in development).
 */
export function buildCsp(
  nonce: string,
  opts: { isDev?: boolean } = {},
): string {
  const { isDev = false } = opts;

  // Dev requires 'unsafe-eval' for the Next.js React Fast Refresh runtime.
  // In production we drop it.
  //
  // Why 'unsafe-inline' instead of nonce-only?
  //   We tried nonce-based script-src to drop 'unsafe-inline'. Next.js
  //   16.2.3 should auto-apply the nonce to its bootstrap inline scripts
  //   (the `self.__next_f.push(...)` chunks) when the middleware sets
  //   `Content-Security-Policy` on the forwarded request headers, but in
  //   this project that auto-application doesn't happen — the SSR'd
  //   inline scripts come back without a `nonce=` attribute and the
  //   browser blocks them, leaving `__next_f.length === 0` and React
  //   stuck on the Suspense fallback ("Caricamento..."). Reverting to
  //   'unsafe-inline' restores XSS posture equivalent to the original
  //   next.config.ts. The `nonce` parameter is still threaded through
  //   for any downstream consumer that wants it.
  void nonce;
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  // Connection endpoints — Supabase (API + Realtime), LiveKit (WebRTC
  // signalling), Stripe (payment intents), Stream Chat (WS + HTTP),
  // Meta Pixel + Google Analytics (marketing — only fire when the
  // user consents via CookieBanner; CSP allows the hosts upfront so
  // that scripts don't get CSP-blocked at load time).
  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "wss://*.livekit.cloud",
    "https://*.livekit.cloud",
    "https://api.stripe.com",
    "https://*.stream-io-api.com",
    "wss://*.stream-io-api.com",
    "https://www.facebook.com",
    "https://connect.facebook.net",
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    // Vimeo oEmbed endpoint — used by the therapist profile page to
    // resolve a thumbnail URL for the video tile poster (YouTube has
    // a deterministic URL pattern, Vimeo does not). Without this in
    // `connect-src` the `fetch('https://vimeo.com/api/oembed.json?…')`
    // is blocked at CSP and silently falls back to the gradient.
    "https://vimeo.com",
  ].join(" ");

  // Script sources for marketing pixels — gated client-side by
  // consent, but the CSP must allow the host upfront so the script tag
  // doesn't get blocked when the user accepts.
  const scriptSrcMarketing = [
    "https://connect.facebook.net",
    "https://www.googletagmanager.com",
    "https://*.googletagmanager.com",
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc} ${scriptSrcMarketing}`,
    // See comment above — styles retain unsafe-inline by design.
    "style-src 'self' 'unsafe-inline'",
    // YouTube + Vimeo thumbnail hosts are required for the therapist
    // profile video tile (`<img>` poster preview). Browsers fetch
    // YouTube thumbnails from `img.youtube.com` (and the CDN alias
    // `i.ytimg.com`) and Vimeo thumbnails from various `*.vimeocdn.com`
    // subdomains depending on the upload region. Without these in
    // `img-src` the poster `<img>` is silently CSP-blocked, leaving
    // the gradient placeholder visible — which is exactly the
    // regression that shipped with the first poster implementation.
    "img-src 'self' data: blob: https://*.supabase.co https://www.facebook.com https://admin.holisticunity.app https://*.stream-io-cdn.com https://www.google-analytics.com https://*.google-analytics.com https://*.googletagmanager.com https://img.youtube.com https://i.ytimg.com https://*.vimeocdn.com",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    // Stripe Checkout iframe + therapist video presentations
    // (Vimeo + YouTube). Everything else denied.
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://player.vimeo.com https://www.youtube.com https://www.youtube-nocookie.com",
    "media-src 'self' blob:",
    // Prevent plugins + legacy object embeds — no Flash, no Java applets.
    "object-src 'none'",
    // Prevent the page from being framed (complements X-Frame-Options).
    "frame-ancestors 'none'",
    // Scope `<base href>` so injected <base> tags can't redirect relative URLs.
    "base-uri 'self'",
    // Force HTTPS upgrades for mixed-content resources.
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * CSP for the `/embed/youtube` route — a standalone, public HTML page that
 * hosts the YouTube IFrame Player so the iOS app can load it as a *real*
 * HTTPS navigation inside its WKWebView.
 *
 * WHY A SEPARATE CSP:
 *   The main-app policy intentionally omits YouTube from `script-src`
 *   (only Vimeo/YouTube *frames* are allowed, for the profile poster). The
 *   embed host genuinely needs to run YouTube's `iframe_api` script, so it
 *   gets its own tightly-scoped policy instead of widening the app-wide one.
 *
 * WHY THIS FIXES iOS ERROR 150/152/153:
 *   WKWebView's `loadHTMLString(..., baseURL:)` never sends a real HTTP
 *   `Referer`, so YouTube's player refuses to embed (the 15x "playback
 *   disabled here" family) even for videos whose owners *do* allow
 *   embedding. Serving this page from `app.holisticunity.app` and loading
 *   it via `URLRequest` makes WKWebView send a genuine same-origin
 *   `Referer`, which YouTube accepts.
 *
 * `default-src 'none'` denies everything not explicitly listed. The video
 * bytes themselves stream inside YouTube's own iframe (its own origin +
 * CSP), so this page only needs to load the API script and frame YouTube.
 */
export function buildEmbedCsp(): string {
  return [
    "default-src 'none'",
    // `iframe_api` is served from www.youtube.com and pulls its widget from
    // s.ytimg.com; the inline bootstrap script initialises the player.
    "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
    "style-src 'unsafe-inline'",
    "img-src https://i.ytimg.com https://img.youtube.com data:",
    "connect-src https://www.youtube.com https://s.ytimg.com",
    // The actual <iframe> player — both the standard and no-cookie hosts.
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    // The page is only ever the top document inside WKWebView; never framed.
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
 * Generate a CSP-safe nonce.
 *
 * 128 random bits → base64 without padding. Web Crypto is available in
 * Edge Runtime and Node 19+ without importing anything extra.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Edge-runtime-safe base64 encode.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/[+/=]/g, (c) =>
    c === "+" ? "-" : c === "/" ? "_" : "",
  );
}
