import SwiftUI
import StreamChat
import StreamChatSwiftUI
import os.log

/// Module-scoped logger for client-side dashboard issues. Replaces the
/// previous `print()` calls so failures land in the unified iOS log
/// (visible via `xcrun simctl spawn booted log show` or Console.app)
/// with subsystem filtering, category routing, and `privacy: .public`
/// redaction for anything that might contain user identifiers.
private let clientHomeLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "com.holisticunity.app",
    category: "ClientHome"
)

struct ClientTabView: View {
    @State private var selectedTab: ClientTab = .home
    @State private var exploreCategoryFilter: TherapyCategory?
    @StateObject private var streamService = StreamChatService.shared
    private var notificationManager = NotificationManager.shared
    private var appState: AppState { DIContainer.shared.appState }
    
    enum ClientTab: String {
        case home, explore, bookings, chat, profile
        
        var title: String {
            switch self {
            case .home:     return String(localized: "Home", comment: "Client tab: home")
            case .explore:  return String(localized: "Explore", comment: "Client tab: explore")
            case .bookings: return String(localized: "Bookings", comment: "Client tab: bookings")
            case .chat:     return String(localized: "Messages", comment: "Client tab: messages")
            case .profile:  return String(localized: "Profile", comment: "Client tab: profile")
            }
        }
        
        var icon: String {
            switch self {
            case .home: return "house.fill"
            case .explore: return "magnifyingglass"
            case .bookings: return "calendar"
            case .chat: return "bubble.left.and.bubble.right"
            case .profile: return "person.circle"
            }
        }
    }
    
    var body: some View {
        TabView(selection: $selectedTab) {
            ClientHomeView(onNavigateToExplore: { category in
                exploreCategoryFilter = category
                selectedTab = .explore
            })
                .tabItem { Label(ClientTab.home.title, systemImage: ClientTab.home.icon) }
                .tag(ClientTab.home)
                .badge(notificationManager.unreadCount)
            
            AllTherapistsView(initialCategory: exploreCategoryFilter)
                .tabItem { Label(ClientTab.explore.title, systemImage: ClientTab.explore.icon) }
                .tag(ClientTab.explore)
            
            ClientBookingsView()
                .tabItem { Label(ClientTab.bookings.title, systemImage: ClientTab.bookings.icon) }
                .tag(ClientTab.bookings)
            
            StreamChannelListView()
                .tabItem { Label(ClientTab.chat.title, systemImage: ClientTab.chat.icon) }
                .tag(ClientTab.chat)
                .badge(streamService.totalUnreadCount)
            
            SettingsView()
                .tabItem { Label(ClientTab.profile.title, systemImage: ClientTab.profile.icon) }
                .tag(ClientTab.profile)
        }
        .tint(HUColor.primary)
        .onAppear {
            // Cold-start measurement end (task #167): the home is on screen.
            // Idempotent — only the first launch's render is recorded.
            LaunchMetrics.markHomeRendered()
        }
        .onChange(of: selectedTab) { _, newTab in
            HUHaptic.selection()
            if newTab != .explore {
                exploreCategoryFilter = nil
            }
        }
        .onChange(of: appState.pendingDeepLink) { _, deepLink in
            guard let deepLink else { return }
            switch deepLink {
            case .booking:
                selectedTab = .bookings
            case .chat:
                selectedTab = .chat
            }
            // Clear after handling so it doesn't fire again
            appState.pendingDeepLink = nil
        }
    }
}

// MARK: - Client Home View (matches design: greeting, next session, discover, categories)

struct ClientHomeView: View {
    var onNavigateToExplore: (TherapyCategory?) -> Void = { _ in }
    @Environment(AuthManager.self) private var authManager
    @State private var navigateToTherapist: TherapistProfile?
    @State private var upcomingBookings: [Booking] = []
    @State private var featuredTherapists: [TherapistProfile] = []
    @State private var bookedTherapists: [String: TherapistProfile] = [:]
    @State private var isLoading = true
    @State private var activeVideoCall: VideoCallInfo?
    @State private var interruptedSession: (roomName: String, participantName: String, bookingId: String)?
    @State private var activeCredits: [SessionCredit] = []

    @State private var messageChannelController: ChatChannelController?
    @State private var showMessageSheet = false
    @State private var isLoadingMessage = false
    @State private var messageError: String?
    @State private var manageBookingItem: ManageBookingItem?
    @State private var loadError: String?
    
    private struct ManageBookingItem: Identifiable {
        let id = UUID()
        let booking: Booking
        let therapist: TherapistProfile?
    }
    
