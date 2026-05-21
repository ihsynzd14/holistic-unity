import Foundation

protocol BookingRepositoryProtocol: Sendable {
    func createBooking(_ booking: Booking) async throws -> Booking
    func getBooking(bookingId: String) async throws -> Booking
    func updateBookingStatus(bookingId: String, status: BookingStatus, reason: String?) async throws
    
    func getUpcomingBookings(userId: String, role: UserRole) async throws -> [Booking]
    func getPastBookings(userId: String, role: UserRole) async throws -> [Booking]
    func getPastBookings(userId: String, role: UserRole, limit: Int, offset: Int) async throws -> [Booking]
    func getPendingBookingRequests(therapistId: String) async throws -> [Booking]
    
    func getAvailableSlots(therapistId: String, date: Date, serviceDuration: Int) async throws -> [TimeRange]
    
    func acceptBooking(bookingId: String) async throws
    func declineBooking(bookingId: String, reason: String) async throws
    func cancelBooking(bookingId: String, reason: String) async throws
    func rescheduleBooking(bookingId: String, newDate: Date) async throws
    func requestReschedule(bookingId: String, proposedDate: Date) async throws
    func approveReschedule(bookingId: String) async throws
    func declineReschedule(bookingId: String) async throws
    func updateVideoRoomId(bookingId: String, videoRoomId: String) async throws
    func updateBookingPaymentIntent(bookingId: String, paymentIntentId: String) async throws

    /// Atomically creates a booking and consumes one session credit in a single DB transaction.
    /// Both operations succeed or both roll back — no orphaned bookings or phantom credit usage.
    func createBookingWithCredit(booking: Booking, creditId: String) async throws -> CreditBookingResult
}

/// Result returned by the atomic credit+booking RPC.
struct CreditBookingResult: Sendable {
    let bookingId: String
    let creditId: String
    let sessionsRemaining: Int
}
