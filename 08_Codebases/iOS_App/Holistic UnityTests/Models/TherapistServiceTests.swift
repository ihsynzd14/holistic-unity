import XCTest
@testable import Holistic_Unity

final class TherapistServiceTests: XCTestCase {

    func test_startingPrice_excludesIntroCalls() {
        let profile = TestFactory.makeTherapistProfile(services: [
            TestFactory.makeTherapistService(id: "intro", price: 0, isIntroCall: true),
            TestFactory.makeTherapistService(id: "regular", price: 100),
        ])
        XCTAssertEqual(profile.startingPrice, 100)
    }

    func test_startingPrice_returnsMinNonIntroPrice() {
        let profile = TestFactory.makeTherapistProfile(services: [
            TestFactory.makeTherapistService(id: "s1", price: 120),
            TestFactory.makeTherapistService(id: "s2", price: 80),
            TestFactory.makeTherapistService(id: "s3", price: 100),
        ])
        XCTAssertEqual(profile.startingPrice, 80)
    }

    func test_startingPrice_onlyIntroCalls_returnsNil() {
        let profile = TestFactory.makeTherapistProfile(services: [
            TestFactory.makeTherapistService(id: "intro", price: 0, isIntroCall: true),
        ])
        XCTAssertNil(profile.startingPrice)
    }

    func test_startingPrice_noServices_returnsNil() {
        let profile = TestFactory.makeTherapistProfile(services: [])
        XCTAssertNil(profile.startingPrice)
    }

    func test_formattedStartingPrice_withPrice_includesCurrencySymbol() {
        let profile = TestFactory.makeTherapistProfile(
            services: [TestFactory.makeTherapistService(price: 80)],
            currency: .eur
        )
        XCTAssertTrue(profile.formattedStartingPrice.contains("€"))
        XCTAssertTrue(profile.formattedStartingPrice.contains("80"))
    }

    func test_formattedStartingPrice_noServices_returnsContactMessage() {
        let profile = TestFactory.makeTherapistProfile(services: [])
        XCTAssertEqual(profile.formattedStartingPrice, "Contact for pricing")
    }

    func test_packSizeOptions_areStandard() {
        XCTAssertEqual(TherapistService.packSizeOptions, [4, 6, 8, 10])
    }

    func test_durationOptions_areStandard() {
        XCTAssertEqual(TherapistService.durationOptions, [15, 30, 45, 60, 75, 90, 120])
    }
}
