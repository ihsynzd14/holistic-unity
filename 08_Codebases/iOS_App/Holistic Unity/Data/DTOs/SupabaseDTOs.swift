import Foundation

// MARK: - User DTO

/// Maps to the `users` table in Supabase
struct UserDTO: Codable, Sendable {
    let id: String
    var email: String?
    var displayName: String
    var photoURL: String?
    var phoneNumber: String?
    var role: String?
    var city: String?
    var country: String?
    var latitude: Double?
    var longitude: Double?
    var authProvider: String
    var isEmailVerified: Bool
    var preferredLanguages: [String]?
    var experienceLevel: String?
    var intention: String?
    var fcmToken: String?
    var stripeCustomerId: String?
    var marketingConsent: Bool?
    var marketingConsentDate: String?
    var createdAt: String
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case displayName = "display_name"
        case photoURL = "photo_url"
        case phoneNumber = "phone_number"
        case role
        case city, country, latitude, longitude
        case authProvider = "auth_provider"
        case isEmailVerified = "is_email_verified"
        case preferredLanguages = "preferred_languages"
        case experienceLevel = "experience_level"
        case intention
        case fcmToken = "fcm_token"
        case stripeCustomerId = "stripe_customer_id"
        case marketingConsent = "marketing_consent"
        case marketingConsentDate = "marketing_consent_date"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
    
    func toDomain() -> User {
        let location: User.UserLocation? = {
            guard let city, let country else { return nil }
            return User.UserLocation(city: city, country: country, latitude: latitude, longitude: longitude)
        }()
        
        return User(
            id: id,
            email: email,
            displayName: displayName,
            photoURL: photoURL.flatMap { URL(string: $0) },
            phoneNumber: phoneNumber,
            role: role.flatMap { UserRole(rawValue: $0) },
            location: location,
            authProvider: AuthProvider(rawValue: authProvider) ?? .email,
            isEmailVerified: isEmailVerified,
            preferredLanguages: preferredLanguages ?? ["English"],
            experienceLevel: experienceLevel.flatMap { ExperienceLevel(rawValue: $0) },
            intention: intention.flatMap { Intention(rawValue: $0) },
            fcmToken: fcmToken,
            stripeCustomerId: stripeCustomerId,
            marketingConsent: marketingConsent ?? false,
            marketingConsentDate: marketingConsentDate.flatMap { ISO8601DateFormatter.parseSupabaseDate($0) },
            createdAt: ISO8601DateFormatter.parseSupabaseDate(createdAt) ?? Date(),
            updatedAt: ISO8601DateFormatter.parseSupabaseDate(updatedAt) ?? Date()
        )
    }

    static func from(_ user: User) -> UserDTO {
        let formatter = ISO8601DateFormatter.shared
        return UserDTO(
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL?.absoluteString,
            phoneNumber: user.phoneNumber,
            role: user.role?.rawValue,
            city: user.location?.city,
            country: user.location?.country,
            latitude: user.location?.latitude,
            longitude: user.location?.longitude,
            authProvider: user.authProvider.rawValue,
            isEmailVerified: user.isEmailVerified,
            preferredLanguages: user.preferredLanguages,
            experienceLevel: user.experienceLevel?.rawValue,
            intention: user.intention?.rawValue,
            fcmToken: user.fcmToken,
            stripeCustomerId: user.stripeCustomerId,
            marketingConsent: user.marketingConsent,
            marketingConsentDate: user.marketingConsentDate.map { formatter.string(from: $0) },
            createdAt: formatter.string(from: user.createdAt),
            updatedAt: formatter.string(from: user.updatedAt)
        )
    }
}

// MARK: - Therapist Profile DTO

