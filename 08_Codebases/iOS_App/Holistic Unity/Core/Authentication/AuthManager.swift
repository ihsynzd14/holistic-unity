import Foundation
import Observation
import OSLog
import Supabase
import Sentry

/// Manages all authentication flows. Uses protocol-based repository for actual backend calls,
/// making it testable and backend-agnostic.
@MainActor
@Observable
final class AuthManager {
    var currentUser: User?
    var authState: AuthState = .loading
    var isAuthenticated: Bool = false
    
    enum AuthState: Equatable {
        case loading
        case unauthenticated
        /// Email/password user signed up but has not yet clicked the
        /// Supabase confirmation link. Apple/Google OAuth users skip
        /// this state because their identity provider already confirms
        /// the email at sign-in. App Store Review section 5.1.1(i)
        /// effectively requires this gate for apps that store health
        /// data tied to an unverified email — a stranger could create
        /// an account with someone else's address and book sessions
        /// in their name.
        case needsEmailVerification
        case authenticated
        case needsRole // authenticated but no role selected
        case needsOnboarding(UserRole) // role selected but onboarding not complete
        /// User is fully onboarded but the latest accepted TOS version
        /// is older than `TOSService.currentVersion(for:)` — typically
        /// because we bumped the constants after publishing a contract
        /// update. Mirrors the web middleware that redirects to
        /// `/accept-terms` for the same reason. Re-acceptance is the
        /// legal mechanism that keeps onerous clauses (vessatorie ex
        /// art. 1341 c.c.) enforceable when we modify the contract.
        case needsTOSAcceptance(UserRole)
    }
    
    private static let logger = Logger(subsystem: AppConstants.appBundleId, category: "AuthManager")
    
    private let authRepository: AuthRepositoryProtocol
    private let keychain = KeychainService.shared
    @ObservationIgnored
    private var authStateTask: Task<Void, Never>?
    private var hasRestoredSession = false

    init(authRepository: AuthRepositoryProtocol) {
        self.authRepository = authRepository
        checkExistingSession()
        observeAuthStateChanges()
    }
    
    deinit {
        // Task.cancel() is safe to call from any thread
        authStateTask?.cancel()
    }
    
    // MARK: - Session Check
    
    func checkExistingSession() {
        // Set flag immediately to prevent re-entrant calls from the authStateChanges observer
        // racing with this initial call before any async work starts
        guard !hasRestoredSession else { return }
        hasRestoredSession = true
        
        // Quick synchronous check to see if there's a session at all
        guard let basicUser = try? authRepository.getCurrentUser() else {
            self.hasRestoredSession = false // no session found, allow future calls
            self.authState = .unauthenticated
            return
        }
        
        // If cached user already has a role, use it immediately
        if basicUser.role != nil {
            self.currentUser = basicUser
            self.isAuthenticated = true
            resolveAuthState(for: basicUser)
            setSentryUser(basicUser)
            // Connect Stream and register push in the background — don't block auth flow
            Task {
                await connectStreamUser(basicUser)
                await PushNotificationService.shared.onUserAuthenticated(userId: basicUser.id)
                NotificationManager.shared.start(userId: basicUser.id)
            }
            return
        }
        
        // Otherwise, fetch full profile from DB to get the role.
        self.currentUser = basicUser
        self.isAuthenticated = true
        self.authState = .loading
        
        Task {
            do {
                let fetchedUser = try await withThrowingTaskGroup(of: User?.self) { group in
                    group.addTask { [authRepository] in
                        try await authRepository.fetchCurrentUserProfile()
                    }
                    group.addTask {
                        try await Task.sleep(for: .seconds(10))
                        throw CancellationError()
                    }
                    let result = try await group.next() ?? nil
                    group.cancelAll()
                    return result
                }
                
                if let fullUser = fetchedUser {
                    self.currentUser = fullUser
                    resolveAuthState(for: fullUser)
                    self.setSentryUser(fullUser)
                    // Connect Stream and register push in the background
                    Task {
                        await self.connectStreamUser(fullUser)
                        await PushNotificationService.shared.onUserAuthenticated(userId: fullUser.id)
                        NotificationManager.shared.start(userId: fullUser.id)
                    }
                } else {
                    // Profile returned nil — keep basic auth user and assume needsRole
                    Self.logger.info("Session profile fetch returned nil. Using basic user.")
                    resolveAuthState(for: basicUser)
                }
            } catch {
                // Timeout or network error — keep the user authenticated with basic info
                // rather than destroying their session
                Self.logger.warning("Session profile fetch failed: \(error.localizedDescription). Keeping basic session.")
                resolveAuthState(for: basicUser)
            }
        }
    }
    
