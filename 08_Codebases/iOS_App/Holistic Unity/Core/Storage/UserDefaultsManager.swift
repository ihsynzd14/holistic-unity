import Foundation
import os.log

/// Non-sensitive local preferences stored in UserDefaults
final class UserDefaultsManager {
    static let shared = UserDefaultsManager()
    
    private let defaults = UserDefaults.standard

    /// Logs Keychain write failures for active-session recovery so a broken
    /// rejoin is diagnosable instead of failing silently. See F3 of the
    /// static quality sweep audit (2026-05-30).
    private let logger = Logger(subsystem: AppConstants.appBundleId, category: "SessionRecovery")

    private init() {}
    
    // MARK: - Keys
    
    private enum Keys {
        static let hasCompletedOnboarding = "hasCompletedOnboarding"
        static let selectedRole = "selectedRole"
        // therapistOnboardingStep removed V1 — iOS is client-only.
        // Therapists register + onboard via therapistportal.holisticunity.app.
        static let hasSeenWelcome = "hasSeenWelcome"
        static let lastSearchQuery = "lastSearchQuery"
        static let searchRadius = "searchRadius"
        static let preferredCategories = "preferredCategories"
        // Active session recovery
        static let activeSessionRoomName = "activeSessionRoomName"
        static let activeSessionParticipantName = "activeSessionParticipantName"
        static let activeSessionBookingId = "activeSessionBookingId"
        static let activeSessionStartTime = "activeSessionStartTime"
    }
    
    // MARK: - Onboarding
    
    var hasCompletedOnboarding: Bool {
        get { defaults.bool(forKey: Keys.hasCompletedOnboarding) }
        set { defaults.set(newValue, forKey: Keys.hasCompletedOnboarding) }
    }
    
    var hasSeenWelcome: Bool {
        get { defaults.bool(forKey: Keys.hasSeenWelcome) }
        set { defaults.set(newValue, forKey: Keys.hasSeenWelcome) }
    }
    
    // therapistOnboardingStep property removed V1 — iOS is client-only.

    // MARK: - Search
    
    var searchRadius: Double {
        get {
            let value = defaults.double(forKey: Keys.searchRadius)
            return value > 0 ? value : 25.0
        }
        set { defaults.set(newValue, forKey: Keys.searchRadius) }
    }
    
    // MARK: - Active Session Recovery (stored in Keychain for security)

    private var keychain: KeychainService { KeychainService.shared }

    var activeSessionRoomName: String? {
        get { keychain.loadString(for: .activeSessionRoomName) }
        set {
            if let newValue {
                do { try keychain.save(newValue, for: .activeSessionRoomName) }
                catch { logger.error("Keychain save failed (roomName): \(error.localizedDescription)") }
            } else {
                keychain.delete(key: .activeSessionRoomName)
            }
        }
    }

    var activeSessionParticipantName: String? {
        get { keychain.loadString(for: .activeSessionParticipantName) }
        set {
            if let newValue {
                do { try keychain.save(newValue, for: .activeSessionParticipantName) }
                catch { logger.error("Keychain save failed (participantName): \(error.localizedDescription)") }
            } else {
                keychain.delete(key: .activeSessionParticipantName)
            }
        }
    }

    var activeSessionBookingId: String? {
        get { keychain.loadString(for: .activeSessionBookingId) }
        set {
            if let newValue {
                do { try keychain.save(newValue, for: .activeSessionBookingId) }
                catch { logger.error("Keychain save failed (bookingId): \(error.localizedDescription)") }
            } else {
                keychain.delete(key: .activeSessionBookingId)
            }
        }
    }

    var activeSessionStartTime: Date? {
        get {
            guard let str = keychain.loadString(for: .activeSessionStartTime),
                  let interval = TimeInterval(str) else { return nil }
            return Date(timeIntervalSince1970: interval)
        }
        set {
            if let newValue {
                do { try keychain.save(String(newValue.timeIntervalSince1970), for: .activeSessionStartTime) }
                catch { logger.error("Keychain save failed (startTime): \(error.localizedDescription)") }
            } else {
                keychain.delete(key: .activeSessionStartTime)
            }
        }
    }

    func saveActiveSession(roomName: String, participantName: String, bookingId: String) {
        activeSessionRoomName = roomName
        activeSessionParticipantName = participantName
        activeSessionBookingId = bookingId
        activeSessionStartTime = Date()
    }

    func clearActiveSession() {
        activeSessionRoomName = nil
        activeSessionParticipantName = nil
        activeSessionBookingId = nil
        activeSessionStartTime = nil
    }

    var hasInterruptedSession: Bool {
        guard let roomName = activeSessionRoomName, !roomName.isEmpty,
              let bookingId = activeSessionBookingId, !bookingId.isEmpty,
              let startTime = activeSessionStartTime else { return false }
        // Session is considered interrupted if it started less than 3 hours ago
        return Date().timeIntervalSince(startTime) < 3 * 3600
    }
    
    // MARK: - Reset
    
    func resetAll() {
        let domain = Bundle.main.bundleIdentifier ?? ""
        defaults.removePersistentDomain(forName: domain)
    }
}
