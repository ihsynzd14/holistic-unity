import Foundation

struct Review: Identifiable, Codable, Equatable {
    let id: String
    var bookingId: String
    var clientId: String
    var therapistId: String
    var clientName: String
    var clientPhotoURL: URL?
    var rating: Int // 1-5
    var text: String?
    var therapistReply: String?
    var therapistReplyDate: Date?
    var isFlagged: Bool
    var createdAt: Date
    
    var formattedDate: String {
        createdAt.formatted(date: .abbreviated, time: .omitted)
    }
}
