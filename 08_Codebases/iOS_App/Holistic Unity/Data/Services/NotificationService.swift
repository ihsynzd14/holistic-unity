import Foundation
import UserNotifications

/// Manages local push notifications for session reminders and booking updates.
/// SM-04: Session reminder notifications
/// SM-03: Booking confirmation/decline notifications
@MainActor
final class NotificationService: Sendable {
    static let shared = NotificationService()
    
    private init() {}
    
    // MARK: - Permission
    
    /// Requests notification permission from the user.
    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            return granted
        } catch {
            return false
        }
    }
    
    /// Checks if notifications are currently authorized.
    func isAuthorized() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized
    }
    
    // MARK: - SM-04: Session Reminders
    
    /// Schedules a local notification reminder before an upcoming session.
    /// - Parameters:
    ///   - booking: The booking to schedule a reminder for.
    ///   - therapistName: The display name of the therapist.
    ///   - minutesBefore: How many minutes before the session to fire the reminder.
    func scheduleSessionReminder(
        bookingId: String,
        sessionDate: Date,
        therapistName: String,
        serviceName: String,
        minutesBefore: Int = 30
    ) {
        let reminderDate = sessionDate.addingTimeInterval(-TimeInterval(minutesBefore * 60))
        
        // Don't schedule if the reminder time is in the past
        guard reminderDate > Date() else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Starting Soon"
        content.body = "Your \(serviceName) session with \(therapistName) starts in \(minutesBefore) minutes."
        content.sound = .default
        content.categoryIdentifier = "SESSION_REMINDER"
        content.userInfo = ["bookingId": bookingId]
        
        let components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: reminderDate
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        
        let request = UNNotificationRequest(
            identifier: "session-reminder-\(bookingId)",
            content: content,
            trigger: trigger
        )
        
        UNUserNotificationCenter.current().add(request)
    }
    
    /// Removes a previously scheduled session reminder.
    func cancelSessionReminder(bookingId: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: ["session-reminder-\(bookingId)"]
        )
    }
    
    // MARK: - SM-03: Booking Status Notifications
    
    /// Sends an immediate local notification when a booking is confirmed by the therapist.
    func notifyBookingConfirmed(
        bookingId: String,
        therapistName: String,
        serviceName: String,
        sessionDate: Date
    ) {
        let content = UNMutableNotificationContent()
        content.title = "Booking Confirmed!"
        content.body = "\(therapistName) confirmed your \(serviceName) session on \(sessionDate.formatted(date: .abbreviated, time: .shortened))."
        content.sound = .default
        content.categoryIdentifier = "BOOKING_STATUS"
        content.userInfo = ["bookingId": bookingId, "status": "confirmed"]
        
        // Fire immediately (1-second delay)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        
        let request = UNNotificationRequest(
            identifier: "booking-confirmed-\(bookingId)",
            content: content,
            trigger: trigger
        )
        
        UNUserNotificationCenter.current().add(request)
    }
    
    /// Sends an immediate local notification when a booking is declined by the therapist.
    func notifyBookingDeclined(
        bookingId: String,
        therapistName: String,
        serviceName: String,
        reason: String? = nil
    ) {
        let content = UNMutableNotificationContent()
        content.title = "Booking Update"
        let reasonText = reason.map { " Reason: \($0)" } ?? ""
        content.body = "\(therapistName) was unable to confirm your \(serviceName) session.\(reasonText) You can try booking a different time."
        content.sound = .default
        content.categoryIdentifier = "BOOKING_STATUS"
        content.userInfo = ["bookingId": bookingId, "status": "declined"]
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        
        let request = UNNotificationRequest(
            identifier: "booking-declined-\(bookingId)",
            content: content,
            trigger: trigger
        )
        
        UNUserNotificationCenter.current().add(request)
    }
    
    // MARK: - Reschedule Notifications
    
    /// Sends a local notification to the therapist when a client requests a reschedule.
    func notifyRescheduleRequested(
        bookingId: String,
        clientName: String,
        serviceName: String,
        originalDate: Date,
        proposedDate: Date
    ) {
        let content = UNMutableNotificationContent()
        content.title = "Reschedule Request"
        content.body = "\(clientName) wants to reschedule their \(serviceName) session from \(originalDate.formatted(date: .abbreviated, time: .shortened)) to \(proposedDate.formatted(date: .abbreviated, time: .shortened))."
        content.sound = .default
        content.categoryIdentifier = "RESCHEDULE_REQUEST"
        content.userInfo = ["bookingId": bookingId]
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(
            identifier: "reschedule-requested-\(bookingId)",
            content: content,
            trigger: trigger
        )
        UNUserNotificationCenter.current().add(request)
    }
    
    /// Sends a local notification to the client when a therapist approves a reschedule.
    func notifyRescheduleApproved(
        bookingId: String,
        therapistName: String,
        serviceName: String,
        newDate: Date
    ) {
        let content = UNMutableNotificationContent()
        content.title = "Reschedule Approved!"
        content.body = "\(therapistName) approved your reschedule request. Your \(serviceName) session is now on \(newDate.formatted(date: .abbreviated, time: .shortened))."
        content.sound = .default
        content.categoryIdentifier = "BOOKING_STATUS"
        content.userInfo = ["bookingId": bookingId, "status": "reschedule_approved"]
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(
            identifier: "reschedule-approved-\(bookingId)",
            content: content,
            trigger: trigger
        )
        UNUserNotificationCenter.current().add(request)
    }
    
    /// Sends a local notification to the client when a therapist declines a reschedule.
    func notifyRescheduleDeclined(
        bookingId: String,
        therapistName: String,
        serviceName: String,
        originalDate: Date
    ) {
        let content = UNMutableNotificationContent()
        content.title = "Reschedule Declined"
        content.body = "\(therapistName) was unable to accommodate your reschedule request. Your \(serviceName) session remains on \(originalDate.formatted(date: .abbreviated, time: .shortened))."
        content.sound = .default
        content.categoryIdentifier = "BOOKING_STATUS"
        content.userInfo = ["bookingId": bookingId, "status": "reschedule_declined"]
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(
            identifier: "reschedule-declined-\(bookingId)",
            content: content,
            trigger: trigger
        )
        UNUserNotificationCenter.current().add(request)
    }
    
    // MARK: - Bulk Schedule
    
    /// Schedules reminders for all upcoming bookings. Call on app launch.
    func scheduleRemindersForUpcomingBookings(_ bookings: [Booking], therapistNames: [String: String]) {
        for booking in bookings where booking.status == .confirmed {
            let therapistName = therapistNames[booking.therapistId] ?? "your therapist"
            scheduleSessionReminder(
                bookingId: booking.id,
                sessionDate: booking.scheduledAt,
                therapistName: therapistName,
                serviceName: booking.serviceName
            )
        }
    }
    
    /// Removes all pending session reminders.
    func cancelAllReminders() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }
}
