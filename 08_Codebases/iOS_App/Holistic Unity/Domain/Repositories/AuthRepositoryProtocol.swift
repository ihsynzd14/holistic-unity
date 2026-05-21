import Foundation

enum AuthError: LocalizedError {
    case invalidCredentials
    case emailAlreadyInUse
    case weakPassword
    case networkError
    case emailNotVerified
    case accountDisabled
    case unknown(String)
    
    var errorDescription: String? {
        switch self {
        case .invalidCredentials: return "Invalid email or password"
        case .emailAlreadyInUse: return "An account with this email already exists"
        case .weakPassword: return "Password must be at least 8 characters"
        case .networkError: return "Network error. Please check your connection"
        case .emailNotVerified: return "Please verify your email address"
        case .accountDisabled: return "This account has been disabled"
        case .unknown(let message): return message
        }
    }
}

protocol AuthRepositoryProtocol: Sendable {
    func signUpWithEmail(email: String, password: String, displayName: String) async throws -> User
    func signInWithEmail(email: String, password: String) async throws -> User
    func signInWithApple(idToken: String, nonce: String) async throws -> User
    func signInWithGoogle(idToken: String, accessToken: String) async throws -> User
    func sendEmailVerification() async throws
    func sendPasswordReset(email: String) async throws
    func signOut() throws
    func deleteAccount() async throws
    func getCurrentUser() -> User?
    func fetchCurrentUserProfile() async throws -> User?
    func setUserRole(_ role: UserRole, for userId: String) async throws
}