    // MARK: - Auth State Observation
    
    /// Listen for Supabase auth state changes (token refresh, sign-out from another device, etc.)
    private func observeAuthStateChanges() {
        authStateTask = Task { [weak self] in
            for await (event, session) in SupabaseConfig.client.auth.authStateChanges {
                guard let self, !Task.isCancelled else { return }
                await MainActor.run {
                    switch event {
                    case .initialSession:
                        // The SDK emits this once on startup. If the session is nil
                        // and we're still loading, it means there's no valid session.
                        if session == nil, self.authState == .loading {
                            self.currentUser = nil
                            self.isAuthenticated = false
                            self.authState = .unauthenticated
                        }
                    case .signedIn:
                        // Guard against re-entrant signedIn events racing with direct sign-in handlers
                        guard self.authState == .loading || self.authState == .unauthenticated else { break }
                        self.checkExistingSession()
                    case .signedOut:
                        self.currentUser = nil
                        self.isAuthenticated = false
                        self.authState = .unauthenticated
                        self.keychain.deleteAll()
                    case .tokenRefreshed:
                        break // Session auto-refreshed, no action needed
                    default:
                        break
                    }
                }
            }
        }
    }
    
    // MARK: - Email Auth
    
    func signUp(email: String, password: String, displayName: String) async throws {
        let user = try await authRepository.signUpWithEmail(email: email, password: password, displayName: displayName)
        persistUserId(user.id)
        self.currentUser = user
        self.isAuthenticated = true
        setSentryUser(user)

        // Check whether Supabase returned a session. When email
        // confirmation is ON in the Supabase project (which it is in
        // production for App Store compliance), `signUp` returns
        // `user` but NO session — the user must verify their email
        // first before any session is granted.
        //
        // Without a session, ANY RLS-protected DB write throws
        // "Auth session missing" (this used to crash AuthManager
        // .signUp at `setUserRole`, which calls `client.auth.session`
        // and surfaces that error verbatim to the user). The fix:
        // gate post-signup DB writes + Stream connect on session
        // presence, and transition to `.needsEmailVerification` when
        // no session exists. The user role + Stream user are wired
        // up later, after `recheckEmailVerification` confirms the
        // verification link was clicked and a session is in place.
        let hasSession: Bool
        do {
            _ = try await SupabaseConfig.client.auth.session
            hasSession = true
        } catch {
            hasSession = false
        }

        if hasSession {
            // Email confirmation OFF, or already verified — finish
            // the post-signup wiring immediately.
            try await authRepository.setUserRole(.client, for: user.id)
            currentUser?.role = .client
            self.authState = .needsOnboarding(.client)
            await connectStreamUser(user)
        } else {
            // Email confirmation required — defer role assignment +
            // Stream connect until the user verifies their email.
            // EmailVerificationView calls `recheckEmailVerification`
            // when the user reports clicking the link.
            self.authState = .needsEmailVerification
        }

        await PushNotificationService.shared.onUserAuthenticated(userId: user.id)
        NotificationManager.shared.start(userId: user.id)
    }
    
    func signIn(email: String, password: String) async throws {
        let user = try await authRepository.signInWithEmail(email: email, password: password)
        persistUserId(user.id)
        self.currentUser = user
        self.isAuthenticated = true
        resolveAuthState(for: user)
        setSentryUser(user)
        await connectStreamUser(user)
        await PushNotificationService.shared.onUserAuthenticated(userId: user.id)
        NotificationManager.shared.start(userId: user.id)
    }
    
    // MARK: - Social Auth
    
    func signInWithApple(idToken: String, nonce: String) async throws {
        let user = try await authRepository.signInWithApple(idToken: idToken, nonce: nonce)
        persistUserId(user.id)
        self.currentUser = user
        self.isAuthenticated = true
        resolveAuthState(for: user)
        setSentryUser(user)
        await connectStreamUser(user)
        await PushNotificationService.shared.onUserAuthenticated(userId: user.id)
        NotificationManager.shared.start(userId: user.id)
    }
    
