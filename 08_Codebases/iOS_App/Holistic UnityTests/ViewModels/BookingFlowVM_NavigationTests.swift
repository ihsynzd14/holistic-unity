import XCTest
@testable import Holistic_Unity

@MainActor
final class BookingFlowVM_NavigationTests: XCTestCase {

    func test_canAdvance_step0_noService_returnsFalse() {
        let vm = makeVM()
        vm.currentStep = 0
        vm.selectedService = nil
        XCTAssertFalse(vm.canAdvance)
    }

    func test_canAdvance_step0_serviceSelected_returnsTrue() {
        let vm = makeVM()
        vm.currentStep = 0
        vm.selectedService = TestFactory.makeTherapistService()
        XCTAssertTrue(vm.canAdvance)
    }

    func test_canAdvance_step1_noTimeSlot_returnsFalse() {
        let vm = makeVM()
        vm.currentStep = 1
        vm.selectedTimeSlot = nil
        XCTAssertFalse(vm.canAdvance)
    }

    func test_canAdvance_step1_timeSlotSelected_returnsTrue() {
        let vm = makeVM()
        vm.currentStep = 1
        vm.selectedTimeSlot = "10:00"
        XCTAssertTrue(vm.canAdvance)
    }

    func test_canAdvance_step2_alwaysTrue() {
        let vm = makeVM()
        vm.currentStep = 2
        XCTAssertTrue(vm.canAdvance)
    }

    func test_progress_step0_isZero() {
        let vm = makeVM()
        vm.currentStep = 0
        XCTAssertEqual(vm.progress, 0.0, accuracy: 0.001)
    }

    func test_progress_step1_isHalf() {
        let vm = makeVM()
        vm.currentStep = 1
        XCTAssertEqual(vm.progress, 0.5, accuracy: 0.001)
    }

    func test_progress_step2_isOne() {
        let vm = makeVM()
        vm.currentStep = 2
        XCTAssertEqual(vm.progress, 1.0, accuracy: 0.001)
    }

    func test_goBack_atStep0_doesNotGoBelowZero() {
        let vm = makeVM()
        vm.currentStep = 0
        vm.goBack()
        XCTAssertEqual(vm.currentStep, 0)
    }

    // MARK: - Helpers

    private func makeVM() -> BookingFlowViewModel {
        let profile = TestFactory.makeTherapistProfile()
        return BookingFlowViewModel(therapist: profile, currentUserId: "user-1")
    }
}
