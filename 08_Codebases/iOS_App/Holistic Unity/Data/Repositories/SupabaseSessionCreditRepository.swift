import Foundation
import Supabase

enum SessionCreditError: LocalizedError {
    case creditExhausted
    case creditNotFound

    var errorDescription: String? {
        switch self {
        case .creditExhausted:
            return "No sessions remaining for this credit."
        case .creditNotFound:
            return "Session credit not found."
        }
    }
}

final class SupabaseSessionCreditRepository: SessionCreditRepositoryProtocol, @unchecked Sendable {

    // Select only the columns mapped by SessionCreditDTO to avoid decoding failures
    // when the DB table has extra columns not present in the DTO.
    private static let sessionCreditColumns = "id,client_id,therapist_id,service_id,pack_booking_id,sessions_total,sessions_remaining,created_at,updated_at"

    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
    }

    // MARK: - Read

    func getActiveCredits(clientId: String, therapistId: String) async throws -> [SessionCredit] {
        let dtos: [SessionCreditDTO] = try await client
            .from(SupabaseConfig.Table.sessionCredits)
            .select(Self.sessionCreditColumns)
            .eq("client_id", value: clientId)
            .eq("therapist_id", value: therapistId)
            .gt("sessions_remaining", value: 0)
            .order("created_at", ascending: true)
            .execute()
            .value

        return dtos.map { $0.toDomain() }
    }

    func getCredits(clientId: String) async throws -> [SessionCredit] {
        let dtos: [SessionCreditDTO] = try await client
            .from(SupabaseConfig.Table.sessionCredits)
            .select(Self.sessionCreditColumns)
            .eq("client_id", value: clientId)
            .order("created_at", ascending: false)
            .execute()
            .value

        return dtos.map { $0.toDomain() }
    }

    // MARK: - Create

    func createCredit(_ credit: SessionCredit) async throws -> SessionCredit {
        let dto = SessionCreditDTO.from(credit)
        try await client
            .from(SupabaseConfig.Table.sessionCredits)
            .insert(dto)
            .execute()
        return credit
    }

    // MARK: - Use

    func useCredit(creditId: String) async throws -> SessionCredit {
        // C5: Client-side guard — verify credit has remaining sessions before calling RPC.
        // The DB RPC should also enforce this, but we catch it early for better UX.
        let checkDtos: [SessionCreditDTO] = try await client
            .from(SupabaseConfig.Table.sessionCredits)
            .select(Self.sessionCreditColumns)
            .eq("id", value: creditId)
            .limit(1)
            .execute()
            .value

        guard let existing = checkDtos.first else {
            throw SessionCreditError.creditNotFound
        }
        guard existing.sessionsRemaining > 0 else {
            throw SessionCreditError.creditExhausted
        }

        let dto: SessionCreditDTO = try await client
            .rpc("use_session_credit", params: ["p_credit_id": creditId])
            .single()
            .execute()
            .value

        return dto.toDomain()
    }

    // MARK: - Lookup

    func getCredit(byPackBookingId packBookingId: String) async throws -> SessionCredit? {
        let dtos: [SessionCreditDTO] = try await client
            .from(SupabaseConfig.Table.sessionCredits)
            .select(Self.sessionCreditColumns)
            .eq("pack_booking_id", value: packBookingId)
            .limit(1)
            .execute()
            .value

        return dtos.first?.toDomain()
    }

    // MARK: - Restore

    func restoreCredit(creditId: String) async throws -> SessionCredit {
        let dto: SessionCreditDTO = try await client
            .rpc("restore_session_credit", params: ["p_credit_id": creditId])
            .single()
            .execute()
            .value

        return dto.toDomain()
    }
}
