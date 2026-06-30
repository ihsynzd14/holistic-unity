import { createHmac, randomUUID } from "crypto";

// H6: Require ICAL_SECRET — no weak fallback to anon key or hardcoded default
const ICAL_SECRET = process.env.ICAL_SECRET;
if (!ICAL_SECRET) {
  console.error("FATAL: ICAL_SECRET environment variable is not set. iCal feeds will not work.");
}

/**
 * Derives a deterministic token for the iCal feed URL.
 * Uses HMAC-SHA256 so we don't need to store tokens in the DB.
 */
export function generateIcalToken(therapistId: string): string {
  if (!ICAL_SECRET) throw new Error("ICAL_SECRET not configured");
  return createHmac("sha256", ICAL_SECRET).update(therapistId).digest("hex").slice(0, 32);
}

/**
 * Validates an iCal token against the expected value.
 */
export function validateIcalToken(therapistId: string, token: string): boolean {
  const expected = generateIcalToken(therapistId);
  // Constant-time comparison to prevent timing attacks
  if (token.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

type OAuthStatePayload = {
  therapistId: string;
  timestamp: number;
  nonce: string;
};

const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || ICAL_SECRET;
if (!process.env.OAUTH_STATE_SECRET) {
  // Fallback to ICAL_SECRET is a deliberate dev-onboarding shortcut, but
  // in production they should be distinct: a leak of one shouldn't
  // compromise the other (ICAL_SECRET appears in public iCal feed URLs
  // and could plausibly be shoulder-surfed; OAUTH_STATE_SECRET signs
  // CSRF tokens for the calendar OAuth flow). Warn loudly at boot.
  console.warn(
    "OAUTH_STATE_SECRET not set — falling back to ICAL_SECRET. " +
    "Set OAUTH_STATE_SECRET to a distinct random value in production.",
  );
}

function signStatePayload(payload: string): string {
  if (!OAUTH_STATE_SECRET) throw new Error("OAuth state secret not configured");
  return createHmac("sha256", OAUTH_STATE_SECRET).update(payload).digest("base64url");
}

/**
 * Build an OAuth state token: base64(payload).HMAC(payload).
 *
 * Defence in depth:
 *   - HMAC signature with OAUTH_STATE_SECRET prevents tampering.
 *   - `nonce` is a crypto-random UUID so the payload is non-deterministic
 *     even for the same therapist and timestamp second.
 *   - Callers must also check `timestamp` is within 15 minutes and
 *     `therapistId === currentUser.id` (defended in each callback).
 */
export function createOAuthState(therapistId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      therapistId,
      timestamp: Date.now(),
      nonce: randomUUID(),
    } satisfies OAuthStatePayload)
  ).toString("base64url");
  const signature = signStatePayload(payload);
  return `${payload}.${signature}`;
}

export function parseOAuthState(state: string): OAuthStatePayload | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = signStatePayload(payload);
  if (expected.length !== signature.length) return null;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }

  if (diff !== 0) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as OAuthStatePayload;
  } catch {
    return null;
  }
}

// ── Google OAuth helpers ─────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    // Only calendar.freebusy — we read free/busy to block already-busy slots
    // and NEVER write events (bookings reach the user's calendar via the .ics /
    // Google links in the confirmation emails). calendar.freebusy is a
    // non-sensitive scope, so this drops the sensitive calendar.events scope
    // that was triggering Google's "unverified app" warning + scope verification.
    scope: "https://www.googleapis.com/auth/calendar.freebusy",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  return res.json();
}

export async function refreshGoogleToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  return res.json();
}

export async function revokeGoogleToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
}

// ── Microsoft OAuth helpers ──────────────────────────────────

const MS_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const MS_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || "";
const MS_TENANT = "common"; // supports personal + work accounts

export function getMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    redirect_uri: MS_REDIRECT_URI,
    response_type: "code",
    scope: "offline_access Calendars.ReadBasic Calendars.ReadWrite",
    response_mode: "query",
    state,
  });
  return `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeMicrosoftCode(code: string) {
  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      redirect_uri: MS_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  return res.json();
}

export async function refreshMicrosoftToken(refreshToken: string) {
  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  return res.json();
}

/**
 * Gets a valid access token for a calendar integration,
 * refreshing if expired. Updates the DB with new tokens.
 */
export async function getValidAccessToken(
  integration: {
    access_token: string;
    refresh_token: string;
    token_expires_at: string;
    provider: "google" | "microsoft";
    id: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any }
): Promise<string> {
  const expiresAt = new Date(integration.token_expires_at);
  const now = new Date();
  // Refresh if expiring within 5 minutes
  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return integration.access_token;
  }

  const data =
    integration.provider === "google"
      ? await refreshGoogleToken(integration.refresh_token)
      : await refreshMicrosoftToken(integration.refresh_token);

  if (data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from("therapist_calendar_integrations")
    .update({
      access_token: data.access_token,
      token_expires_at: newExpiry,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  return data.access_token;
}
