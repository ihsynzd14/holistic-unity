import Foundation
import CryptoKit
import os.log

#if canImport(TelemetryDeck)
import TelemetryDeck
#endif

/// TelemetryDeck-backed implementation of `AnalyticsService`.
///
/// **Why TelemetryDeck** (chosen 2026-04-17):
///   - EU-hosted (Germany), DPA included, minimal sub-processor footprint.
///   - No IDFA access, so **no ATT prompt**. Regular SDK use does not
///     trigger Apple's App Tracking Transparency flow.
///   - No personal identifiers transmitted. Even the app-level user hash
///     we set via `setPseudonymousUserID` is SHA-256'd on device so the
///     server only ever sees an opaque token.
///   - Privacy manifest impact is minimal — TelemetryDeck declares its
///     own reasons via their included `PrivacyInfo.xcprivacy`; our app's
///     manifest only needs a standard `NSPrivacyAccessedAPITypeReasons`
///     entry (already present for logging infrastructure).
///
/// **Activation** (three steps; all manual for security):
///   1. Xcode → File → Add Package Dependencies → URL
///      `https://github.com/TelemetryDeck/SwiftClient` → version
///      "Up to Next Major" from 2.0.0 → add only the `TelemetryDeck`
///      library product to the `Holistic Unity` target.
///   2. telemetrydeck.com → sign up (free tier, no credit card) → create
///      a new app → copy the App ID (UUID format).
///   3. Paste the App ID into `AnalyticsConfig.telemetryDeckAppID` below.
///      The value is intentionally blank here — the service will no-op
///      until a real ID is set, so committing an ID to the repo is
///      never necessary (read from Info.plist or xcconfig is also fine).
///
/// Until steps 1–3 are done the `#if canImport(TelemetryDeck)` gate
/// is false and the file compiles as a no-op. Nothing is sent anywhere.
final class TelemetryDeckAnalyticsService: AnalyticsService {

    private let logger = Logger(subsystem: AppConstants.appBundleId, category: "Analytics")
    private let config: AnalyticsConfig

    init(config: AnalyticsConfig = .default) {
        self.config = config
    }

    // MARK: - AnalyticsService

    func initialize() {
        #if canImport(TelemetryDeck)
        guard config.enabled, !config.telemetryDeckAppID.isEmpty else {
            logger.info("[Analytics] disabled or missing App ID; operating in no-op mode")
            return
        }

        // `testMode` in DEBUG so dev builds don't pollute production metrics.
        var tdConfig = TelemetryDeck.Config(appID: config.telemetryDeckAppID)
        #if DEBUG
        tdConfig.testMode = true
        #endif
        // TelemetryDeck emits a `newSessionBegan` signal automatically when
        // initialised; leave that on — it's already aggregated and anonymous.
        TelemetryDeck.initialize(config: tdConfig)
        logger.info("[Analytics] TelemetryDeck initialised (testMode=\(tdConfig.testMode, privacy: .public))")
        #else
        logger.info("[Analytics] TelemetryDeck SPM package not linked; no-op")
        #endif
    }

    func signal(_ name: String, parameters: [String: String]?) {
        #if canImport(TelemetryDeck)
        guard config.enabled else { return }
        // Scrub any accidental PII-looking values before sending. Pure
        // defence-in-depth — the contract says "don't pass PII" but this
        // catches slips.
        let safeParams = (parameters ?? [:]).mapValues { redactIfLooksLikePII($0) }
        TelemetryDeck.signal(name, parameters: safeParams)
        #endif
    }

    func setPseudonymousUserID(_ rawUserID: String?) {
        #if canImport(TelemetryDeck)
        guard config.enabled else { return }
        guard let raw = rawUserID, !raw.isEmpty else {
            TelemetryDeck.updateDefaultUserID(to: nil)
            return
        }
        // SHA-256 the raw user id; TelemetryDeck hashes it again server-side,
        // so the actual Supabase uuid never leaves the device.
        let hashed = SHA256.hash(data: Data(raw.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        TelemetryDeck.updateDefaultUserID(to: hashed)
        #endif
    }

    // MARK: - Helpers

    /// Heuristic scrub for parameter values that look like PII slipped in.
    /// Not a full DLP engine — just guards against obvious accidents.
    private func redactIfLooksLikePII(_ value: String) -> String {
        // Email-looking (naive, but catches most accidents).
        if value.contains("@"), value.contains(".") {
            return "<redacted_email>"
        }
        // Phone-looking (10+ consecutive digits with optional +, -, space).
        let digitsOnly = value.filter { $0.isNumber }
        if digitsOnly.count >= 10, value.allSatisfy({ "+- 0123456789()".contains($0) }) {
            return "<redacted_phone>"
        }
        // UUID-looking — might be a user id. Hash it.
        if value.count == 36,
           value.filter({ $0 == "-" }).count == 4 {
            let hashed = SHA256.hash(data: Data(value.utf8))
                .map { String(format: "%02x", $0) }
                .joined()
                .prefix(16)
            return "uuid_\(hashed)"
        }
        return value
    }
}

/// Analytics runtime config. Kept minimal — no vendor switching logic in V1.
struct AnalyticsConfig {
    /// Global kill-switch. If false, even if the SDK is linked, no signal
    /// is sent. Useful for debug builds that want realistic data flow
    /// without dashboard pollution.
    let enabled: Bool

    /// TelemetryDeck App ID (from telemetrydeck.com dashboard). Empty
    /// value means "not configured yet" and the service no-ops.
    let telemetryDeckAppID: String

    static let `default`: AnalyticsConfig = {
        // Read from Info.plist so the ID is provided via xcconfig rather
        // than hardcoded. Missing key → empty string → no-op.
        let appID = Bundle.main.infoDictionary?["TELEMETRY_DECK_APP_ID"] as? String ?? ""
        #if DEBUG
        // Enable even in debug — `testMode` inside
        // `TelemetryDeckAnalyticsService.initialize()` will route events
        // to TelemetryDeck's test bucket.
        let enabled = !appID.isEmpty
        #else
        let enabled = !appID.isEmpty
        #endif
        return AnalyticsConfig(enabled: enabled, telemetryDeckAppID: appID)
    }()
}