    func signInWithGoogle(idToken: String, accessToken: String) async throws {
        let user = try await authRepository.signInWithGoogle(idToken: idToken, accessToken: accessToken)
        persistUserId(user.id)
        self.currentUser = user
        self.isAuthenticated = true
        resolveAuthState(for: user)
        setSentryUser(user)
        await connectStreamUser(user)
        await PushNotificationService.shared.onUserAuthenticated(userId: user.id)
        NotificationManager.shared.start(userId: user.id)
    }
    
    // MARK: - Role Selection
    
    func selectRole(_ role: UserRole) async throws {
        guard let userId = currentUser?.id else { return }
        // Propagate the error to the caller so the UI can show feedback.
        // Do NOT silently swallow — if this fails the user's role is never saved to DB
        // and they will be stuck in needsRole on every cold launch.
        try await authRepository.setUserRole(role, for: userId)
        currentUser?.role = role
        authState = .needsOnboarding(role)
    }
    
    func completeOnboarding() {
        authState = .authenticated
        guard let user = currentUser, let role = user.role else { return }
        Task {
            await checkTOSAndDowngradeIfNeeded(userId: user.id, role: role)
        }
    }
    
    // MARK: - Sign Out
    
    func signOut() async {
        NotificationManager.shared.stop()
        await PushNotificationService.shared.onUserSignedOut()
        await StreamChatService.shared.disconnectUser()  // must complete before revoking Supabase session
        do {
            try authRepository.signOut()
        } catch {
            Self.logger.error("Sign-out backend call failed: \(error.localizedDescription). Clearing local state anyway.")
        }
        keychain.deleteAll()
        SentrySDK.setUser(nil)

        // SECURITY (audit 2026-05-18, F5): wipe HTTP cache + per-user
        // UserDefaults before the next user signs in. Previously the
        // app cleared only the Keychain — but `URLCache.shared` still
        // held cached therapist photos, profile responses, and
        // recently-viewed pages from the previous user. On a shared
        // device the next signed-in user could see ghosts of the
        // previous user's browsing. UserDefaults also held search
        // history, last-viewed therapist, and onboarding skeleton
        // state under `hu_*` keys.
        URLCache.shared.removeAllCachedResponses()
        UserDefaultsManager.shared.resetAll()

        currentUser = nil
        isAuthenticated = false
        authState = .unauthenticated
        hasRestoredSession = false
    }
    
    // MARK: - Password Reset
    
    func sendPasswordReset(email: String) async throws {
        try await authRepository.sendPasswordReset(email: email)
    }
    
    // MARK: - Helpers
    
    /// Computes the next AuthState for a freshly-loaded user.
    ///
    /// Order of gates (each blocks the next until satisfied):
    ///   1. Email verification — only for `.email` provider users whose
    ///      `email_confirmed_at` is still null. Apple/Google bypass this
    ///      because their tokens already attest a verified address.
    ///   2. Role assignment — `.needsRole` if the DB row has no role yet.
    ///   3. Onboarding — `.needsOnboarding(.client)` if a client hasn't
    ///      completed the onboarding flow (checked async via
    ///      `hasCompletedClientOnboarding`, fails open on network error).
    ///      Therapists are exempt: they onboard via the web portal, and
    ///      the iOS app's redirect-out logic lives in `AppCoordinator`.
    ///   4. TOS acceptance — checked async via `TOSService` because the
    ///      lookup hits the network. We optimistically advance to
    ///      `.authenticated` and let the async TOS check downgrade us
    ///      to `.needsTOSAcceptance` once the result lands. This avoids
    ///      blocking the launch screen on a network round-trip while
    ///      still enforcing the gate before the user can interact with
    ///      anything sensitive (the modal is presented globally).
    private func resolveAuthState(for user: User) {
        // Gate 1: email verification (sync — flag is on the user row).
        if user.authProvider == .email && !user.isEmailVerified {
            authState = .needsEmailVerification
            return
        }
        // Gate 2.
        guard let role = user.role else {
            authState = .needsRole
            return
        }

        // Optimistic .authenticated; Gate 3 (onboarding) and Gate 4
        // (TOS) may downgrade asynchronously. Setting .authenticated
        // first means the splash dismisses quickly; the gates then
        // route to the right modal/flow within a few hundred ms.
        authState = .authenticated

        Task { [weak self] in
            guard let self else { return }

            // Gate 3 — Client onboarding (added 2026-05-18 to fix the
            // critical regression where sign-IN users who had never
            // completed onboarding silently landed on Home with an
            // empty `client_preferences` row, breaking matchmaking,
            // stats, and the intention card on Account).
            //
            // Therapists are exempt — they onboard via the web portal
            // and the iOS app redirects them out.
            if role == .client {
                let done = await self.hasCompletedClientOnboarding(userId: user.id)
                if !done {
                    await MainActor.run {
                        // Only downgrade if we're still in .authenticated
                        // (the user might have signed out meanwhile).
                        if case .authenticated = self.authState {
                            self.authState = .needsOnboarding(.client)
                        }
                    }
                    return  // Skip TOS check — runs again after onboarding completes.
                }
            }

            // Gate 4 — TOS acceptance.
            await self.checkTOSAndDowngradeIfNeeded(userId: user.id, role: role)
        }
    }

