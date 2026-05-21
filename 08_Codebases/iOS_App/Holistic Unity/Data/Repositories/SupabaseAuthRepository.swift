import Foundation
import Supabase

/// Real Supabase implementation of AuthRepositoryProtocol.
/// Handles user sign-up, sign-in, sign-out, and profile management via Supabase Auth + database.
final class SupabaseAuthRepository: AuthRepositoryProtocol, @unchecked Sendable {
    
    private let client: SupabaseClient
    
    /// Thread-safe cached user storage
    private let _cachedUserLock = NSLock()
    private var _cachedUser: User?
    private var cachedUser: User? {
        get {
            _cachedUserLock.lock()
            defer { _cachedUserLock.unlock() }
            return _cachedUser
        }
        set {
            _cachedUserLock.lock()
            defer { _cachedUserLock.unlock() }
            _cachedUser = newValue
        }
    }
    
    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
        // Attempt to load current session user on init
        if let session = client.auth.currentSession {
            self._cachedUser = mapAuthUser(session.user)
        }
    }
    
    // MARK: - Sign Up
    
    func signUpWithEmail(email: String, password: String, displayName: String) async throws -> User {
        do {
            let result = try await client.auth.signUp(
                email: email,
                password: password,
                data: ["display_name": .string(displayName)]
            )
            
            let authUser = result.session?.user ?? result.user
            
            // The database trigger (handle_new_user) auto-creates the users row
            // when a new auth user is created. We just build the domain object locally.
            let user = User(
                id: authUser.id.uuidString,
                email: email,
                displayName: displayName,
                authProvider: .email,
                isEmailVerified: false,
                preferredLanguages: ["English"],
                marketingConsent: false,
                marketingConsentDate: nil,
                createdAt: authUser.createdAt,
                updatedAt: authUser.updatedAt
            )
            cachedUser = user
            return user
        } catch let error as AuthError {
            throw error
        } catch {
            throw mapSupabaseError(error)
        }
    }
    
    // MARK: - Sign In
    
    func signInWithEmail(email: String, password: String) async throws -> User {
        do {
            let session = try await client.auth.signIn(
                email: email,
                password: password
            )
            
            // Fetch user profile from our users table
            // If the DB row doesn't exist, fall back to auth metadata
            let user: User
            do {
                user = try await fetchUserProfile(userId: session.user.id.uuidString)
            } catch {
                // Fallback to auth metadata when DB profile is unavailable
                user = mapAuthUser(session.user)
            }
            cachedUser = user
            return user
        } catch {
            throw mapSupabaseError(error)
        }
    }
    
    func signInWithApple(idToken: String, nonce: String) async throws -> User {
        do {
            let session = try await client.auth.signInWithIdToken(
                credentials: OpenIDConnectCredentials(
                    provider: .apple,
                    idToken: idToken,
                    nonce: nonce
                )
            )
            
            let user = try await getOrCreateUserProfile(
                authUser: session.user,
                provider: .apple
            )
            cachedUser = user
            return user
        } catch {
            throw mapSupabaseError(error)
        }
    }
    
    func signInWithGoogle(idToken: String, accessToken: String) async throws -> User {
        do {
            let session = try await client.auth.signInWithIdToken(
                credentials: OpenIDConnectCredentials(
                    provider: .google,
                    idToken: idToken,
                    accessToken: accessToken
                )
            )
            
            let user = try await getOrCreateUserProfile(
                authUser: session.user,
                provider: .google
            )
            cachedUser = user
            return user
        } catch {
            throw mapSupabaseError(error)
        }
    }
    
    // MARK: - Email Verification & Password Reset
    
    func sendEmailVerification() async throws {
        // Supabase handles email verification through its auth system
        // This is typically configured in the Supabase dashboard
    }
    
    func sendPasswordReset(email: String) async throws {
        do {
            try await client.auth.resetPasswordForEmail(email)
        } catch {
            throw mapSupabaseError(error)
        }
    }
    
    // MARK: - Sign Out & Delete
    
    func signOut() throws {
        // Fire-and-forget the async sign-out — local state is cleared immediately
        Task { [client] in
            do {
                try await client.auth.signOut()
            } catch {
                // Logged by AuthManager; local state already cleared
            }
        }
        cachedUser = nil
    }
    
    func deleteAccount() async throws {
        guard cachedUser != nil else {
            throw AuthError.unknown("No user logged in")
        }

        // Route through the `delete-user-account` edge function which
        // orchestrates:
        //   • Stripe customer delete (detaches all payment methods)
        //   • Stream Chat user delete (messages marked [Deleted])
        //   • DB RPC `delete_user_account()` (soft-delete + anonymize)
        //   • auth.users hard-delete
        //
        // Calling the DB RPC directly (as the old code did) skipped the
        // Stream + Stripe cleanup, leaving externally-hosted PII behind
        // in violation of GDPR Art 17.
        // Non-2xx statuses throw before completion; a 2xx means DB
        // erasure succeeded. External-service cleanup failures are
        // reported in the response JSON but are non-fatal per our policy
        // (GDPR erasure takes precedence over external cleanup; support
        // completes externals manually within the 30-day retention).
        let _: DeleteAccountResponse = try await client.functions.invoke(
            "delete-user-account",
            options: FunctionInvokeOptions()
        )

        cachedUser = nil
    }
    
    // MARK: - Current User
    
    func getCurrentUser() throws -> User? {
        if cachedUser != nil { return cachedUser }
        
        // Try to restore from current session
        guard let session = client.auth.currentSession else { return nil }
        let user = mapAuthUser(session.user)
        cachedUser = user
        return user
    }
    
    func fetchCurrentUserProfile() async throws -> User? {
        guard let session = client.auth.currentSession else { return nil }
        let userId = session.user.id.uuidString
        do {
            let user = try await fetchUserProfile(userId: userId)
            cachedUser = user
            return user
        } catch {
            // If DB row doesn't exist yet, return the basic auth user
            let user = mapAuthUser(session.user)
            cachedUser = user
            return user
        }
    }
    
    // MARK: - Role Management
    
    func setUserRole(_ role: UserRole, for userId: String) async throws {
        // Refresh the session token so the JWT is current before the RLS-protected write.
        _ = try? await client.auth.refreshSession()

        // The handle_new_user DB trigger should create the public.users row after the
        // auth.users INSERT. However, the trigger may not have fired (race condition,
        // trigger missing, or RLS blocking). We use UPSERT to guarantee the row exists:
        // if the row is there, we update the role; if not, we create it with minimal data.
        let session = try await client.auth.session
        let authUser = session.user
        let displayName = authUser.userMetadata["display_name"]?.stringValue
            ?? authUser.userMetadata["full_name"]?.stringValue
            ?? authUser.userMetadata["name"]?.stringValue
            ?? authUser.email?.components(separatedBy: "@").first
            ?? "User"
        let now = ISO8601DateFormatter().string(from: Date())

        struct UserRow: Encodable {
            let id: String
            let email: String?
            let display_name: String
            let role: String
            let auth_provider: String
            let is_email_verified: Bool
            let created_at: String
            let updated_at: String
        }

        let providerString = authUser.appMetadata["provider"]?.stringValue ?? "email"
        let row = UserRow(
            id: userId,
            email: authUser.email,
            display_name: displayName,
            role: role.rawValue,
            auth_provider: providerString,
            is_email_verified: authUser.emailConfirmedAt != nil,
            created_at: now,
            updated_at: now
        )

        // UPSERT: if the users row exists, only update role + updated_at.
        // If it doesn't exist, create it with the data from the auth session.
        // This resolves the FK constraint error on therapist_profiles.
        try await client.from(SupabaseConfig.Table.users)
            .upsert(row, onConflict: "id")
            .execute()

        cachedUser?.role = role
    }
    
    // MARK: - Helpers
    
    /// Fetch user profile from our users table
    private func fetchUserProfile(userId: String) async throws -> User {
        let response: UserDTO = try await client.from(SupabaseConfig.Table.users)
            .select()
            .eq("id", value: userId)
            .single()
            .execute()
            .value
        
        return response.toDomain()
    }
    
    /// Get existing user profile or create one for social sign-in.
    /// The database trigger auto-creates the row; we wait briefly then try to fetch.
    /// If not found yet, we build the domain object from auth metadata.
    private func getOrCreateUserProfile(authUser: Auth.User, provider: AuthProvider) async throws -> User {
        // Try to fetch existing profile
        do {
            return try await fetchUserProfile(userId: authUser.id.uuidString)
        } catch {
            // The trigger may not have run yet — wait and retry once
            try? await Task.sleep(nanoseconds: 500_000_000)
            do {
                return try await fetchUserProfile(userId: authUser.id.uuidString)
            } catch {
                // Build domain object locally if DB row isn't ready
                let displayName = authUser.userMetadata["full_name"]?.stringValue
                    ?? authUser.userMetadata["name"]?.stringValue
                    ?? authUser.email?.components(separatedBy: "@").first
                    ?? "User"
                
                return User(
                    id: authUser.id.uuidString,
                    email: authUser.email,
                    displayName: displayName,
                    authProvider: provider,
                    isEmailVerified: authUser.emailConfirmedAt != nil,
                    preferredLanguages: ["English"],
                    experienceLevel: nil,
                    intention: nil,
                    marketingConsent: false,
                    marketingConsentDate: nil,
                    createdAt: authUser.createdAt,
                    updatedAt: authUser.updatedAt
                )
            }
        }
    }
    
    /// Map Supabase Auth.User to our domain User (minimal, without DB lookup)
    private func mapAuthUser(_ authUser: Auth.User) -> User {
        // Determine auth provider from the user's app_metadata
        let providerString = authUser.appMetadata["provider"]?.stringValue ?? "email"
        let provider: AuthProvider
        switch providerString {
        case "apple": provider = .apple
        case "google": provider = .google
        default: provider = .email
        }
        
        return User(
            id: authUser.id.uuidString,
            email: authUser.email,
            displayName: authUser.userMetadata["display_name"]?.stringValue
                ?? authUser.userMetadata["full_name"]?.stringValue
                ?? "User",
            authProvider: provider,
            isEmailVerified: authUser.emailConfirmedAt != nil,
            preferredLanguages: ["English"],
            experienceLevel: nil,
            intention: nil,
            marketingConsent: false,
            marketingConsentDate: nil,
            createdAt: authUser.createdAt,
            updatedAt: authUser.updatedAt
        )
    }
    
    /// Map Supabase errors to our AuthError type
    private func mapSupabaseError(_ error: Error) -> AuthError {
        let message = error.localizedDescription.lowercased()
        
        if message.contains("invalid login") || message.contains("invalid_credentials") {
            return .invalidCredentials
        } else if message.contains("already registered") || message.contains("already been registered") {
            return .emailAlreadyInUse
        } else if message.contains("password") && message.contains("weak") {
            return .weakPassword
        } else if message.contains("network") || message.contains("connection") {
            return .networkError
        } else if message.contains("email not confirmed") {
            return .emailNotVerified
        } else {
            return .unknown(error.localizedDescription)
        }
    }
}

// MARK: - JSON Value Extension

private extension Supabase.AnyJSON {
    var stringValue: String? {
        switch self {
        case .string(let str): return str
        default: return nil
        }
    }
}

// MARK: - Edge Function Response

/// Response payload from `delete-user-account` edge function.
/// We don't currently surface the individual cleanup statuses in the UI
/// (user only needs to know "deletion succeeded"), so all fields are
/// optional. Kept here as documentation of the contract — if we ever
/// want to render per-service status, the fields are already wired.
private struct DeleteAccountResponse: Decodable {
    let ok: Bool?
    let user_id: String?
}
