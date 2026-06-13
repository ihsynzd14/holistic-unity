import SwiftUI
import StreamChat
import StreamChatSwiftUI
import WebKit
import AVKit

/// Drives the booking sheet via `.sheet(item:)`.
/// Wrapping the optional service in an Identifiable container ensures
/// SwiftUI always rebuilds `BookingFlowView` with the current service
/// at first presentation — avoiding the race where `State(initialValue:)`
/// captures a stale `nil` when the sheet is opened with a preselected service.
struct BookingContext: Identifiable {
    let id = UUID()
    let service: TherapistService?
}

struct TherapistProfileView: View {
    let therapist: TherapistProfile
    var isPreview: Bool = false
    @Environment(AuthManager.self) private var authManager
    // Drives the booking sheet via .sheet(item:) so the view is always
    // built with the correct preselected service on first presentation,
    // avoiding the .sheet(isPresented:) + State(initialValue:) timing race
    // where SwiftUI captures the stale (nil) preselectedService on first build.
    @State private var bookingContext: BookingContext?
    @State private var shortsPlayerURL: URL? = nil
    /// Direct video URL (mp4/mov) to play in a full-screen AVKit
    /// sheet. Replaces the previously dead "generic play button"
    /// fallback that did nothing when tapped.
    @State private var directVideoURL: URL? = nil
    @State private var showChat = false
    @State private var directChannelId: ChannelId?
    @State private var directChannelController: ChatChannelController?
    @State private var isLoadingChat = false
    @State private var chatError: String?
    @State private var selectedReviewSort: ReviewSortOption = .mostRecent
    @State private var reviews: [Review] = []
    /// True when the reviews load fails, so the section shows a retry affordance
    /// instead of a false "No reviews yet" empty state (F1, 2026-05-30).
    @State private var reviewsLoadError = false
    @State private var isFavorited = false
    @State private var showReportSheet = false
    @State private var reportSubmitted = false
    @State private var showBlockConfirm = false
    @State private var isBlocking = false
    @State private var blockError: String?
    @State private var didBlock = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                // MARK: - Hero Section
                heroSection