    private struct VideoCallInfo: Identifiable {
        let id = UUID()
        let roomName: String
        let participantName: String
        var bookingId: String = ""
    }
    
    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: HUSpacing.xl) {
                    // SR-01: Session recovery banner
                    if let session = interruptedSession {
                        SessionRecoveryBanner(
                            roomName: session.roomName,
                            participantName: session.participantName,
                            bookingId: session.bookingId,
                            onRejoin: {
                                activeVideoCall = VideoCallInfo(
                                    roomName: session.roomName,
                                    participantName: session.participantName,
                                    bookingId: session.bookingId
                                )
                                interruptedSession = nil
                            },
                            onDismiss: {
                                VideoCallService.dismissInterruptedSession()
                                interruptedSession = nil
                            }
                        )
                    }
                    
                    // Error Banner
                    if let loadError {
                        HStack(spacing: HUSpacing.sm) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(HUColor.error)
                            Text(loadError)
                                .font(HUFont.caption())
                                .foregroundStyle(HUColor.error)
                            Spacer()
                            Button("Retry") {
                                HUHaptic.impact(.light)
                                self.loadError = nil
                                Task { await loadData() }
                            }
                            .font(HUFont.caption(weight: .semibold))
                            .foregroundStyle(HUColor.primary)
                        }
                        .padding(HUSpacing.md)
                        .background(HUColor.error.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
                        .padding(.horizontal, HUSpacing.xl)
                    }
                    
                    // MARK: - Header / Greeting
                    headerSection

                    // MARK: - Next session (gradient card or empty state)
                    upcomingSessionSection

                    // MARK: - Session Credits
                    if !activeCredits.isEmpty {
                        sessionCreditsSection
                    }

                    // MARK: - Suggested therapists (Per te)
                    certifiedTherapistsSection

                    // MARK: - Discover practices (horizontal painted)
                    categoriesSection

                    // MARK: - Pull-quote closer
                    pullQuoteSection
                }
                .padding(.bottom, HUSpacing.xxl)
            }
            .background(HUColor.background)
            .navigationDestination(item: $navigateToTherapist) { therapist in
                TherapistProfileView(therapist: therapist)
            }
            .task {
                await loadData()
                // SR-01: Check for interrupted sessions on launch
                if let session = VideoCallService.interruptedSessionInfo() {
                    interruptedSession = session
                }
            }
            .refreshable {
                await loadData()
            }
            .fullScreenCover(item: $activeVideoCall, onDismiss: {
                interruptedSession = VideoCallService.interruptedSessionInfo()
            }) { call in
                VideoCallView(roomName: call.roomName, participantName: call.participantName, bookingId: call.bookingId)
            }
            .sheet(isPresented: $showMessageSheet) {
                if let controller = messageChannelController {
                    NavigationStack {
                        ChatChannelView(
                            viewFactory: HUChatViewFactory.shared,
                            channelController: controller
                        )
                    }
                }
            }
            .sheet(item: $manageBookingItem, onDismiss: {
                Task { await loadData() }
            }) { item in
                ManageBookingView(booking: item.booking, therapist: item.therapist)
            }
            .alert("Message Error", isPresented: Binding(
                get: { messageError != nil },
                set: { if !$0 { messageError = nil } }
            )) {
                Button("OK") { messageError = nil }
            } message: {
                Text(messageError ?? "")
            }
        }
    }
    
    private func loadData() async {
        guard let userId = authManager.currentUser?.id, !userId.isEmpty else {
            // Not authenticated yet — skip the load silently
            isLoading = false
            return
        }
        loadError = nil

        // Run all three queries concurrently but independently so that one
        // failure does not wipe out the other sections.
        async let bookingsResult: Result<[Booking], Error> = {
            do { return .success(try await DIContainer.shared.bookingRepository.getUpcomingBookings(userId: userId, role: .client)) }
            catch { return .failure(error) }
        }()
        async let therapistsResult: Result<[TherapistProfile], Error> = {
            do { return .success(try await DIContainer.shared.therapistRepository.getFeaturedTherapists()) }
            catch { return .failure(error) }
        }()
        async let creditsResult: Result<[SessionCredit], Error> = {
            do { return .success(try await DIContainer.shared.sessionCreditRepository.getCredits(clientId: userId)) }
            catch { return .failure(error) }
        }()

        let bookings = await bookingsResult
        let therapists = await therapistsResult
        let credits = await creditsResult

        // Apply results — log individual failures but only show the error
        // banner if the user-critical queries (bookings) fail.
        switch bookings {
        case .success(let value):
            upcomingBookings = value
        case .failure(let error):
            clientHomeLogger.error("bookings load failed: \(error.localizedDescription, privacy: .public)")
            loadError = "Couldn't load your dashboard. Check your connection."
            upcomingBookings = []
        }

        switch therapists {
        case .success(let value):
            featuredTherapists = value.shuffled()
        case .failure(let error):
            clientHomeLogger.error("featured therapists load failed: \(error.localizedDescription, privacy: .public)")
            featuredTherapists = []
            // Only show the banner if bookings also didn't set it
            if loadError == nil {
                loadError = "Couldn't load your dashboard. Check your connection."
            }
        }

        switch credits {
        case .success(let value):
            activeCredits = value.filter { $0.hasCredits }
        case .failure:
            activeCredits = []
        }
        
        // Load therapist profiles for booked sessions AND session credits concurrently
        let uniqueTherapistIds = Set(upcomingBookings.map(\.therapistId))
            .union(Set(activeCredits.map(\.therapistId)))
            .filter { bookedTherapists[$0] == nil }
        await withTaskGroup(of: (String, TherapistProfile?).self) { group in
            for therapistId in uniqueTherapistIds {
                group.addTask {
                    let profile = try? await DIContainer.shared.therapistRepository.getProfile(therapistId: therapistId)
                    return (therapistId, profile)
                }
            }
            for await (therapistId, profile) in group {
                if let profile {
                    bookedTherapists[therapistId] = profile
                }
            }
        }
        
        // Schedule local notification reminders using already-fetched profiles
        if await NotificationService.shared.isAuthorized() {
            let therapistNames = bookedTherapists.mapValues(\.displayName)
            NotificationService.shared.scheduleRemindersForUpcomingBookings(upcomingBookings, therapistNames: therapistNames)
        }
        
        isLoading = false
    }
    
    // MARK: - Header (painted edition 2026-05-16)
    //
    // Mirrors `client_app/screens-home.jsx` editorial header:
    //   • Gold eyebrow with localized weekday + date ("Buongiorno · gio 14 mag")
    //   • Serif greeting "Ciao, <name>." with italic accent on the name
    //   • Two circle buttons on the right (notifications + mini avatar)
    // Avoids any logo lockup on this surface — the brand is implicit.

    private var greetingFirstName: String {
        let name = (authManager.currentUser?.displayName ?? "")
            .trimmingCharacters(in: .whitespaces)
        let first = name.components(separatedBy: " ").first ?? ""
        return first.isEmpty ? String(localized: "Ospite", comment: "Home greeting fallback name") : first
    }

    /// "Buongiorno / Buon pomeriggio / Buonasera" + Italian short date.
    private var greetingEyebrow: String {
        let now = Date()
        let hour = Calendar.current.component(.hour, from: now)
        let timeKey: String
        if hour < 12 {
            timeKey = String(localized: "Buongiorno", comment: "Morning greeting")
        } else if hour < 18 {
            timeKey = String(localized: "Buon pomeriggio", comment: "Afternoon greeting")
        } else {
            timeKey = String(localized: "Buonasera", comment: "Evening greeting")
        }
        return "\(timeKey) · \(DateFormatter.italianWeekdayDayMonth.string(from: now))"
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.lg) {
            // ─────────────────────────────────────────────────────
            // Brand lockup row (restored 2026-05-16). Small logo +
            // wordmark on the left, notification bell + avatar on the
            // right. Sits ABOVE the editorial greeting so the user
            // always knows what app they're in — same affordance as
            // the original pre-redesign header.
            // ─────────────────────────────────────────────────────
            HStack(spacing: HUSpacing.sm) {
                Image("AppLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 30, height: 30)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Text("Holistic Unity")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(HUColor.primary)

                Spacer(minLength: 0)

                NavigationLink {
                    NotificationsView()
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "bell")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(HUColor.primary)
                            .frame(width: 38, height: 38)
                            .background(HUColor.background)
                            .overlay(
                                Circle().strokeBorder(HUColor.divider, lineWidth: 1)
                            )
                            .clipShape(Circle())
                        if notificationManager.unreadCount > 0 {
                            Circle()
                                .fill(HUColor.brandMagenta)
                                .frame(width: 8, height: 8)
                                .overlay(Circle().strokeBorder(HUColor.background, lineWidth: 2))
                                .offset(x: -2, y: 2)
                        }
                    }
                }

                // Avatar shortcut. We can't programmatically switch
                // tabs from inside the TabView child, so the avatar
                // acts as a passive identity marker.
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [HUColor.tilePink, HUColor.brandMagenta.opacity(0.15)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 38, height: 38)
                    Text(String(greetingFirstName.prefix(1)).uppercased())
                        .font(.custom("Fraunces72pt-SemiBold", size: 14))
                        .foregroundStyle(HUColor.primary)
                }
            }

            // ─────────────────────────────────────────────────────
            // Editorial greeting: gold eyebrow + serif "Ciao, name."
            // ─────────────────────────────────────────────────────
            VStack(alignment: .leading, spacing: HUSpacing.sm) {
                Text(greetingEyebrow.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2.0)
                    .foregroundStyle(HUColor.brandGold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)

                // Serif greeting: "Ciao, <name>." — name italic in berry.
                (
                    Text("Ciao, ")
                        .font(HUFont.displayTitle(size: 28, weight: .semiBold))
                        .foregroundColor(HUColor.textPrimary)
                    + Text(greetingFirstName + ".")
                        .font(.custom("Fraunces72pt-Italic", size: 28))
                        .foregroundColor(HUColor.primary)
                )
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            }
        }
        .padding(.horizontal, HUSpacing.xl)
        .padding(.top, HUSpacing.md)
    }

    /// Local push-notification badge surface — bound to the same
    /// `NotificationManager.shared` instance the TabBar reads. Kept as
    /// a reference here so the bell-dot reflects unread state.
    @MainActor
    private var notificationManager: NotificationManager { NotificationManager.shared }
    
    // MARK: - Upcoming Sessions
    
    private var upcomingSessionSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            if let nextBooking = upcomingBookings.first {
                let therapist = bookedTherapists[nextBooking.therapistId] ?? featuredTherapists.first { $0.id == nextBooking.therapistId }

                // Editorial context line — "Hai una sessione tra X
                // ore con <name>". Renders only when we have a
                // computable countdown; fades back to no line otherwise.
                if let countdownText = countdownContextLine(for: nextBooking, therapist: therapist) {
                    Text(countdownText)
                        .font(.system(size: 14))
                        .foregroundStyle(HUColor.textSecondary)
                        .padding(.horizontal, HUSpacing.xl)
                        .padding(.bottom, HUSpacing.xs)
                }

                ZStack(alignment: .topTrailing) {
                    Button {
                        if let therapist {
                            navigateToTherapist = therapist
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: HUSpacing.md) {
                            HStack(alignment: .center, spacing: 14) {
                                HUAvatar(
                                    url: therapist?.photoURL,
                                    name: therapist?.displayName ?? "T",
                                    size: 56
                                )

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(nextSessionEyebrow(for: nextBooking).uppercased())
                                        .font(.system(size: 10, weight: .bold))
                                        .tracking(2.0)
                                        .foregroundStyle(HUColor.brandGoldLight)
                                        .lineLimit(1)
                                    Text(nextBooking.serviceName)
                                        .font(.custom("Fraunces72pt-SemiBold", size: 20))
                                        .foregroundStyle(.white)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.85)
                                    Text("\(String(localized: "con", comment: "Home next session: 'with' connector")) \(therapist?.displayName ?? String(localized: "operatore", comment: "Therapist fallback"))")
                                        .font(.system(size: 12))
                                        .foregroundStyle(.white.opacity(0.78))
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(nextBooking.formattedTime)
                                        .font(.custom("Fraunces72pt-SemiBold", size: 26))
                                        .foregroundStyle(HUColor.brandGoldLight)
                                    Text(nextSessionShortDate(for: nextBooking).uppercased())
                                        .font(.system(size: 9, weight: .semibold))
                                        .tracking(1.5)
                                        .foregroundStyle(.white.opacity(0.7))
                                }
                            }
                            actionButtonStrip(for: nextBooking, therapist: therapist)
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity)
                        .background(PrimaryGradient.linear)
                        .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
                        .shadow(color: HUColor.primary.opacity(0.22), radius: 16, y: 8)
                    }
                    .buttonStyle(.plain)

                    // Decorative gold orb — matches design's
                    // editorial "halo on the corner" treatment.
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [HUColor.brandGoldLight.opacity(0.30), .clear],
                                center: .center,
                                startRadius: 6,
                                endRadius: 70
                            )
                        )
                        .frame(width: 140, height: 140)
                        .offset(x: 30, y: -30)
                        .allowsHitTesting(false)
                }
                .padding(.horizontal, HUSpacing.xl)
            } else {
                // Empty state — refined editorial layout with branded lotus
                // illustration, Fraunces title, and gradient CTA. Replaces
                // the previous armchair illustration / plain pill button.
                VStack(spacing: HUSpacing.lg) {
                    // Lotus illustration framed by a soft branded halo.
                    // The halo softens the cream-on-cream contrast of the
                    // raw asset and anchors it visually inside the card.
                    ZStack {
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        HUColor.primary.opacity(0.18),
                                        HUColor.primary.opacity(0.00),
                                    ],
                                    center: .center,
                                    startRadius: 6,
                                    endRadius: 90
                                )
                            )
                            .frame(width: 170, height: 170)
                        Image("empty_no_sessions")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 132, height: 132)
                    }

                    VStack(spacing: HUSpacing.xs) {
                        Text("Begin your journey")
                            .font(HUFont.displayHeadline(size: 22, weight: .semiBold))
                            .foregroundStyle(HUColor.textPrimary)
                            .multilineTextAlignment(.center)
                        Text("Connect with a practitioner who resonates with your intentions.")
                            .font(HUFont.body(weight: .regular))
                            .foregroundStyle(HUColor.textSecondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, HUSpacing.md)
                    }

                    Button {
                        HUHaptic.impact(.light)
                        onNavigateToExplore(nil)
                    } label: {
                        HStack(spacing: 8) {
                            Text("Find your practitioner")
                                .font(.system(size: 15, weight: .semibold))
                            Image(systemName: "arrow.right")
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 13)
                        .background(PrimaryGradient.linear)
                        .clipShape(Capsule())
                        .shadow(color: HUColor.primary.opacity(0.28), radius: 10, x: 0, y: 4)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, HUSpacing.xs)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, HUSpacing.xxl + 4)
                .padding(.horizontal, HUSpacing.lg)
                .background(
                    // Warm wash at top + neutral surface below — gives the
                    // card depth without competing with the lotus halo.
                    ZStack {
                        HUColor.secondaryBackground
                        LinearGradient(
                            colors: [
                                HUColor.primaryLight.opacity(0.55),
                                .clear,
                            ],
                            startPoint: .top,
                            endPoint: .center
                        )
                    }
                )
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
                .overlay(
                    RoundedRectangle(cornerRadius: HURadius.xxl)
                        .stroke(HUColor.primary.opacity(0.08), lineWidth: 1)
                )
                .padding(.horizontal, HUSpacing.xl)
            }
        }
    }
    
    // MARK: - Next-session helpers (extracted 2026-05-16)

    /// Compact eyebrow above the gradient card. "OGGI · TRA 6H 30M",
    /// "DOMANI · 15:30", or "GIO · 14 MAG" depending on proximity.
    private func nextSessionEyebrow(for booking: Booking) -> String {
        let now = Date()
        let scheduled = booking.scheduledAt
        let cal = Calendar.current
        let interval = scheduled.timeIntervalSince(now)
        if interval > 0 && interval < 24 * 3600 && cal.isDateInToday(scheduled) {
            // Same day, future — show countdown.
            let h = Int(interval / 3600)
            let m = Int((interval - Double(h) * 3600) / 60)
            if h > 0 {
                return String(localized: "Oggi · tra \(h)h \(m)m", comment: "Next session eyebrow: today + countdown")
            }
            return String(localized: "Oggi · tra \(m)m", comment: "Next session eyebrow: today + minutes")
        }
        if cal.isDateInTomorrow(scheduled) {
            return String(localized: "Domani · \(booking.formattedTime)", comment: "Next session eyebrow: tomorrow")
        }
        return DateFormatter.italianWeekdayDayMonth.string(from: scheduled)
    }

    /// Right-side stamp: "OGGI", "DOM", or "14 MAG".
    private func nextSessionShortDate(for booking: Booking) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(booking.scheduledAt) {
            return String(localized: "Oggi", comment: "Date stamp: today")
        }
        if cal.isDateInTomorrow(booking.scheduledAt) {
            return String(localized: "Domani", comment: "Date stamp: tomorrow")
        }
        return DateFormatter.italianDayMonth.string(from: booking.scheduledAt)
    }

    /// One-line context above the gradient card. Returns nil for
    /// far-future sessions where a countdown would be silly.
    private func countdownContextLine(for booking: Booking, therapist: TherapistProfile?) -> String? {
        let now = Date()
        let interval = booking.scheduledAt.timeIntervalSince(now)
        let firstName = therapist?.displayName.components(separatedBy: " ").first
            ?? String(localized: "il tuo operatore", comment: "Countdown line: therapist fallback")
        if interval <= 0 || interval > 48 * 3600 { return nil }
        if interval < 3600 {
            let m = max(1, Int(interval / 60))
            return String(localized: "Hai una sessione tra \(m) minuti con \(firstName).", comment: "Countdown context line — minutes")
        }
        let h = Int(interval / 3600)
        return String(localized: "Hai una sessione tra \(h) ore con \(firstName).", comment: "Countdown context line — hours")
    }

    /// Action buttons inside the gradient card. Extracted from the
    /// old monolithic upcomingSessionSection so the layout reads.
    @ViewBuilder
    private func actionButtonStrip(for nextBooking: Booking, therapist: TherapistProfile?) -> some View {
        HStack(spacing: 8) {
            // Primary on-card CTA — Join (when joinable) wins over
            // Message; otherwise message is primary.
            if nextBooking.canJoinVideoCall,
               let roomId = nextBooking.videoRoomId, !roomId.isEmpty {
                Button {
                    HUHaptic.impact(.medium)
                    activeVideoCall = VideoCallInfo(
                        roomName: roomId,
                        participantName: authManager.currentUser?.displayName ?? "Participant",
                        bookingId: nextBooking.id
                    )
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "video.fill").font(.system(size: 12))
                        Text("Entra nella sessione")
                            .font(.system(size: 12.5, weight: .bold))
                    }
                    .foregroundStyle(HUColor.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(.white)
                    .clipShape(Capsule())
                }
            } else {
                Button {
                    guard let therapist else { return }
                    Task {
                        isLoadingMessage = true
                        do {
                            let currentUserId = authManager.currentUser?.id ?? ""
                            let channelId = try await StreamChatService.shared.getOrCreateChannel(
                                currentUserId: currentUserId,
                                otherUserId: therapist.id
                            )
                            let controller = try await StreamChatService.shared.synchronizedController(for: channelId)
                            messageChannelController = controller
                            showMessageSheet = true
                        } catch {
                            messageError = error.localizedDescription
                        }
                        isLoadingMessage = false
                    }
                } label: {
                    HStack(spacing: 6) {
                        if isLoadingMessage {
                            ProgressView().controlSize(.mini).tint(HUColor.primary)
                        } else {
                            Image(systemName: "bubble.left.fill").font(.system(size: 11))
                        }
                        Text("Messaggio")
                            .font(.system(size: 12.5, weight: .bold))
                    }
                    .foregroundStyle(HUColor.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(.white)
                    .clipShape(Capsule())
                }
                .disabled(isLoadingMessage)
            }

            // Secondary: Sposta (or Reschedule Pending pill).
            if nextBooking.status == .reschedulePending {
                Text("In attesa di sposta")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.6))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.white.opacity(0.1))
                    .clipShape(Capsule())
            } else {
                Button {
                    HUHaptic.impact(.light)
                    manageBookingItem = ManageBookingItem(booking: nextBooking, therapist: therapist)
                } label: {
                    Text("Sposta")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.white.opacity(0.18))
                        .clipShape(Capsule())
                }
            }
        }
    }

    // MARK: - Categories (horizontal painted scroll, redesigned)
    //
    // Replaces the 2-col LazyVGrid with a horizontal painted-tile
    // scroll. Same data (TherapyCategory.allCases), same routing,
    // less visual weight on a screen that already has a hero card.

    private var categoriesSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            HStack(alignment: .lastTextBaseline) {
                Text("Scopri le pratiche")
                    .font(HUFont.displayHeadline(size: 19, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                Spacer()
                Button {
                    onNavigateToExplore(nil)
                } label: {
                    Text("Tutte ›")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(HUColor.brandMagenta)
                }
            }
            .padding(.horizontal, HUSpacing.xl)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(TherapyCategory.allCases) { category in
                        Button {
                            HUHaptic.impact(.light)
                            onNavigateToExplore(category)
                        } label: {
                            VStack(spacing: 6) {
                                if let illust = category.illustrationName {
                                    Image(illust)
                                        .resizable()
                                        .aspectRatio(contentMode: .fit)
                                        .frame(width: 84, height: 84)
                                } else {
                                    Image(systemName: category.icon)
                                        .font(.system(size: 26))
                                        .foregroundStyle(category.color)
                                        .frame(width: 84, height: 84)
                                }
                                Text(category.displayName)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(HUColor.textPrimary)
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.85)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(width: 100)
                            .padding(.vertical, 10)
                            .padding(.horizontal, 8)
                            .background(HUColor.brandCream)
                            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
                            .overlay(
                                RoundedRectangle(cornerRadius: HURadius.xl)
                                    .strokeBorder(HUColor.divider, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Esplora \(category.displayName)")
                    }
                }
                .padding(.horizontal, HUSpacing.xl)
            }
        }
    }

    // MARK: - Suggested therapists (editorial cards, "Per te")

    private var certifiedTherapistsSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            VStack(alignment: .leading, spacing: 4) {
                Text("PER TE")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2.0)
                    .foregroundStyle(HUColor.brandGold)
                (
                    Text("Operatori che ")
                        .font(HUFont.displayHeadline(size: 19, weight: .semiBold))
                        .foregroundColor(HUColor.textPrimary)
                    + Text("risuonano")
                        .font(.custom("Fraunces72pt-Italic", size: 19))
                        .foregroundColor(HUColor.primary)
                    + Text(" con te.")
                        .font(HUFont.displayHeadline(size: 19, weight: .semiBold))
                        .foregroundColor(HUColor.textPrimary)
                )
            }
            .padding(.horizontal, HUSpacing.xl)

            VStack(spacing: 10) {
                if isLoading {
                    SkeletonList(count: 3)
                } else {
                    ForEach(Array(featuredTherapists.prefix(3).enumerated()), id: \.element.id) { index, therapist in
                        EditorialTherapistCard(therapist: therapist) {
                            navigateToTherapist = therapist
                        }
                        .staggeredAppearance(index: index, isVisible: !isLoading)
                    }
                }
            }
            .padding(.horizontal, HUSpacing.xl)
        }
    }

    // MARK: - Pull quote footer (editorial closer)
    //
    // Closes the home with a brand-aligned moment: warm, grounded,
    // no spiritual hype, no medical claims. Two-line composition
    // with italic accent on the second clause — mirrors the design
    // system's signature soft-imperative + italicized-word pattern.

    private var pullQuoteSection: some View {
        VStack(spacing: HUSpacing.md) {
            // Gold trefoil — small ornamental break above the quote
            // so it reads as an editorial closer, not a generic card.
            HStack(spacing: 6) {
                Capsule()
                    .fill(HUColor.brandGold.opacity(0.5))
                    .frame(width: 18, height: 1)
                Image(systemName: "asterisk")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(HUColor.brandGold)
                Capsule()
                    .fill(HUColor.brandGold.opacity(0.5))
                    .frame(width: 18, height: 1)
            }

            // First line: regular serif, charcoal.
            Text("Non sei in ritardo.")
                .font(HUFont.displayHeadline(size: 22, weight: .semiBold))
                .foregroundStyle(HUColor.textPrimary)
                .multilineTextAlignment(.center)

            // Second line: italic Fraunces, italic word in berry.
            (
                Text("Sei esattamente ")
                    .font(.custom("Fraunces72pt-SemiBold", size: 22))
                    .foregroundColor(HUColor.textPrimary)
                + Text("dove devi essere")
                    .font(.custom("Fraunces72pt-Italic", size: 22))
                    .foregroundColor(HUColor.primary)
                + Text(".")
                    .font(.custom("Fraunces72pt-SemiBold", size: 22))
                    .foregroundColor(HUColor.textPrimary)
            )
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, HUSpacing.xxl)
        .padding(.horizontal, HUSpacing.xl)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [
                    HUColor.brandCream,
                    HUColor.tilePink.opacity(0.55)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xxxl))
        .padding(.horizontal, HUSpacing.xl)
    }

    // MARK: - Session Credits Section

    private var sessionCreditsSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            HStack {
                Text("Your Session Credits")
                    .font(HUFont.displayHeadline(size: 22, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                Spacer()
            }
            .padding(.horizontal, HUSpacing.xl)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HUSpacing.md) {
                    ForEach(activeCredits) { credit in
                        let therapistProfile = bookedTherapists[credit.therapistId]
                        SessionCreditCard(credit: credit, therapist: therapistProfile) {
                            if let profile = therapistProfile {
                                navigateToTherapist = profile
                            }
                        }
                    }
                }
                .padding(.horizontal, HUSpacing.xl)
                .padding(.vertical, HUSpacing.xs)
            }
        }
    }
}

