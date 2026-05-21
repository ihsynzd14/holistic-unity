import SwiftUI

/// Shown to therapist users when they open the iOS app.
/// Directs them to the web-based therapist portal instead.
struct TherapistWebAppRedirectView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        VStack(spacing: HUSpacing.xxl) {
            Spacer()

            // Logo
            Image("AppLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .shadow(color: HUColor.cardShadow, radius: 8, y: 4)

            VStack(spacing: HUSpacing.md) {
                Text("Therapist Portal Has Moved")
                    .font(HUFont.title())
                    .foregroundStyle(HUColor.textPrimary)
                    .multilineTextAlignment(.center)

                Text("Manage your practice, bookings, and earnings on our web portal.")
                    .font(HUFont.body())
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HUSpacing.xl)
            }

            VStack(spacing: HUSpacing.md) {
                HUButton("Open Web Portal", style: .primary, icon: "safari") {
                    if let url = URL(string: AppConstants.Webapp.therapistPortalURL) {
                        UIApplication.shared.open(url)
                    }
                }

                HUButton("Sign Out", style: .outline, icon: "rectangle.portrait.and.arrow.right") {
                    Task { await authManager.signOut() }
                }
            }
            .padding(.horizontal, HUSpacing.xl)

            Spacer()

            Text("This app is now for clients only.\nTherapists use the web portal.")
                .font(HUFont.caption())
                .foregroundStyle(HUColor.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.bottom, HUSpacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HUColor.background)
    }
}