                // MARK: - Content
                VStack(alignment: .leading, spacing: HUSpacing.xxl) {
                    if isPreview {
                        previewBanner
                    }

                    aboutSection
                    therapyTypesSection
                    servicesSection
                    certificationsSection
                    videoSection

                    if !therapist.galleryImageURLs.isEmpty {
                        gallerySection
                    }

                    availabilitySection
                    reviewsSection
                    cancellationPolicySection

                    // Report + Block (Guideline 1.2 — fully wired
                    // to ReportService.shared as of 2026-05-18, was
                    // previously a local-state stub).
                    if !isPreview {
                        reportBlockSection
                    }
                }
                .padding(.horizontal, HUSpacing.xl)
                .padding(.top, HUSpacing.xl)
                .padding(.bottom, HUSpacing.xl)
            }
        }
        .background(HUColor.background)
        .ignoresSafeArea(edges: .top)
        // Signature booking-app pattern: a frosted, always-visible CTA bar
        // pinned to the bottom safe area. Replaces the old inline hero CTA
        // so the top of the screen stays calm and editorial, while booking
        // remains one tap away at every scroll position.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !isPreview {
                bookingBar
            }
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if isPreview {
                    Text("Preview")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(HUColor.textSecondary)
                } else {
                    HStack(spacing: HUSpacing.md) {
                        ShareLink(
                            item: "Check out \(therapist.displayName) on Holistic Unity!",
                            subject: Text("Holistic Unity Therapist"),
                            message: Text("\(therapist.displayName) - \(therapist.tagline)")
                        ) {
                            Image(systemName: "square.and.arrow.up")
                                .foregroundStyle(HUColor.textPrimary)
                        }
                        Button {
                            HUHaptic.impact(.medium)
                            withAnimation { isFavorited.toggle() }
                        } label: {
                            Image(systemName: isFavorited ? "heart.fill" : "heart")
                                .foregroundStyle(isFavorited ? .red : HUColor.textPrimary)
                        }
                        .accessibilityLabel(isFavorited ? "Remove from favorites" : "Add to favorites")
                    }
                }
            }
        }
        .sheet(item: $bookingContext) { ctx in
            BookingFlowView(therapist: therapist, preselectedService: ctx.service)
        }
        .sheet(isPresented: Binding(
            get: { shortsPlayerURL != nil },
            set: { if !$0 { shortsPlayerURL = nil } }
        )) {
            if let url = shortsPlayerURL {
                YouTubeShortsPlayerView(url: url)
            }
        }
        .sheet(item: $directVideoURL) { url in
            // Native AVPlayer for direct .mp4/.mov files (e.g. videos
            // uploaded straight to Supabase Storage). Replaces the
            // dead "play icon" the old code rendered for non-YouTube
            // URLs. AVKit handles caching, playback controls, and
            // background audio routing for free.
            DirectVideoSheet(url: url)
        }
        .sheet(isPresented: $showChat) {
            if let controller = directChannelController {
                NavigationStack {
                    ChatChannelView(
                        viewFactory: HUChatViewFactory.shared,
                        channelController: controller
                    )
                }
            }
        }
        .task {
            await loadReviews()
        }
        .refreshable {
            await loadReviews()
        }
        // ReportSheet — wired to ReportService.shared. The previous
        // confirmationDialog was a UI stub that set a local flag
        // without ever hitting the backend (Guideline 1.2 risk).
        .sheet(isPresented: $showReportSheet) {
            ReportSheet(
                targetType: .therapist,
                targetID: therapist.id,
                targetDisplayName: therapist.displayName
            )
        }
        .confirmationDialog(
            "Blocca \(therapist.displayName)?",
            isPresented: $showBlockConfirm,
            titleVisibility: .visible
        ) {
            Button("Blocca", role: .destructive) {
                Task { await blockTherapist() }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Bloccando \(therapist.displayName) non riceverai più i suoi messaggi e non comparirà più nelle ricerche. Puoi sbloccare in qualsiasi momento da Impostazioni.")
        }
        .alert("Errore", isPresented: Binding(
            get: { blockError != nil },
            set: { if !$0 { blockError = nil } }
        )) {
            Button("OK") {}
        } message: {
            Text(blockError ?? "")
        }
        .alert("Bloccato", isPresented: $didBlock) {
            Button("OK") {}
        } message: {
            Text("\(therapist.displayName) è stato/a bloccato/a. Non riceverai più suoi messaggi.")
        }
        .alert("Message Error", isPresented: Binding(
            get: { chatError != nil },
            set: { if !$0 { chatError = nil } }
        )) {
            Button("OK") { chatError = nil }
        } message: {
            Text(chatError ?? "")
        }
    }

    // MARK: - Data Loading

    private func blockTherapist() async {
        isBlocking = true
        blockError = nil
        defer { isBlocking = false }
        do {
            try await ReportService.shared.blockUser(therapist.id)
            HUHaptic.notification(.success)
            didBlock = true
        } catch {
            HUHaptic.notification(.error)
            blockError = error.localizedDescription
        }
    }

    private func loadReviews() async {
        do {
            reviews = try await DIContainer.shared.reviewRepository.getReviews(
                therapistId: therapist.id,
                sortBy: selectedReviewSort,
                page: 0
            )
            reviewsLoadError = false
        } catch {
            reviewsLoadError = true
        }
    }

    /// Opens (or creates) the 1:1 chat channel with this therapist.
    /// Extracted from the old inline CTA closure so both the sticky
    /// booking bar and any future entry points share one code path.
    private func startChat() {
        Task {
            isLoadingChat = true
            do {
                let currentUserId = authManager.currentUser?.id ?? ""
                let channelId = try await StreamChatService.shared.getOrCreateChannel(
                    currentUserId: currentUserId,
                    otherUserId: therapist.id
                )
                directChannelId = channelId
                let controller = try await StreamChatService.shared.synchronizedController(for: channelId)
                directChannelController = controller
                showChat = true
            } catch {
                chatError = error.localizedDescription
            }
            isLoadingChat = false
        }
    }

    // MARK: - Hero

    /// Editorial hero (2026 edition). A soft cream wash with a
    /// category-tinted halo cradles a centered painted portrait, then a
    /// serif name, a single italic pull-quote (no more duplicated
    /// tagline), a location chip, and a three-up credibility strip.
    private var heroSection: some View {
        VStack(spacing: HUSpacing.lg) {
            // Portrait + soft radial halo. The halo is a *non-layout*
            // background so it can bleed outward visually without
            // inflating the portrait's layout box — otherwise the 290pt
            // halo forced ~80pt of dead space between the photo and name.
            heroPortrait
                .background {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [heroHaloColor.opacity(0.20), .clear],
                                center: .center,
                                startRadius: 10,
                                endRadius: 130
                            )
                        )
                        .frame(width: 240, height: 240)
                }
                .padding(.top, 64)

            // Name, role quote, location
            VStack(spacing: HUSpacing.sm) {
                if let tier = therapist.tier {
                    TierPill(tier: tier)
                }

                Text(therapist.displayName)
                    .font(HUFont.displayTitle(size: 28, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                    .multilineTextAlignment(.center)

                if !therapist.tagline.isEmpty {
                    Text("\u{201C}\(therapist.tagline)\u{201D}")
                        .font(.custom("Fraunces72pt-Italic", size: 17))
                        .foregroundStyle(HUColor.primary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .padding(.horizontal, HUSpacing.lg)
                }

                if let locationText {
                    locationChip(locationText)
                }
            }

            // Credibility strip
            statStrip
                .padding(.top, HUSpacing.xs)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, HUSpacing.xl)
        .padding(.bottom, HUSpacing.lg)
        .background(heroBackdrop)
    }

    private var heroBackdrop: some View {
        LinearGradient(
            colors: [HUColor.brandCream, HUColor.background],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var heroHaloColor: Color {
        therapist.categories.first?.color ?? HUColor.primary
    }

    private var heroPortrait: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let photoURL = therapist.photoURL {
                    AsyncImage(url: photoURL.supabaseThumbnail(size: 132)) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        case .failure:
                            profileInitialsCircle
                        case .empty:
                            ZStack {
                                Circle().fill(HUColor.primaryLight)
                                ProgressView().tint(HUColor.primary)
                            }
                        @unknown default:
                            profileInitialsCircle
                        }
                    }
                    .frame(width: 132, height: 132)
                    .clipShape(Circle())
                } else {
                    profileInitialsCircle
                        .frame(width: 132, height: 132)
                }
            }
            .overlay(Circle().strokeBorder(HUColor.background, lineWidth: 5))
            .shadow(color: HUColor.primary.opacity(0.18), radius: 22, y: 10)

            if therapist.isVerified {
                ZStack {
                    Circle()
                        .fill(HUColor.background)
                        .frame(width: 32, height: 32)
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(HUColor.primary)
                }
                .offset(x: -2, y: -2)
            }
        }
        .overlay(alignment: .topLeading) {
            if let tier = therapist.tier {
                TierBadge(tier: tier, size: 52)
                    .offset(x: -6, y: -6)
            }
        }
    }

    private var locationText: String? {
        guard let location = therapist.location else { return nil }
        if !location.city.isEmpty { return location.city }
        if !location.country.isEmpty { return location.country }
        return nil
    }

    private func locationChip(_ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 11, weight: .semibold))
            Text(text)
                .font(.system(size: 13, weight: .medium))
        }
        .foregroundStyle(HUColor.brandMagenta)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(HUColor.brandMagenta.opacity(0.10))
        .clipShape(Capsule())
        .padding(.top, 2)
    }

    // MARK: - Stat Strip

    private var statStrip: some View {
        HStack(spacing: HUSpacing.sm) {
            if therapist.totalReviews > 0 {
                statTile(
                    icon: "star.fill",
                    value: String(format: "%.1f", therapist.averageRating),
                    label: "Voto",
                    tint: HUColor.brandGold
                )
            } else {
                statTile(icon: "sparkles", value: "Nuovo", label: "Profilo", tint: HUColor.brandGold)
            }

            statTile(icon: "rosette", value: "\(therapist.yearsExperience)", label: "Anni", tint: HUColor.primary)
            statTile(icon: "video.fill", value: "Online", label: "Sessioni", tint: HUColor.primary)
        }
    }

    private func statTile(icon: String, value: String, label: String, tint: Color) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(HUColor.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(HUColor.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HUSpacing.md)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: HURadius.lg, style: .continuous)
                .strokeBorder(HUColor.primary.opacity(0.04), lineWidth: 1)
        )
    }

    private var therapistInitials: String {
        let components = therapist.displayName.split(separator: " ")
        let first = components.first?.prefix(1) ?? ""
        let last = components.count > 1 ? components.last?.prefix(1) ?? "" : ""
        return "\(first)\(last)".uppercased()
    }

    private var profileInitialsCircle: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [
                            HUColor.primaryLight,
                            therapist.categories.first?.color.opacity(0.15) ?? HUColor.primaryLight
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 132, height: 132)

            Text(therapistInitials)
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(HUColor.primaryDark)
        }
    }

    // MARK: - Sticky Booking Bar

    /// Frosted bottom bar: starting price on the left, message + the
    /// primary "Prenota sessione" pill on the right. Only shown to
    /// clients (`!isPreview`).
    private var bookingBar: some View {
        HStack(spacing: HUSpacing.md) {
            VStack(alignment: .leading, spacing: 0) {
                if let price = therapist.startingPrice {
                    Text("da \(therapist.currency.symbol)\(Int(price))")
                        .font(.custom("Fraunces72pt-SemiBold", size: 20))
                        .foregroundStyle(HUColor.textPrimary)
                        .lineLimit(1)
                    Text("a sessione")
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textTertiary)
                        .lineLimit(1)
                } else {
                    Text("Prenota")
                        .font(.custom("Fraunces72pt-SemiBold", size: 18))
                        .foregroundStyle(HUColor.textPrimary)
                    Text("Scegli un servizio")
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textTertiary)
                }
            }

            Spacer(minLength: HUSpacing.sm)

            messageIconButton

            Button {
                HUHaptic.impact(.light)
                bookingContext = BookingContext(service: nil)
            } label: {
                Text("Prenota sessione")
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .foregroundStyle(.white)
                    .padding(.horizontal, HUSpacing.lg)
                    .frame(height: 50)
                    .background(
                        Capsule()
                            .fill(PrimaryGradient.linear)
                            .shadow(color: HUColor.primary.opacity(0.30), radius: 12, y: 5)
                    )
            }
            .buttonStyle(HUPressButtonStyle())
        }
        .padding(.horizontal, HUSpacing.xl)
        .padding(.top, HUSpacing.md)
        .padding(.bottom, HUSpacing.sm)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(HUColor.divider.opacity(0.6))
                .frame(height: 0.5)
        }
    }

    private var messageIconButton: some View {
        Button {
            startChat()
        } label: {
            ZStack {
                Circle()
                    .fill(HUColor.brandMagenta.opacity(0.10))
                    .frame(width: 50, height: 50)
                    .overlay(Circle().strokeBorder(HUColor.brandMagenta.opacity(0.22), lineWidth: 1))
                if isLoadingChat {
                    ProgressView()
                        .controlSize(.small)
                        .tint(HUColor.brandMagenta)
                } else {
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(HUColor.brandMagenta)
                }
            }
        }
        .buttonStyle(HUPressButtonStyle())
        .disabled(isLoadingChat)
        .accessibilityLabel("Invia un messaggio a \(therapist.displayName)")
    }

    // MARK: - Preview Banner

    private var previewBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "eye.fill")
                .font(.system(size: 14))
            Text("This is how clients see your profile")
                .font(.system(size: 13, weight: .medium))
        }
        .foregroundStyle(HUColor.primary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(HUColor.primaryLight)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg, style: .continuous))
    }

    // MARK: - About

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle("A Little Bit About Me")

            Text(therapist.bio)
                .font(.system(size: 15))
                .foregroundStyle(HUColor.textSecondary)
                .lineSpacing(6)
                .fixedSize(horizontal: false, vertical: true)

            if !therapist.languages.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "globe")
                        .font(.system(size: 12, weight: .medium))
                    Text("Speaks: \(therapist.languages.joined(separator: ", "))")
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(HUColor.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(HUColor.primaryLight.opacity(0.55))
                .clipShape(Capsule())
            }
        }
    }

    // MARK: - Therapy Types

    private var therapyTypesSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle("My Type of Therapy")

            FlowLayout(spacing: HUSpacing.sm) {
                ForEach(therapist.categories) { category in
                    HStack(spacing: 6) {
                        Image(systemName: category.icon)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(category.color)
                        Text(category.displayName)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(HUColor.textPrimary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(category.color.opacity(0.13))
                    .clipShape(Capsule())
                    .overlay(Capsule().strokeBorder(category.color.opacity(0.22), lineWidth: 1))
                }
            }
        }
    }

    // MARK: - Services

    private var servicesSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle("Services & Pricing")

            VStack(spacing: HUSpacing.md) {
                ForEach(therapist.services) { service in
                    serviceCard(service)
                }
            }
        }
    }

    private func serviceCard(_ service: TherapistService) -> some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            // Title + price
            HStack(alignment: .firstTextBaseline, spacing: HUSpacing.sm) {
                Text(service.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(HUColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: HUSpacing.sm)

                if service.isIntroCall {
                    Text("Free")
                        .font(.custom("Fraunces72pt-SemiBold", size: 22))
                        .foregroundStyle(HUColor.success)
                } else {
                    Text("\(therapist.currency.symbol)\(Int(service.price))")
                        .font(.custom("Fraunces72pt-SemiBold", size: 24))
                        .foregroundStyle(HUColor.primary)
                }
            }

            // Description
            if !service.description.isEmpty {
                Text(service.description)
                    .font(.system(size: 13))
                    .foregroundStyle(HUColor.textSecondary)
                    .lineSpacing(3)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Meta chips — duration, modality, intro tag
            HStack(spacing: HUSpacing.sm) {
                metaChip(icon: "video.fill", text: "\(service.duration) min", tint: HUColor.primary)
                metaChip(
                    icon: service.category.icon,
                    text: service.category.displayName,
                    tint: service.category.color
                )
                if service.isIntroCall {
                    metaChip(icon: "gift.fill", text: "Intro", tint: HUColor.success)
                }
                Spacer(minLength: 0)
            }

            // Pack pricing highlight
            if let packSize = service.packSize, let packPrice = service.packPrice {
                HStack(spacing: 6) {
                    Image(systemName: "square.stack.3d.up.fill")
                        .font(.system(size: 11))
                    Text("Pack of \(packSize): \(therapist.currency.symbol)\(Int(packPrice))/session")
                        .font(.system(size: 12, weight: .medium))
                }
                .foregroundStyle(HUColor.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(HUColor.primaryLight.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: HURadius.md, style: .continuous))
            }

            // Per-service CTA
            if !isPreview {
                Button {
                    // Pre-select this specific service so the flow skips the
                    // redundant "Choose a Service" step. BookingContext is
                    // Identifiable, so .sheet(item:) always builds
                    // BookingFlowView with the correct service on first present.
                    HUHaptic.impact(.light)
                    bookingContext = BookingContext(service: service)
                } label: {
                    HStack(spacing: 6) {
                        Text(service.isIntroCall ? "Schedule" : "Book")
                            .font(.system(size: 14, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(
                        Capsule().fill(
                            service.isIntroCall
                            ? AnyShapeStyle(HUColor.success)
                            : AnyShapeStyle(PrimaryGradient.linear)
                        )
                    )
                }
                .buttonStyle(HUPressButtonStyle())
            }
        }
        .huProfileSurface()
    }

    private func metaChip(icon: String, text: String, tint: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .semibold))
            Text(text)
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(tint.opacity(0.12))
        .clipShape(Capsule())
    }

    // MARK: - Certifications

    private var certificationsSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle("My Certifications")

            VStack(spacing: HUSpacing.sm) {
                ForEach(therapist.certifications) { cert in
                    certificationRow(cert)
                }
            }
        }
    }

    private func certificationRow(_ cert: Certificate) -> some View {
        HStack(spacing: HUSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: HURadius.md, style: .continuous)
                    .fill(PrimaryGradient.linear)
                Image(systemName: "rosette")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 46, height: 46)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(cert.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    if cert.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(HUColor.primary)
                    }
                }
                Text(cert.issuingOrganization)
                    .font(.system(size: 12))
                    .foregroundStyle(HUColor.textSecondary)
                Text("Obtained \(cert.yearString)")
                    .font(.system(size: 11))
                    .foregroundStyle(HUColor.textTertiary)
            }

            Spacer(minLength: 0)
        }
        .huProfileSurface(padding: HUSpacing.md)
    }

    // MARK: - Video

    private var videoSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle(isPreview ? "Il mio video di presentazione" : "Video di presentazione")

            if let videoURL = therapist.videoIntroURL {
                videoPresentation(for: videoURL)
            } else {
                videoEmptyState
            }
        }
    }

    /// Decides how to render a presentation video, in order of
    /// preference. Each branch resolves a distinct hosting style:
    ///
    ///   1. YouTube Shorts        → tappable thumbnail → modal in-app player
    ///   2. YouTube watch / youtu.be / Vimeo → inline `WKWebView` embed
    ///   3. Anything else (direct mp4 from Supabase Storage, etc.)
    ///      → tappable thumbnail → modal `AVPlayer`. This was the
    ///      missing branch — the previous code rendered a static
    ///      "play icon" with no tap handler for direct URLs, so
    ///      therapists who uploaded their own .mp4 saw a button
    ///      that did nothing.
    @ViewBuilder
    private func videoPresentation(for videoURL: URL) -> some View {
        if let shortsID = youTubeShortsVideoID(from: videoURL) {
            videoThumbButton(
                thumb: URL(string: "https://img.youtube.com/vi/\(shortsID)/hqdefault.jpg")
            ) {
                shortsPlayerURL = videoURL
            }
        } else if let embedURL = videoEmbedURL(from: videoURL) {
            VideoThumbnailPreview(embedURL: embedURL, originalURL: videoURL)
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
        } else {
            // Direct video file (mp4/mov) — open in AVKit on tap.
            // The thumbnail uses a soft gradient since we don't have
            // a poster frame.
            videoThumbButton(thumb: nil) {
                directVideoURL = videoURL
            }
        }
    }

    /// Tappable video thumbnail used by both the Shorts and direct-
    /// file branches. Same visual treatment so the user always sees
    /// a clear play affordance.
    private func videoThumbButton(thumb: URL?, action: @escaping () -> Void) -> some View {
        Button {
            HUHaptic.impact(.light)
            action()
        } label: {
            ZStack {
                if let thumb {
                    AsyncImage(url: thumb.supabaseThumbnail(size: 400)) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        case .failure, .empty:
                            videoPlaceholderBackground
                        @unknown default:
                            videoPlaceholderBackground
                        }
                    }
                } else {
                    videoPlaceholderBackground
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 200)
            .clipped()
            .overlay {
                LinearGradient(
                    colors: [.clear, .black.opacity(0.25)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .overlay {
                ZStack {
                    Circle()
                        .fill(.white.opacity(0.95))
                        .frame(width: 64, height: 64)
                        .shadow(color: .black.opacity(0.25), radius: 8, y: 4)
                    Image(systemName: "play.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(HUColor.primary)
                        .offset(x: 2) // optical centering
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
        }
        .buttonStyle(.plain)
    }

    private var videoPlaceholderBackground: some View {
        LinearGradient(
            colors: [
                HUColor.primaryLight,
                (therapist.categories.first?.color ?? HUColor.primary).opacity(0.25)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var videoEmptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "video.slash")
                .font(.system(size: 28))
                .foregroundStyle(HUColor.textTertiary)
            Text("Nessun video di presentazione")
                .font(.system(size: 13))
                .foregroundStyle(HUColor.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 120)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
    }

    /// Returns the video ID if the URL is a YouTube Shorts URL.
    /// Accepts both `youtube.com/shorts/ID` and `m.youtube.com/shorts/ID`
    /// (mobile share links), with or without trailing query params.
    ///
    /// SECURITY: validates ID format (11-char YouTube alphanumeric)
    /// to prevent therapist-controlled URLs from injecting arbitrary
    /// strings into the WebView embed (see VideoPlayerViews.swift F3
    /// fix for full context).
    private func youTubeShortsVideoID(from url: URL) -> String? {
        let s = url.absoluteString
        guard s.contains("youtube.com/shorts/") || s.contains("youtube-nocookie.com/shorts/") else { return nil }
        let id = url.lastPathComponent
        return Self.isValidYouTubeID(id) ? id : nil
    }

    /// Converts a YouTube or Vimeo watch URL to an embeddable URL.
    /// Returns nil if the URL is not a recognised hosted-video link
    /// or if the extracted ID fails sanitisation.
    ///
    /// SECURITY: all extracted IDs are validated against the host's
    /// ID format. YouTube IDs are 11-char `[A-Za-z0-9_-]`; Vimeo IDs
    /// are numeric. Anything else returns nil → caller falls back to
    /// AVKit or empty state.
    ///
    /// Embed params:
    ///   • `playsinline=1`     — iOS plays inline (not auto-fullscreen)
    ///   • `rel=0`             — hide related videos at end
    ///   • `modestbranding=1`  — minimal YouTube chrome
    private func videoEmbedURL(from url: URL) -> URL? {
        let urlString = url.absoluteString

        // We no longer build a `youtube.com/embed` URL and load it inside a
        // WKWebView via `loadHTMLString`: that path never sends a real HTTP
        // `Referer`, so YouTube refuses the embed with the error 150/152/153
        // family even for videos whose owners allow embedding. Instead we
        // point the WebView at our own hosted player page
        // (app.holisticunity.app/embed/youtube), which IS a real same-origin
        // navigation — WKWebView then sends a genuine `Referer` and YouTube
        // accepts it. See AppConstants.Webapp.youTubeEmbedURL and
        // VideoPlayerViews.swift for the full story.
        func ytEmbed(_ id: String) -> URL? {
            guard Self.isValidYouTubeID(id) else { return nil }
            return AppConstants.Webapp.youTubeEmbedURL(videoID: id)
        }

        if urlString.contains("youtube.com/watch") || urlString.contains("youtube-nocookie.com/watch"),
           let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "v" })?.value,
           !id.isEmpty {
            return ytEmbed(id)
        }
        if urlString.contains("youtu.be/") {
            let id = url.lastPathComponent
            if !id.isEmpty { return ytEmbed(id) }
        }
        if urlString.contains("youtube.com/embed/") {
            let id = url.lastPathComponent
            if !id.isEmpty { return ytEmbed(id) }
        }
        // Vimeo — accepts `vimeo.com/ID` and `vimeo.com/ID/HASH`
        // (private videos). Preserve the hash if present so the
        // embed succeeds.
        if urlString.contains("vimeo.com/") {
            let parts = url.pathComponents.filter { $0 != "/" }
            // ["123456"] or ["123456", "hash"]
            if let id = parts.first(where: { Int($0) != nil }) {
                if let hash = parts.dropFirst().first(where: { Int($0) == nil }) {
                    return URL(string: "https://player.vimeo.com/video/\(id)?h=\(hash)&playsinline=1")
                }
                return URL(string: "https://player.vimeo.com/video/\(id)?playsinline=1")
            }
        }
        return nil
    }

    /// Validates a YouTube video ID. YouTube IDs are exactly 11
    /// characters drawn from `[A-Za-z0-9_-]`. Anything outside this
    /// alphabet is rejected as a potential injection attempt.
    /// Mirrors `YouTubeID.isValid` in VideoPlayerViews.swift (single
    /// source of truth would be nicer; kept duplicated to avoid coupling
    /// the view to the design-system component).
    static func isValidYouTubeID(_ id: String) -> Bool {
        guard id.count == 11 else { return false }
        return id.unicodeScalars.allSatisfy { scalar in
            (scalar >= "A" && scalar <= "Z") ||
            (scalar >= "a" && scalar <= "z") ||
            (scalar >= "0" && scalar <= "9") ||
            scalar == "_" || scalar == "-"
        }
    }

    // MARK: - Gallery

    private var gallerySection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle("Gallery")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HUSpacing.md) {
                    ForEach(therapist.galleryImageURLs, id: \.absoluteString) { url in
                        galleryThumb(url)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func galleryThumb(_ url: URL) -> some View {
        AsyncImage(url: url.supabaseThumbnail(size: 200)) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure:
                ZStack {
                    HUColor.secondaryBackground
                    Image(systemName: "photo")
                        .font(.system(size: 24))
                        .foregroundStyle(HUColor.textTertiary)
                }
            case .empty:
                ZStack {
                    HUColor.secondaryBackground
                    ProgressView().tint(HUColor.primary)
                }
            @unknown default:
                Color.clear
            }
        }
        .frame(width: 180, height: 130)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: HURadius.xl, style: .continuous)
                .strokeBorder(HUColor.primary.opacity(0.05), lineWidth: 1)
        )
    }

    // MARK: - Availability Preview

    private var availabilitySection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle("Availability This Week")

            HStack(spacing: HUSpacing.xs) {
                ForEach(DayOfWeek.allCases) { day in
                    availabilityCell(day)
                }
            }

            // Legend — prevents the "what do the dots mean?" confusion.
            HStack(spacing: HUSpacing.lg) {
                legendItem(filled: true, text: "Available")
                legendItem(filled: false, text: "Unavailable")
                Spacer()
            }
            .padding(.top, 2)

            if !isPreview {
                Button {
                    HUHaptic.impact(.light)
                    bookingContext = BookingContext(service: nil)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Prenota")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(HUColor.primary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(HUColor.primaryLight.opacity(0.7))
                    .clipShape(Capsule())
                }
                .buttonStyle(HUPressButtonStyle())
                .padding(.top, HUSpacing.xs)
            }
        }
    }

    private func availabilityCell(_ day: DayOfWeek) -> some View {
        let hasSlots = !(therapist.availability.recurring[day]?.isEmpty ?? true)
        return VStack(spacing: 7) {
            Text(day.initial)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(hasSlots ? .white : HUColor.textTertiary)
            Circle()
                .fill(hasSlots ? Color.white.opacity(0.9) : HUColor.divider)
                .frame(width: 5, height: 5)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 58)
        .background {
            RoundedRectangle(cornerRadius: HURadius.lg, style: .continuous)
                .fill(hasSlots ? AnyShapeStyle(PrimaryGradient.linear) : AnyShapeStyle(HUColor.secondaryBackground))
                .shadow(color: hasSlots ? HUColor.primary.opacity(0.22) : .clear, radius: 6, y: 3)
        }
    }

    private func legendItem(filled: Bool, text: String) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(filled ? HUColor.success : Color.clear)
                .frame(width: 6, height: 6)
                .overlay {
                    if !filled {
                        Circle().strokeBorder(HUColor.textTertiary, lineWidth: 1)
                    }
                }
            Text(text)
                .font(.system(size: 11))
                .foregroundStyle(HUColor.textSecondary)
        }
    }

    // MARK: - Reviews

    private var reviewsSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            HStack {
                sectionTitle("\(therapist.displayName.split(separator: " ").first ?? "")\'s Reviews")
                Spacer()
                Menu {
                    ForEach(ReviewSortOption.allCases, id: \.self) { option in
                        Button(option.displayName) {
                            selectedReviewSort = option
                        }
                    }
                } label: {
                    HStack(spacing: 3) {
                        Text(selectedReviewSort.displayName)
                            .font(.system(size: 12, weight: .medium))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(HUColor.primary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(HUColor.primaryLight.opacity(0.6))
                    .clipShape(Capsule())
                }
            }

            ratingBreakdown

            VStack(spacing: HUSpacing.sm) {
                ForEach(reviews) { review in
                    ReviewCard(review: review)
                }
            }

            if reviewsLoadError && reviews.isEmpty {
                VStack(spacing: HUSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 32))
                        .foregroundStyle(HUColor.textTertiary)
                    Text("Couldn't load reviews")
                        .font(HUFont.subheadline())
                        .foregroundStyle(HUColor.textSecondary)
                    Button("Retry") {
                        HUHaptic.impact(.light)
                        Task { await loadReviews() }
                    }
                    .font(HUFont.caption(weight: .semibold))
                    .foregroundStyle(HUColor.primary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, HUSpacing.xl)
            } else if reviews.isEmpty {
                VStack(spacing: HUSpacing.sm) {
                    Image(systemName: "star.bubble")
                        .font(.system(size: 32))
                        .foregroundStyle(HUColor.textTertiary)
                    Text("No reviews yet")
                        .font(HUFont.subheadline())
                        .foregroundStyle(HUColor.textSecondary)
                    Text("Be the first to review after your session")
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textTertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, HUSpacing.xl)
            }
        }
    }

    private var ratingBreakdown: some View {
        // Below 5 reviews the 5-bar distribution chart is statistically
        // meaningless and visually embarrassing (4 empty bars). Show a
        // warmer "early praise" layout instead.
        let hasEnoughReviews = therapist.totalReviews >= 5

        return HStack(spacing: HUSpacing.xl) {
            VStack(spacing: 4) {
                Text(String(format: "%.1f", therapist.averageRating))
                    .font(HUFont.displayTitle(size: 44, weight: .bold))
                    .foregroundStyle(HUColor.textPrimary)
                HURatingStars(rating: therapist.averageRating, size: 12)
                Text("\(therapist.totalReviews) \(therapist.totalReviews == 1 ? "review" : "reviews")")
                    .font(.system(size: 11))
                    .foregroundStyle(HUColor.textSecondary)
            }

            if hasEnoughReviews {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(Array(stride(from: 5, through: 1, by: -1)), id: \.self) { star in
                        ratingBar(stars: star, percentage: ratingPercentage(for: star))
                    }
                }
            } else {
                // Early praise — friendlier than 4 empty bars.
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 12))
                            .foregroundStyle(HUColor.brandGold)
                        Text("Early praise")
                            .font(HUFont.displaySubtitle(size: 15, weight: .semiBold))
                            .foregroundStyle(HUColor.textPrimary)
                    }
                    Text(therapist.totalReviews == 0
                         ? "Be the first to leave a review after your session."
                         : "Few reviews yet — all of them glowing.")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .huProfileSurface()
    }

    private func ratingBar(stars: Int, percentage: Double) -> some View {
        HStack(spacing: 6) {
            Text("\(stars)")
                .font(.system(size: 11, weight: .medium))
                .frame(width: 10)
            Image(systemName: "star.fill")
                .font(.system(size: 8))
                .foregroundStyle(HUColor.starFilled)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(HUColor.divider)
                        .frame(height: 4)
                    Capsule()
                        .fill(PrimaryGradient.linear)
                        .frame(width: geo.size.width * percentage, height: 4)
                }
            }
            .frame(height: 4)
        }
    }

    // MARK: - Refund Policy

    private var cancellationPolicySection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            sectionTitle("Refund Policy")

            HStack(alignment: .top, spacing: HUSpacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: HURadius.md, style: .continuous)
                        .fill(HUColor.primaryLight)
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(HUColor.primary)
                }
                .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 4) {
                    Text(therapist.cancellationPolicy.displayName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    Text(therapist.cancellationPolicy.description)
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)
            }
            .huProfileSurface()
        }
    }

    // MARK: - Report / Block

    private var reportBlockSection: some View {
        VStack(spacing: HUSpacing.md) {
            Button {
                HUHaptic.selection()
                showReportSheet = true
            } label: {
                Label("Segnala questo operatore", systemImage: "flag")
                    .font(.system(size: 13))
                    .foregroundStyle(HUColor.textTertiary)
            }

            Button {
                HUHaptic.selection()
                showBlockConfirm = true
            } label: {
                Label("Blocca", systemImage: "hand.raised.slash")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(HUColor.error.opacity(0.85))
            }
            .disabled(isBlocking || didBlock)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, HUSpacing.sm)
        .padding(.bottom, HUSpacing.lg)
    }

    // MARK: - Helpers

    private func ratingPercentage(for stars: Int) -> Double {
        guard !reviews.isEmpty else {
            // No reviews loaded — show empty bars
            return 0
        }
        let count = reviews.filter { $0.rating == stars }.count
        return Double(count) / Double(reviews.count)
    }

    /// Editorial section title (Fraunces serif) with a small berry
    /// accent bar. Drop-in compatible with all existing call sites —
    /// same one-string signature.
    private func sectionTitle(_ title: String) -> some View {
        HStack(spacing: HUSpacing.sm) {
            Capsule()
                .fill(PrimaryGradient.linear)
                .frame(width: 4, height: 18)
            Text(title)
                .font(HUFont.displayHeadline(size: 21, weight: .semiBold))
                .foregroundStyle(HUColor.textPrimary)
        }
    }

    // MARK: - Preview Data

    #if DEBUG
    static func previewReviews(for therapistId: String) -> [Review] {
        [
            Review(
                id: "r1",
                bookingId: "b1",
                clientId: "c1",
                therapistId: therapistId,
                clientName: "Anna P.",
                rating: 5,
                text: "An incredible experience. I felt completely at ease from the moment the session began. The energy work was deeply calming and I noticed a real shift in my wellbeing over the following days. Highly recommend!",
                therapistReply: "Thank you Anna! It was a pleasure working with you. Looking forward to our next session.",
                therapistReplyDate: Calendar.current.date(byAdding: .day, value: -3, to: Date()),
                isFlagged: false,
                createdAt: Calendar.current.date(byAdding: .day, value: -5, to: Date()) ?? Date()
            ),
            Review(
                id: "r2",
                bookingId: "b2",
                clientId: "c2",
                therapistId: therapistId,
                clientName: "Marco D.",
                rating: 5,
                text: "I was skeptical at first, but after my sound healing session I felt a deep sense of peace I haven't experienced in years. The therapist was professional, caring, and very knowledgeable.",
                isFlagged: false,
                createdAt: Calendar.current.date(byAdding: .day, value: -12, to: Date()) ?? Date()
            ),
            Review(
                id: "r3",
                bookingId: "b3",
                clientId: "c3",
                therapistId: therapistId,
                clientName: "Elena S.",
                rating: 4,
                text: "Great session overall. Very calming environment and skilled practitioner. Would have loved a slightly longer session but the results were noticeable.",
                isFlagged: false,
                createdAt: Calendar.current.date(byAdding: .day, value: -20, to: Date()) ?? Date()
            )
        ]
    }
    #endif
}

