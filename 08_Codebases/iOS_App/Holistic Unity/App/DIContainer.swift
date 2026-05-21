import Foundation

/// Dependency injection container using protocol-based design.
/// All repositories now use Supabase implementations.
@MainActor
final class DIContainer {
    
    // MARK: - Repositories
    
    let authRepository: AuthRepositoryProtocol
    let therapistRepository: TherapistRepositoryProtocol
    let bookingRepository: BookingRepositoryProtocol
    let chatRepository: ChatRepositoryProtocol
    let reviewRepository: ReviewRepositoryProtocol
    let paymentRepository: PaymentRepositoryProtocol
    let sessionCreditRepository: SessionCreditRepositoryProtocol
    
    // MARK: - Services

    let storageService: SupabaseStorageService
    let videoCallService: VideoCallService
    let analytics: AnalyticsService

    // MARK: - Managers

    let authManager: AuthManager
    let appState: AppState

    // MARK: - Singleton

    static let shared = DIContainer()

    private init() {
        // Initialize Supabase repositories
        let authRepo = SupabaseAuthRepository()
        self.authRepository = authRepo
        self.therapistRepository = SupabaseTherapistRepository()
        self.bookingRepository = SupabaseBookingRepository()
        self.chatRepository = StreamChatRepository()
        self.reviewRepository = SupabaseReviewRepository()
        self.paymentRepository = SupabasePaymentRepository()
        self.sessionCreditRepository = SupabaseSessionCreditRepository()
        self.storageService = SupabaseStorageService.shared
        self.videoCallService = VideoCallService.shared

        // Analytics: TelemetryDeck-backed in production, no-op until both
        // the SPM package is linked AND `TELEMETRY_DECK_APP_ID` is set in
        // Info.plist (via Secrets.xcconfig). Initialize() is called from
        // Holistic_UnityApp.init so the first session event fires before
        // the first screen renders.
        self.analytics = TelemetryDeckAnalyticsService()

        // Initialize managers — AuthManager no longer needs therapistRepository
        let auth = AuthManager(authRepository: authRepo)
        self.authManager = auth
        self.appState = AppState(authManager: auth)
    }
}
