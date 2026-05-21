import Foundation

protocol SessionCreditRepositoryProtocol {
    /// Fetch all active (non-exhausted) credits for a client with a specific therapist.
    func getActiveCredits(clientId: String, therapistId: String) async throws -> [SessionCredit]

    /// Fetch all credits for a client (active and exhausted).
    func getCredits(clientId: String) async throws -> [SessionCredit]

    /// Create a new credit record after a pack purchase.
    func createCredit(_ credit: SessionCredit) async throws -> SessionCredit

    /// Decrement sessionsRemaining by 1. Throws if already exhausted.
    func useCredit(creditId: String) async throws -> SessionCredit

    /// Find a credit by its pack booking ID (the original purchase booking).
    func getCredit(byPackBookingId packBookingId: String) async throws -> SessionCredit?

    /// Increment sessionsRemaining by 1 (restores a credit after cancellation).
    func restoreCredit(creditId: String) async throws -> SessionCredit
}
