import XCTest
@testable import Holistic_Unity

final class FeeBreakdownTests: XCTestCase {

    func test_feeBreakdown_codable_roundTrips() throws {
        let original = FeeBreakdown(
            sessionPrice: 100,
            serviceFee: 5.90,
            totalCharged: 105.90,
            commissionBase: 20,
            ivaAmount: 0,
            ivaApplied: false,
            therapistPayout: 80,
            therapistCountry: "US",
            currency: "usd"
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(FeeBreakdown.self, from: data)
        XCTAssertEqual(original, decoded)
    }

    func test_feeBreakdown_ivaApplied_forItalianTherapist() {
        let breakdown = FeeBreakdown(
            sessionPrice: 100,
            serviceFee: 5.90,
            totalCharged: 111.60,
            commissionBase: 20,
            ivaAmount: 5.70,
            ivaApplied: true,
            therapistPayout: 74.30,
            therapistCountry: "IT",
            currency: "eur"
        )
        XCTAssertTrue(breakdown.ivaApplied)
        XCTAssertGreaterThan(breakdown.ivaAmount, 0)
        XCTAssertEqual(breakdown.therapistCountry, "IT")
    }

    func test_feeBreakdown_noIva_forNonItalianTherapist() {
        let breakdown = FeeBreakdown(
            sessionPrice: 100,
            serviceFee: 5.90,
            totalCharged: 105.90,
            commissionBase: 20,
            ivaAmount: 0,
            ivaApplied: false,
            therapistPayout: 80,
            therapistCountry: "US",
            currency: "usd"
        )
        XCTAssertFalse(breakdown.ivaApplied)
        XCTAssertEqual(breakdown.ivaAmount, 0)
    }

    func test_platformCommission_isTwentyPercent() {
        XCTAssertEqual(AppConstants.Platform.commissionPercentage, 0.20, accuracy: 0.001)
    }
}
