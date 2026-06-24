import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";

const COUNT = 8;
const BCRYPT_COST = 12;

/**
 * Generate `COUNT` cryptographically random backup codes.
 * Format: 16 hex chars grouped 4-4-4-4 (e.g. "A3F2-9C81-04B5-EE6D").
 * Returns plaintext codes — caller must show to user once and persist
 * only the bcrypt hash via `hashCode()`.
 *
 * Entropy: 64 bits (16 hex chars). Combined with bcrypt cost 12 and
 * rate-limited recovery endpoint, this is well above the brute-force
 * threshold for the 8 unused codes outstanding at any time.
 */
export function generateCodes(): string[] {
  return Array.from({ length: COUNT }, () => {
    const hex = randomBytes(8).toString("hex").toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
  });
}

/**
 * Normalise a code (strip hyphens, uppercase) before hashing or
 * comparison so users can re-type with or without hyphens.
 */
function normalize(code: string): string {
  return code.replace(/-/g, "").toUpperCase();
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(normalize(code), BCRYPT_COST);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalize(code), hash);
}
