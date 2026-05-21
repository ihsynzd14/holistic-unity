import Foundation
import StreamChat

/// Stream-backed implementation of ChatRepositoryProtocol.
/// Wraps Stream ChatClient operations and maps to domain models.
final class StreamChatRepository: ChatRepositoryProtocol, @unchecked Sendable {
    
    @MainActor
    private var chatClient: ChatClient { StreamChatService.shared.chatClient }
    
    // MARK: - Conversations
    
    func getConversations(userId: String) async throws -> [Conversation] {
        let controller = makeChannelListController(userId: userId)
        try await synchronizeAsync(controller)
        return controller.channels.map { mapChannelToConversation($0, currentUserId: userId) }
    }
    
    func getOrCreateConversation(participantIds: [String]) async throws -> Conversation {
        guard participantIds.count == 2 else {
            throw StreamChatError.invalidParticipants
        }
        
        let controller = try await MainActor.run {
            try StreamChatService.shared.chatClient.channelController(
                createDirectMessageChannelWith: Set(participantIds),
                extraData: [:]
            )
        }
        try await synchronizeAsync(controller)
        
        guard let channel = controller.channel else {
            throw StreamChatError.channelNotFound
        }
        
        return mapChannelToConversation(channel, currentUserId: participantIds[0])
    }
    
    // MARK: - Messages
    
    func getMessages(conversationId: String, limit: Int, before: Date?) async throws -> [ChatMessage] {
        let cid = try ChannelId(cid: conversationId)
        let controller = await MainActor.run {
            StreamChatService.shared.chatClient.channelController(for: cid)
        }
        try await synchronizeAsync(controller)
        
        let messages = controller.messages
        return messages.prefix(limit).map { mapStreamMessage($0) }
    }
    
