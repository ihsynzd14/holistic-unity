import Foundation

// MARK: - Experience Level

enum ExperienceLevel: String, Codable, CaseIterable, Identifiable {
    case curious
    case exploring
    case practicing
    
    var id: String { rawValue }
    
    var label: String {
        switch self {
        case .curious: return "Just curious"
        case .exploring: return "I've explored a bit"
        case .practicing: return "I practice regularly"
        }
    }
    
    var icon: String {
        switch self {
        case .curious: return "eyes"
        case .exploring: return "safari"
        case .practicing: return "sparkles"
        }
    }
    
    var tagline: String {
        switch self {
        case .curious: return "I've never tried holistic practices before"
        case .exploring: return "I know the basics and want to go deeper"
        case .practicing: return "I have regular sessions or I'm a practitioner"
        }
    }
    
    /// Shown after the user selects a level
    var encouragement: String {
        switch self {
        case .curious: return "Perfect — we'll guide you every step of the way."
        case .exploring: return "Great — we'll deepen what you already know."
        case .practicing: return "Welcome home — your space is ready."
        }
    }
}

// MARK: - Intention

enum Intention: String, Codable, CaseIterable, Identifiable {
    case selfDiscovery = "self_discovery"
    case healingLetGo = "healing_let_go"
    case relationships
    case careerPurpose = "career_purpose"
    case spiritualGrowth = "spiritual_growth"
    case justExploring = "just_exploring"
    
    var id: String { rawValue }
    
    var label: String {
        switch self {
        case .selfDiscovery: return "Self-discovery"
        case .healingLetGo: return "Healing & letting go"
        case .relationships: return "Better relationships"
        case .careerPurpose: return "Career & purpose"
        case .spiritualGrowth: return "Spiritual growth"
        case .justExploring: return "Just exploring"
        }
    }
    
    var icon: String {
        switch self {
        case .selfDiscovery: return "magnifyingglass"
        case .healingLetGo: return "heart.circle"
        case .relationships: return "person.2"
        case .careerPurpose: return "target"
        case .spiritualGrowth: return "sparkles"
        case .justExploring: return "safari"
        }
    }
}

// MARK: - Client Profile

struct ClientProfile: Identifiable, Codable, Equatable {
    var id: String // same as userId
    var interests: [TherapyCategory]
    var goals: [WellnessGoal]
    var experienceLevel: ExperienceLevel?
    var intention: Intention?
    var birthDate: Date?
    var birthTime: Date?
    var birthPlace: String?
    var hasSkippedBirthData: Bool
    var budgetTier: BudgetTier
    var preferredLanguages: [String]
    var favoriteTherapistIds: [String]
    var createdAt: Date
    var updatedAt: Date
    
    /// Whether the user's selected interests require birth data (astrology, human design, numerology)
    var requiresBirthData: Bool {
        let birthModalities: Set<TherapyCategory> = [.astrology, .humanDesign, .numerology]
        return !birthModalities.isDisjoint(with: interests)
    }
    
    // SessionFormatPreference removed V1 — platform is virtual-only.

    enum BudgetTier: String, Codable, CaseIterable {
        case low
        case medium
        case high
        
        var displayName: String {
            switch self {
            case .low: return "$"
            case .medium: return "$$"
            case .high: return "$$$"
            }
        }
        
        var description: String {
            switch self {
            case .low: return "Budget-friendly"
            case .medium: return "Mid-range"
            case .high: return "Premium"
            }
        }
    }
}

extension ClientProfile {
    static func draft(userId: String) -> ClientProfile {
        ClientProfile(
            id: userId,
            interests: [],
            goals: [],
            experienceLevel: nil,
            intention: nil,
            birthDate: nil,
            birthTime: nil,
            birthPlace: nil,
            hasSkippedBirthData: false,
            budgetTier: .medium,
            preferredLanguages: ["English"],
            favoriteTherapistIds: [],
            createdAt: Date(),
            updatedAt: Date()
        )
    }
}
