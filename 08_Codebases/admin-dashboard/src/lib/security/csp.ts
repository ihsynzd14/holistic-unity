/**
 * Content-Security-Policy builder for the admin dashboard.
 *
 * Tighter than the therapist webapp's CSP because the admin UI doesn't
 * embed any third-party client SDKs (Stripe is called only from server
 * routes, LiveKit/Stream aren't used at all). Only Supabase shows up in
 * `connect-src`.
 *
 * See `therapist-webapp/src/lib/security/csp.ts` for a fuller discussion
 * of the nonce trade-offs. Rationale is identical across both apps.
 */

export function buildCsp(
  nonce: string,
  opts: { isDev?: boolean } = {},
): string {
  const { isDev = false } = opts;

  // 'unsafe-inline' instead of nonce-only: Next.js 16.2.3 doesn't apply
  // the nonce to its bootstrap inline scripts in this project, which
  // breaks hydration when CSP is nonce-based. Same trade-off documented
  // in therapist-webapp/src/lib/security/csp.ts.
  void nonce;
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-src 'none'",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/[+/=]/g, (c) =>
    c === "+" ? "-" : c === "/" ? "_" : "",
  );
}
