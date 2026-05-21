import Foundation

// MARK: - User Role

enum UserRole: String, Codable, CaseIterable {
    case therapist
    case client
}

// MARK: - Auth Provider

enum AuthProvider: String, Codable {
    case email
    case apple
    case google
    case phone
}

// MARK: - User Model

struct User: Identifiable, Codable, Equatable {
    let id: String
    var email: String?
    var displayName: String
    var photoURL: URL?
    var phoneNumber: String?
    var role: UserRole?
    var location: UserLocation?
    var authProvider: AuthProvider
    var isEmailVerified: Bool
    var preferredLanguages: [String]
    var experienceLevel: ExperienceLevel?
    var intention: Intention?
    var fcmToken: String?
    var stripeCustomerId: String?
    var marketingConsent: Bool
    var marketingConsentDate: Date?
    var createdAt: Date
    var updatedAt: Date
    
    struct UserLocation: Codable, Equatable {
        var city: String
        var country: String
        var latitude: Double?
        var longitude: Double?
    }
}

// MARK: - User Settings

struct UserSettings: Codable, Equatable {
    var notificationsEnabled: Bool = true
    var emailDigestFrequency: EmailDigestFrequency = .weekly
    var pushBookingReminders: Bool = true
    var pushNewMessages: Bool = true
    var pushSessionReminders: Bool = true
    var pushPromotional: Bool = false
    
    enum EmailDigestFrequency: String, Codable, CaseIterable {
        case daily
        case weekly
        case off
    }
}
