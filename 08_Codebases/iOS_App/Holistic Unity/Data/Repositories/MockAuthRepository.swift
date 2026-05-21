import Foundation

/// Mock implementation for development and previews. Replace with Firebase/real backend implementation.
final class MockAuthRepository: AuthRepositoryProtocol {
    private var storedUser: User?
    
    func signUpWithEmail(email: String, password: String, displayName: String) async throws -> User {
        // Simulate network delay
        try await Task.sleep(for: .seconds(1))
        
        guard password.count >= AppConstants.Validation.minPasswordLength else {
            throw AuthError.weakPassword
        }
        
        let user = User(
            id: UUID().uuidString,
            email: email,
            displayName: displayName,
            authProvider: .email,
            isEmailVerified: false,
            preferredLanguages: ["English"],
            experienceLevel: nil,
            intention: nil,
            marketingConsent: false,
            marketingConsentDate: nil,
            createdAt: Date(),
            updatedAt: Date()
        )
        storedUser = user
        return user
    }
    
    func signInWithEmail(email: String, password: String) async throws -> User {
        try await Task.sleep(for: .seconds(1))
        
        if let user = storedUser, user.email == email {
            return user
        }
        
        // Return a mock user for development
        let user = User(
            id: "mock-user-123",
            email: email,
            displayName: "Test User",
            authProvider: .email,
            isEmailVerified: true,
            preferredLanguages: ["English"],
            experienceLevel: nil,
            intention: nil,
            marketingConsent: false,
            marketingConsentDate: nil,
            createdAt: Date(),
            updatedAt: Date()
        )
        storedUser = user
        return user
    }
    
    func signInWithApple(idToken: String, nonce: String) async throws -> User {
        try await Task.sleep(for: .seconds(1))
        let user = User(
            id: UUID().uuidString,
            displayName: "Apple User",
            authProvider: .apple,
            isEmailVerified: true,
            preferredLanguages: ["English"],
            experienceLevel: nil,
            intention: nil,
            marketingConsent: false,
            marketingConsentDate: nil,
            createdAt: Date(),
            updatedAt: Date()
        )
        storedUser = user
        return user
    }
    
    func signInWithGoogle(idToken: String, accessToken: String) async throws -> User {
        try await Task.sleep(for: .seconds(1))
        let user = User(
            id: UUID().uuidString,
            email: "user@gmail.com",
            displayName: "Google User",
            authProvider: .google,
            isEmailVerified: true,
            preferredLanguages: ["English"],
            experienceLevel: nil,
            intention: nil,
            marketingConsent: false,
            marketingConsentDate: nil,
            createdAt: Date(),
            updatedAt: Date()
        )
        storedUser = user
        return user
    }
    
    func sendEmailVerification() async throws {
        try await Task.sleep(for: .seconds(0.5))
    }
    
    func sendPasswordReset(email: String) async throws {
        try await Task.sleep(for: .seconds(0.5))
    }
    
    func signOut() throws {
        storedUser = nil
    }
    
    func deleteAccount() async throws {
        try await Task.sleep(for: .seconds(1))
        storedUser = nil
    }
    
    func getCurrentUser() throws -> User? {
        storedUser
    }
    
    func fetchCurrentUserProfile() async throws -> User? {
        storedUser
    }
    
    func setUserRole(_ role: UserRole, for userId: String) async throws {
        try await Task.sleep(for: .seconds(0.5))
        storedUser?.role = role
    }
}
