import Foundation
import Sentry
import os.log

#if canImport(IOSSecuritySuite)
import IOSSecuritySuite
#endif

/// Jailbreak + runtime-tampering detection.
///
/// **Policy: soft-fail, not hard-block.** A jailbroken device is a signal,
/// not a verdict. Reasons we don't hard-block:
///   • TestFlight reviewers sometimes use jailbroken devices for testing.
///   • False positives are common — corporate MDM profiles, beta iOS, and
///     some simulators all trip standard jailbreak checks.
///   • Hard-blocking creates a terrible UX for the small minority of users
///     who legitimately have jailbroken devices.
///
/// What we DO when tampering is detected:
///   1. Log a Sentry event with tag `security.event_type=jailbreak` so we
///      can see the aggregate rate across the user base.
///   2. Flip `JailbreakDetector.shared.isCompromised = true` so sensitive
///      flows (payment, session credits) can add an extra confirmation
///      step or log additional context with the request.
///   3. Optionally show a soft warning banner in Settings — wired up by
///      the UI layer, not here.
///
/// **Activation:** this file is a no-op until the `IOSSecuritySuite` SPM
/// package is added to the target. Add it via:
///   Xcode → File → Add Package Dependencies
///   URL: https://github.com/securing/IOSSecuritySuite
///   Version: Up to Next Major (from 2.1.0)
///   Add only the `IOSSecuritySuite` library to the `Holistic Unity` target.
/// Once added, `canImport(IOSSecuritySuite)` is true and the full checks
/// below run. Until then, `isCompromised` is hardcoded to `false` and no
/// Sentry events are emitted.
@Observable
@MainActor
final class JailbreakDetector {

    static let shared = JailbreakDetector()

    /// Aggregated verdict across all checks. Persists for the app lifetime
    /// (not re-checked on every access — a sophisticated attacker could
    /// patch the function after the first call, so the first-run result is
    /// the most reliable).
    private(set) var isCompromised: Bool = false

    /// Human-readable list of reasons the device was flagged — useful for
    /// the Settings banner UI and for Sentry context. Empty when
    /// `isCompromised == false`.
    private(set) var reasons: [String] = []

    private let logger = Logger(subsystem: AppConstants.appBundleId, category: "JailbreakDetector")

    private init() {}

    /// Call once at app launch, after Sentry has been initialized. Safe to
    /// call multiple times — subsequent calls are no-ops.
    func runInitialCheck() {
        guard reasons.isEmpty else { return } // already ran

        #if canImport(IOSSecuritySuite)
        var flagged: [String] = []

        // 1. Core jailbreak detection — checks for common jailbreak artifacts
        //    (Cydia.app, /private/jailbreak.txt writability, suspicious dylibs).
        let jbStatus = IOSSecuritySuite.amIJailbrokenWithFailMessage()
        if jbStatus.jailbroken {
            flagged.append("jailbreak:\(jbStatus.failMessage)")
        }

        // 2. Debugger attached — not necessarily malicious (dev builds trip
        //    this) but worth flagging in release builds.
        #if !DEBUG
        if IOSSecuritySuite.amIDebugged() {
            flagged.append("debugger_attached")
        }
        #endif

        // 3. Reverse engineering tools — Frida, Cycript, etc. Strong signal
        //    of active runtime manipulation.
        if IOSSecuritySuite.amIReverseEngineered() {
            flagged.append("reverse_engineering_tools")
        }

        // 4. Runtime hooking via method swizzling from a dylib. Less
        //    reliable on iOS 16+ due to Pointer Authentication, but keep
        //    as a signal.
        #if !DEBUG
        if IOSSecuritySuite.amIRuntimeHooked(dyldWhiteList: []) {
            flagged.append("runtime_hooks")
        }
        #endif

        if !flagged.isEmpty {
            self.isCompromised = true
            self.reasons = flagged
            reportToSentry(reasons: flagged)
            logger.warning("[JailbreakDetector] compromised — reasons=\(flagged.joined(separator: ","), privacy: .public)")
        } else {
            logger.info("[JailbreakDetector] clean")
        }
        #else
        // Package not installed yet — remain at default (isCompromised=false).
        // Log once so we know the detector is dormant in release builds.
        logger.info("[JailbreakDetector] IOSSecuritySuite not linked; detector inactive")
        #endif
    }

    // MARK: - Sentry reporting

    private func reportToSentry(reasons: [String]) {
        let breadcrumb = Breadcrumb(level: .warning, category: "jailbreak")
        breadcrumb.message = "device_flagged"
        breadcrumb.data = ["reasons": reasons.joined(separator: ",")]
        SentrySDK.addBreadcrumb(breadcrumb)

        SentrySDK.capture(message: "jailbreak_detected") { scope in
            scope.setTag(value: "jailbreak", key: "security.event_type")
            scope.setContext(value: ["reasons": reasons], key: "jailbreak_detail")
            // Level stays at the default (warning) — we don't want these
            // firing as errors and polluting the error rate.
            scope.setLevel(.warning)
        }
    }
}
