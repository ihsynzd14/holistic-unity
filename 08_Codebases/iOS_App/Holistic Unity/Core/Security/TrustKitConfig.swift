import Foundation
import TrustKit
import os.log

/// Certificate pinning configuration for Holistic Unity.
///
/// Strategy: V1 starts in **reporting mode only** (pinning NOT enforced).
/// Pin mismatches are logged to the system log and (optionally) sent to
/// a report URI. After 7–14 days of production traffic with zero false
/// positives, flip `kTSKEnforcePinning` to `true` to hard-fail mismatches.
///
/// Reporting mode reduces risk of bricking the app if a pin is wrong or
/// a backend rotates certs unexpectedly — the user experience is unaffected.
///
/// Pinning scope: ONLY the two domains we control end-to-end
///   • Supabase  (our backend, auth+DB+storage+edge functions)
///   • Stripe    (money path, highest sensitivity)
///
/// Intentionally NOT pinning: Stream Chat, LiveKit, Sentry, Google OAuth,
/// Apple. Third-party SDKs rotate certs on their own schedule (often
/// unannounced); pinning them risks multi-hour outages. Their TLS chain
/// is already validated by iOS default; pinning is belt-and-suspenders
/// we can add later if warranted.
///
/// To update pins after cert rotation:
///   1. Run the shell script at the bottom of TrustKitConfig (in comments)
///      to capture the new SPKI hashes.
///   2. Add the new hash to the domain's `kTSKPublicKeyHashes` list —
///      ALWAYS keep the previous one too (at least 2 pins total) so the
///      app doesn't break during the rotation window.
///   3. Remove the oldest hash only after confirming the rotation landed.
enum TrustKitConfig {

    private static let logger = Logger(subsystem: AppConstants.appBundleId, category: "TrustKit")

    /// Public key hashes (SHA-256, base64) for the pinned domains.
    /// Two pins per domain minimum — the second is a backup so a cert
    /// rotation doesn't brick the app. Fill in below with real values
    /// extracted via the shell script in the MARK: Extract Pins section.
    ///
    /// Placeholder values intentionally invalid so Reporting Mode catches
    /// them and logs — you'll see the real hashes in the console during
    /// the first run, paste them here, and re-deploy.
    // Extracted on 2026-04-17 from live TLS handshake with bqyqkvkzkemiwyqjkbna.supabase.co.
    // Leaf = current cert (rotates ~90 days with Let's Encrypt).
    // Intermediate = backup pin — more stable, saves us during leaf rotation.
    private static let supabasePins: [String] = [
        "GU2W4j1P24T3sqlI+o6YTnidzz0PI8fB/Gvd2ITfSZE=", // leaf (current)
        "kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4=", // intermediate (backup)
    ]

    // Extracted on 2026-04-17 from api.stripe.com. Stripe rotates rarely;
    // see https://stripe.com/docs/security/stripe#ssl-tls-pinning.
    private static let stripePins: [String] = [
        "xUUBOliw6Rgb7It2YbiSOg0ifTHlP3Lv6MXMkw//uLM=", // leaf (current)
        "Ld64SpoeXjpLjc+/7Wahk6p5+KVyzVSUptciuWsyxeY=", // intermediate (backup)
    ]

    /// Returns the TrustKit configuration dictionary.
    /// Enforcement is GATED on this build flag — flip to true after the
    /// 7-day soak period and real pins have been collected.
    static func configuration() -> [String: Any] {
        let enforce = false  // ← start in REPORTING MODE

        return [
            kTSKSwizzleNetworkDelegates: true,
            kTSKPinnedDomains: [
                "supabase.co": [
                    kTSKEnforcePinning: enforce,
                    kTSKIncludeSubdomains: true,
                    kTSKPublicKeyHashes: supabasePins,
                    kTSKDisableDefaultReportUri: true,
                ] as [String: Any],
                "api.stripe.com": [
                    kTSKEnforcePinning: enforce,
                    kTSKIncludeSubdomains: false,
                    kTSKPublicKeyHashes: stripePins,
                    kTSKDisableDefaultReportUri: true,
                ] as [String: Any],
            ] as [String: Any],
        ] as [String: Any]
    }

    /// Call once at app launch, before any network request is made.
    static func initialize() {
        TrustKit.initSharedInstance(withConfiguration: configuration())

        // Install a pinning validator logger — in reporting mode any
        // mismatch logs but doesn't fail. Useful to watch in Xcode console
        // during the soak period.
        TrustKit.sharedInstance().pinningValidatorCallback = { result, notedHostname, policy in
            switch result.finalTrustDecision {
            case .shouldAllowConnection:
                return
            case .shouldBlockConnection:
                logger.error("[TrustKit] BLOCKED connection to \(notedHostname, privacy: .public) — pin mismatch")
            case .domainNotPinned:
                return
            @unknown default:
                return
            }
        }
    }
}

// MARK: - Extract Pins
//
// Run this shell one-liner on a Mac with openssl to get SPKI hashes
// for the current certificates of our pinned hosts. Copy the output
// into `supabasePins` / `stripePins` above.
//
// #!/bin/bash
// for host in bqyqkvkzkemiwyqjkbna.supabase.co api.stripe.com; do
//   echo "=== $host ==="
//   openssl s_client -servername "$host" -connect "$host:443" -showcerts < /dev/null 2>/dev/null \
//     | openssl x509 -noout -pubkey \
//     | openssl rsa -pubin -outform der 2>/dev/null \
//     | openssl dgst -sha256 -binary \
//     | openssl enc -base64
// done
//
// Best practice: also capture the INTERMEDIATE CA's SPKI as a backup pin.
// If the leaf rotates (common) but the intermediate doesn't (rare), the
// backup saves us. Extract intermediate:
//
// openssl s_client -servername HOST -connect HOST:443 -showcerts < /dev/null 2>/dev/null \
//   | awk '/-----BEGIN/,/-----END/' \
//   | awk 'BEGIN{c=0} /-----BEGIN/{c++} c==2'  # second cert = first intermediate
//   # then pipe to the same openssl rsa → dgst → base64 pipeline above
