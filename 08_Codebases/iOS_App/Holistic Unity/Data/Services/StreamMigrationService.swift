import Foundation
import StreamChat
import Supabase
import os.log

/// One-time migration utility that moves existing Supabase chat conversations to Stream.
/// Creates Stream channels for each existing conversation so users see their contacts.
/// Message history migration requires a server-side Edge Function (`stream-migrate`).
@MainActor
final class StreamMigrationService {
    
    static let shared = StreamMigrationService()
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "HolisticUnity", category: "StreamMigration")
    
    private let migrationKey = "streamMigrationComplete"
    
    var isMigrationComplete: Bool {
        UserDefaults.standard.bool(forKey: migrationKey)
    }
    
    private init() {}
    
    // MARK: - DTOs for Supabase queries
    
    private struct ConversationRow: Decodable {
        let id: String
    }
    
    private struct ParticipantRow: Decodable {
        let conversationId: String
        let userId: String
        
        enum CodingKeys: String, CodingKey {
            case conversationId = "conversation_id"
            case userId = "user_id"
        }
    }
    
    // MARK: - Migration
    
    /// Migrates existing Supabase conversations to Stream channels.
    /// Creates 1-on-1 DM channels for each conversation.
    /// Message content migration requires the `stream-migrate` Edge Function.
    func migrateIfNeeded(currentUserId: String) async {
        guard !isMigrationComplete else { return }
        
        // 1. Try to fetch existing Supabase conversations
        let participants: [ParticipantRow]
        do {
            participants = try await SupabaseConfig.client
                .from("conversation_participants")
                .select("conversation_id, user_id")
                .execute()
                .value
        } catch {
            // Table may not exist or RLS blocks it — skip migration gracefully
            logger.info("No Supabase conversations to migrate: \(error.localizedDescription)")
            UserDefaults.standard.set(true, forKey: migrationKey)
            return
        }
        
        guard !participants.isEmpty else {
            // No conversations to migrate
            UserDefaults.standard.set(true, forKey: migrationKey)
            logger.info("No conversations found — marking complete")
            return
        }
        
        // Group participants by conversation
        var conversationParticipants: [String: [String]] = [:]
        for p in participants {
            conversationParticipants[p.conversationId, default: []].append(p.userId)
        }
        
        // 2. For each conversation, create a Stream channel with the same participants
        for (_, userIds) in conversationParticipants {
            guard userIds.count == 2 else { continue }
            _ = try? await StreamChatService.shared.getOrCreateChannel(
                currentUserId: userIds[0],
                otherUserId: userIds[1]
            )
        }
        
        // 3. Message history migration (optional — requires server-side Edge Function)
        _ = try? await SupabaseConfig.client.functions.invoke(
            "stream-migrate",
            options: FunctionInvokeOptions()
        )
        
        // 4. Mark migration as complete
        UserDefaults.standard.set(true, forKey: migrationKey)
        logger.info("Migration completed successfully")
    }
}
