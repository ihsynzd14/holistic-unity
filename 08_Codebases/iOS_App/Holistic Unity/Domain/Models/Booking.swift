import Foundation

enum BookingStatus: String, Codable, CaseIterable {
    case pending
    case confirmed
    case inProgress = "in_progress"
    case completed
    case cancelled
    case noShow = "no_show"
    case reschedulePending = "reschedule_pending"
    
    var displayName: String {
        switch self {
        case .pending: return "Pending"
        case .confirmed: return "Confirmed"
        case .inProgress: return "In Progress"
        case .completed: return "Completed"
        case .cancelled: return "Cancelled"
        case .noShow: return "No Show"
        case .reschedulePending: return "Reschedule Pending"
        }
    }
    
    var isActive: Bool {
        self == .pending || self == .confirmed || self == .inProgress || self == .reschedulePending
    }
}

struct Booking: Identifiable, Codable, Equatable {
    let id: String
    var clientId: String
    var therapistId: String
    var serviceId: String
    var serviceName: String
    var duration: Int // minutes
    var price: Double
    var scheduledAt: Date
    var timezone: String
    var status: BookingStatus
    var cancellationReason: String?
    var videoRoomId: String?
    var stripePaymentIntentId: String?
    var platformFee: Double
    var therapistPayout: Double
    var promoCode: String?
    var discount: Double?
    var proposedScheduledAt: Date?
    var rescheduleCount: Int
    var packBookingId: String?
    var createdAt: Date
    var updatedAt: Date
    
    // Computed
    var endTime: Date {
        scheduledAt.addingTimeInterval(TimeInterval(duration * 60))
    }
    
    var formattedDate: String {
        scheduledAt.formatted(date: .abbreviated, time: .omitted)
    }
    
    var formattedTime: String {
        scheduledAt.formatted(date: .omitted, time: .shortened)
    }
    
    var formattedDateTime: String {
        // `at` must be localized — in IT it's "alle".
        let connector = String(localized: "at", comment: "Connector between a date and a time, e.g. 'Apr 16 at 9:30'")
        return "\(formattedDate) \(connector) \(formattedTime)"
    }

    var formattedProposedDateTime: String? {
        guard let proposed = proposedScheduledAt else { return nil }
        let connector = String(localized: "at", comment: "Connector between a date and a time, e.g. 'Apr 16 at 9:30'")
        return "\(proposed.formatted(date: .abbreviated, time: .omitted)) \(connector) \(proposed.formatted(date: .omitted, time: .shortened))"
    }
    
    var hasProposedReschedule: Bool {
        status == .reschedulePending && proposedScheduledAt != nil
    }
    
    var canJoinVideoCall: Bool {
        // All sessions are virtual (platform is video-only V1). Format check removed.
        guard videoRoomId != nil, !(videoRoomId?.isEmpty ?? true) else { return false }
        let now = Date()

        // Active sessions: joinable any time on the session day
        if status == .confirmed || status == .inProgress || status == .reschedulePending {
            let calendar = Calendar.current
            let dayStart = calendar.startOfDay(for: scheduledAt)
            guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else { return false }
            return now >= dayStart && now < dayEnd
        }

        // Completed sessions: 3-hour grace period from scheduled start for rejoin
        // (covers accidental disconnects that auto-marked the session as completed)
        if status == .completed {
            let graceEnd = scheduledAt.addingTimeInterval(3 * 60 * 60)
            return now >= scheduledAt && now <= graceEnd
        }

        return false
    }
}
