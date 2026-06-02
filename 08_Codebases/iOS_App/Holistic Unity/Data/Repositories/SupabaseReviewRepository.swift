import Foundation
import Supabase
import os.log

enum ReviewError: LocalizedError {
    case duplicateReview
    
    var errorDescription: String? {
        switch self {
        case .duplicateReview:
            return "You have already reviewed this session."
        }
    }
}

/// Supabase implementation of ReviewRepositoryProtocol.
/// Handles review submission, retrieval, replies, and flagging.
final class SupabaseReviewRepository: ReviewRepositoryProtocol, @unchecked Sendable {

    // Select only the columns mapped by ReviewDTO to avoid decoding failures
    // when the DB table has extra columns not present in the DTO.
    private static let reviewColumns = "id,booking_id,client_id,therapist_id,client_name,client_photo_url,rating,text,therapist_reply,therapist_reply_date,is_flagged,created_at"

    private let client: SupabaseClient

    private let logger = Logger(subsystem: AppConstants.appBundleId, category: "ReviewRepository")

    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
    }
    
    // MARK: - Read
    
    func getReviews(therapistId: String, sortBy: ReviewSortOption, page: Int) async throws -> [Review] {
        let pageSize = 20
        let from = page * pageSize
        let to = from + pageSize - 1
        
        let baseQuery = client.from(SupabaseConfig.Table.reviews)
            .select(Self.reviewColumns)
            .eq("therapist_id", value: therapistId)
            .eq("is_flagged", value: false)
        
        let orderColumn: String
        let ascending: Bool
        
        switch sortBy {
        case .mostRecent:
            orderColumn = "created_at"
            ascending = false
        case .highestRated:
            orderColumn = "rating"
            ascending = false
        case .lowestRated:
            orderColumn = "rating"
            ascending = true
        }
        
        let dtos: [ReviewDTO] = try await baseQuery
            .order(orderColumn, ascending: ascending)
            .range(from: from, to: to)
            .execute()
            .value
        
        return dtos.map { $0.toDomain() }
    }
    
    // MARK: - Write
    
    func submitReview(_ review: Review) async throws {
        // Check for existing review on this booking to prevent duplicates
        let existingCount: Int = try await client.from(SupabaseConfig.Table.reviews)
            .select("id", head: true, count: .exact)
            .eq("booking_id", value: review.bookingId)
            .eq("client_id", value: review.clientId)
            .execute()
            .count ?? 0
        
        guard existingCount == 0 else {
            throw ReviewError.duplicateReview
        }
        
        let formatter = ISO8601DateFormatter.shared
        let dto = ReviewDTO(
            id: review.id,
            bookingId: review.bookingId,
            clientId: review.clientId,
            therapistId: review.therapistId,
            clientName: review.clientName,
            clientPhotoURL: review.clientPhotoURL?.absoluteString,
            rating: review.rating,
            text: review.text,
            therapistReply: nil,
            therapistReplyDate: nil,
            isFlagged: false,
            createdAt: formatter.string(from: review.createdAt)
        )
        
        try await client.from(SupabaseConfig.Table.reviews)
            .insert(dto)
            .execute()
        
        // Rating stats are maintained by a database trigger. Keep a best-effort
        // RPC refresh for databases that have the function but not the trigger yet.
        do {
            try await refreshTherapistRatingStats(therapistId: review.therapistId)
        } catch {
            logger.debug("Best-effort rating stats refresh failed: \(error.localizedDescription)")
        }
    }
    
    func replyToReview(reviewId: String, reply: String) async throws {
        let now = ISO8601DateFormatter.shared.string(from: Date())
        try await client.from(SupabaseConfig.Table.reviews)
            .update([
                "therapist_reply": reply,
                "therapist_reply_date": now
            ])
            .eq("id", value: reviewId)
            .execute()
    }
    
    func flagReview(reviewId: String, reason: String) async throws {
        try await client.from(SupabaseConfig.Table.reviews)
            .update(["is_flagged": true])
            .eq("id", value: reviewId)
            .execute()
    }
    
    // MARK: - Helpers
    
    private func refreshTherapistRatingStats(therapistId: String) async throws {
        try await client
            .rpc("refresh_therapist_rating_stats", params: ["p_therapist_id": therapistId])
            .execute()
    }
}