// MARK: - Session Credit Card

struct SessionCreditCard: View {
    let credit: SessionCredit
    let therapist: TherapistProfile?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: HUSpacing.sm) {
                HStack(spacing: HUSpacing.sm) {
                    HUAvatar(url: therapist?.photoURL, name: therapist?.displayName ?? "T", size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(therapist?.displayName ?? "Therapist")
                            .font(HUFont.subheadline(weight: .semibold))
                            .foregroundStyle(HUColor.textPrimary)
                            .lineLimit(1)
                    }
                }

                Divider()

                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(credit.sessionsRemaining)")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(HUColor.primary)
                        Text(credit.sessionsRemaining == 1 ? "session left" : "sessions left")
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(HUColor.primary.opacity(0.3))
                }

                // Progress bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(HUColor.primaryLight.opacity(0.3))
                            .frame(height: 6)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(HUColor.primary)
                            .frame(
                                width: geo.size.width * CGFloat(credit.sessionsRemaining) / CGFloat(credit.sessionsTotal),
                                height: 6
                            )
                    }
                }
                .frame(height: 6)
            }
            .padding(HUSpacing.lg)
            .frame(width: 180)
            .background(HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Therapist List Card

struct TherapistListCard: View {
    let therapist: TherapistProfile
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HUSpacing.md) {
                // Profile photo
                HUAvatar(url: therapist.photoURL, name: therapist.displayName, size: 60)
                
                VStack(alignment: .leading, spacing: HUSpacing.xs) {
                    HStack(spacing: HUSpacing.xs) {
                        Text(therapist.displayName)
                            .font(HUFont.subheadline(weight: .semibold))
                            .foregroundStyle(HUColor.textPrimary)
                        
                        if therapist.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(HUFont.footnote())
                                .foregroundStyle(HUColor.primary)
                        }
                    }
                    
                    Text(therapist.tagline)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(1)
                    
                    HStack(spacing: 6) {
                        HStack(spacing: 2) {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundStyle(HUColor.starFilled)
                            Text(String(format: "%.1f", therapist.averageRating))
                                .font(HUFont.caption(weight: .semibold))
                                .foregroundStyle(HUColor.textPrimary)
                        }
                        
                        Text("(\(therapist.totalReviews))")
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textSecondary)
                        
                        Spacer()
                        
                        Text(therapist.formattedStartingPrice)
                            .font(HUFont.caption(weight: .semibold))
                            .foregroundStyle(HUColor.primary)
                    }
                    
                    // Category tags (show max 2, with +N indicator for extras)
                    HStack(spacing: HUSpacing.xs) {
                        ForEach(therapist.categories.prefix(2)) { cat in
                            Text(cat.displayName)
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(HUColor.primary)
                                .padding(.horizontal, HUSpacing.sm)
                                .padding(.vertical, 3)
                                .background(HUColor.primaryLight)
                                .clipShape(Capsule())
                        }
                        
                        if therapist.categories.count > 2 {
                            Text("+\(therapist.categories.count - 2)")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(HUColor.primary)
                                .padding(.horizontal, HUSpacing.sm)
                                .padding(.vertical, 3)
                                .background(HUColor.primaryLight)
                                .clipShape(Capsule())
                        }
                    }
                }
            }
            .padding(HUSpacing.md)
            .background(HUColor.background)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay {
                RoundedRectangle(cornerRadius: HURadius.xl)
                    .strokeBorder(HUColor.divider, lineWidth: 0.5)
            }
            .huShadow(.sm)
        }
        .buttonStyle(HUPressButtonStyle())
        .accessibilityLabel("\(therapist.displayName), \(therapist.tagline), rated \(String(format: "%.1f", therapist.averageRating)) stars, \(therapist.formattedStartingPrice)")
    }
}

