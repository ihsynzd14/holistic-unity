import Foundation

struct Conversation: Identifiable, Codable, Equatable {
    let id: String
    var participants: [String] // two user IDs
    var lastMessage: LastMessage?
    var unreadCount: [String: Int] // userId -> count
    var createdAt: Date
    var updatedAt: Date
    
    struct LastMessage: Codable, Equatable {
        var text: String
        var senderId: String
        var timestamp: Date
        var type: MessageType
    }
    
    func unreadCountFor(userId: String) -> Int {
        unreadCount[userId] ?? 0
    }
    
    func otherParticipantId(currentUserId: String) -> String? {
        participants.first { $0 != currentUserId }
    }
}
