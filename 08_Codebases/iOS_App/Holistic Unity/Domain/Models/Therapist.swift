import Foundation

// MARK: - Currency

enum Currency: String, Codable, CaseIterable, Identifiable {
    case usd, eur, gbp, brl
    
    var id: String { rawValue }
    
    var symbol: String {
        switch self {
        case .usd: return "$"
        case .eur: return "€"
        case .gbp: return "£"
        case .brl: return "R$"
        }
    }
    
    var displayName: String {
        switch self {
        case .usd: return "US Dollar ($)"
        case .eur: return "Euro (€)"
        case .gbp: return "British Pound (£)"
        case .brl: return "Brazilian Real (R$)"
        }
    }
}

// MARK: - Session Format (removed V1 — platform is virtual-only)
// All sessions are conducted via LiveKit video. No in-person option exists.
// See docs/flows/09-video-call.md

// MARK: - Cancellation Policy

enum CancellationPolicy: String, Codable, CaseIterable {
    case flexible
    case moderate
    case strict

    static let standard: CancellationPolicy = .flexible
    
    var displayName: String {
        "Standard Refund Policy"
    }
    
    var description: String {
        "Full refund if cancelled at least 48 hours before the session. 50% refund between 24 and 48 hours. No refund within 24 hours."
    }

    /// Minimum hours before the session for ANY refund. Below this, 0%.
    var noRefundCutoffHours: Int { 24 }

    /// Hours before the session to qualify for a FULL refund.
    var fullRefundCutoffHours: Int { 48 }

    /// Legacy alias kept for backward compat — now the no-refund boundary.
    /// NOTE: older call sites may have used this to mean "full refund cutoff";
    /// they must be updated.
    var refundCutoffHours: Int { noRefundCutoffHours }

    /// Returns the refund percentage (0.0 – 1.0) based on how many hours remain before the session.
    /// Three tiers:
    ///   - >= 48h        → 100%
    ///   - 24h..<48h     →  50%
    ///   - < 24h         →   0%
    func refundPercentage(hoursUntilSession: Double) -> Double {
        if hoursUntilSession >= Double(fullRefundCutoffHours) {
            return 1.0
        }
        if hoursUntilSession >= Double(noRefundCutoffHours) {
            return 0.5
        }
        return 0.0
    }
}

// MARK: - Therapist Service

struct TherapistService: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var description: String
    var duration: Int // minutes
    var price: Double
    var category: TherapyCategory
    var isIntroCall: Bool = false
    var packSize: Int? // e.g. 4 or 8 sessions
    var packPrice: Double? // discounted price per session in a pack
    
    static let durationOptions = [15, 30, 45, 60, 75, 90, 120]
    static let packSizeOptions = [4, 6, 8, 10]
}

// MARK: - Therapist Profile

struct TherapistProfile: Identifiable, Codable, Equatable, Hashable {
    static func == (lhs: TherapistProfile, rhs: TherapistProfile) -> Bool {
        lhs.id == rhs.id
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    var id: String // same as userId
    var displayName: String
    var tagline: String
    var bio: String
    var photoURL: URL?
    var yearsExperience: Int
    var categories: [TherapyCategory]
    var languages: [String]
    var services: [TherapistService]
    var certifications: [Certificate]
    var videoIntroURL: URL?
    var galleryImageURLs: [URL]
    var availability: TherapistAvailability
    var cancellationPolicy: CancellationPolicy
    var currency: Currency
    var location: User.UserLocation?
    var averageRating: Double
    var totalReviews: Int
    var profileCompleteness: Int // percentage 0-100
    var isVerified: Bool
    var isApproved: Bool
    var approvalStatus: ApprovalStatus
    var stripeConnectedAccountId: String?
    var stripeAccountStatus: StripeAccountStatus
    var createdAt: Date
    var updatedAt: Date
    
    enum StripeAccountStatus: String, Codable {
        case notConnected = "not_connected"
        case onboardingPending = "onboarding_pending"
        case active, restricted, disabled
    }
    
    enum ApprovalStatus: String, Codable {
        case draft
        case pendingReview = "pending_review"
        case approved
        case changesRequested = "changes_requested"
    }
    
    var startingPrice: Double? {
        services.filter { !$0.isIntroCall }.map(\.price).min()
    }
    
    var formattedStartingPrice: String {
        guard let price = startingPrice else { return "Contact for pricing" }
        return "From \(currency.symbol)\(Int(price))/session"
    }
}

// MARK: - Default Profile

extension TherapistProfile {
    static func draft(userId: String, name: String) -> TherapistProfile {
        TherapistProfile(
            id: userId,
            displayName: name,
            tagline: "",
            bio: "",
            yearsExperience: 0,
            categories: [],
            languages: ["English"],
            services: [],
            certifications: [],
            galleryImageURLs: [],
            availability: .default,
            cancellationPolicy: .flexible,
            currency: .usd,
            averageRating: 0,
            totalReviews: 0,
            profileCompleteness: 0,
            isVerified: false,
            isApproved: false,
            approvalStatus: .draft,
            stripeAccountStatus: .notConnected,
            createdAt: Date(),
            updatedAt: Date()
        )
    }
}
