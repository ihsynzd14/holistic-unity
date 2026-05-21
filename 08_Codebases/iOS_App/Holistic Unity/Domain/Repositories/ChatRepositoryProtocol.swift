import Foundation

protocol ChatRepositoryProtocol: Sendable {
    func getConversations(userId: String) async throws -> [Conversation]
    func getOrCreateConversation(participantIds: [String]) async throws -> Conversation
    
    func getMessages(conversationId: String, limit: Int, before: Date?) async throws -> [ChatMessage]
    func sendMessage(_ message: ChatMessage, conversationId: String) async throws
    func markAsRead(conversationId: String, userId: String) async throws
    
    func uploadVoiceNote(data: Data, conversationId: String) async throws -> URL
    func uploadImage(data: Data, conversationId: String) async throws -> URL
    
    func observeMessages(conversationId: String, onMessage: @escaping @Sendable (ChatMessage) -> Void) -> any Sendable
    func observeConversations(userId: String, onChange: @escaping @Sendable ([Conversation]) -> Void) -> any Sendable
    func observeTypingStatus(conversationId: String, onChange: @escaping @Sendable (String?) -> Void) -> any Sendable
    
    func setTyping(conversationId: String, userId: String, isTyping: Bool) async throws
}
