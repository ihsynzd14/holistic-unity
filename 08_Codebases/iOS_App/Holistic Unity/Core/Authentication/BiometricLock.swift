import SwiftUI
import LocalAuthentication
import Combine

/// Observable state for the app-wide biometric lock.
///
/// When `@AppStorage("hu_biometric_enabled") == true`, the app displays
/// `BiometricLockView` as a full-screen overlay until the user authenticates
/// with Face ID / Touch ID. The lock triggers on:
///   - Cold launch (app just opened)
///   - Return from background after `lockThresholdSeconds` (prevents
///     re-prompt on momentary backgrounds like Control Center pulls)
///
/// Authentication is local-device only (nothing hits Supabase). This is
/// a privacy control for the HEALTH-sensitive content (therapy sessions,
/// chat with therapists) — not a replacement for normal login.
@Observable
@MainActor
final class BiometricLock {
    static let shared = BiometricLock()

    /// True while the biometric overlay should be shown.
    var isLocked: Bool = false

    /// Last time the user successfully authenticated. Used to decide
    /// whether to re-lock on foreground.
    private var lastSuccessfulAuth: Date?

    /// Don't re-prompt if the app was in background for less than this.
    /// 30s balances security and UX: a user pulling down Control Center
    /// shouldn't have to Face ID every time.
    private let lockThresholdSeconds: TimeInterval = 30

    private init() {}

    /// Returns whether the user has enabled the biometric lock in Settings.
    var isEnabledInSettings: Bool {
        UserDefaults.standard.bool(forKey: "hu_biometric_enabled")
    }

    /// Called once at app launch. Applies initial lock state.
    func applyInitialLock() {
        if isEnabledInSettings {
            isLocked = true
        }
    }

    /// Called when the app transitions from `.background` to `.active`.
    /// Re-locks only if threshold has been exceeded since last success.
    func handleForeground() {
        guard isEnabledInSettings else {
            isLocked = false
            return
        }
        guard let last = lastSuccessfulAuth else {
            isLocked = true
            return
        }
        if Date().timeIntervalSince(last) >= lockThresholdSeconds {
            isLocked = true
        }
    }

    /// Call after successful Face ID / Touch ID.
    func markUnlocked() {
        lastSuccessfulAuth = Date()
        isLocked = false
    }

    /// Programmatically lock the app (e.g. from Settings if the user turns
    /// the toggle on with the app already open).
    func lockNow() {
        isLocked = isEnabledInSettings
    }

    /// The biometric type available on this device, for UI labels.
    var biometricTypeLabel: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none: return "Passcode"
        @unknown default: return "Biometrics"
        }
    }

    /// Triggers the system biometric prompt. Returns on the main actor with
    /// success / failure.
    func authenticate() async -> Result<Void, Error> {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return .failure(error ?? NSError(domain: "BiometricLock", code: -1))
        }
        do {
            let reason = String(
                localized: "Unlock Holistic Unity",
                comment: "Biometric lock prompt shown at app launch"
            )
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            )
            if success {
                markUnlocked()
                return .success(())
            } else {
                return .failure(NSError(domain: "BiometricLock", code: -2))
            }
        } catch {
            return .failure(error)
        }
    }
}
