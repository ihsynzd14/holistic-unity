import Foundation
import Supabase

/// Persists user-generated content reports + block-list operations.
///
/// Satisfies App Store Guideline 1.2 (UGC apps must let users flag
/// inappropriate content AND block other users). The DB row is the
/// source of truth; the rate-limit RLS policy (`report_rate_ok`,
/// see `Security_Fixes/2026-05-18_db_migrations.sql`) caps each
/// reporter at 10 reports per 24h to limit abuse.
///
/// Block also calls Stream Chat's `muteUser` so the blocked user's
/// messages stop arriving in real time (the local row exists so the
/// block survives Stream cache wipes + app reinstalls).
@MainActor
final class ReportService {
    static let shared = ReportService()
    private init() {}

    // MARK: - Reasons

    enum Reason: String, CaseIterable, Identifiable {
        case inappropriateBehaviour = "inappropriate_behaviour"
        case spam                    = "spam"
        case scamOrFraud             = "scam_or_fraud"
        case misleadingCredentials   = "misleading_credentials"
        case harassment              = "harassment"
        case other                   = "other"

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .inappropriateBehaviour: return String(localized: "Comportamento inappropriato", comment: "Report reason")
            case .spam:                   return String(localized: "Spam", comment: "Report reason")
            case .scamOrFraud:            return String(localized: "Truffa / frode", comment: "Report reason")
            case .misleadingCredentials:  return String(localized: "Credenziali fuorvianti", comment: "Report reason")
            case .harassment:             return String(localized: "Molestie", comment: "Report reason")
            case .other:                  return String(localized: "Altro", comment: "Report reason")
            }
        }
    }

    enum Target: String {
        case therapist
        case message
        case review
    }

    // MARK: - Submit

    /// Submits a report. Throws `ReportError.rateLimited` if the
    /// reporter has hit the 24h cap (RLS returns 403 in that case).
    func submitReport(
        targetType: Target,
        targetID: String,
        reason: Reason,
        details: String?
    ) async throws {
        struct ReportInsert: Encodable {
            let reporter_id: String
            let reported_type: String
            let reported_id: String
            let reason: String
            let details: String?
        }

        guard let userId = try? await SupabaseConfig.client.auth.user().id.uuidString else {
            throw ReportError.notAuthenticated
        }

        let row = ReportInsert(
            reporter_id: userId,
            reported_type: targetType.rawValue,
            reported_id: targetID,
            reason: reason.rawValue,
            details: (details?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : String($0.prefix(500)) }
        )

        do {
            try await SupabaseConfig.client
                .from("reports")
                .insert(row)
                .execute()
        } catch {
            // RLS rate-limit denial surfaces as 403 / PostgrestError
            if "\(error)".contains("report_rate_ok") || "\(error)".contains("403") {
                throw ReportError.rateLimited
            }
            throw error
        }
    }

    // MARK: - Block

    /// Blocks `blockedUserId` for the current user. Persists to DB
    /// AND calls Stream Chat `muteUser` so messages stop arriving.
    func blockUser(_ blockedUserId: String, reason: String? = nil) async throws {
        guard let currentUserId = try? await SupabaseConfig.client.auth.user().id.uuidString else {
            throw ReportError.notAuthenticated
        }
        guard currentUserId != blockedUserId else { return }

        struct BlockInsert: Encodable {
            let blocker_id: String
            let blocked_id: String
            let reason: String?
        }

        try await SupabaseConfig.client
            .from("blocked_users")
            .upsert(
                BlockInsert(blocker_id: currentUserId, blocked_id: blockedUserId, reason: reason),
                onConflict: "blocker_id,blocked_id"
            )
            .execute()

        await StreamChatService.shared.muteUser(blockedUserId)
    }

    /// Removes the block. Also unmutes on Stream Chat.
    func unblockUser(_ blockedUserId: String) async throws {
        guard let currentUserId = try? await SupabaseConfig.client.auth.user().id.uuidString else {
            throw ReportError.notAuthenticated
        }
        try await SupabaseConfig.client
            .from("blocked_users")
            .delete()
            .eq("blocker_id", value: currentUserId)
            .eq("blocked_id", value: blockedUserId)
            .execute()

        await StreamChatService.shared.unmuteUser(blockedUserId)
    }

    /// Returns the set of user IDs the current user has blocked.
    /// Used at app launch to seed the local block list before the
    /// Home / Explore queries fire (so blocked therapists never
    /// surface in the first place).
    func loadBlockedUserIDs() async -> Set<String> {
        guard let currentUserId = try? await SupabaseConfig.client.auth.user().id.uuidString else {
            return []
        }
        struct Row: Decodable { let blocked_id: String }
        do {
            let rows: [Row] = try await SupabaseConfig.client
                .from("blocked_users")
                .select("blocked_id")
                .eq("blocker_id", value: currentUserId)
                .execute()
                .value
            return Set(rows.map(\.blocked_id))
        } catch {
            return []
        }
    }
}

enum ReportError: Error, LocalizedError {
    case notAuthenticated
    case rateLimited

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return String(localized: "Devi essere autenticato per inviare una segnalazione.", comment: "Report error")
        case .rateLimited:
            return String(localized: "Hai raggiunto il limite di segnalazioni per oggi. Riprova domani.", comment: "Report error")
        }
    }
}