struct TherapistProfileDTO: Codable, Sendable {
    let id: String
    var displayName: String
    var tagline: String
    var bio: String
    var photoURL: String?
    var yearsExperience: Int
    var categories: [String]
    var languages: [String]
    var videoIntroURL: String?
    var galleryImageURLs: [String]
    var availability: TherapistAvailability?
    var cancellationPolicy: String
    var currency: String?
    var city: String?
    var country: String?
    var latitude: Double?
    var longitude: Double?
    var averageRating: Double
    var totalReviews: Int
    var profileCompleteness: Int
    var isVerified: Bool
    var isApproved: Bool
    var approvalStatus: String
    var stripeConnectedAccountId: String?
    var stripeAccountStatus: String?
    var createdAt: String
    var updatedAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case tagline, bio
        case photoURL = "photo_url"
        case yearsExperience = "years_experience"
        case categories, languages
        case videoIntroURL = "video_intro_url"
        case galleryImageURLs = "gallery_image_urls"
        case availability
        case cancellationPolicy = "cancellation_policy"
        case currency
        case city, country, latitude, longitude
        case averageRating = "average_rating"
        case totalReviews = "total_reviews"
        case profileCompleteness = "profile_completeness"
        case isVerified = "is_verified"
        case isApproved = "is_approved"
        case approvalStatus = "approval_status"
        case stripeConnectedAccountId = "stripe_connected_account_id"
        case stripeAccountStatus = "stripe_account_status"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// MARK: - Service DTO

struct TherapistServiceDTO: Codable, Sendable {
    let id: String
    var therapistId: String
    var name: String
    var description: String
    var duration: Int
    var price: Double
    var category: String
    var isIntroCall: Bool?
    var packSize: Int?
    var packPrice: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case therapistId = "therapist_id"
        case name, description, duration, price, category
        case isIntroCall = "is_intro_call"
        case packSize = "pack_size"
        case packPrice = "pack_price"
    }

    func toDomain() -> TherapistService {
        TherapistService(
            id: id,
            name: name,
            description: description,
            duration: duration,
            price: price,
            category: Self.mapCategory(category),
            isIntroCall: isIntroCall ?? false,
            packSize: packSize,
            packPrice: packPrice
        )
    }

    /// Maps a raw category string from the DB to a TherapyCategory enum.
    ///
    /// The DB canonical format is the dashed Italian (`dbValue`) — e.g.
    /// "costellazioni-familiari", "theta-healing". This is what both the
    /// web app and (now) iOS write. We try `dbValue` first, then the
    /// Swift snake_case `rawValue`, then the legacy friendly labels
    /// ("ThetaHealing", "Reiki a Distanza", etc.) the therapist dashboard
    /// used to write before the format was normalised. Falls back to
    /// .naturopathy for unknown categories so an unexpected value does
    /// not crash the decode of an entire therapist list.
    private static func mapCategory(_ raw: String) -> TherapyCategory {
        // 1. Try dbValue (Italian/dashed) — the canonical DB format.
        if let byDb = TherapyCategory.allCases.first(where: { $0.dbValue == raw }) {
            return byDb
        }
        // 2. Try Swift rawValue (snake_case).
        if let direct = TherapyCategory(rawValue: raw) {
            return direct
        }
        // 3. Legacy friendly labels (older rows + free-typed services).
        switch raw {
        case "ThetaHealing", "Theta Healing":
            return .thetaHealing
        case "Reiki", "Reiki a Distanza", "Distance Reiki":
            return .reiki
        case "Family Constellation", "Costellazioni Familiari":
            return .familyConstellation
        case "Systemic Constellation", "Costellazioni Sistemiche":
            return .systemicConstellation
        case "Naturopathy", "Naturopatia":
            return .naturopathy
        case "Ayurveda", "Ayurveda Consultation", "Consulenza Ayurveda":
            return .ayurveda
        case "Astrology", "Astrologia":
            return .astrology
        case "Human Design":
            return .humanDesign
        case "Numerology", "Numerologia":
            return .numerology
        case "Shamanism", "Sciamanesimo":
            return .shamanism
        default:
            return .naturopathy
        }
    }
}

// MARK: - Certificate DTO

struct CertificateDTO: Codable, Sendable {
    let id: String
    var therapistId: String
    var name: String
    var issuingOrganization: String
    var yearObtained: Int
    var documentURL: String?
    var isVerified: Bool
    
    enum CodingKeys: String, CodingKey {
        case id
        case therapistId = "therapist_id"
        case name
        case issuingOrganization = "issuing_organization"
        case yearObtained = "year_obtained"
        case documentURL = "document_url"
        case isVerified = "is_verified"
    }
    
