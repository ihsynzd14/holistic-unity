import XCTest
@testable import Holistic_Unity

final class BookingModelTests: XCTestCase {

    func test_endTime_adds60Minutes() {
        let start = Date(timeIntervalSince1970: 1000000)
        let booking = TestFactory.makeBooking(duration: 60, scheduledAt: start)
        XCTAssertEqual(booking.endTime, start.addingTimeInterval(3600))
    }

    func test_endTime_adds30Minutes() {
        let start = Date(timeIntervalSince1970: 1000000)
        let booking = TestFactory.makeBooking(duration: 30, scheduledAt: start)
        XCTAssertEqual(booking.endTime, start.addingTimeInterval(1800))
    }

    func test_hasProposedReschedule_whenReschedulePendingWithDate_returnsTrue() {
        let booking = TestFactory.makeBooking(
            status: .reschedulePending,
            proposedScheduledAt: Date().addingTimeInterval(86400)
        )
        XCTAssertTrue(booking.hasProposedReschedule)
    }

    func test_hasProposedReschedule_whenReschedulePendingWithoutDate_returnsFalse() {
        let booking = TestFactory.makeBooking(status: .reschedulePending, proposedScheduledAt: nil)
        XCTAssertFalse(booking.hasProposedReschedule)
    }

    func test_hasProposedReschedule_whenConfirmed_returnsFalse() {
        let booking = TestFactory.makeBooking(
            status: .confirmed,
            proposedScheduledAt: Date().addingTimeInterval(86400)
        )
        XCTAssertFalse(booking.hasProposedReschedule)
    }

    // MARK: - BookingStatus

    func test_isActive_activeStatuses() {
        let activeStatuses: [BookingStatus] = [.pending, .confirmed, .inProgress, .reschedulePending]
        for status in activeStatuses {
            XCTAssertTrue(status.isActive, "\(status) should be active")
        }
    }

    func test_isActive_inactiveStatuses() {
        let inactiveStatuses: [BookingStatus] = [.completed, .cancelled, .noShow]
        for status in inactiveStatuses {
            XCTAssertFalse(status.isActive, "\(status) should not be active")
        }
    }

    func test_allStatusesCovered() {
        // Ensure every status is either active or inactive — no gaps
        for status in BookingStatus.allCases {
            _ = status.isActive // Should not crash
            XCTAssertFalse(status.displayName.isEmpty, "\(status) should have a display name")
        }
    }
}