// MARK: - Editorial Therapist Card (used by Home "Per te" section)
//
// Compact one-row card: portrait + name (with verified badge) + role
// in caption + stars + serif-italic "tagline pull" + price stamp.
// Mirrors the design's `HUTherapistCardEditorial` from
// `client_app/screens-home.jsx`.

struct EditorialTherapistCard: View {
    let therapist: TherapistProfile
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HUSpacing.md) {
                ZStack(alignment: .bottomTrailing) {
                    HUAvatar(url: therapist.photoURL, name: therapist.displayName, size: 54)
                    if let tier = therapist.tier {
                        TierBadge(tier: tier, size: 22)
                            .offset(x: 4, y: 4)
                    }
                }

                VStack(alignment: .leading, spacing: 3) {
                    if let tier = therapist.tier {
                        TierPill(tier: tier, compact: true)
                    }
                    HStack(spacing: 5) {
                        Text(therapist.displayName)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(HUColor.textPrimary)
                            .lineLimit(1)
                        if therapist.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(HUColor.brandMagenta)
                        }
                    }
                    Text(therapist.tagline)
                        .font(.system(size: 11.5))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(HUColor.starFilled)
                        Text(String(format: "%.1f", therapist.averageRating))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(HUColor.textPrimary)
                        Text("(\(therapist.totalReviews))")
                            .font(.system(size: 10.5))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                    .padding(.top, 1)
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 1) {
                    Text(therapist.formattedStartingPrice)
                        .font(.custom("Fraunces72pt-SemiBold", size: 19))
                        .foregroundStyle(HUColor.primary)
                    Text("/sessione")
                        .font(.system(size: 9.5))
                        .tracking(0.5)
                        .foregroundStyle(HUColor.textTertiary)
                }
            }
            .padding(12)
            .background(HUColor.background)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay(
                RoundedRectangle(cornerRadius: HURadius.xl)
                    .strokeBorder(HUColor.divider, lineWidth: 1)
            )
        }
        .buttonStyle(HUPressButtonStyle())
        .accessibilityLabel("\(therapist.displayName), \(therapist.tagline), \(therapist.formattedStartingPrice)")
    }
}

// MARK: - All Therapists View (matches "All Our Therapists" screen)

struct AllTherapistsView: View {
    var initialCategory: TherapyCategory?
    @State private var searchText = ""
    @State private var selectedCategory: TherapyCategory?
    @State private var selectedLanguages: Set<String> = []
    @State private var showLanguageFilter = false
    @State private var navigateToTherapist: TherapistProfile?
    @State private var showFilters = false
    @State private var therapists: [TherapistProfile] = []
    @State private var isLoading = true
    @State private var searchError: String?
    @State private var selectedSort: TherapistSortOption = .rating
    @State private var currentPage = 0
    @State private var hasMoreResults = true
    @State private var isLoadingMore = false
    @State private var minPrice: Double = 0
    @State private var maxPrice: Double = 500
    @State private var priceFilterEnabled = false
    @State private var useNearbySearch = false
    @State private var nearbyRadius: Double = 50 // km
    private let locationManager = LocationManager.shared
    private let pageSize = 20
    
