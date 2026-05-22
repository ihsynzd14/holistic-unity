import SwiftUI

/// Root navigation coordinator that determines which screen to show
/// based on the current authentication state.
struct AppCoordinator: View {
    @Bindable var authManager: AuthManager
    @Bindable var appState: AppState
    
    var body: some View {
        ZStack(alignment: .top) {
            Group {
                switch authManager.authState {
                case .loading:
                    LaunchLoadingView()

                case .unauthenticated:
                    WelcomeView()

                case .needsEmailVerification:
                    // Hard gate for email/password sign-ups: the app
                    // stores health-related session data tied to the
                    // address, so an unverified email is treated as a
                    // potential impersonation. App Store 5.1.1(i)
                    // expects this for apps in our category. Apple /
                    // Google sign-ins skip this state because their
                    // tokens already attest a verified address.
                    EmailVerificationView()

                case .needsRole:
                    // Auto-assign client role — therapists use the web portal.
                    // The error MUST surface: if selectRole silently fails the user
                    // is stuck in .needsRole forever on every cold launch (see the
                    // explicit warning in AuthManager.selectRole). Surface to the
                    // toast so the user can retry by backgrounding/foregrounding,
                    // which re-fires this .task closure.
                    LaunchLoadingView()
                        .task {
                            do {
                                try await authManager.selectRole(.client)
                            } catch {
                                appState.showToast(.error, message: "Configurazione account fallita. Controlla la connessione e riapri l'app.")
                            }
                        }

                case .needsOnboarding(let role):
                    switch role {
                    case .therapist:
                        TherapistWebAppRedirectView()
                    case .client:
                        ClientOnboardingFlow()
                    }

                case .needsTOSAcceptance(let role):
                    // Block until the user accepts the current TOS
                    // version. Mirrors the web `/accept-terms`
                    // middleware. Re-acceptance is the legal mechanism
                    // that keeps onerous (vessatorie ex art. 1341 c.c.)
                    // clauses enforceable when the contract changes.
                    AcceptTermsView(role: role)

                case .authenticated:
                    if authManager.currentUser?.role == .therapist {
                        TherapistWebAppRedirectView()
                    } else if authManager.currentUser?.role == .client {
                        ClientTabView()
                    } else {
                        // Auto-assign client role for users without a role.
                        // Same rationale as the .needsRole case above — silent
                        // failure leaves the user stuck on LaunchLoadingView.
                        LaunchLoadingView()
                            .task {
                                do {
                                    try await authManager.selectRole(.client)
                                } catch {
                                    appState.showToast(.error, message: "Configurazione account fallita. Controlla la connessione e riapri l'app.")
                                }
                            }
                    }
                }
            }
            .animation(HUAnimation.standard, value: authManager.authState)
            
            // Offline banner
            if appState.isOffline {
                OfflineBanner()
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(HUAnimation.standard, value: appState.isOffline)
        .toast($appState.toast, onDismiss: { appState.onToastDismissed() })
        .preferredColorScheme(appState.colorSchemeOverride)
        .onChange(of: appState.networkMonitor.isConnected) { _, connected in
            appState.isOffline = !connected
        }
    }
}

// MARK: - Launch Loading View

struct LaunchLoadingView: View {
    @State private var pulseScale: CGFloat = 1.0
    
    var body: some View {
        VStack(spacing: HUSpacing.xl) {
            Image("AppLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .shadow(color: HUColor.cardShadow, radius: 8, y: 4)
                .scaleEffect(pulseScale)
            
            VStack(spacing: HUSpacing.sm) {
                Text(AppConstants.appName)
                    .font(HUFont.title())
                    .foregroundStyle(HUColor.textPrimary)
                
                ProgressView()
                    .tint(HUColor.primary)
                    .accessibilityLabel("Loading")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HUColor.background)
        .task {
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                pulseScale = 1.05
            }
        }
    }
}
