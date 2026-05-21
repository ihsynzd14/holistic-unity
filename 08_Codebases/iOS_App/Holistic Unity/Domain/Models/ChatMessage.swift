import Foundation

enum MessageType: String, Codable {
    case text
    case voice
    case image
    case system
    case sessionLink = "session_link"
}

struct ChatMessage: Identifiable, Codable, Equatable {
    let id: String
    var senderId: String
    var type: MessageType
    var content: MessageContent
    var timestamp: Date
    var readAt: Date?
    var isDeleted: Bool
    
    struct MessageContent: Codable, Equatable {
        var text: String?
        var mediaURL: URL?
        var duration: TimeInterval? // voice note duration
        var bookingId: String?
    }
    
    var isRead: Bool { readAt != nil }
    
    var formattedTime: String {
        timestamp.formatted(date: .omitted, time: .shortened)
    }
}
