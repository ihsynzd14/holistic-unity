import Foundation

enum NotificationType: String, Codable {
    case bookingConfirmed = "booking_confirmed"
    case bookingDeclined = "booking_declined"
    case bookingRequest = "booking_request"
    case bookingCancelled = "booking_cancelled"
    case sessionReminder = "session_reminder"
    case newMessage = "new_message"
    case videoSessionStarting = "video_session_starting"
    case reviewReceived = "review_received"
    case paymentProcessed = "payment_processed"
    case refundIssued = "refund_issued"
    case profileApproved = "profile_approved"
    case profileChangesRequested = "profile_changes_requested"
    case rescheduleRequested = "reschedule_requested"
    case rescheduleApproved = "reschedule_approved"
    case rescheduleDeclined = "reschedule_declined"
    case promotional
}

struct AppNotification: Identifiable, Codable, Equatable {
    let id: String
    var userId: String
    var type: NotificationType
    var title: String
    var body: String
    var data: NotificationData?
    var isRead: Bool
    var createdAt: Date
    
    struct NotificationData: Codable, Equatable {
        var bookingId: String?
        var conversationId: String?
        var therapistId: String?
        var clientId: String?
    }
    
    var formattedDate: String {
        let now = Date()
        let interval = now.timeIntervalSince(createdAt)
        
        if interval < 60 { return "Just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        if interval < 604800 { return "\(Int(interval / 86400))d ago" }
        return createdAt.formatted(date: .abbreviated, time: .omitted)
    }
}
