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
                
                VStack(alignment: .leading, spacing: HUSpacing.xxl) {
                    // MARK: - Preview Banner
                    if isPreview {
                        HStack(spacing: 8) {
                            Image(systemName: "eye.fill")
                                .font(.system(size: 14))
                            Text("This is how clients see your profile")
                                .font(.system(size: 13, weight: .medium))
                        }
                        .foregroundStyle(HUColor.primary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(HUColor.primaryLight)
                        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                    }
                    
                    // MARK: - Book CTA
                    if !isPreview {
                        bookingCTA
                    }
                    
                    // MARK: - About Me
                    aboutSection
                    
                    // MARK: - My Type of Therapy
                    therapyTypesSection
                    
                    // MARK: - Services & Pricing
                    servicesSection
                    
                    // MARK: - Certifications
                    certificationsSection
                    
                    // MARK: - Presentation Video
                    videoSection
                    
                    // MARK: - Gallery
                    if !therapist.galleryImageURLs.isEmpty {
                        gallerySection
                    }
                    
                    // MARK: - Availability Preview
                    availabilitySection
                    
                    // MARK: - Reviews
                    reviewsSection
                    
                    // MARK: - Refund Policy
                    cancellationPolicySection
                    
                    // Report + Block (Guideline 1.2 — fully wired
                    // to ReportService.shared as of 2026-05-18, was
                    // previously a local-state stub).
                    if !isPreview {
                        VStack(spacing: HUSpacing.sm) {
                            Button {
                                HUHaptic.selection()
                                showReportSheet = true
                            } label: {
                                Label("Segnala questo operatore", systemImage: "flag")
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.textTertiary)
                            }

                            Button {
                                HUHaptic.selection()
                                showBlockConfirm = true
                            } label: {
                                Label("Blocca", systemImage: "hand.raised.slash")
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.error.opacity(0.85))
                            }
                            .disabled(isBlocking || didBlock)
                        }
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.bottom, HUSpacing.massive)
                    }
                }
                .padding(.horizontal, HUSpacing.xl)
            }
        }
        .background(HUColor.background)
        .ignoresSafeArea(edges: .top)
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
    
    // MARK: - Hero
    
    /// Editorial hero (painted edition 2026-05-16).
    /// Centered painted portrait with verified pin, Fraunces serif
    /// name, role caption, and meta row (loc · years · stars).
    private var heroSection: some View {
        VStack(spacing: 0) {
            // Cream top band — replaces the old illustration banner.
            // The banner cropped the painted asset awkwardly, and the
            // overlapping photo created a busy top edge. Cream + halo
            // matches the design's "spacious editorial" feel.
            ZStack {
                LinearGradient(
                    colors: [HUColor.brandCream, HUColor.background],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 96)

                // Soft category-tinted radial halo behind the portrait.
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                (therapist.categories.first?.color ?? HUColor.primary).opacity(0.22),
                                .clear
                            ],
                            center: .center,
                            startRadius: 6,
                            endRadius: 140
                        )
                    )
                    .frame(width: 260, height: 260)
                    .offset(y: 30)
            }
            .frame(height: 96)
            .frame(maxWidth: .infinity)

            VStack(spacing: 14) {
                // Centered painted portrait (140pt) with verified pin.
                ZStack(alignment: .bottomTrailing) {
                    Group {
                        if let photoURL = therapist.photoURL {
                            AsyncImage(url: photoURL.supabaseThumbnail(size: 140)) { phase in
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
                            .frame(width: 140, height: 140)
                            .clipShape(Circle())
                        } else {
                            profileInitialsCircle
                                .frame(width: 140, height: 140)
                        }
                    }
                    .overlay(
                        Circle().strokeBorder(HUColor.background, lineWidth: 5)
                    )
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
                        .offset(x: -4, y: -4)
                    }
                }
                .overlay(alignment: .topLeading) {
                    if let tier = therapist.tier {
                        TierBadge(tier: tier, size: 56)
                            .offset(x: -8, y: -8)
                    }
                }
                .offset(y: -56)
                .padding(.bottom, -56)

                // Serif name (Fraunces) + role caption + meta.
                VStack(spacing: 8) {
                    if let tier = therapist.tier {
                        TierPill(tier: tier)
                    }

                    Text(therapist.displayName)
                        .font(HUFont.displayHeadline(size: 26, weight: .semiBold))
                        .foregroundStyle(HUColor.textPrimary)
                        .multilineTextAlignment(.center)

                    Text(therapist.tagline)
                        .font(.system(size: 13))
                        .foregroundStyle(HUColor.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, HUSpacing.xl)

                    // Meta row — separated by thin dividers, matches
                    // design's "loc · 8 anni · ★ 4.9 (124)" layout.
                    HStack(spacing: 10) {
                        if let location = therapist.location {
                            HStack(spacing: 4) {
                                Image(systemName: "mappin.circle.fill")
                                    .font(.system(size: 11))
                                    .foregroundStyle(HUColor.brandMagenta)
                                Text(location.city.isEmpty ? location.country : location.city)
                                    .font(.system(size: 12))
                                    .foregroundStyle(HUColor.textSecondary)
                            }
                            metaDivider
                        }
                        Text("\(therapist.yearsExperience) anni esp.")
                            .font(.system(size: 12))
                            .foregroundStyle(HUColor.textSecondary)
                        metaDivider
                        HStack(spacing: 4) {
                            Image(systemName: "star.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(HUColor.brandGold)
                            Text(String(format: "%.1f", therapist.averageRating))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(HUColor.textPrimary)
                            Text("(\(therapist.totalReviews))")
                                .font(.system(size: 11))
                                .foregroundStyle(HUColor.textTertiary)
                        }
                    }
                    .padding(.top, 2)
                }

                // Editorial pull-quote — uses the therapist's tagline
                // verbatim in serif italic. Replaces the redundant
                // "Book a Time for your session" header on the CTA.
                if !therapist.tagline.isEmpty {
                    Text("\u{201C}\(therapist.tagline)\u{201D}")
                        .font(.custom("Fraunces72pt-Italic", size: 18))
                        .foregroundStyle(HUColor.primary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .padding(.horizontal, HUSpacing.xl)
                        .padding(.top, HUSpacing.md)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, HUSpacing.xl)
        }
    }

    /// Thin vertical dot used between meta items in the hero row.
    private var metaDivider: some View {
        Circle()
            .fill(HUColor.divider)
            .frame(width: 3, height: 3)
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
                .frame(width: 100, height: 100)
            
            Text(therapistInitials)
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(HUColor.primaryDark)
        }
    }
    
    // MARK: - Book CTA
    
    /// Editorial CTA — full-width berry "Prenota sessione" pill paired
    /// with a circular chat icon. Mirrors the design's inline pair
    /// (no wrapping card, no redundant header) so the screen breathes.
    private var bookingCTA: some View {
        HStack(spacing: 10) {
            Button {
                HUHaptic.impact(.light)
                bookingContext = BookingContext(service: nil)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 14, weight: .semibold))
                    Text("Prenota sessione")
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(PrimaryGradient.linear)
                .clipShape(Capsule())
                .shadow(color: HUColor.primary.opacity(0.25), radius: 14, y: 6)
            }
            .buttonStyle(HUPressButtonStyle())

            Button {
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
            } label: {
                ZStack {
                    Circle()
                        .fill(HUColor.background)
                        .frame(width: 52, height: 52)
                        .overlay(
                            Circle().strokeBorder(HUColor.brandMagenta.opacity(0.25), lineWidth: 1)
                        )
                    if isLoadingChat {
                        ProgressView()
                            .controlSize(.small)
                            .tint(HUColor.brandMagenta)
                    } else {
                        Image(systemName: "bubble.left.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(HUColor.brandMagenta)
                    }
                }
            }
            .accessibilityLabel("Invia un messaggio a \(therapist.displayName)")
            .disabled(isLoadingChat)
        }
    }
    
    // MARK: - About
    
    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("A Little Bit About Me")
            
            Text(therapist.bio)
                .font(.system(size: 14))
                .foregroundStyle(HUColor.textSecondary)
                .lineSpacing(5)
            
            if !therapist.languages.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "globe")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.primary)
                    Text("Speaks: \(therapist.languages.joined(separator: ", "))")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                }
            }
        }
    }
    
    // MARK: - Therapy Types
    
    private var therapyTypesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("My Type of Therapy")
            
            FlowLayout(spacing: 8) {
                ForEach(therapist.categories) { category in
                    HStack(spacing: 5) {
                        Image(systemName: category.icon)
                            .font(.system(size: 12))
                        Text(category.displayName)
                            .font(.system(size: 13, weight: .medium))
                    }
                    .foregroundStyle(HUColor.primary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(HUColor.primaryLight)
                    .clipShape(Capsule())
                }
            }
        }
    }
    
    // MARK: - Services
    
    private var servicesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Services & Pricing")
            
            ForEach(therapist.services) { service in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        // Title row: name + FREE badge + category pill
                        HStack(spacing: 6) {
                            Text(service.name)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(HUColor.textPrimary)
                            if service.isIntroCall {
                                Text("FREE")
                                    .font(.system(size: 9, weight: .bold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(HUColor.success.opacity(0.15))
                                    .foregroundStyle(HUColor.success)
                                    .clipShape(Capsule())
                            }
                            // Per-service category pill (GAP 6). Clarifies
                            // which modality this specific service is.
                            Text(service.category.displayName)
                                .font(.system(size: 9, weight: .semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(HUColor.primary.opacity(0.10))
                                .foregroundStyle(HUColor.primary)
                                .clipShape(Capsule())
                        }

                        // Description (GAP 5) — optional, truncated to 2 lines.
                        if !service.description.isEmpty {
                            Text(service.description)
                                .font(.system(size: 11))
                                .foregroundStyle(HUColor.textSecondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }

                        // Meta row: duration (all sessions are virtual — V1 platform default)
                        HStack(spacing: 8) {
                            Image(systemName: "video.fill")
                                .font(.system(size: 9))
                            Text("\(service.duration) min")
                        }
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textSecondary)

                        // Pack info
                        if let packSize = service.packSize, let packPrice = service.packPrice {
                            HStack(spacing: 4) {
                                Image(systemName: "tag.fill")
                                    .font(.system(size: 9))
                                Text("Pack of \(packSize): \(therapist.currency.symbol)\(Int(packPrice))/session")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .foregroundStyle(HUColor.primary)
                        }
                    }
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 6) {
                        if service.isIntroCall {
                            Text("Free")
                                .font(.custom("Fraunces72pt-SemiBold", size: 20))
                                .foregroundStyle(HUColor.success)
                        } else {
                            Text("\(therapist.currency.symbol)\(Int(service.price))")
                                .font(.custom("Fraunces72pt-SemiBold", size: 22))
                                .foregroundStyle(HUColor.primary)
                        }
                        
                        if !isPreview {
                            Button {
                                // Pre-select this specific service so the flow
                                // skips the redundant "Choose a Service" step.
                                // BookingContext is Identifiable, so .sheet(item:)
                                // always builds BookingFlowView with the correct
                                // service on first presentation.
                                bookingContext = BookingContext(service: service)
                            } label: {
                                Text(service.isIntroCall ? "Schedule" : "Book")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 5)
                                    .background(service.isIntroCall ? HUColor.success : HUColor.primary)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
                .padding(14)
                .background(HUColor.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            }
        }
    }
    
    // MARK: - Certifications
    
    private var certificationsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("My Certifications")
            
            ForEach(therapist.certifications) { cert in
                HStack(spacing: 12) {
                    Image(systemName: "doc.text.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(HUColor.primary)
                        .frame(width: 40, height: 40)
                        .background(HUColor.primaryLight)
                        .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
                    
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(cert.name)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(HUColor.textPrimary)
                            if cert.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 11))
                                    .foregroundStyle(HUColor.primary)
                            }
                        }
                        Text(cert.issuingOrganization)
                            .font(.system(size: 11))
                            .foregroundStyle(HUColor.textSecondary)
                        Text("Obtained \(cert.yearString)")
                            .font(.system(size: 11))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                    
                    Spacer()
                }
                .padding(12)
                .background(HUColor.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
            }
        }
    }
    
    // MARK: - Video
    
    private var videoSection: some View {
        VStack(alignment: .leading, spacing: 10) {
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

        // `youtube-nocookie.com` is YouTube's privacy-enhanced embed
        // domain. We prefer it over `youtube.com` because (a) no
        // cookies are written to the WebView storage, reducing
        // cross-domain leakage, and (b) it carries the same content
        // with an explicit "no tracking" surface in Privacy Manifest
        // conversations with Apple Review.
        func ytEmbed(_ id: String) -> URL? {
            guard Self.isValidYouTubeID(id) else { return nil }
            return URL(string: "https://www.youtube-nocookie.com/embed/\(id)?playsinline=1&rel=0&modestbranding=1")
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
    /// Mirrors `YouTubeShortsWebView.isValidYouTubeID` (single source
    /// of truth would be nicer; kept duplicated to avoid coupling the
    /// view to the design-system component).
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
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Gallery")
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(therapist.galleryImageURLs, id: \.absoluteString) { url in
                        AsyncImage(url: url.supabaseThumbnail(size: 160)) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 160, height: 120)
                                    .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                            case .failure:
                                RoundedRectangle(cornerRadius: HURadius.lg)
                                    .fill(HUColor.secondaryBackground)
                                    .frame(width: 160, height: 120)
                                    .overlay {
                                        Image(systemName: "photo")
                                            .font(.system(size: 24))
                                            .foregroundStyle(HUColor.textTertiary)
                                    }
                            case .empty:
                                RoundedRectangle(cornerRadius: HURadius.lg)
                                    .fill(HUColor.secondaryBackground)
                                    .frame(width: 160, height: 120)
                                    .overlay { ProgressView().tint(HUColor.primary) }
                            @unknown default:
                                EmptyView()
                            }
                        }
                    }
                }
            }
        }
    }
    
    // MARK: - Availability Preview
    
    private var availabilitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Availability This Week")

            HStack(spacing: 4) {
                ForEach(DayOfWeek.allCases) { day in
                    let hasSlots = !(therapist.availability.recurring[day]?.isEmpty ?? true)
                    VStack(spacing: 4) {
                        Text(day.initial)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(hasSlots ? .white : HUColor.textTertiary)

                        Circle()
                            .fill(hasSlots ? HUColor.success : Color.clear)
                            .frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(hasSlots ? HUColor.primary : HUColor.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
                }
            }

            // Legend — prevents the "what do the dots mean?" confusion.
            HStack(spacing: 10) {
                HStack(spacing: 4) {
                    Circle().fill(HUColor.success).frame(width: 5, height: 5)
                    Text("Available")
                }
                HStack(spacing: 4) {
                    Circle()
                        .strokeBorder(HUColor.textTertiary, lineWidth: 0.5)
                        .frame(width: 5, height: 5)
                    Text("Unavailable")
                }
                Spacer()
            }
            .font(.system(size: 10))
            .foregroundStyle(HUColor.textSecondary)
            .padding(.top, 2)

            if !isPreview {
                Button {
                    bookingContext = BookingContext(service: nil)
                } label: {
                    Text("Prenota")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(HUColor.primary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 38)
                        .background(HUColor.primaryLight)
                        .clipShape(Capsule())
                }
            }
        }
    }
    
    // MARK: - Reviews
    
    private var reviewsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
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
                            .font(.system(size: 11, weight: .medium))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9))
                    }
                    .foregroundStyle(HUColor.primary)
                }
            }
            
            ratingBreakdown
            
            ForEach(reviews) { review in
                ReviewCard(review: review)
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

        return HStack(spacing: 20) {
            VStack(spacing: 4) {
                Text(String(format: "%.1f", therapist.averageRating))
                    .font(HUFont.displayTitle(size: 42, weight: .bold))
                    .foregroundStyle(HUColor.textPrimary)
                HURatingStars(rating: therapist.averageRating, size: 12)
                Text("\(therapist.totalReviews) \(therapist.totalReviews == 1 ? "review" : "reviews")")
                    .font(.system(size: 11))
                    .foregroundStyle(HUColor.textSecondary)
            }

            if hasEnoughReviews {
                VStack(alignment: .leading, spacing: 4) {
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
                            .foregroundStyle(HUColor.primary)
                        Text("Early praise")
                            .font(HUFont.displaySubtitle(size: 14, weight: .semiBold))
                            .foregroundStyle(HUColor.textPrimary)
                    }
                    Text(therapist.totalReviews == 0
                         ? "Be the first to leave a review after your session."
                         : "Few reviews yet — all of them glowing.")
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
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
                    RoundedRectangle(cornerRadius: 2)
                        .fill(HUColor.divider)
                        .frame(height: 3)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(HUColor.primary)
                        .frame(width: geo.size.width * percentage, height: 3)
                }
            }
            .frame(height: 3)
        }
    }
    
    // MARK: - Refund Policy
    
    private var cancellationPolicySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Refund Policy")
            
            HStack(spacing: 10) {
                Image(systemName: "info.circle")
                    .font(.system(size: 16))
                    .foregroundStyle(HUColor.primary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(therapist.cancellationPolicy.displayName)
                        .font(.system(size: 13, weight: .semibold))
                    Text(therapist.cancellationPolicy.description)
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textSecondary)
                }
            }
            .padding(12)
            .background(HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        }
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
    
    /// Editorial section title (Fraunces serif). Drop-in compatible
    /// with all existing call sites — same one-string signature.
    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(HUFont.displayHeadline(size: 20, weight: .semiBold))
            .foregroundStyle(HUColor.textPrimary)
    }

    /// Brand-aware section title with gold uppercase eyebrow above
    /// (used for newly-added editorial sections — leave the existing
    /// `sectionTitle(_:)` untouched so we don't have to retouch every
    /// callsite).
    @ViewBuilder
    private func editorialTitle(eyebrow: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow.uppercased())
                .font(.system(size: 11, weight: .bold))
                .tracking(2.0)
                .foregroundStyle(HUColor.brandGold)
            Text(title)
                .font(HUFont.displayHeadline(size: 20, weight: .semiBold))
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

// MARK: - Review Card

struct ReviewCard: View {
    let review: Review
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                HUAvatar(url: review.clientPhotoURL, name: review.clientName, size: 36)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(review.clientName)
                        .font(.system(size: 13, weight: .medium))
                    HStack(spacing: 6) {
                        HURatingStars(rating: Double(review.rating), size: 10)
                        Text(review.formattedDate)
                            .font(.system(size: 10))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                }
            }
            
            if let text = review.text {
                Text(text)
                    .font(.system(size: 13))
                    .foregroundStyle(HUColor.textSecondary)
                    .lineSpacing(3)
            }
            
            if let reply = review.therapistReply {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Therapist Reply")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(HUColor.primary)
                    Text(reply)
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textSecondary)
                }
                .padding(10)
                .background(HUColor.primaryLight.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
            }
        }
        .padding(14)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
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
