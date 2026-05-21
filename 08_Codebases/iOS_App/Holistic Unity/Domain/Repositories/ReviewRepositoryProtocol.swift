import Foundation

protocol ReviewRepositoryProtocol: Sendable {
    func getReviews(therapistId: String, sortBy: ReviewSortOption, page: Int) async throws -> [Review]
    func submitReview(_ review: Review) async throws
    func replyToReview(reviewId: String, reply: String) async throws
    func flagReview(reviewId: String, reason: String) async throws
}

enum ReviewSortOption: String, CaseIterable {
    case mostRecent = "recent"
    case highestRated = "highest"
    case lowestRated = "lowest"
    
    var displayName: String {
        switch self {
        case .mostRecent: return "Most Recent"
        case .highestRated: return "Highest Rated"
        case .lowestRated: return "Lowest Rated"
        }
    }
}