// MARK: - Profile Card Surface

fileprivate extension View {
    /// Unified soft card surface used across the profile: rounded
    /// continuous corners, secondary fill, and a hairline berry stroke
    /// for gentle depth. One modifier keeps every card consistent.
    func huProfileSurface(padding: CGFloat = HUSpacing.lg) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: HURadius.xxl, style: .continuous)
                    .strokeBorder(HUColor.primary.opacity(0.05), lineWidth: 1)
            )
    }
}

// MARK: - Review Card

struct ReviewCard: View {
    let review: Review

    var body: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            HStack(spacing: 10) {
                HUAvatar(url: review.clientPhotoURL, name: review.clientName, size: 38)

                VStack(alignment: .leading, spacing: 2) {
                    Text(review.clientName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    HStack(spacing: 6) {
                        HURatingStars(rating: Double(review.rating), size: 10)
                        Text(review.formattedDate)
                            .font(.system(size: 10))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                }

                Spacer(minLength: 0)
            }

            if let text = review.text {
                Text(text)
                    .font(.system(size: 13))
                    .foregroundStyle(HUColor.textSecondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let reply = review.therapistReply {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 5) {
                        Image(systemName: "arrowshape.turn.up.left.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(HUColor.primary)
                        Text("Therapist Reply")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(HUColor.primary)
                    }
                    Text(reply)
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(HUSpacing.md)
                .background(HUColor.primaryLight.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: HURadius.md, style: .continuous))
            }
        }
        .huProfileSurface()
    }
}

// MARK: - Direct video sheet (AVKit)

/// Full-screen AVKit player for direct video files (mp4/mov) hosted
/// outside YouTube/Vimeo — e.g. an MP4 uploaded to Supabase Storage.
/// Previously the app rendered a static play icon with no tap handler
/// for these URLs, so direct-uploaded therapist videos were
/// unplayable.
private struct DirectVideoSheet: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        NavigationStack {
            Group {
                if let player {
                    VideoPlayer(player: player)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    Color.black
                        .overlay(ProgressView().tint(.white))
                        .ignoresSafeArea()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fine") { dismiss() }
                }
            }
        }
        .task {
            // Construct the player lazily so we don't autoplay
            // before the sheet has appeared (avoids audio glitches
            // when the user dismisses immediately).
            let p = AVPlayer(url: url)
            p.actionAtItemEnd = .pause
            player = p
            p.play()
        }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }
}

#Preview {
    NavigationStack {
        TherapistProfileView(therapist: MockData.therapists[0])
    }
    .environment(AuthManager(authRepository: MockAuthRepository()))
}
