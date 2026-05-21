import XCTest
@testable import Holistic_Unity

@MainActor
final class BookingFlowVM_PricingTests: XCTestCase {

    // MARK: - effectiveBasePrice

    func test_effectiveBasePrice_single_returnsServicePrice() {
        let vm = makeVM(servicePrice: 100)
        vm.purchaseOption = .single
        XCTAssertEqual(vm.effectiveBasePrice, 100)
    }

    func test_effectiveBasePrice_pack_returnsPackPriceTimesPackSize() {
        let vm = makeVM(servicePrice: 100, packSize: 4, packPrice: 80)
        vm.purchaseOption = .pack
        XCTAssertEqual(vm.effectiveBasePrice, 320) // 80 * 4
    }

    func test_effectiveBasePrice_pack_noPackPrice_fallsBackToRegularPrice() {
        let vm = makeVM(servicePrice: 100, packSize: 4, packPrice: nil)
        vm.purchaseOption = .pack
        XCTAssertEqual(vm.effectiveBasePrice, 400) // 100 * 4
    }

    func test_effectiveBasePrice_useCredit_returnsZero() {
        let credit = TestFactory.makeSessionCredit()
        let vm = makeVM(servicePrice: 100)
        vm.purchaseOption = .useCredit(credit)
        XCTAssertEqual(vm.effectiveBasePrice, 0)
    }

    func test_effectiveBasePrice_noService_returnsZero() {
        let profile = TestFactory.makeTherapistProfile()
        let vm = BookingFlowViewModel(therapist: profile, currentUserId: "u1")
        // selectedService is nil
        XCTAssertEqual(vm.effectiveBasePrice, 0)
    }

    // MARK: - discountedTotal

    func test_discountedTotal_withPromoDiscount_appliesCorrectly() {
        let vm = makeVM(servicePrice: 100)
        vm.purchaseOption = .single
        vm.promoDiscount = 0.20
        XCTAssertEqual(vm.discountedTotal ?? 0, 80.0, accuracy: 0.01)
    }

    func test_discountedTotal_noDiscount_returnsNil() {
        let vm = makeVM(servicePrice: 100)
        vm.promoDiscount = 0
        XCTAssertNil(vm.discountedTotal)
    }

    // MARK: - requiresPayment

    func test_requiresPayment_paidSingle_returnsTrue() {
        let vm = makeVM(servicePrice: 100)
        vm.purchaseOption = .single
        XCTAssertTrue(vm.requiresPayment)
    }

    func test_requiresPayment_useCredit_returnsFalse() {
        let credit = TestFactory.makeSessionCredit()
        let vm = makeVM(servicePrice: 100)
        vm.purchaseOption = .useCredit(credit)
        XCTAssertFalse(vm.requiresPayment)
    }

    func test_requiresPayment_introCall_returnsFalse() {
        let service = TestFactory.makeTherapistService(price: 0, isIntroCall: true)
        let profile = TestFactory.makeTherapistProfile(services: [service])
        let vm = BookingFlowViewModel(therapist: profile, currentUserId: "u1")
        vm.selectedService = service
        vm.purchaseOption = .single
        XCTAssertFalse(vm.requiresPayment)
    }

    func test_requiresPayment_zeroPrice_returnsFalse() {
        let vm = makeVM(servicePrice: 0)
        vm.purchaseOption = .single
        XCTAssertFalse(vm.requiresPayment)
    }

    // MARK: - Helpers

    private func makeVM(
        servicePrice: Double,
        packSize: Int? = nil,
        packPrice: Double? = nil
    ) -> BookingFlowViewModel {
        let service = TestFactory.makeTherapistService(
            price: servicePrice,
            packSize: packSize,
            packPrice: packPrice
        )
        let profile = TestFactory.makeTherapistProfile(services: [service])
        let vm = BookingFlowViewModel(therapist: profile, currentUserId: "user-1")
        vm.selectedService = service
        return vm
    }
}
