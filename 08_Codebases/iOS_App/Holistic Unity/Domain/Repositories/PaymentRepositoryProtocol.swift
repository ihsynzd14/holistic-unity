import Foundation

protocol PaymentRepositoryProtocol: Sendable {
    func createPaymentIntent(bookingId: String, therapistId: String, amount: Double, currency: String) async throws -> PaymentIntentResult
    func confirmPayment(paymentIntentId: String) async throws -> Transaction
    func requestRefund(transactionId: String) async throws
    func getTransaction(bookingId: String) async throws -> Transaction?
    
    func getTransactionHistory(userId: String, role: UserRole) async throws -> [Transaction]
    func getEarningsSummary(therapistId: String) async throws -> EarningsSummary
    
    func createStripeConnectAccount(therapistId: String) async throws -> String // returns onboarding URL
    func getStripeConnectDashboardURL(therapistId: String) async throws -> String
    
    func getSavedPaymentMethods(clientId: String) async throws -> [SavedPaymentMethod]
    func addPaymentMethod(clientId: String, token: String) async throws -> SavedPaymentMethod
    func removePaymentMethod(methodId: String) async throws

    /// C2: Atomically creates a pending booking and its PaymentIntent in a single
    /// edge function call. If Stripe fails, the booking is rolled back server-side.
    func createBookingWithPayment(_ request: BookingPaymentRequest) async throws -> BookingPaymentResult
}

/// Parameters for the atomic booking+payment edge function.
struct BookingPaymentRequest: Encodable {
    let bookingId: String
    let therapistId: String
    let serviceId: String
    let serviceName: String
    let duration: Int
    let price: Double
    let scheduledAt: String
    let timezone: String
    let videoRoomId: String?
    let promoCode: String?
    let discount: Double?
    let packBookingId: String?
    let currency: String

    enum CodingKeys: String, CodingKey {
        case bookingId = "booking_id"
        case therapistId = "therapist_id"
        case serviceId = "service_id"
        case serviceName = "service_name"
        case duration, price
        case scheduledAt = "scheduled_at"
        case timezone
        case videoRoomId = "video_room_id"
        case promoCode = "promo_code"
        case discount
        case packBookingId = "pack_booking_id"
        case currency
        case idempotencyKey = "idempotency_key"
    }

    /// Idempotency key derived from booking ID
    var idempotencyKey: String { "pi-\(bookingId)" }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(bookingId, forKey: .bookingId)
        try container.encode(therapistId, forKey: .therapistId)
        try container.encode(serviceId, forKey: .serviceId)
        try container.encode(serviceName, forKey: .serviceName)
        try container.encode(duration, forKey: .duration)
        try container.encode(price, forKey: .price)
        try container.encode(scheduledAt, forKey: .scheduledAt)
        try container.encode(timezone, forKey: .timezone)
        try container.encodeIfPresent(videoRoomId, forKey: .videoRoomId)
        try container.encodeIfPresent(promoCode, forKey: .promoCode)
        try container.encodeIfPresent(discount, forKey: .discount)
        try container.encodeIfPresent(packBookingId, forKey: .packBookingId)
        try container.encode(currency, forKey: .currency)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}

/// Result from the atomic booking+payment edge function.
struct BookingPaymentResult: Decodable {
    let bookingId: String
    let clientSecret: String
    let paymentIntentId: String
    let customerId: String
    let ephemeralKeySecret: String
    let customerSessionClientSecret: String
    let feeBreakdown: FeeBreakdown?
}

struct FeeBreakdown: Codable, Equatable {
    let sessionPrice: Double
    let serviceFee: Double
    let totalCharged: Double
    let commissionBase: Double
    let ivaAmount: Double
    let ivaApplied: Bool
    let therapistPayout: Double
    let therapistCountry: String
    let currency: String
}

struct PaymentIntentResult: Codable {
    let clientSecret: String
    let paymentIntentId: String
    let customerId: String
    let ephemeralKeySecret: String
    let customerSessionClientSecret: String
    let feeBreakdown: FeeBreakdown?
}

struct EarningsSummary: Codable, Equatable {
    let totalEarnings: Double
    let thisWeek: Double
    let thisMonth: Double
    let pendingPayout: Double
    let totalSessions: Int
}

struct SavedPaymentMethod: Identifiable, Codable, Equatable {
    let id: String
    var brand: String // visa, mastercard, etc.
    var last4: String
    var expiryMonth: Int
    var expiryYear: Int
    var isDefault: Bool
}
