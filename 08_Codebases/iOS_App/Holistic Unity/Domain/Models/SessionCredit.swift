import Foundation

/// Represents remaining prepaid sessions from a pack purchase.
/// Credits are scoped to a specific (client, therapist, service) combination.
/// When a client buys a pack of N sessions, the first session is booked immediately;
/// the remaining N-1 sessions are stored here as credits.
struct SessionCredit: Identifiable, Codable, Equatable {
    let id: String
    var clientId: String
    var therapistId: String
    var serviceId: String
    /// The booking ID of the original pack purchase
    var packBookingId: String
    var sessionsTotal: Int
    var sessionsRemaining: Int
    var createdAt: Date
    var updatedAt: Date

    var isExhausted: Bool {
        sessionsRemaining <= 0
    }

    var hasCredits: Bool {
        sessionsRemaining > 0
    }
}