    func toDomain() -> Certificate {
        Certificate(
            id: id,
            name: name,
            issuingOrganization: issuingOrganization,
            yearObtained: yearObtained,
            imageURL: documentURL.flatMap { URL(string: $0) },
            isVerified: isVerified
        )
    }
}

// MARK: - Booking DTO

struct BookingDTO: Codable, Sendable {
    let id: String
    var clientId: String
    var therapistId: String
    var serviceId: String
    var serviceName: String
    var duration: Int
    var price: Double
    var scheduledAt: String
    var timezone: String
    var status: String
    var cancellationReason: String?
    var videoRoomId: String?
    var stripePaymentIntentId: String?
    var platformFee: Double
    var therapistPayout: Double
    var promoCode: String?
    var discount: Double?
    var proposedScheduledAt: String?
    var rescheduleCount: Int?
    var packBookingId: String?
    var createdAt: String
    var updatedAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case clientId = "client_id"
        case therapistId = "therapist_id"
        case serviceId = "service_id"
        case serviceName = "service_name"
        case duration, price
        case scheduledAt = "scheduled_at"
        case timezone, status
        case cancellationReason = "cancellation_reason"
        case videoRoomId = "video_room_id"
        case stripePaymentIntentId = "stripe_payment_intent_id"
        case platformFee = "platform_fee"
        case therapistPayout = "therapist_payout"
        case promoCode = "promo_code"
        case discount
        case proposedScheduledAt = "proposed_scheduled_at"
        case rescheduleCount = "reschedule_count"
        case packBookingId = "pack_booking_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(clientId, forKey: .clientId)
        try container.encode(therapistId, forKey: .therapistId)
        try container.encode(serviceId, forKey: .serviceId)
        try container.encode(serviceName, forKey: .serviceName)
        try container.encode(duration, forKey: .duration)
        try container.encode(price, forKey: .price)
        try container.encode(scheduledAt, forKey: .scheduledAt)
        try container.encode(timezone, forKey: .timezone)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(cancellationReason, forKey: .cancellationReason)
        try container.encodeIfPresent(videoRoomId, forKey: .videoRoomId)
        try container.encodeIfPresent(stripePaymentIntentId, forKey: .stripePaymentIntentId)
        try container.encode(platformFee, forKey: .platformFee)
        try container.encode(therapistPayout, forKey: .therapistPayout)
        try container.encodeIfPresent(promoCode, forKey: .promoCode)
        try container.encodeIfPresent(discount, forKey: .discount)
        try container.encodeIfPresent(proposedScheduledAt, forKey: .proposedScheduledAt)
        try container.encodeIfPresent(rescheduleCount, forKey: .rescheduleCount)
        try container.encodeIfPresent(packBookingId, forKey: .packBookingId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
    
    func toDomain() -> Booking {
        return Booking(
            id: id,
            clientId: clientId,
            therapistId: therapistId,
            serviceId: serviceId,
            serviceName: serviceName,
            duration: duration,
            price: price,
            scheduledAt: ISO8601DateFormatter.parseSupabaseDate(scheduledAt) ?? Date(),
            timezone: timezone,
            status: BookingStatus(rawValue: status) ?? .pending,
            cancellationReason: cancellationReason,
            videoRoomId: videoRoomId,
            stripePaymentIntentId: stripePaymentIntentId,
            platformFee: platformFee,
            therapistPayout: therapistPayout,
            promoCode: promoCode,
            discount: discount,
            proposedScheduledAt: proposedScheduledAt.flatMap { ISO8601DateFormatter.parseSupabaseDate($0) },
            rescheduleCount: rescheduleCount ?? 0,
            packBookingId: packBookingId,
            createdAt: ISO8601DateFormatter.parseSupabaseDate(createdAt) ?? Date(),
            updatedAt: ISO8601DateFormatter.parseSupabaseDate(updatedAt) ?? Date()
        )
    }
    
    static func from(_ booking: Booking) -> BookingDTO {
        let formatter = ISO8601DateFormatter.shared
        return BookingDTO(
            id: booking.id,
            clientId: booking.clientId,
            therapistId: booking.therapistId,
            serviceId: booking.serviceId,
            serviceName: booking.serviceName,
            duration: booking.duration,
            price: booking.price,
            scheduledAt: formatter.string(from: booking.scheduledAt),
            timezone: booking.timezone,
            status: booking.status.rawValue,
            cancellationReason: booking.cancellationReason,
            videoRoomId: booking.videoRoomId,
            stripePaymentIntentId: booking.stripePaymentIntentId,
            platformFee: booking.platformFee,
            therapistPayout: booking.therapistPayout,
            promoCode: booking.promoCode,
            discount: booking.discount,
            proposedScheduledAt: booking.proposedScheduledAt.map { formatter.string(from: $0) },
            rescheduleCount: booking.rescheduleCount > 0 ? booking.rescheduleCount : nil,
            packBookingId: booking.packBookingId,
            createdAt: formatter.string(from: booking.createdAt),
            updatedAt: formatter.string(from: booking.updatedAt)
        )
    }
}

// MARK: - Review DTO

struct ReviewDTO: Codable, Sendable {
    let id: String
    var bookingId: String
    var clientId: String
    var therapistId: String
    var clientName: String
    var clientPhotoURL: String?
    var rating: Int
    var text: String?
    var therapistReply: String?
    var therapistReplyDate: String?
    var isFlagged: Bool
    var createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case bookingId = "booking_id"
        case clientId = "client_id"
        case therapistId = "therapist_id"
        case clientName = "client_name"
        case clientPhotoURL = "client_photo_url"
        case rating, text
        case therapistReply = "therapist_reply"
        case therapistReplyDate = "therapist_reply_date"
        case isFlagged = "is_flagged"
        case createdAt = "created_at"
    }
    
