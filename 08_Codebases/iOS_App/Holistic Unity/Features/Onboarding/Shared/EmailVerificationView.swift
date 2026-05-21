import SwiftUI

/// Full-screen blocker shown when an email/password user has not yet
/// confirmed their address via the Supabase magic link.
///
/// Presented by `AppCoordinator` when `authState == .needsEmailVerification`.
/// Apple/Google OAuth sign-ins skip this state because their tokens
/// already attest a verified address.
///
/// Why a hard block (no skip):
///   - The app stores health-related session data tied to the email.
///     Allowing an unverified address means a stranger could register
///     someone else's email and book sessions in their name.
///   - App Store Review section 5.1.1(i) treats unverified emails as a
///     red flag for apps handling sensitive personal data.
///
/// UX:
///   - Static instructions ("we sent you a link, click it then come back")
///   - "I clicked the link" button → re-fetches profile, advances state
///     if Supabase has marked the email confirmed, shows error toast
///     otherwise
///   - "Resend email" button with 30-second cooldown to avoid abuse
///   - "Sign out" escape hatch (so a user with the wrong email can
///     restart with the right one — no other way out)
struct EmailVerificationView: View {

    @Environment(AuthManager.self) private var authManager

    @State private var isChecking = false
    @State private var isResending = false
    @State private var resendCooldown = 0
    @State private var infoMessage: String?
    @State private var errorMessage: String?
    @State private var showSignOutConfirm = false

    private var email: String {
        authManager.currentUser?.email ?? ""
    }

    private var canResend: Bool {
        !isResending && resendCooldown == 0
    }

    var body: some View {
        VStack(spacing: HUSpacing.xl) {
            Spacer()

            iconBadge

            VStack(spacing: HUSpacing.md) {
                Text("Verifica la tua email")
                    .font(HUFont.displayTitle(size: 26, weight: .bold))
                    .foregroundStyle(HUColor.textPrimary)
                    .multilineTextAlignment(.center)

                if !email.isEmpty {
                    Text("Abbiamo inviato un link di conferma a")
                        .font(HUFont.body(weight: .regular))
                        .foregroundStyle(HUColor.textSecondary)
                        .multilineTextAlignment(.center)

                    Text(email)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .padding(.horizontal, HUSpacing.xl)
                }

                Text("Apri l'email, clicca il link, poi torna qui e tocca \"Ho cliccato il link\".")
                    .font(.system(size: 14))
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HUSpacing.lg)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: HUSpacing.sm) {
                checkButton
                resendButton
            }
            .padding(.horizontal, HUSpacing.xl)

            if let infoMessage {
                Text(infoMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HUSpacing.xl)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(HUColor.error)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HUSpacing.xl)
            }

            Spacer()

            Button("Esci e usa un'altra email") {
                showSignOutConfirm = true
            }
            .font(.system(size: 14))
            .foregroundStyle(HUColor.textSecondary)
        }
        .padding(.vertical, HUSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HUColor.background)
        .interactiveDismissDisabled(true)
        .confirmationDialog(
            "Esci?",
            isPresented: $showSignOutConfirm,
            titleVisibility: .visible
        ) {
            Button("Esci", role: .destructive) {
                Task { await authManager.signOut() }
            }
            Button("Annulla", role: .cancel) { }
        } message: {
            Text("Dovrai accedere o registrarti di nuovo.")
        }
        .task {
            // Re-check on first appear in case the user already verified
            // before opening the app (common: tap link in mail app, then
            // get foregrounded back to HU).
            await silentCheck()
        }
    }

    // MARK: - UI components

    private var iconBadge: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [HUColor.primary.opacity(0.18), HUColor.primary.opacity(0)],
                        center: .center,
                        startRadius: 6,
                        endRadius: 70
                    )
                )
                .frame(width: 130, height: 130)
            Image(systemName: "envelope.badge")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(HUColor.primary)
                .symbolRenderingMode(.hierarchical)
        }
    }

    private var checkButton: some View {
        Button {
            Task { await checkVerification() }
        } label: {
            HStack(spacing: 8) {
                if isChecking {
                    ProgressView().tint(.white)
                }
                Text(isChecking ? "Verifico…" : "Ho cliccato il link")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(PrimaryGradient.linear)
            .clipShape(Capsule())
            .shadow(color: HUColor.primary.opacity(0.28), radius: 8, y: 4)
        }
        .disabled(isChecking)
    }

    private var resendButton: some View {
        Button {
            Task { await resend() }
        } label: {
            HStack(spacing: 6) {
                if isResending {
                    ProgressView().tint(HUColor.primary)
                }
                Text(resendButtonTitle)
                    .font(.system(size: 14, weight: .medium))
            }
            .foregroundStyle(canResend ? HUColor.primary : HUColor.textSecondary.opacity(0.6))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: HURadius.lg)
                    .stroke(canResend ? HUColor.primary.opacity(0.5) : HUColor.divider, lineWidth: 1)
            )
        }
        .disabled(!canResend)
    }

    private var resendButtonTitle: String {
        if isResending { return String(localized: "Invio in corso…", comment: "Resend email in progress") }
        if resendCooldown > 0 { return String(localized: "Reinvia tra \(resendCooldown)s", comment: "Resend cooldown") }
        return String(localized: "Reinvia email di verifica", comment: "Resend verification email")
    }

    // MARK: - Actions

    private func checkVerification() async {
        isChecking = true
        infoMessage = nil
        errorMessage = nil
        defer { isChecking = false }
        await authManager.recheckEmailVerification()
        // If still in this state, surface a hint
        if case .needsEmailVerification = authManager.authState {
            errorMessage = String(localized: "Non risulta ancora confermata. Controlla anche lo spam, o reinvia il link.", comment: "Email still not verified after recheck")
            HUHaptic.notification(.warning)
        }
    }

    private func silentCheck() async {
        await authManager.recheckEmailVerification()
    }

    private func resend() async {
        isResending = true
        infoMessage = nil
        errorMessage = nil
        do {
            try await authManager.resendVerificationEmail()
            infoMessage = String(localized: "Email inviata. Controlla la tua casella (anche lo spam).", comment: "Email resent successfully")
            startCooldown()
        } catch {
            errorMessage = error.localizedDescription
        }
        isResending = false
    }

    private func startCooldown() {
        resendCooldown = 30
        Task { @MainActor in
            while resendCooldown > 0 {
                try? await Task.sleep(for: .seconds(1))
                resendCooldown -= 1
            }
        }
    }
}