    /// Returns true when the user has at least one `client_preferences`
    /// row with `completed_at != null`. Fails open: on any error
    /// (network, RLS, missing table) we assume the user has completed
    /// onboarding so the gate doesn't lock everyone out during an
    /// outage.
    private func hasCompletedClientOnboarding(userId: String) async -> Bool {
        struct Row: Decodable { let completed_at: String? }
        do {
            let rows: [Row] = try await SupabaseConfig.client
                .from("client_preferences")
                .select("completed_at")
                .eq("user_id", value: userId)
                .limit(1)
                .execute()
                .value
            return rows.first?.completed_at != nil
        } catch {
            Self.logger.warning(
                "hasCompletedClientOnboarding query failed (\(error.localizedDescription)); failing open to .authenticated to avoid lockout."
            )
            return true
        }
    }

    /// Async TOS gate. Runs after `.authenticated` is set so the UI is
    /// responsive immediately. If the user owes acceptance we transition
    /// to `.needsTOSAcceptance(role)`; the AppCoordinator routes to the
    /// modal and blocks every other surface until the user accepts.
    private func checkTOSAndDowngradeIfNeeded(userId: String, role: UserRole) async {
        let needsTOS = await TOSService.shared.needsAcceptance(userId: userId, role: role)
        guard needsTOS else { return }
        await MainActor.run {
            // Only downgrade if we're still in `.authenticated` — if the
            // user signed out in the meantime, leave the unauthenticated
            // state intact.
            if case .authenticated = self.authState {
                self.authState = .needsTOSAcceptance(role)
            }
        }
    }

    /// Called by `AcceptTermsView` after the user submits acceptance.
    /// Re-runs the gate check and advances to `.authenticated` if all
    /// conditions are satisfied.
    func tosAccepted() {
        guard let user = currentUser else { return }
        resolveAuthState(for: user)
    }

    /// Called by `EmailVerificationView` after the user reports having
    /// clicked the confirmation link. Refetches the user row so
    /// `isEmailVerified` reflects the latest server state, then
    /// re-resolves.
    func recheckEmailVerification() async {
        do {
            if let refreshed = try await authRepository.fetchCurrentUserProfile() {
                self.currentUser = refreshed
                resolveAuthState(for: refreshed)
            }
        } catch {
            Self.logger.warning("recheckEmailVerification refetch failed: \(error.localizedDescription)")
        }
    }

    /// Triggers Supabase to re-send the confirmation email for the
    /// signed-in user. Throws on transport / rate-limit errors so the
    /// UI can show a toast. Reuses the existing repository hook.
    func resendVerificationEmail() async throws {
        guard let email = currentUser?.email, !email.isEmpty else {
            throw NSError(
                domain: "AuthManager",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: String(
                    localized: "We couldn't find your email address. Please sign out and create your account again.",
                    comment: "Resend verification failed: no email on the current user"
                )]
            )
        }
        try await authRepository.sendEmailVerification(email: email)
    }
    
    private func persistUserId(_ userId: String) {
        do {
            try keychain.save(userId, for: .userId)
        } catch {
            Self.logger.error("Failed to save user ID to keychain: \(error.localizedDescription)")
        }
    }
    
    private func connectStreamUser(_ user: User) async {
        await StreamChatService.shared.connectUser(
            userId: user.id,
            name: user.displayName,
            imageURL: user.photoURL
        )
    }
    
    private func setSentryUser(_ user: User) {
        // H4: Only set opaque userId — do NOT send email or name to Sentry to protect PII
        let sentryUser = Sentry.User(userId: user.id)
        SentrySDK.setUser(sentryUser)
    }
}
