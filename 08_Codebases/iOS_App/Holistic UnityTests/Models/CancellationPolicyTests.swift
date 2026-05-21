import XCTest
@testable import Holistic_Unity

final class CancellationPolicyTests: XCTestCase {

    func test_refundPercentage_moreThan24Hours_returnsFiftyPercent() {
        let policy = CancellationPolicy.flexible
        XCTAssertEqual(policy.refundPercentage(hoursUntilSession: 48), 0.5)
    }

    func test_refundPercentage_exactly24Hours_returnsFiftyPercent() {
        let policy = CancellationPolicy.flexible
        XCTAssertEqual(policy.refundPercentage(hoursUntilSession: 24), 0.5)
    }

    func test_refundPercentage_lessThan24Hours_returnsZero() {
        let policy = CancellationPolicy.flexible
        XCTAssertEqual(policy.refundPercentage(hoursUntilSession: 23.9), 0.0)
    }

    func test_refundPercentage_zeroHours_returnsZero() {
        let policy = CancellationPolicy.flexible
        XCTAssertEqual(policy.refundPercentage(hoursUntilSession: 0), 0.0)
    }

    func test_refundCutoffHours_is24_forAllPolicies() {
        for policy in CancellationPolicy.allCases {
            XCTAssertEqual(policy.refundCutoffHours, 24,
                           "\(policy) should have 24h cutoff")
        }
    }

    func test_standardPolicy_isFlexible() {
        XCTAssertEqual(CancellationPolicy.standard, .flexible)
    }

    func test_allPolicies_haveNonEmptyDescription() {
        for policy in CancellationPolicy.allCases {
            XCTAssertFalse(policy.description.isEmpty)
            XCTAssertFalse(policy.displayName.isEmpty)
        }
    }
}