    private var filteredTherapists: [TherapistProfile] {
        var results = therapists
        if let category = selectedCategory {
            results = results.filter { $0.categories.contains(category) }
        }
        if !searchText.isEmpty {
            results = results.filter {
                $0.displayName.localizedCaseInsensitiveContains(searchText) ||
                $0.tagline.localizedCaseInsensitiveContains(searchText)
            }
        }
        switch selectedSort {
        case .rating:
            results.sort { $0.averageRating > $1.averageRating }
        case .priceLowToHigh:
            results.sort { ($0.startingPrice ?? .greatestFiniteMagnitude) < ($1.startingPrice ?? .greatestFiniteMagnitude) }
        case .priceHighToLow:
            results.sort { ($0.startingPrice ?? 0) > ($1.startingPrice ?? 0) }
        case .distance:
            if let lat = locationManager.userLatitude, let lon = locationManager.userLongitude {
                results.sort { a, b in
                    let aDist = distanceKm(from: lat, lon: lon, to: a.location?.latitude, lon2: a.location?.longitude)
                    let bDist = distanceKm(from: lat, lon: lon, to: b.location?.latitude, lon2: b.location?.longitude)
                    return aDist < bDist
                }
            }
        case .relevance:
            break // default order from API
        }
        return results
    }
    
    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: HUSpacing.lg, pinnedViews: []) {
                    if let searchError {
                        HStack(spacing: HUSpacing.sm) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(HUColor.error)
                            Text(searchError)
                                .font(HUFont.caption())
                                .foregroundStyle(HUColor.error)
                            Spacer()
                            Button("Riprova") {
                                HUHaptic.impact(.light)
                                self.searchError = nil
                                Task { await loadTherapists() }
                            }
                            .font(HUFont.caption(weight: .semibold))
                            .foregroundStyle(HUColor.primary)
                        }
                        .padding(HUSpacing.md)
                        .background(HUColor.error.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
                        .padding(.horizontal, HUSpacing.xl)
                    }

                    exploreHeader
                    practiceStrip
                    quickFilterRow

                    if let category = selectedCategory {
                        categoryInfoSection(for: category)
                            .padding(.horizontal, HUSpacing.xl)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    therapistsListSection
                }
                .padding(.bottom, HUSpacing.xxl)
            }
            .background(HUColor.background)
            .navigationBarTitleDisplayMode(.inline)
            .navigationTitle("")
            .navigationDestination(item: $navigateToTherapist) { therapist in
                TherapistProfileView(therapist: therapist)
            }
            .task {
                selectedCategory = initialCategory
                await loadTherapists()
            }
            .refreshable {
                await loadTherapists()
            }
            .onChange(of: initialCategory) { _, newCategory in
                withAnimation(HUAnimation.standard) {
                    selectedCategory = newCategory
                }
            }
            .onChange(of: selectedCategory) { _, _ in
                Task { await loadTherapists() }
            }
            .onChange(of: selectedLanguages) { _, _ in
                Task { await loadTherapists() }
            }
            .onChange(of: selectedSort) { _, _ in
                Task { await loadTherapists() }
            }
            .sheet(isPresented: $showLanguageFilter) {
                languageFilterSheet
            }
            .sheet(isPresented: $showFilters) {
                filtersSheet
            }
        }
    }

    // MARK: - Editorial header (painted edition 2026-05-16)

    private var exploreHeader: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            VStack(alignment: .leading, spacing: 8) {
                Text("ESPLORA")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2.0)
                    .foregroundStyle(HUColor.brandGold)
                (
                    Text("Trova il tuo ")
                        .font(HUFont.displayTitle(size: 30, weight: .semiBold))
                        .foregroundColor(HUColor.textPrimary)
                    + Text("guida")
                        .font(.custom("Fraunces72pt-Italic", size: 30))
                        .foregroundColor(HUColor.primary)
                    + Text(".")
                        .font(HUFont.displayTitle(size: 30, weight: .semiBold))
                        .foregroundColor(HUColor.textPrimary)
                )
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            }

            // Custom inline search bar — matches design's white card
            // with magenta filter button.
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15))
                    .foregroundStyle(HUColor.textTertiary)
                TextField("Cerca un operatore, una pratica...", text: $searchText)
                    .font(.system(size: 14))
                    .foregroundStyle(HUColor.textPrimary)
                    .submitLabel(.search)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                        HUHaptic.selection()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                }
                Button {
                    HUHaptic.impact(.light)
                    showFilters = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(HUColor.brandMagenta)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .accessibilityLabel("Apri filtri")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(HUColor.background)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: HURadius.lg)
                    .strokeBorder(HUColor.divider, lineWidth: 1)
            )
        }
        .padding(.horizontal, HUSpacing.xl)
        .padding(.top, HUSpacing.md)
    }

    // MARK: - Painted practices strip ("Per pratica")

    private var practiceStrip: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            HStack(alignment: .lastTextBaseline) {
                Text("Per pratica")
                    .font(HUFont.displayHeadline(size: 19, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                Spacer()
                if selectedCategory != nil {
                    Button {
                        HUHaptic.selection()
                        withAnimation(HUAnimation.standard) {
                            selectedCategory = nil
                        }
                    } label: {
                        Text("Mostra tutte ›")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(HUColor.brandMagenta)
                    }
                }
            }
            .padding(.horizontal, HUSpacing.xl)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(TherapyCategory.allCases) { category in
                        practiceTile(category)
                    }
                }
                .padding(.horizontal, HUSpacing.xl)
            }
        }
    }

    private func practiceTile(_ category: TherapyCategory) -> some View {
        let isSelected = selectedCategory == category
        return Button {
            HUHaptic.selection()
            withAnimation(HUAnimation.standard) {
                selectedCategory = isSelected ? nil : category
            }
        } label: {
            VStack(spacing: 4) {
                if let illust = category.illustrationName {
                    Image(illust)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 72, height: 72)
                } else {
                    Image(systemName: category.icon)
                        .font(.system(size: 24))
                        .foregroundStyle(category.color)
                        .frame(width: 72, height: 72)
                }
                Text(category.displayName)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(isSelected ? HUColor.brandMagenta : HUColor.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .multilineTextAlignment(.center)
                    .frame(height: 26)
            }
            .frame(width: 92)
            .padding(.vertical, 8)
            .padding(.horizontal, 6)
            .background(HUColor.brandCream)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay(
                RoundedRectangle(cornerRadius: HURadius.xl)
                    .strokeBorder(
                        isSelected ? HUColor.brandMagenta : HUColor.divider,
                        lineWidth: isSelected ? 2 : 1
                    )
            )
            .scaleEffect(isSelected ? 0.97 : 1.0)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isSelected ? "Rimuovi filtro \(category.displayName)" : "Filtra per \(category.displayName)")
    }

    // MARK: - Quick filter pills (sort + language + nearby)

    private var quickFilterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Sort menu — wrapped as a chip so it stays visually
                // peer with the others, instead of a separate Filter
                // button hidden behind a sheet.
                Menu {
                    Picker("Ordina", selection: $selectedSort) {
                        ForEach(TherapistSortOption.allCases, id: \.self) { option in
                            Text(option.displayName).tag(option)
                        }
                    }
                } label: {
                    quickFilterChipLabel(
                        icon: "arrow.up.arrow.down",
                        title: selectedSort.displayName,
                        active: selectedSort != .rating
                    )
                }

                // Language picker chip — opens existing sheet
                Button {
                    HUHaptic.selection()
                    showLanguageFilter = true
                } label: {
                    quickFilterChipLabel(
                        icon: "globe",
                        title: selectedLanguages.isEmpty
                            ? String(localized: "Lingua", comment: "Explore filter: language")
                            : String(localized: "\(selectedLanguages.count) lingue", comment: "Explore filter: N languages selected"),
                        active: !selectedLanguages.isEmpty
                    )
                }

                // Nearby toggle chip
                Button {
                    HUHaptic.selection()
                    useNearbySearch.toggle()
                    if useNearbySearch {
                        locationManager.requestLocation()
                        selectedSort = .distance
                    } else if selectedSort == .distance {
                        selectedSort = .rating
                    }
                    Task { await loadTherapists() }
                } label: {
                    quickFilterChipLabel(
                        icon: "location",
                        title: String(localized: "Vicino a me", comment: "Explore filter: nearby"),
                        active: useNearbySearch
                    )
                }

                // Price toggle chip
                Button {
                    HUHaptic.selection()
                    priceFilterEnabled.toggle()
                    Task { await loadTherapists() }
                } label: {
                    quickFilterChipLabel(
                        icon: "eurosign.circle",
                        title: priceFilterEnabled
                            ? String(localized: "€\(Int(minPrice))–\(Int(maxPrice))", comment: "Explore filter: price range")
                            : String(localized: "Prezzo", comment: "Explore filter: price"),
                        active: priceFilterEnabled
                    )
                }
            }
            .padding(.horizontal, HUSpacing.xl)
        }
    }

    private func quickFilterChipLabel(icon: String, title: String, active: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .medium))
            Text(title)
                .font(.system(size: 12.5, weight: active ? .semibold : .medium))
        }
        .foregroundStyle(active ? .white : HUColor.textPrimary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(active ? HUColor.primary : HUColor.background)
        .clipShape(Capsule())
        .overlay(
            Capsule()
                .strokeBorder(active ? Color.clear : HUColor.divider, lineWidth: 1)
        )
    }

    // MARK: - Therapists list section

    private var therapistsListSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            HStack(alignment: .lastTextBaseline) {
                Text(selectedCategory.map { "Praticanti di \($0.displayName)" }
                     ?? String(localized: "Operatori certificati", comment: "Explore section: certified practitioners"))
                    .font(HUFont.displayHeadline(size: 19, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                Spacer()
                Text("\(filteredTherapists.count)")
                    .font(.custom("Fraunces72pt-SemiBold", size: 16))
                    .foregroundStyle(HUColor.primary)
            }
            .padding(.horizontal, HUSpacing.xl)

            VStack(spacing: 10) {
                if isLoading {
                    SkeletonList(count: 4)
                } else if filteredTherapists.isEmpty {
                    emptyTherapistsState
                } else {
                    ForEach(Array(filteredTherapists.enumerated()), id: \.element.id) { index, therapist in
                        EditorialTherapistCard(therapist: therapist) {
                            navigateToTherapist = therapist
                        }
                        .staggeredAppearance(index: index, isVisible: !isLoading)
                    }

                    if hasMoreResults {
                        Button {
                            HUHaptic.impact(.light)
                            Task { await loadMoreTherapists() }
                        } label: {
                            HStack(spacing: 6) {
                                if isLoadingMore {
                                    ProgressView().tint(HUColor.brandMagenta)
                                } else {
                                    Text("Mostra altri")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(HUColor.brandMagenta)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(HUColor.brandMagenta.opacity(0.08))
                            .clipShape(Capsule())
                        }
                        .disabled(isLoadingMore)
                    }
                }
            }
            .padding(.horizontal, HUSpacing.xl)
            .animation(.easeInOut(duration: 0.3), value: filteredTherapists.count)
        }
    }

    private var emptyTherapistsState: some View {
        VStack(spacing: HUSpacing.md) {
            ZStack {
                Circle()
                    .fill(HUColor.tilePink.opacity(0.5))
                    .frame(width: 100, height: 100)
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(HUColor.primary)
            }
            Text("Nessun operatore trovato")
                .font(HUFont.displayHeadline(size: 18, weight: .semiBold))
                .foregroundStyle(HUColor.textPrimary)
            Text("Prova a rimuovere qualche filtro o a cercare con altre parole.")
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, HUSpacing.md)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HUSpacing.xxl)
    }
    
    private var activePriceRange: ClosedRange<Double>? {
        guard priceFilterEnabled else { return nil }
        let low = min(minPrice, maxPrice)
        let high = max(minPrice, maxPrice)
        return low...high
    }
    
    private func distanceKm(from lat1: Double, lon lon1: Double, to lat2: Double?, lon2: Double?) -> Double {
        guard let lat2, let lon2 else { return .greatestFiniteMagnitude }
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) *
                sin(dLon / 2) * sin(dLon / 2)
        return 6371 * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
    
    private func loadTherapists() async {
        currentPage = 0
        hasMoreResults = true
        searchError = nil          // clear stale errors before every load attempt
        do {
            // Use nearby search when location is available and sorting by distance
            if useNearbySearch,
               let lat = locationManager.userLatitude,
               let lon = locationManager.userLongitude {
                let results = try await DIContainer.shared.therapistRepository.getNearbyTherapists(
                    latitude: lat,
                    longitude: lon,
                    radiusKm: nearbyRadius
                )
                therapists = results
                hasMoreResults = false // nearby returns all matches
            } else {
                let categories = selectedCategory.map { [$0] } ?? []
                let results = try await DIContainer.shared.therapistRepository.searchTherapists(
                    query: nil,
                    categories: categories,
                    languages: selectedLanguages.isEmpty ? [] : Array(selectedLanguages),
                    minRating: nil,
                    priceRange: activePriceRange,
                    sortBy: selectedSort,
                    page: 0,
                    pageSize: pageSize
                )
                therapists = results
                hasMoreResults = results.count >= pageSize
            }
        } catch {
            searchError = "Couldn't load therapists. Pull to refresh or tap retry."
        }
        isLoading = false
    }
    
    private func loadMoreTherapists() async {
        guard hasMoreResults, !isLoadingMore else { return }
        isLoadingMore = true
        let nextPage = currentPage + 1
        
        do {
            let categories = selectedCategory.map { [$0] } ?? []
            let results = try await DIContainer.shared.therapistRepository.searchTherapists(
                query: nil,
                categories: categories,
                languages: selectedLanguages.isEmpty ? [] : Array(selectedLanguages),
                minRating: nil,
                priceRange: activePriceRange,
                sortBy: selectedSort,
                page: nextPage,
                pageSize: pageSize
            )
            therapists.append(contentsOf: results)
            currentPage = nextPage
            hasMoreResults = results.count >= pageSize
        } catch {
            // Silently fail on load more — user can try scrolling again
        }
        isLoadingMore = false
    }
    
    // (Old `filterBar` and `therapistsList` removed 2026-05-16.
    // Their responsibilities now live in `exploreHeader`,
    // `practiceStrip`, `quickFilterRow`, `categoryInfoSection`, and
    // `therapistsListSection` — see them above.)

    // MARK: - Category info section (painted editorial layout)

    /// Editorial detail for the currently selected practice. Shows
    /// painted illustration in a cream-deep tile next to the serif
    /// name, a Fraunces-italic pullquote, body description, benefits
    /// with magenta-dot bullets, and a "who it's for" card. Pullquote
    /// strings live in `practicePullquote(_:)` below.
    private func categoryInfoSection(for category: TherapyCategory) -> some View {
        VStack(alignment: .leading, spacing: HUSpacing.xl) {
            // ─────────────────────────────────────────────────────
            // Hero: painted illustration tile on the left, editorial
            // eyebrow + serif name + caption on the right. Mirrors
            // the design's `CategoryScreen` hero. The illustration
            // sits inside a cream-deep square instead of a full-bleed
            // banner — the painted assets read better at fixed size.
            // ─────────────────────────────────────────────────────
            HStack(alignment: .top, spacing: HUSpacing.lg) {
                ZStack {
                    RoundedRectangle(cornerRadius: HURadius.xxl)
                        .fill(category.color.opacity(0.18))
                        .frame(width: 112, height: 112)
                    if let illust = category.illustrationName {
                        Image(illust)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 92, height: 92)
                    } else {
                        Image(systemName: category.icon)
                            .font(.system(size: 36))
                            .foregroundStyle(category.color)
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: HURadius.xxl)
                        .strokeBorder(HUColor.divider, lineWidth: 1)
                )

                VStack(alignment: .leading, spacing: 6) {
                    Text("PRATICA OLISTICA")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(2.0)
                        .foregroundStyle(HUColor.brandGold)
                    Text(category.displayName)
                        .font(HUFont.displayHeadline(size: 24, weight: .semiBold))
                        .foregroundStyle(HUColor.textPrimary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                    Text(practiceTagline(for: category))
                        .font(.system(size: 12.5))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // ─────────────────────────────────────────────────────
            // Editorial pullquote — Fraunces italic, berry. One line
            // per category, hand-tuned to fit the brand voice (warm,
            // grounded, no medical claims).
            // ─────────────────────────────────────────────────────
            Text("\u{201C}\(practicePullquote(for: category))\u{201D}")
                .font(.custom("Fraunces72pt-Italic", size: 19))
                .foregroundStyle(HUColor.primary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Body description (rich text from TherapyCategory).
            Text(category.practiceDescription)
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)

            // ─────────────────────────────────────────────────────
            // Benefits with painted bullet rows (magenta dot ✓ in a
            // soft tint pill — matches design's `Benefici chiave`).
            // ─────────────────────────────────────────────────────
            VStack(alignment: .leading, spacing: HUSpacing.sm) {
                Text("BENEFICI CHIAVE")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2.0)
                    .foregroundStyle(HUColor.brandGold)
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(category.benefits.enumerated()), id: \.offset) { _, benefit in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(HUColor.brandMagenta.opacity(0.12))
                                    .frame(width: 22, height: 22)
                                Image(systemName: "checkmark")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(HUColor.brandMagenta)
                            }
                            .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] }
                            Text(benefit)
                                .font(HUFont.body())
                                .foregroundStyle(HUColor.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                    }
                }
            }

            // "Per chi è" — kept as a soft card so it reads as a
            // distinct aside, not part of the benefits list.
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "person.2")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.brandMagenta)
                    Text("PER CHI È")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(2.0)
                        .foregroundStyle(HUColor.brandMagenta)
                }
                Text(category.whoIsItFor)
                    .font(HUFont.body())
                    .foregroundStyle(HUColor.textSecondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(HUSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(HUColor.brandCream)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        }
        .padding(.top, HUSpacing.sm)
    }

    /// One-sentence editorial tagline shown in the category hero
    /// (right column, caption under the serif name).
    private func practiceTagline(for category: TherapyCategory) -> String {
        switch category {
        case .thetaHealing:
            return String(localized: "Meditazione, credenze, riprogrammazione interiore.", comment: "Category tagline")
        case .reiki:
            return String(localized: "Energia sottile, distanza, rilascio dello stress.", comment: "Category tagline")
        case .familyConstellation:
            return String(localized: "Dinamiche familiari e ordini nascosti.", comment: "Category tagline")
        case .systemicConstellation:
            return String(localized: "Sistemi, ruoli, equilibri da riportare.", comment: "Category tagline")
        case .naturopathy:
            return String(localized: "Salute naturale, ritmo del corpo, prevenzione.", comment: "Category tagline")
        case .ayurveda:
            return String(localized: "Costituzione, rituale quotidiano, equilibrio dei dosha.", comment: "Category tagline")
        case .astrology:
            return String(localized: "Mappa celeste e consapevolezza dei cicli.", comment: "Category tagline")
        case .humanDesign:
            return String(localized: "Tipo energetico e strategie di decisione.", comment: "Category tagline")
        case .numerology:
            return String(localized: "Numeri come specchio, cicli, percorso di vita.", comment: "Category tagline")
        case .shamanism:
            return String(localized: "Saggezza terrestre, viaggio, recupero dell'anima.", comment: "Category tagline")
        }
    }

    /// Hand-tuned Italian pullquote per practice. Rendered in
    /// Fraunces italic in berry — the editorial heartbeat of the
    /// category page. Kept here (not on `TherapyCategory`) because
    /// it's presentation copy that doesn't belong on the model.
    private func practicePullquote(for category: TherapyCategory) -> String {
        switch category {
        case .thetaHealing:
            return String(localized: "Il pensiero crea. La consapevolezza trasforma.", comment: "Pullquote: ThetaHealing")
        case .reiki:
            return String(localized: "Le mani si fermano. L'energia inizia a parlare.", comment: "Pullquote: Reiki")
        case .familyConstellation:
            return String(localized: "C'è un ordine, anche dove sembra solo dolore.", comment: "Pullquote: Family Constellation")
        case .systemicConstellation:
            return String(localized: "Ogni sistema cerca il suo equilibrio.", comment: "Pullquote: Systemic Constellation")
        case .naturopathy:
            return String(localized: "Il corpo sa, se gli dai tempo di ricordare.", comment: "Pullquote: Naturopathy")
        case .ayurveda:
            return String(localized: "La cura è già dentro di te. Devi solo ascoltarla.", comment: "Pullquote: Ayurveda")
        case .astrology:
            return String(localized: "Il cielo al tuo primo respiro racconta già una storia.", comment: "Pullquote: Astrology")
        case .humanDesign:
            return String(localized: "Sei un disegno unico, non un errore da correggere.", comment: "Pullquote: Human Design")
        case .numerology:
            return String(localized: "Ogni numero è una vibrazione che ti accompagna.", comment: "Pullquote: Numerology")
        case .shamanism:
            return String(localized: "C'è una parte di te che è sempre stata intera.", comment: "Pullquote: Shamanism")
        }
    }
    
    private var filtersSheet: some View {
        NavigationStack {
            Form {
                Section("Sort By") {
                    ForEach(TherapistSortOption.allCases, id: \.self) { option in
                        Button {
                            selectedSort = option
                        } label: {
                            HStack {
                                Text(option.displayName)
                                    .foregroundStyle(HUColor.textPrimary)
                                Spacer()
                                if selectedSort == option {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(HUColor.primary)
                                }
                            }
                        }
                    }
                }
                
                Section("Location") {
                    Toggle("Search nearby", isOn: $useNearbySearch)
                        .onChange(of: useNearbySearch) { _, enabled in
                            if enabled {
                                locationManager.requestLocation()
                                selectedSort = .distance
                            }
                        }
                    
                    if useNearbySearch {
                        VStack(alignment: .leading, spacing: HUSpacing.xs) {
                            Text("Radius: \(Int(nearbyRadius)) km")
                                .font(HUFont.caption(weight: .medium))
                                .foregroundStyle(HUColor.textSecondary)
                            Slider(value: $nearbyRadius, in: 5...200, step: 5)
                                .tint(HUColor.primary)
                        }
                        
                        if !locationManager.hasLocation {
                            HStack(spacing: HUSpacing.xs) {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Getting your location...")
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.textTertiary)
                            }
                        }
                    }
                }
                
                Section("Price Range") {
                    Toggle("Filter by price", isOn: $priceFilterEnabled)
                    
                    if priceFilterEnabled {
                        VStack(spacing: HUSpacing.sm) {
                            HStack {
                                Text("$\(Int(minPrice))")
                                    .font(HUFont.caption(weight: .medium))
                                    .foregroundStyle(HUColor.textSecondary)
                                Spacer()
                                Text("$\(Int(maxPrice))")
                                    .font(HUFont.caption(weight: .medium))
                                    .foregroundStyle(HUColor.textSecondary)
                            }
                            
                            HStack(spacing: HUSpacing.md) {
                                Slider(value: $minPrice, in: 0...500, step: 10)
                                    .tint(HUColor.primary)
                                Text("to")
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.textTertiary)
                                Slider(value: $maxPrice, in: 0...500, step: 10)
                                    .tint(HUColor.primary)
                            }
                        }
                    }
                }
                
                Section("Category") {
                    ForEach(TherapyCategory.allCases.prefix(10)) { category in
                        Button {
                            withAnimation {
                                selectedCategory = selectedCategory == category ? nil : category
                            }
                        } label: {
                            HStack {
                                Image(systemName: category.icon)
                                    .foregroundStyle(category.color)
                                    .frame(width: 24)
                                Text(category.displayName)
                                    .foregroundStyle(HUColor.textPrimary)
                                Spacer()
                                if selectedCategory == category {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(HUColor.primary)
                                }
                            }
                        }
                    }
                }
                
                Section("Language") {
                    ForEach(AppConstants.availableLanguages.prefix(8), id: \.self) { language in
                        Button {
                            if selectedLanguages.contains(language) {
                                selectedLanguages.remove(language)
                            } else {
                                selectedLanguages.insert(language)
                            }
                        } label: {
                            HStack {
                                Text(language)
                                    .foregroundStyle(HUColor.textPrimary)
                                Spacer()
                                if selectedLanguages.contains(language) {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(HUColor.primary)
                                }
                            }
                        }
                    }
                }
                
                if selectedCategory != nil || !selectedLanguages.isEmpty || selectedSort != .rating || priceFilterEnabled || useNearbySearch {
                    Section {
                        Button("Clear All Filters") {
                            selectedCategory = nil
                            selectedLanguages.removeAll()
                            selectedSort = .rating
                            priceFilterEnabled = false
                            useNearbySearch = false
                        }
                        .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        showFilters = false
                        Task { await loadTherapists() }
                    }
                    .font(HUFont.body(weight: .semibold))
                    .foregroundStyle(HUColor.primary)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
    
    private var languageFilterSheet: some View {
        NavigationStack {
            List {
                Section(footer: Text("Filter therapists by languages they speak")) {
                    ForEach(AppConstants.availableLanguages, id: \.self) { language in
                        Button {
                            if selectedLanguages.contains(language) {
                                selectedLanguages.remove(language)
                            } else {
                                selectedLanguages.insert(language)
                            }
                        } label: {
                            HStack {
                                Text(language)
                                    .foregroundStyle(HUColor.textPrimary)
                                Spacer()
                                if selectedLanguages.contains(language) {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(HUColor.primary)
                                }
                            }
                        }
                    }
                }
                
                if !selectedLanguages.isEmpty {
                    Section {
                        Button("Clear All Filters") {
                            selectedLanguages.removeAll()
                        }
                        .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Filter by Language")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        showLanguageFilter = false
                    }
                    .font(HUFont.body(weight: .semibold))
                    .foregroundStyle(HUColor.primary)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Client Bookings

struct ClientBookingsView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var selectedTab: BookingTab = .upcoming
    @State private var showReviewSheet = false
    @State private var reviewBooking: Booking?
    @State private var upcomingBookings: [Booking] = []
    @State private var pastBookings: [Booking] = []
    @State private var therapistNames: [String: String] = [:]
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var hasMorePast = true
    /// True when the initial bookings load fails, so the view shows a retry
    /// affordance instead of a false "no sessions" empty state (F1, 2026-05-30).
    @State private var loadError = false
    private let pageSize = 20
    @State private var manageTarget: Booking?
    @State private var manageTherapist: TherapistProfile?
    @State private var manageInitialMode: ManageBookingView.ManageMode = .reschedule
    @State private var rescheduleTarget: Booking?
    @State private var rescheduleTherapist: TherapistProfile?
    @State private var activeVideoCall: BookingsVideoCallInfo?
    
    private struct BookingsVideoCallInfo: Identifiable {
        let id = UUID()
        let roomName: String
        let participantName: String
        var bookingId: String = ""
    }
    
    
    enum BookingTab: String, CaseIterable {
        case upcoming
        case past

        var label: String {
            switch self {
            case .upcoming: return String(localized: "In arrivo", comment: "Bookings tab")
            case .past:     return String(localized: "Il cammino", comment: "Bookings tab — past sessions, editorial wording")
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: HUSpacing.lg, pinnedViews: [.sectionHeaders]) {
                    bookingsHeader
                    segmentedSelector

                    if isLoading {
                        SkeletonList(count: 3)
                            .padding(.horizontal, HUSpacing.xl)
                    } else if loadError && upcomingBookings.isEmpty && pastBookings.isEmpty {
                        HUErrorView(
                            message: "Couldn't load your sessions. Check your connection.",
                            retryAction: {
                                HUHaptic.impact(.light)
                                Task { await loadBookings() }
                            }
                        )
                        .padding(.horizontal, HUSpacing.xl)
                    } else {
                        switch selectedTab {
                        case .upcoming:
                            upcomingSection
                                .padding(.horizontal, HUSpacing.xl)
                        case .past:
                            pastSection
                                .padding(.horizontal, HUSpacing.xl)
                        }
                    }
                }
                .padding(.bottom, HUSpacing.xxl)
            }
            .background(HUColor.background)
            .navigationBarTitleDisplayMode(.inline)
            .navigationTitle("")
            .task {
                await loadBookings()
            }
            .refreshable {
                await loadBookings()
            }
            .sheet(item: $reviewBooking) { booking in
                ReviewSheetWrapper(booking: booking)
            }
            .sheet(item: $manageTarget, onDismiss: {
                Task { await loadBookings() }
            }) { booking in
                ManageBookingView(booking: booking, therapist: manageTherapist, initialMode: manageInitialMode)
            }
            .sheet(item: $rescheduleTarget, onDismiss: {
                Task { await loadBookings() }
            }) { booking in
                ManageBookingView(booking: booking, therapist: rescheduleTherapist)
            }
            .fullScreenCover(item: $activeVideoCall) { call in
                VideoCallView(roomName: call.roomName, participantName: call.participantName, bookingId: call.bookingId)
            }
        }
    }
    
    
    private func loadBookings() async {
        let userId = authManager.currentUser?.id ?? ""
        async let upcoming = DIContainer.shared.bookingRepository.getUpcomingBookings(userId: userId, role: .client)
        async let past = DIContainer.shared.bookingRepository.getPastBookings(userId: userId, role: .client, limit: pageSize, offset: 0)

        do {
            upcomingBookings = try await upcoming
            let loadedPast = try await past
            pastBookings = loadedPast
            hasMorePast = loadedPast.count >= pageSize
            loadError = false
        } catch {
            clientHomeLogger.error("Failed to load bookings: \(error.localizedDescription)")
            loadError = true
            isLoading = false
            return
        }

        // Fetch therapist names for all bookings
        let allBookings = upcomingBookings + pastBookings
        let uniqueTherapistIds = Set(allBookings.map { $0.therapistId })
        for therapistId in uniqueTherapistIds {
            if therapistNames[therapistId] == nil {
                let profile = try? await DIContainer.shared.therapistRepository.getProfile(therapistId: therapistId)
                therapistNames[therapistId] = profile?.displayName ?? "Therapist"
            }
        }
        isLoading = false
    }

    private func loadMorePastBookings() async {
        guard !isLoadingMore, hasMorePast else { return }
        isLoadingMore = true
        let userId = authManager.currentUser?.id ?? ""
        let offset = pastBookings.count

        let morePast: [Booking]
        do {
            morePast = try await DIContainer.shared.bookingRepository.getPastBookings(
                userId: userId, role: .client, limit: pageSize, offset: offset
            )
        } catch {
            clientHomeLogger.error("Failed to load more past bookings: \(error.localizedDescription)")
            isLoadingMore = false
            return
        }

        pastBookings.append(contentsOf: morePast)
        hasMorePast = morePast.count >= pageSize

        // Fetch therapist names for new bookings
        for booking in morePast {
            if therapistNames[booking.therapistId] == nil {
                let profile = try? await DIContainer.shared.therapistRepository.getProfile(therapistId: booking.therapistId)
                therapistNames[booking.therapistId] = profile?.displayName ?? "Therapist"
            }
        }
        isLoadingMore = false
    }
    
    // MARK: - Editorial header + segmented selector (painted edition)

    private var bookingsHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("IL TUO CAMMINO")
                .font(.system(size: 11, weight: .bold))
                .tracking(2.0)
                .foregroundStyle(HUColor.brandGold)
            (
                Text("Le tue ")
                    .font(HUFont.displayTitle(size: 30, weight: .semiBold))
                    .foregroundColor(HUColor.textPrimary)
                + Text("sessioni")
                    .font(.custom("Fraunces72pt-Italic", size: 30))
                    .foregroundColor(HUColor.primary)
                + Text(".")
                    .font(HUFont.displayTitle(size: 30, weight: .semiBold))
                    .foregroundColor(HUColor.textPrimary)
            )
            .lineLimit(2)
            .minimumScaleFactor(0.85)

            Text("In arrivo, oggi, e tutto quello che hai attraversato finora.")
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, HUSpacing.xl)
        .padding(.top, HUSpacing.md)
    }

    private var segmentedSelector: some View {
        HStack(spacing: 4) {
            ForEach(BookingTab.allCases, id: \.self) { tab in
                Button {
                    HUHaptic.selection()
                    withAnimation(HUAnimation.quick) { selectedTab = tab }
                } label: {
                    HStack(spacing: 6) {
                        Text(tab.label)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selectedTab == tab ? .white : HUColor.textSecondary)
                        let count = (tab == .upcoming ? upcomingBookings.count : pastBookings.count)
                        if count > 0 {
                            Text("\(count)")
                                .font(.system(size: 10.5, weight: .semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(selectedTab == tab ? Color.white.opacity(0.22) : HUColor.brandMagenta.opacity(0.12))
                                .foregroundStyle(selectedTab == tab ? .white : HUColor.brandMagenta)
                                .clipShape(Capsule())
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(selectedTab == tab ? HUColor.primary : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 11))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(HUColor.background)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: HURadius.lg)
                .strokeBorder(HUColor.divider, lineWidth: 1)
        )
        .padding(.horizontal, HUSpacing.xl)
    }

    // MARK: - Upcoming list (day-strip card)

    private var upcomingSection: some View {
        Group {
            if upcomingBookings.isEmpty {
                emptyUpcoming
            } else {
                VStack(spacing: HUSpacing.md) {
                    ForEach(upcomingBookings) { booking in
                        upcomingDayStripCard(booking)
                    }
                }
            }
        }
    }

    private var emptyUpcoming: some View {
        VStack(spacing: HUSpacing.md) {
            ZStack {
                Circle()
                    .fill(HUColor.primaryLight.opacity(0.45))
                    .frame(width: 110, height: 110)
                Image(systemName: "calendar.badge.plus")
                    .font(.system(size: 36, weight: .light))
                    .foregroundStyle(HUColor.primary)
            }
            Text("Niente in arrivo, per ora.")
                .font(HUFont.displayHeadline(size: 19, weight: .semiBold))
                .foregroundStyle(HUColor.textPrimary)
            Text("Quando prenoti una sessione la trovi qui.")
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HUSpacing.xxl)
    }

    /// Day-strip card: left column has month·day·time pinned over a
    /// cream-deep band; right column has service in serif, therapist
    /// caption, duration · mode, status badge, and action buttons.
    private func upcomingDayStripCard(_ booking: Booking) -> some View {
        let therapistName = therapistNames[booking.therapistId] ?? String(localized: "Operatore", comment: "Booking therapist fallback")
        let monthDF = DateFormatter.italianMonthAbbrev
        let dayDF = DateFormatter.italianDayOfMonth

        let interval = booking.scheduledAt.timeIntervalSinceNow
        let daysAway = max(0, Int(interval / 86400))
        let countdown: String? = {
            if interval <= 0 { return nil }
            if interval < 3600 {
                let m = max(1, Int(interval / 60))
                return String(localized: "Tra \(m) min", comment: "Booking countdown minutes")
            }
            if interval < 86400 {
                let h = Int(interval / 3600)
                return String(localized: "Tra \(h) ore", comment: "Booking countdown hours")
            }
            return String(localized: "Tra \(daysAway) giorni", comment: "Booking countdown days")
        }()

        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                // Day strip
                VStack(spacing: 2) {
                    Text(monthDF.string(from: booking.scheduledAt).uppercased())
                        .font(.system(size: 10, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(HUColor.brandMagenta)
                    Text(dayDF.string(from: booking.scheduledAt))
                        .font(.custom("Fraunces72pt-SemiBold", size: 32))
                        .foregroundStyle(HUColor.primary)
                    Text(booking.formattedTime)
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textSecondary)
                }
                .frame(width: 82)
                .padding(.vertical, 14)
                .background(HUColor.brandCream)

                // Content
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(booking.serviceName)
                            .font(.custom("Fraunces72pt-SemiBold", size: 19))
                            .foregroundStyle(HUColor.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 6)
                        statusBadge(for: booking)
                    }
                    Text("con \(therapistName)")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                    HStack(spacing: 6) {
                        Text("\(booking.duration) min")
                            .font(.system(size: 11.5))
                            .foregroundStyle(HUColor.textSecondary)
                        Text("·")
                            .font(.system(size: 11.5))
                            .foregroundStyle(HUColor.textTertiary)
                        Text("Virtuale")
                            .font(.system(size: 11.5))
                            .foregroundStyle(HUColor.textSecondary)
                    }
                    if let countdown {
                        Text(countdown)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(HUColor.brandMagenta)
                            .padding(.top, 2)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider().background(HUColor.divider)

            // Actions
            HStack(spacing: 8) {
                if booking.canJoinVideoCall, let roomId = booking.videoRoomId, !roomId.isEmpty {
                    Button {
                        HUHaptic.impact(.medium)
                        activeVideoCall = BookingsVideoCallInfo(
                            roomName: roomId,
                            participantName: authManager.currentUser?.displayName ?? "Participant",
                            bookingId: booking.id
                        )
                    } label: {
                        Text("Entra")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(HUColor.primary)
                            .clipShape(Capsule())
                    }
                } else {
                    Button {
                        HUHaptic.impact(.light)
                        Task {
                            manageTherapist = try? await DIContainer.shared.therapistRepository.getProfile(therapistId: booking.therapistId)
                            manageInitialMode = .reschedule
                            manageTarget = booking
                        }
                    } label: {
                        Text("Dettagli")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(HUColor.brandMagenta)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(HUColor.brandMagenta.opacity(0.10))
                            .clipShape(Capsule())
                    }
                }

                Button {
                    HUHaptic.impact(.light)
                    Task {
                        rescheduleTherapist = try? await DIContainer.shared.therapistRepository.getProfile(therapistId: booking.therapistId)
                        rescheduleTarget = booking
                    }
                } label: {
                    Text("Sposta")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(HUColor.textSecondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .overlay(
                            Capsule()
                                .strokeBorder(HUColor.divider, lineWidth: 1)
                        )
                }
            }
            .padding(14)
        }
        .background(HUColor.background)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
        .overlay(
            RoundedRectangle(cornerRadius: HURadius.xxl)
                .strokeBorder(HUColor.divider, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func statusBadge(for booking: Booking) -> some View {
        let (label, fg, bg): (String, Color, Color) = {
            switch booking.status {
            case .confirmed:
                return (String(localized: "Conf.", comment: "Booking status: confirmed (short)"),
                        HUColor.brandMagenta, HUColor.brandMagenta.opacity(0.10))
            case .pending:
                return (String(localized: "In attesa", comment: "Booking status: pending"),
                        Color(red: 0.55, green: 0.41, blue: 0.08), HUColor.tileGold)
            case .inProgress:
                return (String(localized: "In corso", comment: "Booking status: in progress"),
                        HUColor.brandMagenta, HUColor.brandMagenta.opacity(0.10))
            case .completed:
                return (String(localized: "Completata", comment: "Booking status: completed"),
                        HUColor.success, HUColor.success.opacity(0.10))
            case .cancelled:
                return (String(localized: "Annullata", comment: "Booking status: cancelled"),
                        HUColor.error, HUColor.error.opacity(0.10))
            case .noShow:
                return (String(localized: "Mancata", comment: "Booking status: no-show"),
                        HUColor.textSecondary, HUColor.secondaryBackground)
            case .reschedulePending:
                return (String(localized: "Sposta", comment: "Booking status: reschedule pending"),
                        HUColor.brandGold, HUColor.tileGold)
            }
        }()
        Text(label.uppercased())
            .font(.system(size: 9.5, weight: .bold))
            .tracking(0.5)
            .foregroundStyle(fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Past list (editorial timeline "Il cammino")

    private var pastSection: some View {
        Group {
            if pastBookings.isEmpty {
                emptyPast
            } else {
                VStack(alignment: .leading, spacing: HUSpacing.md) {
                    pastStatsRibbon
                    pastTimeline
                }
            }
        }
    }

    private var emptyPast: some View {
        VStack(spacing: HUSpacing.md) {
            ZStack {
                Circle()
                    .fill(HUColor.tilePink.opacity(0.5))
                    .frame(width: 110, height: 110)
                Image(systemName: "leaf")
                    .font(.system(size: 32, weight: .light))
                    .foregroundStyle(HUColor.primary)
            }
            Text("Il cammino inizia qui.")
                .font(HUFont.displayHeadline(size: 19, weight: .semiBold))
                .foregroundStyle(HUColor.textPrimary)
            Text("Le sessioni che porti a termine compariranno qui — come una mappa di dove sei stato/a.")
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, HUSpacing.md)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HUSpacing.xxl)
    }

    /// Editorial 3-stat ribbon at the top of "Il cammino".
    private var pastStatsRibbon: some View {
        let completed = pastBookings.filter { $0.status == .completed }
        let distinctTherapists = Set(completed.map { $0.therapistId }).count
        let daysInJourney: Int = {
            guard let earliest = (upcomingBookings + pastBookings)
                .map(\.scheduledAt).min() else { return 0 }
            let comps = Calendar.current.dateComponents([.day], from: earliest, to: Date())
            return max(0, comps.day ?? 0)
        }()
        return HStack(alignment: .firstTextBaseline, spacing: HUSpacing.xl) {
            statBlock(value: daysInJourney, label: "Giorni in cammino")
            statBlock(value: completed.count, label: "Sessioni")
            statBlock(value: distinctTherapists, label: "Operatori")
            Spacer(minLength: 0)
        }
        .padding(.bottom, HUSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUColor.divider)
                .frame(height: 1)
        }
    }

    private func statBlock(value: Int, label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)")
                .font(.custom("Fraunces72pt-SemiBold", size: 32))
                .foregroundStyle(HUColor.primary)
            Text(label.uppercased())
                .font(.system(size: 9.5, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(HUColor.textTertiary)
        }
    }

    /// Timeline list — date · service · therapist + serif italic
    /// service excerpt. Triggers pagination when the last item shows.
    private var pastTimeline: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(pastBookings) { booking in
                pastTimelineRow(booking)
                    .onAppear {
                        if booking.id == pastBookings.last?.id {
                            Task { await loadMorePastBookings() }
                        }
                    }
            }
            if isLoadingMore {
                ProgressView()
                    .tint(HUColor.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, HUSpacing.md)
            }
        }
    }

    private func pastTimelineRow(_ booking: Booking) -> some View {
        let therapistName = therapistNames[booking.therapistId] ?? String(localized: "Operatore", comment: "Booking therapist fallback")
        let df = DateFormatter.italianDayMonth

        // Try to map the service name to a known category so we can
        // surface its painted illustration. Best-effort — falls back
        // to a simple bullet dot if no mapping is found.
        let category = TherapyCategory.allCases.first { cat in
            booking.serviceName.localizedCaseInsensitiveContains(cat.displayName)
        }

        return HStack(alignment: .top, spacing: 14) {
            // Date stamp + illustration bullet
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [category?.color.opacity(0.35) ?? HUColor.tilePink, HUColor.brandCream],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 46, height: 46)
                    .overlay(
                        Circle().strokeBorder(HUColor.background, lineWidth: 3)
                    )
                if let illust = category?.illustrationName {
                    Image(illust)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 32, height: 32)
                        .opacity(0.9)
                } else {
                    Text("✦")
                        .font(.custom("Fraunces72pt-Italic", size: 18))
                        .foregroundStyle(HUColor.primary)
                }
            }

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text(df.string(from: booking.scheduledAt))
                        .font(.system(size: 10.5, weight: .semibold))
                        .tracking(0.4)
                        .foregroundStyle(HUColor.brandMagenta)
                    Text("·")
                        .foregroundStyle(HUColor.textTertiary)
                    Text(booking.serviceName)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(HUColor.textPrimary)
                        .lineLimit(1)
                    Text("·")
                        .foregroundStyle(HUColor.textTertiary)
                    Text(therapistName)
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(1)
                }
                Text(pastSessionEditorialNote(for: booking))
                    .font(.custom("Fraunces72pt-Italic", size: 14.5))
                    .foregroundStyle(HUColor.textPrimary)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack {
                    statusBadge(for: booking)
                    Spacer()
                    if booking.status == .completed {
                        Button {
                            HUHaptic.impact(.light)
                            reviewBooking = booking
                        } label: {
                            Text("Riprenota →")
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(HUColor.brandMagenta)
                        }
                    }
                }
                .padding(.top, 4)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(HUColor.background)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: HURadius.lg)
                    .strokeBorder(HUColor.divider, lineWidth: 1)
            )
        }
    }

    /// Editorial pseudo-note for past sessions. We don't store session
    /// notes (and shouldn't — health-data scope creep), so we render
    /// a template line derived from status. Keeps the timeline visual
    /// while staying honest: no fake user-generated content.
    private func pastSessionEditorialNote(for booking: Booking) -> String {
        switch booking.status {
        case .completed:
            return String(localized: "Una sessione attraversata. Hai fatto questo passo.", comment: "Past session note: completed")
        case .cancelled:
            return String(localized: "Annullata. Va bene così — ogni cammino ha le sue pause.", comment: "Past session note: cancelled")
        case .noShow:
            return String(localized: "Saltata. Capita — ascolta cosa ti serve la prossima volta.", comment: "Past session note: no-show")
        default:
            return String(localized: "Una sessione del tuo cammino.", comment: "Past session note: generic")
        }
    }
}

struct ReviewSheetWrapper: View {
    let booking: Booking
    @State private var therapist: TherapistProfile?
    
    var body: some View {
        Group {
            if let therapist {
                WriteReviewView(therapist: therapist, booking: booking)
            } else {
                HULoadingView()
                    .task {
                        therapist = try? await DIContainer.shared.therapistRepository.getProfile(therapistId: booking.therapistId)
                    }
            }
        }
    }
}

struct BookingCard: View {
    let booking: Booking
    let therapistName: String
    var showReviewButton: Bool = false
    var showActions: Bool = false
    var onJoinSession: (() -> Void)?
    var onReview: (() -> Void)?
    var onCancel: (() -> Void)?
    var onReschedule: (() -> Void)?
    var onMessage: (() -> Void)?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(booking.serviceName)
                        .font(.system(size: 15, weight: .semibold))
                    Text("with \(therapistName)")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                }
                Spacer()
                HUBadge(text: booking.status.displayName, style: badgeStyle)
            }
            
            HStack(spacing: 14) {
                Label(booking.formattedDate, systemImage: "calendar")
                Label(booking.formattedTime, systemImage: "clock")
                Label("\(booking.duration) min", systemImage: "timer")
            }
            .font(.system(size: 11))
            .foregroundStyle(HUColor.textSecondary)
            
            // Reschedule pending indicator
            if booking.hasProposedReschedule {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Reschedule requested")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.orange)
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 10))
                        Text(booking.formattedProposedDateTime ?? "")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(HUColor.textSecondary)
                    Text("Awaiting therapist approval")
                        .font(.system(size: 10))
                        .foregroundStyle(HUColor.textTertiary)
                }
                .padding(HUSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: HURadius.sm))
            }
            
            if booking.status == .confirmed && booking.canJoinVideoCall,
               let _ = booking.videoRoomId, let onJoinSession {
                HUButton("Join Session", style: .primary, icon: "video.fill") {
                    onJoinSession()
                }
            }
            
            if let onMessage {
                Button {
                    onMessage()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "bubble.left.fill")
                            .font(.system(size: 11))
                        Text("Message")
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(HUColor.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(HUColor.primaryLight)
                    .clipShape(Capsule())
                }
            }
            
            if showActions && booking.status.isActive {
                HStack(spacing: HUSpacing.sm) {
                    if booking.status != .reschedulePending {
                        Button {
                            HUHaptic.impact(.light)
                            onReschedule?()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "calendar.badge.clock")
                                    .font(.system(size: 11))
                                Text("Reschedule")
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(HUColor.primary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(HUColor.primaryLight)
                            .clipShape(Capsule())
                        }
                    }
                    
                    Button {
                        HUHaptic.impact(.light)
                        onCancel?()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "xmark.circle")
                                .font(.system(size: 11))
                            Text("Cancel")
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(Color.red.opacity(0.08))
                        .clipShape(Capsule())
                    }
                }
            }
            
            if showReviewButton {
                Button {
                    onReview?()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "star")
                            .font(.system(size: 11))
                        Text("Leave a Review")
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(HUColor.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(HUColor.primaryLight)
                    .clipShape(Capsule())
                }
            }
        }
        .padding(14)
        .padding(.leading, 4) // leave room for the state accent bar
        .background(stateBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        .overlay(alignment: .leading) {
            // State-as-color: a 4pt accent bar on the leading edge makes
            // it possible to scan a long list and tell apart Confirmed
            // (berry), Pending (gold), Completed (muted), Cancelled (red).
            RoundedRectangle(cornerRadius: 2)
                .fill(stateAccent)
                .frame(width: 4)
                .padding(.vertical, 10)
        }
        .overlay {
            RoundedRectangle(cornerRadius: HURadius.xl)
                .strokeBorder(HUColor.divider.opacity(0.6), lineWidth: 0.5)
        }
        .huShadow(.sm)
        .opacity(booking.status == .completed || booking.status == .cancelled ? 0.8 : 1.0)
    }

    private var badgeStyle: HUBadgeStyle {
        switch booking.status {
        case .confirmed: return .success
        case .completed: return .info
        case .cancelled, .noShow: return .error
        case .reschedulePending: return .warning
        default: return .neutral
        }
    }

    /// Leading accent bar colour — state signal at the widest-possible distance.
    private var stateAccent: Color {
        switch booking.status {
        case .confirmed:          return HUColor.primary
        case .reschedulePending:  return HUColor.warning
        case .pending:            return HUColor.warning.opacity(0.6)
        case .completed:          return HUColor.success
        case .cancelled, .noShow: return HUColor.error
        case .inProgress:         return HUColor.primary
        }
    }

    /// Subtle background tint that reinforces state without shouting.
    private var stateBackground: Color {
        switch booking.status {
        case .confirmed, .inProgress: return HUColor.primaryLight.opacity(0.45)
        case .reschedulePending, .pending: return HUColor.accentLight.opacity(0.45)
        case .completed: return HUColor.secondaryBackground
        case .cancelled, .noShow: return HUColor.background
        }
    }
}

// MARK: - Category Illustration Card

struct CategoryIllustrationCard: View {
    let category: TherapyCategory
    
    var body: some View {
        VStack(spacing: 0) {
            // Illustration
            if let illustrationName = category.illustrationName {
                Image(illustrationName)
                    .resizable()
                    .scaledToFill()
                    .frame(height: 100)
                    .clipped()
            } else {
                // Fallback for categories without illustrations
                Rectangle()
                    .fill(category.color.opacity(0.12))
                    .frame(height: 100)
                    .overlay {
                        Image(systemName: category.icon)
                            .font(.system(size: 32))
                            .foregroundStyle(category.color)
                    }
            }
            
            // Label
            Text(category.displayName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(HUColor.textPrimary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(HUColor.secondaryBackground)
        }
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        .shadow(color: .black.opacity(0.06), radius: 4, y: 2)
    }
}

#Preview {
    ClientTabView()
        .environment(AuthManager(authRepository: MockAuthRepository()))
        .environment(AppState(authManager: AuthManager(authRepository: MockAuthRepository())))
}
