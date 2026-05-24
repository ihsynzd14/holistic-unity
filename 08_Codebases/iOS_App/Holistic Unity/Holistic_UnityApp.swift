import SwiftUI
import Supabase
import StreamChat
import StreamChatSwiftUI
import StripePaymentSheet
import Sentry
// Deep-link handling (including Google Sign-In URLs) is delegated to
// DeepLinkRouter; no direct GoogleSignIn import needed here.

extension Notification.Name {
    static let stripeConnectReturn = Notification.Name("stripeConnectReturn")
}

@main
struct Holistic_UnityApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var appState: AppState
    @State private var authManager: AuthManager
    @State private var biometricLock = BiometricLock.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Sentry must initialize FIRST so it captures any crashes during the
        // rest of init (URLCache sizing, Stream Chat bootstrap, Stripe, the
        // jailbreak detector, analytics). DSN loaded from Secrets.xcconfig
        // via Info.plist.
        //
        // The task spec asks for SentrySDK.start() as the first statement of
        // `applicationDidFinishLaunchingWithOptions` (the UIKit hook). In a
        // SwiftUI app with @UIApplicationDelegateAdaptor, `App.init()` runs
        // BEFORE the AppDelegate's didFinishLaunching, so initializing here
        // is strictly earlier and catches more pre-UI crashes.
        if let sentryDSN = Bundle.main.infoDictionary?["SENTRY_DSN"] as? String, !sentryDSN.isEmpty {
            SentrySDK.start { options in
                options.dsn = sentryDSN
                // 10% APM sampling — matches the three webapp configs which
                // document the same conservative starting point ("don't blow
                // past Sentry plan quota on launch"). Raise post-launch once
                // we see steady-state volume.
                options.tracesSampleRate = 0.1
                // 10% of sampled transactions get CPU profiling. Tiny extra
                // cost, big win when chasing main-thread stalls.
                options.profilesSampleRate = 0.1
                options.enableAutoSessionTracking = true
                // enableAutoPerformanceTracing defaults to true in
                // sentry-cocoa 9.x, so we leave it implicit.
                //
                // ATTACHMENTS — intentionally OFF for pre-launch.
                // Holistic handles GDPR Article 9 data (mental-health
                // disclosures, therapist chat, symptoms, payment forms).
                // A crash screenshot is a literal photo of whatever screen
                // the user is on; view-hierarchy serialization captures
                // SwiftUI accessibility labels which routinely embed user
                // text. Stack traces + breadcrumbs cover the vast majority
                // of iOS crash triage without the PII surface. Revisit
                // post-launch once we have a DPIA on what richer
                // attachments would actually add.
                options.attachScreenshot = false
                options.attachViewHierarchy = false
            }
        }

        // Wipe any cached HTTP responses left over from earlier launches.
        //
        // ─────────────────────────────────────────────────────
        // URLCache strategy (refined 2026-05-18 after perf audit)
        //
        // The PROBLEM the blanket wipe was solving: Supabase REST
        // 403s being heuristically disk-cached and surviving force
        // quits, causing persistent "Couldn't load…" banners.
        //
        // The COST of the blanket wipe: every `AsyncImage` photo
        // (therapist avatars, painted illustrations, gallery shots)
        // also got blown away on every cold launch — forcing the
        // user to re-download multi-MB images every time they
        // open the app. With 100x more therapists this becomes a
        // bandwidth + latency disaster.
        //
        // The FIX: the underlying Supabase REST session uses its
        // own `URLSession` with `urlCache = nil` (see
        // SupabaseConfig.swift) — so REST responses never touch the
        // shared cache to begin with. The blanket wipe was solving
        // a problem that no longer exists. We instead size the
        // shared cache for IMAGE responses only (which use
        // URLSession.shared via AsyncImage), which is exactly what
        // a marketplace needs.
        URLCache.shared = URLCache(
            memoryCapacity:  16 * 1024 * 1024,   // 16 MB RAM
            diskCapacity:   200 * 1024 * 1024,   // 200 MB disk
            diskPath: "holistic-unity-images"
        )
        
        let container = DIContainer.shared
        _appState = State(initialValue: container.appState)
        _authManager = State(initialValue: container.authManager)
        
        // Initialize Stream Chat (creates ChatClient + appearance context)
        _ = StreamChatService.shared

        // Initialize Stripe
        StripeAPI.defaultPublishableKey = StripeConfig.publishableKey

        // Jailbreak / runtime-tampering detection — soft-fail, flags to
        // Sentry + sets a flag sensitive flows can consult. No-op until
        // the IOSSecuritySuite SPM package is linked; see
        // JailbreakDetector.swift for activation steps.
        Task { @MainActor in
            JailbreakDetector.shared.runInitialCheck()
        }

        // Product analytics — TelemetryDeck (privacy-first, EU-hosted,
        // no IDFA, no ATT prompt). No-op until:
        //   1. `TelemetryDeck` SPM package added (see
        //      TelemetryDeckAnalyticsService.swift for instructions)
        //   2. `TELEMETRY_DECK_APP_ID` set in Secrets.xcconfig
        // Wire here rather than in DIContainer so it fires before the
        // first screen renders and we don't miss the initial app_opened
        // signal that feeds retention cohorts.
        DIContainer.shared.analytics.initialize()
    }
    
    var body: some Scene {
        WindowGroup {
            ZStack {
                AppCoordinator(authManager: authManager, appState: appState)
                    .environment(authManager)
                    .environment(appState)

                // Biometric lock overlay — shown only if the user enabled
                // Face ID / Touch ID gating in Settings. Blocks all content
                // and prompts the system biometric dialog.
                if biometricLock.isLocked {
                    BiometricLockView()
                        .transition(.opacity)
                        .zIndex(999)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: biometricLock.isLocked)
            .task {
                biometricLock.applyInitialLock()
            }
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .active:
                    biometricLock.handleForeground()
                case .background, .inactive:
                    break
                @unknown default:
                    break
                }
            }
            .environment(authManager)
            .environment(appState)
            .onOpenURL { url in
                // All inbound URLs flow through the strict allowlist in
                // DeepLinkRouter. Unknown scheme/host combinations are
                // rejected + logged to Sentry; the silent fallthrough that
                // previously accepted any `holisticunity://` URL has been
                // removed (see DeepLinkRouter.swift for rationale).
                DeepLinkRouter.handle(url)
            }
        }
    }
}
