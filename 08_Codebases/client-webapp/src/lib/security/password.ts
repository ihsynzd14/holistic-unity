/**
 * Password validation helpers.
 *
 * NIST SP 800-63B (2024) guidance, applied:
 *   - Min 8 chars — the NIST floor. We previously used 12 to match the
 *     "modern industry standard," but real signup-completion data
 *     (May 2026) showed people abandoning at the password step because
 *     they couldn't satisfy a 12-char + composition rule on their phone.
 *     8 chars + a breach check is materially safer than 12 chars +
 *     people writing it on a sticky note, because length-only rules
 *     don't push users toward predictable substitutions ("Password1!"
 *     style) and the HIBP backstop catches the worst common choices.
 *   - Permit but do NOT enforce composition rules (NIST argues they
 *     reduce entropy by pushing users toward predictable patterns).
 *     We keep a minimal letter+digit rule so that "12345678" or
 *     "aaaaaaaa" still fails — it is NOT load-bearing security.
 *   - Block passwords found in known breaches via the HaveIBeenPwned
 *     k-anonymity API (only the first 5 chars of the SHA-1 hash leave
 *     the device — the API returns ~600 candidate hashes for the
 *     prefix and we match the suffix locally). This is the real
 *     security gate, not the length number.
 *
 * NOTE: Supabase Auth also enforces its own password policy at the
 * project level (Dashboard → Authentication → Policies → Password
 * Requirements). Keep the Supabase policy aligned with this constant
 * — otherwise the client passes and Supabase rejects, which is the
 * worst possible UX (a server error users can't act on).
 */

export const MIN_PASSWORD_LENGTH = 8;

export function validatePasswordShape(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "La password deve contenere almeno una lettera e un numero.";
  }
  return null;
}

/**
 * Computes the SHA-1 hex of a string using SubtleCrypto (browser-native).
 * SHA-1 is appropriate here precisely because the HIBP database is keyed
 * on SHA-1 — this is a lookup, not a security primitive.
 */
async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Returns true if the password appears in any known data breach
 * indexed by HaveIBeenPwned. Privacy-preserving: only the first 5 hex
 * chars of the password's SHA-1 ever leave the client.
 *
 * Fail-open: any network or API error returns `false` (i.e. proceed).
 * The cost of blocking signups due to HIBP being down would outweigh
 * the security benefit, since we're not the only line of defense.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        method: "GET",
        headers: { "Add-Padding": "true" }, // hides match count via padding
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    if (!res.ok) return false;

    const text = await res.text();
    return text
      .split("\n")
      .some((line) => line.split(":")[0]?.trim() === suffix);
  } catch {
    return false; // fail-open
  }
}
