import Foundation
@testable import Holistic_Unity

final class MockBookingRepository: BookingRepositoryProtocol, @unchecked Sendable {

    // MARK: - Configurable results

    var availableSlots: [TimeRange] = []
    var creditBookingResult: CreditBookingResult?
    var creditBookingError: Error?

    // MARK: - Call tracking

    var createBookingCallCount = 0
    var createBookingWithCreditCallCount = 0
    var updateStatusCallCount = 0
    var lastUpdatedBookingId: String?
    var lastUpdatedStatus: BookingStatus?
    var cancelCallCount = 0

    // MARK: - Protocol conformance

    func createBooking(_ booking: Booking) async throws -> Booking {
        createBookingCallCount += 1
        return booking
    }

    func getBooking(bookingId: String) async throws -> Booking {
        TestFactory.makeBooking(id: bookingId)
    }

    func updateBookingStatus(bookingId: String, status: BookingStatus, reason: String?) async throws {
        updateStatusCallCount += 1
        lastUpdatedBookingId = bookingId
        lastUpdatedStatus = status
    }

    func getUpcomingBookings(userId: String, role: UserRole) async throws -> [Booking] { [] }
    func getPastBookings(userId: String, role: UserRole) async throws -> [Booking] { [] }
    func getPastBookings(userId: String, role: UserRole, limit: Int, offset: Int) async throws -> [Booking] { [] }
    func getPendingBookingRequests(therapistId: String) async throws -> [Booking] { [] }

    func getAvailableSlots(therapistId: String, date: Date, serviceDuration: Int) async throws -> [TimeRange] {
        availableSlots
    }

    func acceptBooking(bookingId: String) async throws {}
    func declineBooking(bookingId: String, reason: String) async throws {}

    func cancelBooking(bookingId: String, reason: String) async throws {
        cancelCallCount += 1
    }

    func rescheduleBooking(bookingId: String, newDate: Date) async throws {}
    func requestReschedule(bookingId: String, proposedDate: Date) async throws {}
    func approveReschedule(bookingId: String) async throws {}
    func declineReschedule(bookingId: String) async throws {}
    func updateVideoRoomId(bookingId: String, videoRoomId: String) async throws {}
    func updateBookingPaymentIntent(bookingId: String, paymentIntentId: String) async throws {}

    func createBookingWithCredit(booking: Booking, creditId: String) async throws -> CreditBookingResult {
        createBookingWithCreditCallCount += 1
        if let error = creditBookingError { throw error }
        return creditBookingResult ?? CreditBookingResult(bookingId: booking.id, creditId: creditId, sessionsRemaining: 2)
    }
}