    func toDomain() -> Review {
        return Review(
            id: id,
            bookingId: bookingId,
            clientId: clientId,
            therapistId: therapistId,
            clientName: clientName,
            clientPhotoURL: clientPhotoURL.flatMap { URL(string: $0) },
            rating: rating,
            text: text,
            therapistReply: therapistReply,
            therapistReplyDate: therapistReplyDate.flatMap { ISO8601DateFormatter.parseSupabaseDate($0) },
            isFlagged: isFlagged,
            createdAt: ISO8601DateFormatter.parseSupabaseDate(createdAt) ?? Date()
        )
    }
}

// MARK: - Notification DTO

struct NotificationDTO: Codable, Sendable {
    let id: String
    var userId: String
    var type: String
    var title: String
    var body: String
    var bookingId: String?
    var conversationId: String?
    var therapistId: String?
    var clientId: String?
    var isRead: Bool
    var createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case type, title, body
        case bookingId = "booking_id"
        case conversationId = "conversation_id"
        case therapistId = "therapist_id"
        case clientId = "client_id"
        case isRead = "is_read"
        case createdAt = "created_at"
    }
    
    func toDomain() -> AppNotification {
        return AppNotification(
            id: id,
            userId: userId,
            type: NotificationType(rawValue: type) ?? .promotional,
            title: title,
            body: body,
            data: AppNotification.NotificationData(
                bookingId: bookingId,
                conversationId: conversationId,
                therapistId: therapistId,
                clientId: clientId
            ),
            isRead: isRead,
            createdAt: ISO8601DateFormatter.parseSupabaseDate(createdAt) ?? Date()
        )
    }
}

// MARK: - Transaction DTO

