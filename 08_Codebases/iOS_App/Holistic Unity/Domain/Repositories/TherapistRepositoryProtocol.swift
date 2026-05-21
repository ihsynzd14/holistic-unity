import Foundation

protocol TherapistRepositoryProtocol: Sendable {
    func getProfile(therapistId: String) async throws -> TherapistProfile
    func createProfile(_ profile: TherapistProfile) async throws
    func updateProfile(_ profile: TherapistProfile) async throws
    func submitForReview(therapistId: String) async throws
    
    func searchTherapists(query: String?, categories: [TherapyCategory], languages: [String], minRating: Double?, priceRange: ClosedRange<Double>?, sortBy: TherapistSortOption, page: Int, pageSize: Int) async throws -> [TherapistProfile]
    
    func getFeaturedTherapists() async throws -> [TherapistProfile]
    func getRecommendedTherapists(for clientProfile: ClientProfile) async throws -> [TherapistProfile]
    func getNearbyTherapists(latitude: Double, longitude: Double, radiusKm: Double) async throws -> [TherapistProfile]
    
    func uploadProfilePhoto(therapistId: String, imageData: Data) async throws -> URL
    func uploadVideoIntro(therapistId: String, videoURL: URL) async throws -> URL
    func uploadCertificateImage(therapistId: String, certificateId: String, imageData: Data) async throws -> URL
    func uploadGalleryImage(therapistId: String, imageData: Data) async throws -> URL
}

enum TherapistSortOption: String, CaseIterable {
    case relevance
    case priceLowToHigh = "price_asc"
    case priceHighToLow = "price_desc"
    case rating
    case distance
    
    var displayName: String {
        switch self {
        case .relevance: return "Relevance"
        case .priceLowToHigh: return "Price: Low to High"
        case .priceHighToLow: return "Price: High to Low"
        case .rating: return "Highest Rated"
        case .distance: return "Nearest"
        }
    }
}
