import SwiftUI

struct WelcomeView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showAuth = false
    @State private var authMode: AuthMode = .signIn
    @State private var currentPage = 0
    @State private var hasAppeared = false

    enum AuthMode {
        case signIn
        case signUp
    }

    private struct OnboardingPage {
        let imageName: String  // Asset name in Assets.xcassets
        let title: String
        let subtitle: String
        let tint: Color
    }

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            imageName: "onboarding_discover",
            title: "Discover your practitioner",
            subtitle: "From ThetaHealing to astrology — find the right practice for where you are right now.",
            tint: HUColor.primaryLight
        ),
        OnboardingPage(
            imageName: "onboarding_book",
            title: "Book in seconds",
            subtitle: "No back-and-forth emails. Pick a time, confirm, and it's done.",
            tint: Color(red: 0.88, green: 0.96, blue: 0.90)
        ),
        OnboardingPage(
            imageName: "onboarding_session",
            title: "Show up fully",
            subtitle: "Private video sessions from the comfort of your home. Just you and your practitioner.",
            tint: Color(red: 0.99, green: 0.93, blue: 0.86)
        )
    ]
    
    private var logoSize: CGFloat {
        dynamicTypeSize.isAccessibilitySize ? 56 : 80
    }
    
    private var carouselHeight: CGFloat {
        dynamicTypeSize.isAccessibilitySize ? 440 : 240
    }
    
    private var carouselImageSize: CGFloat {
        dynamicTypeSize.isAccessibilitySize ? 64 : 120
    }

    var body: some View {
        NavigationStack {
            ZStack {
                HUColor.background.ignoresSafeArea()

                if dynamicTypeSize.isAccessibilitySize {
                    ScrollView {
                        welcomeContent
                            .padding(.top, 96)
                            .padding(.bottom, HUSpacing.xxl)
                    }
                } else {
                    welcomeContent
                }
            }
            .navigationDestination(isPresented: $showAuth) {
                AuthView(mode: authMode)
            }
            .task {
                try? await Task.sleep(for: .milliseconds(80))
                withAnimation(.spring(response: 0.65, dampingFraction: 0.78)) {
                    hasAppeared = true
                }
            }
        }
    }
    
    private var welcomeContent: some View {
        VStack(spacing: 0) {
            if !dynamicTypeSize.isAccessibilitySize {
                Spacer(minLength: 0)
            }
            
            logoSection
            
            if dynamicTypeSize.isAccessibilitySize {
                Color.clear.frame(height: HUSpacing.lg)
            } else {
                Spacer(minLength: 0)
            }
            
            carouselSection
            
            if dynamicTypeSize.isAccessibilitySize {
                Color.clear.frame(height: HUSpacing.lg)
            } else {
                Spacer(minLength: 0)
            }
            
            ctaSection
        }
    }
    
    private var logoSection: some View {
        VStack(spacing: 14) {
            if !dynamicTypeSize.isAccessibilitySize {
                Image("AppLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: logoSize, height: logoSize)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .shadow(color: HUColor.primary.opacity(0.25), radius: 16, y: 6)
                    .scaleEffect(hasAppeared ? 1.0 : 0.75)
                    .opacity(hasAppeared ? 1.0 : 0.0)
            }
            
            Text("Holistic Unity")
                .font((dynamicTypeSize.isAccessibilitySize ? Font.title : Font.largeTitle).weight(.bold))
                .foregroundStyle(HUColor.textPrimary)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.65)
                .lineLimit(2)
                .padding(.horizontal, HUSpacing.xl)
                .opacity(hasAppeared ? 1.0 : 0.0)
                .offset(y: hasAppeared ? 0 : 8)
        }
    }
    
    private var carouselSection: some View {
        VStack(spacing: HUSpacing.sm) {
            if dynamicTypeSize.isAccessibilitySize {
                carouselCard(pages[currentPage])
                
                pageDots
                
                Button {
                    withAnimation(HUAnimation.standard) {
                        currentPage = (currentPage + 1) % pages.count
                    }
                } label: {
                    Text(currentPage == pages.count - 1 ? "Back to first tip" : "Next tip")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundStyle(HUColor.primary)
            } else {
                carouselCard(pages[currentPage])
                .frame(height: carouselHeight)
                .contentShape(Rectangle())
                .gesture(carouselDragGesture)
                .animation(HUAnimation.standard, value: currentPage)
                
                pageDots
                    .padding(.top, HUSpacing.xs)
            }
        }
        .padding(.horizontal, HUSpacing.lg)
        .opacity(hasAppeared ? 1.0 : 0.0)
    }
    
    private var pageDots: some View {
        HStack(spacing: HUSpacing.xs) {
            ForEach(pages.indices, id: \.self) { index in
                Circle()
                    .fill(index == currentPage ? HUColor.primary : HUColor.textTertiary.opacity(0.35))
                    .frame(width: 8, height: 8)
            }
        }
    }
    
    private var carouselDragGesture: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                if value.translation.width < -40 {
                    showNextPage()
                } else if value.translation.width > 40 {
                    showPreviousPage()
                }
            }
    }
    
    private func showNextPage() {
        withAnimation(HUAnimation.standard) {
            currentPage = min(currentPage + 1, pages.count - 1)
        }
    }
    
    private func showPreviousPage() {
        withAnimation(HUAnimation.standard) {
            currentPage = max(currentPage - 1, 0)
        }
    }
    
    private var ctaSection: some View {
        VStack(spacing: 12) {
            HUButton("Get Started", style: .primary) {
                HUHaptic.impact(.medium)
                authMode = .signUp
                showAuth = true
            }
            
            Button {
                authMode = .signIn
                showAuth = true
            } label: {
                Text("Already have an account? ")
                    .foregroundStyle(HUColor.textSecondary)
                + Text("Sign in")
                    .foregroundStyle(HUColor.primary)
            }
            .font(.subheadline)
            .multilineTextAlignment(.center)
            .opacity(hasAppeared ? 1.0 : 0.0)
        }
        .padding(.horizontal, HUSpacing.xl)
        .padding(.bottom, dynamicTypeSize.isAccessibilitySize ? 0 : HUSpacing.xxl + 8)
        .opacity(hasAppeared ? 1.0 : 0.0)
    }

    private func carouselCard(_ page: OnboardingPage) -> some View {
        VStack(spacing: dynamicTypeSize.isAccessibilitySize ? 10 : 16) {
            Image(page.imageName)
                .resizable()
                .scaledToFill()
                .frame(width: carouselImageSize, height: carouselImageSize)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(page.tint, lineWidth: 2))

            VStack(spacing: 8) {
                Text(page.title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(HUColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text(page.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, HUSpacing.lg)
            }
        }
        .padding(.vertical, HUSpacing.md)
    }
}

#Preview {
    WelcomeView()
}