struct TransactionDTO: Codable, Sendable {
    let id: String
    var bookingId: String
    var clientId: String
    var therapistId: String
    var amount: Double
    var platformFee: Double
    var therapistPayout: Double
    var currency: String
    var status: String
    var stripePaymentIntentId: String?
    var refundAmount: Double?
    var createdAt: String
    var updatedAt: String?
    var payoutStatus: String?
    var payoutAfter: String?
    // Fee breakdown columns
    var totalCharged: Double?
    var commissionBase: Double?
    var ivaAmount: Double?
    var ivaApplied: Bool?
    var serviceFee: Double?
    var therapistCountry: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case bookingId = "booking_id"
        case clientId = "client_id"
        case therapistId = "therapist_id"
        case amount
        case platformFee = "platform_fee"
        case therapistPayout = "therapist_payout"
        case currency, status
        case stripePaymentIntentId = "stripe_payment_intent_id"
        case refundAmount = "refund_amount"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case payoutStatus = "payout_status"
        case payoutAfter = "payout_after"
        case totalCharged = "total_charged"
        case commissionBase = "commission_base"
        case ivaAmount = "iva_amount"
        case ivaApplied = "iva_applied"
        case serviceFee = "service_fee"
        case therapistCountry = "therapist_country"
    }
    
    func toDomain() -> Transaction {
        return Transaction(
            id: id,
            bookingId: bookingId,
            clientId: clientId,
            therapistId: therapistId,
            amount: amount,
            platformFee: platformFee,
            therapistPayout: therapistPayout,
            currency: currency,
            status: TransactionStatus(rawValue: status) ?? .pending,
            stripePaymentIntentId: stripePaymentIntentId,
            refundAmount: refundAmount,
            createdAt: ISO8601DateFormatter.parseSupabaseDate(createdAt) ?? Date(),
            payoutStatus: payoutStatus.flatMap { PayoutStatus(rawValue: $0) },
            payoutAfter: payoutAfter.flatMap { ISO8601DateFormatter.parseSupabaseDate($0) },
            totalCharged: totalCharged,
            commissionBase: commissionBase,
            ivaAmount: ivaAmount,
            ivaApplied: ivaApplied,
            serviceFee: serviceFee,
            therapistCountry: therapistCountry
        )
    }
}

// MARK: - Session Credit DTO

struct SessionCreditDTO: Codable, Sendable {
    let id: String
    var clientId: String
    var therapistId: String
    var serviceId: String
    var packBookingId: String
    var sessionsTotal: Int
    var sessionsRemaining: Int
    var createdAt: String
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case clientId = "client_id"
        case therapistId = "therapist_id"
        case serviceId = "service_id"
        case packBookingId = "pack_booking_id"
        case sessionsTotal = "sessions_total"
        case sessionsRemaining = "sessions_remaining"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    func toDomain() -> SessionCredit {
        SessionCredit(
            id: id,
            clientId: clientId,
            therapistId: therapistId,
            serviceId: serviceId,
            packBookingId: packBookingId,
            sessionsTotal: sessionsTotal,
            sessionsRemaining: sessionsRemaining,
            createdAt: ISO8601DateFormatter.parseSupabaseDate(createdAt) ?? Date(),
            updatedAt: ISO8601DateFormatter.parseSupabaseDate(updatedAt) ?? Date()
        )
    }

    static func from(_ credit: SessionCredit) -> SessionCreditDTO {
        let formatter = ISO8601DateFormatter.shared
        return SessionCreditDTO(
            id: credit.id,
            clientId: credit.clientId,
            therapistId: credit.therapistId,
            serviceId: credit.serviceId,
            packBookingId: credit.packBookingId,
            sessionsTotal: credit.sessionsTotal,
            sessionsRemaining: credit.sessionsRemaining,
            createdAt: formatter.string(from: credit.createdAt),
            updatedAt: formatter.string(from: credit.updatedAt)
        )
    }
}

// MARK: - Payment Method DTO

struct PaymentMethodDTO: Codable, Sendable {
    let id: String
    var userId: String
    var stripePaymentMethodId: String
    var brand: String
    var last4: String
    var expiryMonth: Int
    var expiryYear: Int
    var isDefault: Bool
    var createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case stripePaymentMethodId = "stripe_payment_method_id"
        case brand, last4
        case expiryMonth = "expiry_month"
        case expiryYear = "expiry_year"
        case isDefault = "is_default"
        case createdAt = "created_at"
    }
    
    func toDomain() -> SavedPaymentMethod {
        SavedPaymentMethod(
            id: id,
            brand: brand,
            last4: last4,
            expiryMonth: expiryMonth,
            expiryYear: expiryYear,
            isDefault: isDefault
        )
    }
}
