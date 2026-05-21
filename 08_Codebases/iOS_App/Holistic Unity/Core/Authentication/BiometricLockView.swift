import SwiftUI

/// Full-screen overlay shown while the biometric lock is active.
/// Content is blurred/blacked so nothing sensitive is visible behind it
/// (prevents shoulder-surfing and screenshot exposure).
struct BiometricLockView: View {
    @State private var lock = BiometricLock.shared
    @State private var isAuthenticating = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            // Opaque background — blocks everything underneath.
            HUColor.background
                .ignoresSafeArea()

            VStack(spacing: HUSpacing.xl) {
                Image("AppLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 88, height: 88)
                    .clipShape(RoundedRectangle(cornerRadius: 22))
                    .shadow(color: HUColor.cardShadow, radius: 8, y: 4)

                VStack(spacing: HUSpacing.sm) {
                    Text("Holistic Unity")
                        .font(HUFont.displayTitle(size: 28, weight: .bold))
                        .foregroundStyle(HUColor.textPrimary)

                    Text(String(localized: "Locked for your privacy",
                                comment: "Biometric lock screen headline"))
                        .font(HUFont.subheadline())
                        .foregroundStyle(HUColor.textSecondary)
                }

                if let msg = errorMessage {
                    Text(msg)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.error)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, HUSpacing.xl)
                }

                Button {
                    Task { await attemptAuth() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "lock.open.fill")
                            .font(.system(size: 16, weight: .semibold))
                        Text(String(
                            localized: "Unlock with \(lock.biometricTypeLabel)",
                            comment: "Biometric unlock CTA (variable: Face ID / Touch ID)"
                        ))
                        .font(HUFont.body(weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(HUColor.primary)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                }
                .padding(.horizontal, HUSpacing.xl)
                .disabled(isAuthenticating)
                .opacity(isAuthenticating ? 0.5 : 1.0)
            }
        }
        .task {
            // Prompt immediately on appear.
            await attemptAuth()
        }
    }

    private func attemptAuth() async {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        errorMessage = nil
        let result = await lock.authenticate()
        isAuthenticating = false
        if case .failure(let err) = result {
            errorMessage = err.localizedDescription
        }
        // On success, `BiometricLock.markUnlocked()` flips `isLocked=false`
        // and AppCoordinator hides this view automatically.
    }
}
