import Foundation
@testable import Holistic_Unity

final class MockPaymentRepository: PaymentRepositoryProtocol, @unchecked Sendable {

    // MARK: - Configurable results

    var bookingPaymentResult: BookingPaymentResult?
    var bookingPaymentError: Error?
    var paymentIntentResult: PaymentIntentResult?
    var paymentIntentError: Error?

    // MARK: - Call tracking

    var createBookingWithPaymentCallCount = 0
    var lastPaymentRequest: BookingPaymentRequest?
    var createPaymentIntentCallCount = 0

    // MARK: - Protocol conformance

    func createPaymentIntent(bookingId: String, therapistId: String, amount: Double, currency: String) async throws -> PaymentIntentResult {
        createPaymentIntentCallCount += 1
        if let error = paymentIntentError { throw error }
        return paymentIntentResult ?? PaymentIntentResult(
            clientSecret: "pi_secret_test",
            paymentIntentId: "pi_test_123",
            customerId: "cus_test",
            ephemeralKeySecret: "ek_test",
            customerSessionClientSecret: "cs_test",
            feeBreakdown: nil
        )
    }

    func confirmPayment(paymentIntentId: String) async throws -> Transaction {
        fatalError("Not needed in tests")
    }

    func requestRefund(transactionId: String) async throws {}

    func getTransaction(bookingId: String) async throws -> Transaction? { nil }

    func getTransactionHistory(userId: String, role: UserRole) async throws -> [Transaction] { [] }

    func getEarningsSummary(therapistId: String) async throws -> EarningsSummary {
        EarningsSummary(totalEarnings: 0, thisWeek: 0, thisMonth: 0, pendingPayout: 0, totalSessions: 0)
    }

    func createStripeConnectAccount(therapistId: String) async throws -> String { "" }
    func getStripeConnectDashboardURL(therapistId: String) async throws -> String { "" }
    func getSavedPaymentMethods(clientId: String) async throws -> [SavedPaymentMethod] { [] }

    func addPaymentMethod(clientId: String, token: String) async throws -> SavedPaymentMethod {
        fatalError("Not needed in tests")
    }

    func removePaymentMethod(methodId: String) async throws {}

    func createBookingWithPayment(_ request: BookingPaymentRequest) async throws -> BookingPaymentResult {
        createBookingWithPaymentCallCount += 1
        lastPaymentRequest = request
        if let error = bookingPaymentError { throw error }
        return bookingPaymentResult ?? BookingPaymentResult(
            bookingId: request.bookingId,
            clientSecret: "pi_secret_test",
            paymentIntentId: "pi_test_123",
            customerId: "cus_test",
            ephemeralKeySecret: "ek_test",
            customerSessionClientSecret: "cs_test",
            feeBreakdown: nil
        )
    }
}
