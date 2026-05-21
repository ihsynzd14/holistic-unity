import SwiftUI
import SafariServices

/// Full-screen Terms-of-Service acceptance gate.
///
/// Presented by `AppCoordinator` when `authState == .needsTOSAcceptance`.
/// Mirrors the web `/accept-terms` page exactly:
///   - Four required approvals (general, vessatorie, privacy, health data)
///   - Two read-only links to the public HTML documents (open in Safari)
///   - "Accept" button stays disabled until every checkbox is checked
///   - On accept, calls `TOSService.recordAcceptance` and tells
///     `AuthManager` to re-evaluate its state, which transitions to
///     `.authenticated` and reveals the underlying app
///
/// There is intentionally NO "skip" or "later" button. The legal
/// mechanism that keeps onerous (vessatorie ex art. 1341 c.c.) clauses
/// enforceable is fresh, granular consent — we cannot grant access to
/// any feature that processes health data until the user accepts.
struct AcceptTermsView: View {

    let role: UserRole
    @Environment(AuthManager.self) private var authManager

    // ─── Required approvals (start unchecked) ────────────────────────
    @State private var generalAccepted = false
    @State private var vessatorieAccepted = false
    @State private var privacyAccepted = false
    @State private var healthDataAccepted = false

    // ─── UI flow state ───────────────────────────────────────────────
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var safariURL: URL?

    private var allAccepted: Bool {
        generalAccepted && vessatorieAccepted && privacyAccepted && healthDataAccepted
    }

    private var termsURL: URL? {
        URL(string: role == .therapist ? TOSService.URLs.therapistTerms : TOSService.URLs.clientTerms)
    }

    private var privacyURL: URL? {
        URL(string: TOSService.URLs.privacyPolicy)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HUSpacing.xl) {
                header
                introText
                checkboxStack
                if let errorMessage {
                    Text(errorMessage)
                        .font(HUFont.body(weight: .regular))
                        .foregroundStyle(HUColor.error)
                        .padding(.horizontal, HUSpacing.lg)
                }
                acceptButton
                Spacer(minLength: HUSpacing.xl)
            }
            .padding(.horizontal, HUSpacing.xl)
            .padding(.top, HUSpacing.xxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HUColor.background)
        .interactiveDismissDisabled(true) // user cannot swipe-down to dismiss
        .sheet(item: $safariURL) { url in
            SafariView(url: url)
        }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            Image("AppLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            Text("Termini e privacy")
                .font(HUFont.displayTitle(size: 28, weight: .bold))
                .foregroundStyle(HUColor.textPrimary)
        }
    }

    private var introText: some View {
        Text("Per usare Holistic Unity devi accettare i nostri termini di servizio, la nostra informativa sulla privacy e fornire il consenso esplicito al trattamento dei dati relativi alla salute (Art. 9 GDPR). Le sessioni olistiche generano dati sensibili e queste accettazioni proteggono te e gli operatori.")
            .font(HUFont.body(weight: .regular))
            .foregroundStyle(HUColor.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var checkboxStack: some View {
        VStack(alignment: .leading, spacing: HUSpacing.lg) {
            checkbox(
                isOn: $generalAccepted,
                title: "Accetto i Termini di Servizio",
                detail: "Tariffe, cancellazioni, foro competente.",
                linkTitle: "Leggi i Termini",
                action: { if let url = termsURL { safariURL = url } }
            )
            checkbox(
                isOn: $vessatorieAccepted,
                title: "Accetto specificamente le clausole vessatorie",
                detail: "Art. 1341 e 1342 c.c. — limitazioni di responsabilità, foro esclusivo, modifiche unilaterali.",
                linkTitle: nil,
                action: nil
            )
            checkbox(
                isOn: $privacyAccepted,
                title: "Accetto l'Informativa Privacy",
                detail: "Come trattiamo i tuoi dati personali ai sensi del GDPR.",
                linkTitle: "Leggi la Privacy Policy",
                action: { if let url = privacyURL { safariURL = url } }
            )
            checkbox(
                isOn: $healthDataAccepted,
                title: "Consento al trattamento dei dati sulla salute",
                detail: "Art. 9(2)(a) GDPR — necessario per prenotare sessioni con operatori olistici.",
                linkTitle: nil,
                action: nil
            )
        }
    }

    private var acceptButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack {
                if isSubmitting {
                    ProgressView()
                        .tint(.white)
                }
                Text(isSubmitting ? "Salvataggio…" : "Accetta e continua")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(allAccepted ? AnyShapeStyle(PrimaryGradient.linear) : AnyShapeStyle(Color.gray.opacity(0.3)))
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .shadow(color: allAccepted ? HUColor.primary.opacity(0.25) : .clear, radius: 8, y: 4)
        }
        .disabled(!allAccepted || isSubmitting)
        .animation(.easeInOut(duration: 0.15), value: allAccepted)
    }

    // MARK: - Submit

    private func submit() async {
        guard let userId = authManager.currentUser?.id else {
            errorMessage = String(localized: "Identità utente non disponibile. Esci e accedi di nuovo.", comment: "TOS accept missing user id")
            return
        }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            try await TOSService.shared.recordAcceptance(
                userId: userId,
                role: role,
                general: generalAccepted,
                vessatorie: vessatorieAccepted,
                privacy: privacyAccepted,
                healthData: healthDataAccepted
            )
            // Trigger AuthManager re-evaluation → .authenticated.
            authManager.tosAccepted()
            HUHaptic.notification(.success)
        } catch {
            errorMessage = error.localizedDescription
            HUHaptic.notification(.error)
        }
    }

    // MARK: - Components

    private func checkbox(
        isOn: Binding<Bool>,
        title: String,
        detail: String,
        linkTitle: String?,
        action: (() -> Void)?
    ) -> some View {
        VStack(alignment: .leading, spacing: HUSpacing.xs) {
            Button {
                isOn.wrappedValue.toggle()
                HUHaptic.selection()
            } label: {
                HStack(alignment: .top, spacing: HUSpacing.md) {
                    Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
                        .font(.system(size: 22, weight: .regular))
                        .foregroundStyle(isOn.wrappedValue ? HUColor.primary : HUColor.textSecondary)
                        .frame(width: 24, height: 24)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(HUColor.textPrimary)
                            .multilineTextAlignment(.leading)
                        Text(detail)
                            .font(.system(size: 13))
                            .foregroundStyle(HUColor.textSecondary)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .buttonStyle(.plain)
            if let linkTitle, let action {
                Button(linkTitle, action: action)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(HUColor.primary)
                    .padding(.leading, 36)
            }
        }
    }
}

// MARK: - URL Identifiable wrapper (so .sheet(item:) works on URL)

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

// MARK: - SafariView wrapper

private struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