    func sendMessage(_ message: ChatMessage, conversationId: String) async throws {
        let cid = try ChannelId(cid: conversationId)
        let controller = await MainActor.run {
            StreamChatService.shared.chatClient.channelController(for: cid)
        }
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.createNewMessage(text: message.content.text ?? "") { result in
                switch result {
                case .success:
                    continuation.resume()
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    func markAsRead(conversationId: String, userId: String) async throws {
        let cid = try ChannelId(cid: conversationId)
        let controller = await MainActor.run {
            StreamChatService.shared.chatClient.channelController(for: cid)
        }
        controller.markRead()
    }
    
    // MARK: - Media Uploads

    func uploadVoiceNote(data: Data, conversationId: String) async throws -> URL {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).m4a")
        try data.write(to: tempURL)

        let cid = try ChannelId(cid: conversationId)
        let controller = await MainActor.run {
            StreamChatService.shared.chatClient.channelController(for: cid)
        }

        let cdnURL: URL = try await withCheckedThrowingContinuation { continuation in
            controller.uploadFile(localFileURL: tempURL, progress: nil) { result in
                // Clean up temp file regardless of outcome
                try? FileManager.default.removeItem(at: tempURL)
                switch result {
                case .success(let url):
                    continuation.resume(returning: url)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
        return cdnURL
    }

    func uploadImage(data: Data, conversationId: String) async throws -> URL {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).jpg")
        try data.write(to: tempURL)

        let cid = try ChannelId(cid: conversationId)
        let controller = await MainActor.run {
            StreamChatService.shared.chatClient.channelController(for: cid)
        }

        let cdnURL: URL = try await withCheckedThrowingContinuation { continuation in
            controller.uploadImage(localFileURL: tempURL, progress: nil) { result in
                // Clean up temp file regardless of outcome
                try? FileManager.default.removeItem(at: tempURL)
                switch result {
                case .success(let url):
                    continuation.resume(returning: url)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
        return cdnURL
    }
    
    // MARK: - Real-Time (handled by Stream WebSocket internally)
    
    func observeMessages(conversationId: String, onMessage: @escaping @Sendable (ChatMessage) -> Void) throws -> any Sendable {
        return NoOpSubscription()
    }

    func observeConversations(userId: String, onChange: @escaping @Sendable ([Conversation]) -> Void) throws -> any Sendable {
        return NoOpSubscription()
    }

    func observeTypingStatus(conversationId: String, onChange: @escaping @Sendable (String?) -> Void) throws -> any Sendable {
        return NoOpSubscription()
    }
    
    func setTyping(conversationId: String, userId: String, isTyping: Bool) async throws {
        let cid = try ChannelId(cid: conversationId)
        let controller = await MainActor.run {
            StreamChatService.shared.chatClient.channelController(for: cid)
        }
        if isTyping {
            controller.sendKeystrokeEvent()
        } else {
            controller.sendStopTypingEvent()
        }
    }
    
    // MARK: - Helpers
    
    /// Wraps Stream's completion-based `synchronize` into async/await.
    private func synchronizeAsync(_ controller: ChatChannelController) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.synchronize { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
    
    /// Wraps Stream's completion-based `synchronize` for channel list controllers.
    private func synchronizeAsync(_ controller: ChatChannelListController) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.synchronize { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
    
    @MainActor
    private func makeChannelListController(userId: String) -> ChatChannelListController {
        let filter: Filter<ChannelListFilterScope> = .containMembers(userIds: [userId])
        let sort: [Sorting<ChannelListSortingKey>] = [.init(key: .lastMessageAt, isAscending: false)]
        let query = ChannelListQuery(filter: filter, sort: sort, pageSize: 25)
        return StreamChatService.shared.chatClient.channelListController(query: query)
    }
    
    private func mapChannelToConversation(_ channel: ChatChannel, currentUserId: String) -> Conversation {
        var participantIds = channel.lastActiveMembers.map(\.id)
        // Ensure the current user is always present even if lastActiveMembers is stale
        if !participantIds.contains(currentUserId) {
            participantIds.append(currentUserId)
        }
        
        var unreadCount: [String: Int] = [:]
        // Stream tracks unread per-user; we set current user's count
        unreadCount[currentUserId] = channel.unreadCount.messages
        
        let lastMsg: Conversation.LastMessage?
        if let msg = channel.latestMessages.first {
            let msgType: MessageType = {
                if !msg.attachmentCounts.isEmpty { return .image }
                return .text
            }()
            lastMsg = Conversation.LastMessage(
                text: msg.text,
                senderId: msg.author.id,
                timestamp: msg.createdAt,
                type: msgType
            )
        } else {
            lastMsg = nil
        }
        
        return Conversation(
            id: channel.cid.rawValue,
            participants: participantIds,
            lastMessage: lastMsg,
            unreadCount: unreadCount,
            createdAt: channel.createdAt,
            updatedAt: channel.updatedAt
        )
    }
    
    private func mapStreamMessage(_ msg: StreamChat.ChatMessage) -> ChatMessage {
        let type: MessageType
        if !msg.attachmentCounts.isEmpty {
            if msg.attachmentCounts.keys.contains(.image) {
                type = .image
            } else if msg.attachmentCounts.keys.contains(.audio) {
                type = .voice
            } else {
                type = .text
            }
        } else if msg.type == .system {
            type = .system
        } else {
            type = .text
        }
        
        let imageURL = msg.imageAttachments.first?.imageURL
        
        return ChatMessage(
            id: msg.id,
            senderId: msg.author.id,
            type: type,
            content: ChatMessage.MessageContent(
                text: msg.text.isEmpty ? nil : msg.text,
                mediaURL: imageURL,
                duration: nil,
                bookingId: nil
            ),
            timestamp: msg.createdAt,
            readAt: nil,
            isDeleted: msg.deletedAt != nil
        )
    }
}

// MARK: - Errors

enum StreamChatError: LocalizedError {
    case invalidParticipants
    case channelNotFound
    case notConnected
    
    var errorDescription: String? {
        switch self {
        case .invalidParticipants: return "A conversation requires exactly 2 participants."
        case .channelNotFound: return "Could not find or create the conversation."
        case .notConnected: return "Chat is not connected. Please wait a moment and try again."
        }
    }
}

// MARK: - No-Op Subscription

private final class NoOpSubscription: @unchecked Sendable {
    // Stream handles real-time internally; this satisfies the protocol
}
