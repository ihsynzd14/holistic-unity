import XCTest
@testable import Holistic_Unity

final class SessionCreditTests: XCTestCase {

    func test_isExhausted_whenZeroRemaining_returnsTrue() {
        let credit = TestFactory.makeSessionCredit(sessionsRemaining: 0)
        XCTAssertTrue(credit.isExhausted)
    }

    func test_isExhausted_whenNegativeRemaining_returnsTrue() {
        let credit = TestFactory.makeSessionCredit(sessionsRemaining: -1)
        XCTAssertTrue(credit.isExhausted)
    }

    func test_isExhausted_whenPositiveRemaining_returnsFalse() {
        let credit = TestFactory.makeSessionCredit(sessionsRemaining: 3)
        XCTAssertFalse(credit.isExhausted)
    }

    func test_hasCredits_whenPositiveRemaining_returnsTrue() {
        let credit = TestFactory.makeSessionCredit(sessionsRemaining: 1)
        XCTAssertTrue(credit.hasCredits)
    }

    func test_hasCredits_whenZeroRemaining_returnsFalse() {
        let credit = TestFactory.makeSessionCredit(sessionsRemaining: 0)
        XCTAssertFalse(credit.hasCredits)
    }

    func test_hasCredits_and_isExhausted_areMutuallyExclusive() {
        for remaining in -1...5 {
            let credit = TestFactory.makeSessionCredit(sessionsRemaining: remaining)
            XCTAssertNotEqual(credit.hasCredits, credit.isExhausted,
                              "sessionsRemaining=\(remaining): hasCredits and isExhausted must be mutually exclusive")
        }
    }

    func test_equatable_sameId_isEqual() {
        let a = TestFactory.makeSessionCredit(id: "c1", sessionsRemaining: 3)
        let b = TestFactory.makeSessionCredit(id: "c1", sessionsRemaining: 3)
        XCTAssertEqual(a, b)
    }

    func test_equatable_differentId_isNotEqual() {
        let a = TestFactory.makeSessionCredit(id: "c1")
        let b = TestFactory.makeSessionCredit(id: "c2")
        XCTAssertNotEqual(a, b)
    }
}
