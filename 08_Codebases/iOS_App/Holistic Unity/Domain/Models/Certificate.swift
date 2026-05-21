import Foundation

struct Certificate: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var issuingOrganization: String
    var yearObtained: Int
    var imageURL: URL?
    var verificationURL: URL?
    var isVerified: Bool = false
    
    var yearString: String {
        String(yearObtained)
    }
}
