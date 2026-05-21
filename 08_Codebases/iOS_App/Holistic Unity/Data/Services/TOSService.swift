import Foundation
import CryptoKit
import Supabase
import os.log

/// Backend service for the Terms-of-Service acceptance flow.
///
/// **No UI here on purpose.** This file is the data/logic layer the
/// future TOS modal screen will call. Adding it now (a) lets us run the
/// audit pipeline + tests against a real implementation rather than a
/// stub, (b) lets the next session that adds the UI focus only on
/// SwiftUI views, and (c) mirrors the web app exactly so a single
/// `tos_acceptances` table stays the source of truth across both
/// platforms.
///
/// ## Mirrors the web app
///
/// - Schema: same `public.tos_acceptances` table the web hits
///   (see `client-webapp/src/app/api/tos/accept/route.ts`)
/// - Versions: BUMP `Self.clientVersion` whenever the corresponding
///   constant in `client-webapp/src/lib/tos/version.ts` is bumped
/// - `document_hash`: SHA-256 of the version string, identical recipe
/// - `user_role`: derived from server-side user metadata, not request body
///
/// ## Usage from a future SwiftUI modal
///
/// ```swift
/// let needsTOS = await TOSService.shared.needsAcceptance(
///     userId: authManager.currentUser!.id,
///     role: authManager.currentUser!.role ?? .client
/// )
/// if needsTOS {
///     // present the modal …
/// }
///
/// // when the user taps "Accept":
/// try await TOSService.shared.recordAcceptance(
///     userId: authManager.currentUser!.id,
///     role: .client,
///     general: true, vessatorie: true, privacy: true, healthData: true
/// )
/// ```
final class TOSService: @unchecked Sendable {

    static let shared = TOSService()

    // ─────────────────────────────────────────────────────────────────
    // MARK: - Versions (KEEP IN SYNC with client-webapp/src/lib/tos/version.ts)
    // ─────────────────────────────────────────────────────────────────

    /// Current Terms-of-Service version for clients.
    /// Format: `<role>-vMAJOR.MINOR-YYYYMMDD`.
    /// Bump MAJOR for changes that materially alter user rights
    /// (cancellation, commission, jurisdiction). Bump MINOR for
    /// clarifications. Bumping triggers the re-acceptance modal on
    /// next launch.
    static let clientVersion = "client-v1.0-20260425"

    /// Current Terms-of-Service version for therapists.
    /// Therapists today onboard via web only; iOS uses this constant
    /// only as a defensive fallback if a therapist-role user ever
    /// reaches an iOS acceptance flow.
    static let therapistVersion = "therapist-v1.0-20260425"

    /// Public-facing URLs for the document modal to open in Safari.
    enum URLs {
        static let clientTerms = "https://holisticunity.app/terms-clients.html"
        static let therapistTerms = "https://holisticunity.app/terms-therapists.html"
        static let privacyPolicy = "https://holisticunity.app/privacy-policy.html"
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: - Internals
    // ─────────────────────────────────────────────────────────────────

    private let client: SupabaseClient
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "com.holisticunity.app",
        category: "TOS"
    )

    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
    }

    /// Returns the version string the given role must currently accept.
    static func currentVersion(for role: UserRole) -> String {
        switch role {
        case .therapist: return therapistVersion
        case .client:    return clientVersion
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: - Public API
    // ─────────────────────────────────────────────────────────────────

    /// Returns `true` if the user has either no acceptance row at all,
    /// or their latest acceptance is for a version older than the
    /// current one. Returns `false` on error: we fail-OPEN so a transient
    /// Supabase outage doesn't trap an authenticated user behind the
    /// modal — but we log so production monitoring catches it.
    func needsAcceptance(userId: String, role: UserRole) async -> Bool {
        let target = Self.currentVersion(for: role)
        do {
            let rows: [LatestAcceptanceRow] = try await client
                .from("tos_acceptances")
                .select("tos_version, accepted_at")
                .eq("user_id", value: userId)
                .order("accepted_at", ascending: false)
                .limit(1)
                .execute()
                .value
            guard let latest = rows.first else { return true }
            return latest.tosVersion != target
        } catch {
            logger.error("needsAcceptance lookup failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    /// Persists a TOS acceptance row. Mirrors the web `/api/tos/accept`
    /// endpoint exactly. Returns the inserted row id on success.
    ///
    /// All four booleans MUST be `true`. Passing `false` is treated as
    /// a programming error (the modal should disable the button until
    /// every checkbox is checked) — we throw instead of inserting an
    /// invalid audit row that might survive in the table forever.
    @discardableResult
    func recordAcceptance(
        userId: String,
        role: UserRole,
        general: Bool,
        vessatorie: Bool,
        privacy: Bool,
        healthData: Bool
    ) async throws -> String {
        guard general, vessatorie, privacy, healthData else {
            throw TOSError.requiredApprovalMissing
        }
        let version = Self.currentVersion(for: role)
        let row = AcceptanceInsertRow(
            userId: userId,
            userRole: role.rawValue,
            tosVersion: version,
            generalAccept: true,
            vessatorieAccept: true,
            privacyAccept: true,
            healthDataAccept: true,
            documentHash: Self.sha256Hex(of: version)
            // ip_address + user_agent intentionally omitted — they are
            // derived server-side by the web `/api/tos/accept`. From iOS
            // we don't have access to the public IP and the User-Agent
            // header would just be the URLSession default. Leaving them
            // NULL is acceptable for the audit trail (the row is still
            // attributed by user_id + accepted_at + tos_version).
        )
        let inserted: [InsertedRow] = try await client
            .from("tos_acceptances")
            .insert(row)
            .select("id")
            .execute()
            .value
        guard let id = inserted.first?.id else {
            throw TOSError.insertReturnedNoRow
        }
        logger.info("TOS accepted by \(userId, privacy: .public) for version \(version, privacy: .public)")
        return id
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: - Helpers
    // ─────────────────────────────────────────────────────────────────

    /// SHA-256 hex digest of the input string. Same recipe as the web's
    /// crypto.subtle.digest("SHA-256") call so the two platforms land
    /// identical document_hash values for the same TOS version.
    static func sha256Hex(of input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Errors

enum TOSError: LocalizedError {
    case requiredApprovalMissing
    case insertReturnedNoRow

    var errorDescription: String? {
        switch self {
        case .requiredApprovalMissing:
            return "All four approvals (general, vessatorie, privacy, health data) are required."
        case .insertReturnedNoRow:
            return "TOS acceptance was saved but the server did not return a row id."
        }
    }
}

// MARK: - DB row codables

private struct LatestAcceptanceRow: Decodable {
    let tosVersion: String
    let acceptedAt: String

    enum CodingKeys: String, CodingKey {
        case tosVersion = "tos_version"
        case acceptedAt = "accepted_at"
    }
}

private struct AcceptanceInsertRow: Encodable {
    let userId: String
    let userRole: String
    let tosVersion: String
    let generalAccept: Bool
    let vessatorieAccept: Bool
    let privacyAccept: Bool
    let healthDataAccept: Bool
    let documentHash: String

    enum CodingKeys: String, CodingKey {
        case userId           = "user_id"
        case userRole         = "user_role"
        case tosVersion       = "tos_version"
        case generalAccept    = "general_accept"
        case vessatorieAccept = "vessatorie_accept"
        case privacyAccept    = "privacy_accept"
        case healthDataAccept = "health_data_accept"
        case documentHash     = "document_hash"
    }
}

private struct InsertedRow: Decodable {
    let id: String
}
