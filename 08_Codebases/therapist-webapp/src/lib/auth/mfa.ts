import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MFA helpers built on top of Supabase Auth's TOTP MFA.
 *
 * Concepts:
 *   - "Factor" = a registered second-factor device (e.g. an authenticator
 *     app). Stored in `auth.mfa_factors` by Supabase.
 *   - "AAL" (Authentication Assurance Level):
 *       aal1 = password only
 *       aal2 = password + verified MFA code in the current session
 *   - "Challenge" = a one-time token Supabase generates so we can verify
 *     a TOTP code. Lives ~5 minutes.
 *
 * Pattern:
 *   - At login: enrolled factors get a redirect to /verify-mfa
 *   - At /verify-mfa: user enters TOTP code → session upgrades to aal2
 *   - Sensitive surfaces (admin dashboard) check session.aal === "aal2"
 *     and bounce back to /verify-mfa otherwise.
 */

export type MfaStatus = {
  /** True if the user has at least one verified TOTP factor */
  enrolled: boolean;
  /** Current session AAL level */
  aal: "aal1" | "aal2";
  /** AAL the user *could* reach (relevant for the login → MFA hand-off) */
  nextAal: "aal1" | "aal2";
  /** First verified factor id (used to issue challenges) */
  factorId: string | null;
};

export async function getMfaStatus(supabase: SupabaseClient): Promise<MfaStatus> {
  const [{ data: factors }, { data: aalData }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const verifiedTotp = (factors?.totp ?? []).filter(
    (f) => f.status === "verified",
  );

  return {
    enrolled: verifiedTotp.length > 0,
    aal: (aalData?.currentLevel ?? "aal1") as "aal1" | "aal2",
    nextAal: (aalData?.nextLevel ?? "aal1") as "aal1" | "aal2",
    factorId: verifiedTotp[0]?.id ?? null,
  };
}

/**
 * Begin TOTP enrollment. Returns a QR code URI (otpauth://) the user
 * scans into Google Authenticator / 1Password / Authy, plus the secret
 * for manual entry.
 *
 * The factor is created in `unverified` state — a successful
 * verifyEnrollment() flips it to `verified`.
 */
export async function enrollFactor(supabase: SupabaseClient) {
  // Clean up any stale unverified factors first — Supabase rejects new
  // enrollments while an unverified TOTP factor exists for the user.
  // The Supabase types only declare `status: "verified"` but at runtime
  // it can also be "unverified" — cast through string to make TS accept
  // the comparison.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.totp ?? []) {
    if ((f.status as string) !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Holistic Unity ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/**
 * Confirm an enrollment by verifying a TOTP code. On success the factor
 * status flips to `verified` AND the current session upgrades to aal2
 * (since the user just proved possession).
 */
export async function verifyEnrollment(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
) {
  const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (chErr) throw chErr;
  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (vErr) throw vErr;
  return { ok: true };
}

/**
 * Verify a TOTP code against an existing verified factor — used at
 * login time to upgrade the just-created aal1 session to aal2.
 */
export async function verifyChallenge(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
) {
  const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (chErr) throw chErr;
  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (vErr) throw vErr;
  return { ok: true };
}

/**
 * Disable MFA by removing all verified TOTP factors. Use only when the
 * user explicitly opts out (and the policy allows it — admin policy
 * forbids disabling).
 */
export async function disableMfa(supabase: SupabaseClient) {
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.totp ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
}

// NOTE: `verifyBackupCodeAndDisable` lives in `./mfa-server.ts` because
// it pulls in `bcrypt` (Node-only). Keeping it out of this file lets
// client components safely import the rest of the helpers above.
