import Foundation
@testable import Holistic_Unity

final class MockSessionCreditRepository: SessionCreditRepositoryProtocol, @unchecked Sendable {

    // MARK: - Configurable results

    var activeCredits: [SessionCredit] = []
    var allCredits: [SessionCredit] = []
    var useCreditResult: SessionCredit?
    var useCreditError: Error?
    var restoreCreditResult: SessionCredit?
    var creditByPackBookingId: SessionCredit?

    // MARK: - Call tracking

    var getActiveCreditsCalled = false
    var useCreditCallCount = 0
    var restoreCreditCallCount = 0

    // MARK: - Protocol conformance

    func getActiveCredits(clientId: String, therapistId: String) async throws -> [SessionCredit] {
        getActiveCreditsCalled = true
        return activeCredits.filter { $0.clientId == clientId && $0.therapistId == therapistId }
    }

    func getCredits(clientId: String) async throws -> [SessionCredit] {
        allCredits.filter { $0.clientId == clientId }
    }

    func createCredit(_ credit: SessionCredit) async throws -> SessionCredit {
        credit
    }

    func useCredit(creditId: String) async throws -> SessionCredit {
        useCreditCallCount += 1
        if let error = useCreditError { throw error }
        return useCreditResult ?? TestFactory.makeSessionCredit(id: creditId, sessionsRemaining: 2)
    }

    func getCredit(byPackBookingId packBookingId: String) async throws -> SessionCredit? {
        creditByPackBookingId
    }

    func restoreCredit(creditId: String) async throws -> SessionCredit {
        restoreCreditCallCount += 1
        return restoreCreditResult ?? TestFactory.makeSessionCredit(id: creditId, sessionsRemaining: 4)
    }
}
