import Foundation

enum TransactionStatus: String, Codable {
    case pending
    case processing
    case completed
    case failed
    case refunded
    case partiallyRefunded = "partially_refunded"
}

enum PayoutStatus: String, Codable {
    case pending
    case paid
    case failed
    case failedNoAccount = "failed_no_account"
}

struct Transaction: Identifiable, Codable, Equatable {
    let id: String
    var bookingId: String
    var clientId: String
    var therapistId: String
    var amount: Double
    var platformFee: Double
    var therapistPayout: Double
    var currency: String
    var status: TransactionStatus
    var stripePaymentIntentId: String?
    var refundAmount: Double?
    var createdAt: Date
    var payoutStatus: PayoutStatus?
    var payoutAfter: Date?

    // Fee breakdown (populated for transactions created after the IVA/service-fee rollout)
    var totalCharged: Double?      // total the client was charged (session + service fee)
    var commissionBase: Double?    // platform commission on session price (20%)
    var ivaAmount: Double?         // IVA on commission (22%, IT therapists only, charged to therapist)
    var ivaApplied: Bool?          // true when therapist is in Italy
    var serviceFee: Double?        // Stripe processing fee passed through to client
    var therapistCountry: String?  // ISO-3166 country code of the therapist
    
    var formattedAmount: String {
        let symbol = Currency(rawValue: currency) ?? .usd
        return String(format: "%@%.2f", symbol.symbol, amount)
    }
    
    var formattedDate: String {
        createdAt.formatted(date: .abbreviated, time: .shortened)
    }
}
