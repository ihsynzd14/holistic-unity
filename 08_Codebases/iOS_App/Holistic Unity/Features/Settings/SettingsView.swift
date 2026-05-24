import SwiftUI
import PhotosUI
import Supabase
import StoreKit
import LocalAuthentication
import UserNotifications
import StreamChat
import StreamChatSwiftUI
import os.log
#if DEBUG
import Sentry
#endif

private let settingsLogger = Logger(subsystem: AppConstants.appBundleId, category: "SettingsView")

// MARK: - Settings View

// ═══════════════════════════════════════════════════════════════════
//  Account / Settings — painted edition (2026-05-16)
//
//  Mirrors `holistic-unity-design-system/project/client_app
//  /screens-other.jsx` (AccountScreen). Editorial "Account" surface:
//  hero with avatar + serif name, stats ribbon, intention card pulled
//  from `client_preferences.intent`, and lean menu groups.
//
//  Settings cleanup (per user direction 2026-05-16):
//   • Removed: Stream-chat support, support-tickets, help-center FAQs,
//     linked-accounts (social linking), profile-visible toggle, online
//     status, read receipts, location sharing, clear search history,
//     blocked-users placeholder, weekly digest, marketing toggle (now
//     managed only via the legal/research flow), email notifications
//     placeholder, text-size override (iOS Dynamic Type handles this).
//   • Contact: a single mailto:support@holisticunity.app — no chat,
//     no tickets, no community placeholders.
//   • Sub-screens (NotificationSettings, PrivacySettings) are also
//     trimmed to their essentials below.
//
//  Per design SKILL.md: NO Cormorant Garamond on iOS — we use
//  Fraunces (the bundled brand serif) for the hero name and intention
//  quote. Berry primary stays canonical (HUColor.primary) for the
//  intention card; magenta brand accent stays scoped to onboarding.
// ═══════════════════════════════════════════════════════════════════

private let supportEmailURL: URL? = URL(
    string: "mailto:\(AppConstants.Support.email)?subject=Holistic%20Unity%20—%20supporto"
)

struct SettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.openURL) private var openURL
    @State private var viewModel = AccountViewModel()
    @State private var showDeleteConfirmation = false
    @State private var showSignOutConfirmation = false
    @State private var showDeleteError = false
    @State private var deleteError: String = ""

    private var userName: String {
        let trimmed = (authManager.currentUser?.displayName ?? "")
            .trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? String(localized: "Ospite", comment: "Account screen fallback name") : trimmed
    }

    private var userEmail: String {
        authManager.currentUser?.email ?? ""
    }

    private var userInitial: String {
        let name = userName
        return name.isEmpty ? "·" : String(name.prefix(1)).uppercased()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HUSpacing.xl) {
                    accountHero
                    statsRibbon
                    if let intentionLabel = viewModel.intentionLabel {
                        intentionCard(label: intentionLabel, setOn: viewModel.intentionSetOn)
                    }
                    accountGroup
                    experienceGroup
                    privacyGroup
                    supportGroup
                    dangerZone
                    #if DEBUG
                    // Sentry verification panel — DEBUG builds only.
                    // Stripped from release builds via #if DEBUG so it
                    // can never ship to App Store. Two buttons:
                    //   1. Non-fatal capture: sends a test event,
                    //      keeps the app alive. Use this for routine
                    //      "is the wire still hot" verification.
                    //   2. fatalError: deliberately crashes the app
                    //      so we can confirm the crash reporter and
                    //      dSYM symbolication are working end-to-end.
                    VStack(alignment: .leading, spacing: HUSpacing.md) {
                        Text("Sentry test (DEBUG only)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Capture non-fatal test event") {
                            SentrySDK.capture(message: "Sentry test event — non-fatal from SettingsView")
                        }
                        .buttonStyle(.bordered)
                        Button("Crash app (fatalError)") {
                            fatalError("Sentry test event — fatalError from SettingsView")
                        }
                        .buttonStyle(.bordered)
                        .tint(.red)
                    }
                    .padding(HUSpacing.lg)
                    .background(Color.yellow.opacity(0.08))
                    .cornerRadius(12)
                    #endif
                    versionFooter
                }
                .padding(.horizontal, HUSpacing.xl)
                .padding(.top, HUSpacing.lg)
                .padding(.bottom, HUSpacing.xxl)
            }
            .background(HUColor.background)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Esci", isPresented: $showSignOutConfirmation) {
                Button("Annulla", role: .cancel) {}
                Button("Esci", role: .destructive) {
                    Task { await authManager.signOut() }
                }
            } message: {
                Text("Vuoi davvero uscire dal tuo account?")
            }
            .alert("Eliminazione fallita", isPresented: $showDeleteError) {
                Button("OK") {}
            } message: {
                Text("Non riusciamo a eliminare l'account: \(deleteError). Riprova o scrivici a \(AppConstants.Support.email).")
            }
            .alert("Elimina account", isPresented: $showDeleteConfirmation) {
                Button("Annulla", role: .cancel) {}
                Button("Elimina", role: .destructive) {
                    Task {
                        do {
                            try await DIContainer.shared.authRepository.deleteAccount()
                            await authManager.signOut()
                        } catch {
                            deleteError = error.localizedDescription
                            showDeleteError = true
                        }
                    }
                }
            } message: {
                Text("L'azione è irreversibile. Tutti i tuoi dati verranno eliminati.")
            }
        }
        .task {
            await viewModel.load(authManager: authManager)
        }
    }

    // MARK: - Hero

    private var accountHero: some View {
        HStack(alignment: .center, spacing: HUSpacing.lg) {
            // Painted gradient avatar — initial in Fraunces, matches
            // the design's hero portrait (linear pink → magenta-50).
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [HUColor.tilePink, HUColor.brandMagenta.opacity(0.15)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 80, height: 80)
                    .shadow(color: HUColor.primary.opacity(0.15), radius: 16, y: 6)
                if let imageURL = authManager.currentUser?.photoURL {
                    AsyncImage(url: imageURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        initialMark
                    }
                    .frame(width: 80, height: 80)
                    .clipShape(Circle())
                } else {
                    initialMark
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                if let year = viewModel.memberSinceYear {
                    Text("MEMBRO DAL \(String(year))")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(2.0)
                        .foregroundStyle(HUColor.brandGold)
                } else {
                    Text("MEMBRO")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(2.0)
                        .foregroundStyle(HUColor.brandGold)
                }
                Text(userName)
                    .font(HUFont.displayHeadline(size: 26, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                if !userEmail.isEmpty {
                    Text(userEmail)
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var initialMark: some View {
        Text(userInitial)
            .font(.custom("Fraunces72pt-SemiBold", size: 30))
            .foregroundStyle(HUColor.primary)
    }

    // MARK: - Stats ribbon

    private var statsRibbon: some View {
        HStack(spacing: HUSpacing.sm) {
            statCard(value: viewModel.completedSessions, label: "Sessioni")
            statCard(value: viewModel.distinctTherapists, label: "Operatori")
            statCard(value: viewModel.monthsInJourney, label: "Mesi")
        }
    }

    private func statCard(value: Int, label: String) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.custom("Fraunces72pt-SemiBold", size: 26))
                .foregroundStyle(HUColor.primary)
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(HUColor.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HUSpacing.md)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: HURadius.lg)
                .strokeBorder(HUColor.divider, lineWidth: 1)
        )
    }

    // MARK: - Intention card

    private func intentionCard(label: String, setOn: String?) -> some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: HUSpacing.sm) {
                Text("LA TUA INTENZIONE")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2.0)
                    .foregroundStyle(HUColor.brandGoldLight)

                Text("\u{201C}\(label)\u{201D}")
                    .font(.custom("Fraunces72pt-Italic", size: 22))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                if let setOn {
                    Text("Impostata \(setOn)")
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
            .padding(HUSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)

            // Decorative gold orb in the corner — matches design.
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
        .background(PrimaryGradient.linear)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
        .shadow(color: HUColor.primary.opacity(0.25), radius: 18, y: 8)
    }

    // MARK: - Menu groups

    private var accountGroup: some View {
        menuGroup(title: "Account") {
            menuRow(icon: "person.fill", tint: HUColor.brandMagenta, title: "Modifica profilo") {
                EditProfileView()
            }
            menuRow(icon: "creditcard.fill", tint: HUColor.brandMagenta, title: "Metodi di pagamento") {
                PaymentMethodsView()
            }
            menuRow(icon: "clock.arrow.circlepath", tint: HUColor.brandMagenta, title: "Storico pagamenti") {
                PaymentHistoryView()
            }
        }
    }

    private var experienceGroup: some View {
        menuGroup(title: "Esperienza") {
            menuRow(icon: "bell.fill", tint: HUColor.brandMagenta, title: "Notifiche") {
                NotificationSettingsView()
            }
            menuRow(icon: "globe", tint: HUColor.brandMagenta, title: "Lingua") {
                LanguageSettingsView()
            }
            // "Aspetto" removed 2026-05-16 — app is light-only by
            // brand decision; theme picker would be a dead end.
        }
    }

    private var privacyGroup: some View {
        menuGroup(title: "Privacy") {
            menuRow(icon: "lock.shield.fill", tint: HUColor.brandMagenta, title: "Privacy e sicurezza") {
                PrivacySettingsView()
            }
            menuRow(icon: "doc.text.fill", tint: HUColor.brandMagenta, title: "Termini di servizio") {
                LegalTextView(title: "Termini di servizio", text: AppConstants.Legal.termsOfService)
            }
            menuRow(icon: "hand.raised.fill", tint: HUColor.brandMagenta, title: "Privacy policy") {
                LegalTextView(title: "Privacy policy", text: AppConstants.Legal.privacyPolicy)
            }
        }
    }

    /// Single contact channel — opens the system mail composer with a
    /// pre-filled subject. No in-app chat, no ticket queue, no FAQ
    /// stub: support is humans answering email at our address.
    private var supportGroup: some View {
        menuGroup(title: "Supporto") {
            Button {
                HUHaptic.impact(.light)
                if let supportEmailURL {
                    openURL(supportEmailURL)
                } else {
                    settingsLogger.error("Invalid support email URL")
                }
            } label: {
                menuRowContent(
                    icon: "envelope.fill",
                    tint: HUColor.brandMagenta,
                    title: "Contattaci",
                    detail: AppConstants.Support.email,
                    showsChevron: false,
                    danger: false
                )
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Danger zone

    private var dangerZone: some View {
        VStack(spacing: HUSpacing.sm) {
            Button {
                HUHaptic.notification(.warning)
                showSignOutConfirmation = true
            } label: {
                menuRowContent(
                    icon: "rectangle.portrait.and.arrow.right",
                    tint: HUColor.error.opacity(0.9),
                    title: "Esci",
                    detail: nil,
                    showsChevron: false,
                    danger: true
                )
                .padding(HUSpacing.md)
                .background(HUColor.background)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
                .overlay(
                    RoundedRectangle(cornerRadius: HURadius.xl)
                        .strokeBorder(HUColor.divider, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            Button {
                HUHaptic.notification(.warning)
                showDeleteConfirmation = true
            } label: {
                menuRowContent(
                    icon: "trash.fill",
                    tint: HUColor.error,
                    title: "Elimina account",
                    detail: nil,
                    showsChevron: false,
                    danger: true
                )
                .padding(HUSpacing.md)
                .background(HUColor.background)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
                .overlay(
                    RoundedRectangle(cornerRadius: HURadius.xl)
                        .strokeBorder(HUColor.error.opacity(0.3), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        }
    }

    private var versionFooter: some View {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        return Text("Holistic Unity · v\(version)")
            .font(.system(size: 11))
            .foregroundStyle(HUColor.textTertiary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, HUSpacing.md)
    }

    // MARK: - Menu primitives

    private func menuGroup<Content: View>(
        title: String,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .bold))
                .tracking(2.0)
                .foregroundStyle(HUColor.brandGold)

            VStack(spacing: 0) {
                content()
            }
            .background(HUColor.background)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay(
                RoundedRectangle(cornerRadius: HURadius.xl)
                    .strokeBorder(HUColor.divider, lineWidth: 1)
            )
        }
    }

    /// Standard NavigationLink row inside a menu group.
    @ViewBuilder
    private func menuRow<Destination: View>(
        icon: String,
        tint: Color,
        title: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink(destination: destination()) {
            menuRowContent(icon: icon, tint: tint, title: title, detail: nil, showsChevron: true, danger: false)
        }
        .buttonStyle(.plain)
    }

    /// Visual content of a single row — extracted so it can be used
    /// inside both NavigationLink (auto-chevron suppressed) and a
    /// plain Button (mailto, sign out, delete).
    private func menuRowContent(
        icon: String,
        tint: Color,
        title: String,
        detail: String?,
        showsChevron: Bool,
        danger: Bool
    ) -> some View {
        HStack(spacing: HUSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(tint.opacity(0.12))
                    .frame(width: 32, height: 32)
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(tint)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(danger ? HUColor.error : HUColor.textPrimary)
                if let detail {
                    Text(detail)
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(HUColor.textTertiary)
            }
        }
        .padding(.horizontal, HUSpacing.md)
        .padding(.vertical, HUSpacing.md)
    }
}

// MARK: - Account view model

/// Loads the editorial bits of the Account screen — member-since
/// year, completed-session count, distinct therapists, months in
/// journey, and the user's chosen onboarding intention. All queries
/// are read-only and silently no-op on failure (the screen still
/// renders with the hero + menus even if these can't load).
@MainActor
@Observable
final class AccountViewModel {
    var memberSinceYear: Int?
    var completedSessions: Int = 0
    var distinctTherapists: Int = 0
    var monthsInJourney: Int = 0
    var intentionLabel: String?
    var intentionSetOn: String?

    func load(authManager: AuthManager) async {
        guard let userId = authManager.currentUser?.id else { return }
        async let stats: () = loadBookingStats(userId: userId)
        async let intent: () = loadIntention(userId: userId)
        async let member: () = loadMemberSince(userId: userId)
        _ = await (stats, intent, member)
    }

    /// Pulls just the rows we need (status + therapist_id + scheduled_at)
    /// to compute the three counters without a heavy join.
    private func loadBookingStats(userId: String) async {
        struct Row: Decodable {
            let status: String
            let therapist_id: String
            let scheduled_at: String?
        }
        do {
            let rows: [Row] = try await SupabaseConfig.client
                .from("bookings")
                .select("status,therapist_id,scheduled_at")
                .eq("client_id", value: userId)
                .execute()
                .value
            let completed = rows.filter { $0.status == "completed" }
            completedSessions = completed.count
            distinctTherapists = Set(completed.map(\.therapist_id)).count

            // "Mesi in cammino" — months between the FIRST booking
            // (any status, since it marks when the user joined the
            // path) and now. Floor at 0, cap at 999 for display.
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let dates = rows.compactMap { row -> Date? in
                guard let s = row.scheduled_at else { return nil }
                return formatter.date(from: s) ?? ISO8601DateFormatter().date(from: s)
            }
            if let earliest = dates.min() {
                let comps = Calendar.current.dateComponents([.month], from: earliest, to: Date())
                monthsInJourney = max(0, min(comps.month ?? 0, 999))
            }
        } catch {
            // Leave counters at zero — the screen just shows 0s.
        }
    }

    private func loadIntention(userId: String) async {
        struct Row: Decodable {
            let intent: String?
            let completed_at: String?
        }
        do {
            let rows: [Row] = try await SupabaseConfig.client
                .from("client_preferences")
                .select("intent,completed_at")
                .eq("user_id", value: userId)
                .limit(1)
                .execute()
                .value
            guard let row = rows.first, let raw = row.intent,
                  let intent = OnboardingIntent(rawValue: raw) else { return }
            intentionLabel = intent.label
            if let completedAt = row.completed_at {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: completedAt) ?? ISO8601DateFormatter().date(from: completedAt) {
                    let df = DateFormatter()
                    df.locale = Locale(identifier: "it_IT")
                    df.dateFormat = "d MMMM yyyy"
                    intentionSetOn = df.string(from: date)
                }
            }
        } catch {
            // No intention card — that's fine, it's optional.
        }
    }

    private func loadMemberSince(userId: String) async {
        struct Row: Decodable { let created_at: String? }
        do {
            let rows: [Row] = try await SupabaseConfig.client
                .from("users")
                .select("created_at")
                .eq("id", value: userId)
                .limit(1)
                .execute()
                .value
            guard let raw = rows.first?.created_at else { return }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return }
            memberSinceYear = Calendar.current.component(.year, from: date)
        } catch {
            // Hero just shows "MEMBRO" with no year.
        }
    }
}

// MARK: - Edit Profile View

struct EditProfileView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(AppState.self) private var appState
    @State private var displayName: String = ""
    @State private var phone: String = ""
    @State private var bio: String = ""
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var selectedPhotoData: Data?
    @State private var photoURL: URL?
    @State private var isSaving = false
    @State private var isUploadingPhoto = false
    @State private var saveError: String?
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        Form {
            Section {
                HStack {
                    Spacer()
                    VStack(spacing: HUSpacing.sm) {
                        if let photoData = selectedPhotoData,
                           let uiImage = UIImage(data: photoData) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 80, height: 80)
                                .clipShape(Circle())
                        } else {
                            HUAvatar(url: photoURL, name: displayName.isEmpty ? "?" : displayName, size: 80)
                        }
                        
                        PhotosPicker(
                            selection: $selectedPhotoItem,
                            matching: .images,
                            photoLibrary: .shared()
                        ) {
                            Text(isUploadingPhoto ? "Uploading..." : "Change Photo")
                                .font(HUFont.caption(weight: .semibold))
                                .foregroundStyle(HUColor.primary)
                        }
                        .disabled(isUploadingPhoto)
                        .onChange(of: selectedPhotoItem) { _, newItem in
                            Task { await loadPhoto(from: newItem) }
                        }
                    }
                    Spacer()
                }
                .listRowBackground(Color.clear)
            }
            
            Section("Personal Information") {
                TextField("Display Name", text: $displayName)
                TextField("Phone Number", text: $phone)
                #if os(iOS)
                    .keyboardType(.phonePad)
                #endif
            }
            
            Section("About") {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $bio)
                        .font(HUFont.body())
                        .foregroundStyle(HUColor.textPrimary)
                        .frame(minHeight: 100)
                        .scrollContentBackground(.hidden)
                    
                    if bio.isEmpty {
                        Text("Tell us about yourself...")
                            .font(HUFont.body())
                            .foregroundStyle(HUColor.textTertiary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 8)
                            .allowsHitTesting(false)
                    }
                }
            }
        }
        .navigationTitle("Edit Profile")
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            displayName = authManager.currentUser?.displayName ?? ""
            phone = authManager.currentUser?.phoneNumber ?? ""
            photoURL = authManager.currentUser?.photoURL
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task { await saveProfile() }
                }
                .font(HUFont.body(weight: .semibold))
                .foregroundStyle(HUColor.primary)
                .disabled(isSaving || isUploadingPhoto)
            }
        }
        .alert("Save Failed", isPresented: .init(
            get: { saveError != nil },
            set: { if !$0 { saveError = nil } }
        )) {
            Button("OK") { saveError = nil }
        } message: {
            Text(saveError ?? "")
        }
    }
    
    private func loadPhoto(from item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            if let data = try await item.loadTransferable(type: Data.self) {
                selectedPhotoData = data
            }
        } catch {
            // Photo load failed — picker remains available to retry
        }
    }
    
    private func saveProfile() async {
        guard let userId = authManager.currentUser?.id else { return }
        isSaving = true
        
        // Upload photo if a new one was selected
        var uploadedPhotoURL: URL?
        if let photoData = selectedPhotoData {
            isUploadingPhoto = true
            do {
                let path = "\(userId)/profile.jpg"
                uploadedPhotoURL = try await SupabaseStorageService.shared.uploadImage(
                    bucket: "profile-photos",
                    path: path,
                    data: photoData
                )
            } catch {
                // Upload failed — profile saves without new photo
            }
            isUploadingPhoto = false
        }
        
        let now = ISO8601DateFormatter.shared.string(from: Date())
        
        struct ProfileUpdate: Encodable {
            let displayName: String
            let phoneNumber: String
            let photoUrl: String?
            let updatedAt: String
            
            enum CodingKeys: String, CodingKey {
                case displayName = "display_name"
                case phoneNumber = "phone_number"
                case photoUrl = "photo_url"
                case updatedAt = "updated_at"
            }
        }
        
        do {
            try await SupabaseConfig.client
                .from("users")
                .update(ProfileUpdate(
                    displayName: displayName,
                    phoneNumber: phone,
                    photoUrl: uploadedPhotoURL?.absoluteString ?? photoURL?.absoluteString,
                    updatedAt: now
                ))
                .eq("id", value: userId)
                .execute()
            
            authManager.currentUser?.displayName = displayName
            authManager.currentUser?.phoneNumber = phone
            if let uploadedPhotoURL {
                authManager.currentUser?.photoURL = uploadedPhotoURL
            }
            isSaving = false
            appState.showToast(.success, message: "Profile saved!")
            dismiss()
        } catch {
            saveError = "Failed to save profile: \(error.localizedDescription)"
            isSaving = false
        }
    }
}

// MARK: - Notification Settings View

/// Trimmed 2026-05-16: removed Email Notifications, Promotions/Offers,
/// Weekly Digest, and the Marketing-consent DTO. Email is handled by
/// transactional triggers (booking confirmations, reminders) and is
/// not user-toggleable in app — Brevo / unsubscribe-link is the legal
/// off-switch. Marketing is now opt-in only at sign-up time and not
/// surfaced as an in-app toggle (drop-off without value).
///
/// What remains is the genuinely useful subset: master push switch,
/// booking reminder cadence (only when push is on), new-message
/// alerts. All three actually drive `PushNotificationService` behavior
/// server-side; nothing here is a placeholder.
struct NotificationSettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @AppStorage("hu_push_enabled") private var pushEnabled = true
    @AppStorage("hu_booking_reminders") private var bookingReminders = true
    @AppStorage("hu_message_alerts") private var messageAlerts = true
    @AppStorage("hu_reminder_timing") private var reminderTiming = "30min"

    var body: some View {
        Form {
            Section {
                Toggle("Notifiche push", isOn: $pushEnabled)
                    .onChange(of: pushEnabled) { _, newValue in
                        HUHaptic.selection()
                        if newValue {
                            Task {
                                await PushNotificationService.shared.requestPermissionAndRegister()
                            }
                        }
                        syncPreferences()
                    }
            } footer: {
                Text("L'autorizzazione di sistema iOS rimane comunque la fonte di verità: se la disattivi qui o nelle Impostazioni iOS, non ricevi nulla.")
            }

            Section("Promemoria sessione") {
                Toggle("Avvisami prima della sessione", isOn: $bookingReminders)
                    .disabled(!pushEnabled)
                    .onChange(of: bookingReminders) { _, _ in
                        HUHaptic.selection()
                        syncPreferences()
                    }

                if bookingReminders {
                    Picker("Quanto prima", selection: $reminderTiming) {
                        Text("15 minuti").tag("15min")
                        Text("30 minuti").tag("30min")
                        Text("1 ora").tag("1hr")
                        Text("1 giorno").tag("1day")
                    }
                    .onChange(of: reminderTiming) { _, _ in
                        HUHaptic.selection()
                        syncPreferences()
                    }
                }
            }

            Section("Messaggi") {
                Toggle("Nuovi messaggi", isOn: $messageAlerts)
                    .disabled(!pushEnabled)
                    .onChange(of: messageAlerts) { _, _ in
                        HUHaptic.selection()
                        syncPreferences()
                    }
            }
        }
        .navigationTitle("Notifiche")
    }

    private func syncPreferences() {
        guard let userId = authManager.currentUser?.id else { return }
        Task {
            await PushNotificationService.shared.syncPreferences(
                userId: userId,
                pushEnabled: pushEnabled,
                bookingReminders: bookingReminders,
                newMessages: messageAlerts,
                sessionReminders: bookingReminders,
                promotional: false  // Marketing/promo flag is no longer user-toggleable here
            )
        }
    }
}

// AppearanceSettingsView removed 2026-05-16 — the app is locked to
// light appearance via `UIUserInterfaceStyle = Light` in Info.plist
// (brand palette + painted illustrations are light-only). Text size
// belongs to iOS Dynamic Type, not an app-level slider.

// MARK: - Payment Methods View

struct PaymentMethodsView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var paymentMethods: [SavedPaymentMethod] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    
    var body: some View {
        List {
            if isLoading {
                Section {
                    HULoadingView(message: "Loading payment methods…")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, HUSpacing.xl)
                }
            } else if paymentMethods.isEmpty {
                Section {
                    VStack(spacing: HUSpacing.md) {
                        Image("empty_payment_methods")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 120, height: 120)
                        Text("No saved cards")
                            .font(HUFont.subheadline())
                            .foregroundStyle(HUColor.textSecondary)
                        Text("Cards are saved automatically when you complete a booking payment.")
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textTertiary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, HUSpacing.xl)
                }
            } else {
                Section("Saved Cards") {
                    ForEach(paymentMethods) { method in
                        HStack(spacing: HUSpacing.md) {
                            Image(systemName: cardIcon(for: method.brand))
                                .font(.title2)
                                .foregroundStyle(HUColor.primary)
                                .frame(width: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(method.brand.capitalized)
                                    .font(HUFont.body(weight: .medium))
                                Text("•••• \(method.last4)")
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.textSecondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                if method.isDefault {
                                    Text("Default")
                                        .font(.system(size: 10, weight: .semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(HUColor.success.opacity(0.15))
                                        .foregroundStyle(HUColor.success)
                                        .clipShape(Capsule())
                                }
                                Text("Exp \(String(format: "%02d", method.expiryMonth))/\(String(method.expiryYear % 100))")
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.textTertiary)
                            }
                        }
                    }
                    .onDelete(perform: deleteMethod)
                }
            }
            
            if let error = errorMessage {
                Section {
                    Text(error)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.error)
                }
            }
            
            Section {
                VStack(alignment: .leading, spacing: HUSpacing.sm) {
                    Label("Secure Payments", systemImage: "shield.checkmark.fill")
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.primary)
                    Text("All transactions are processed through Stripe, a PCI-compliant payment provider. Your card details are never stored on our servers.")
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                }
                .padding(.vertical, HUSpacing.xs)
            }
        }
        .navigationTitle("Payment Methods")
        .task { await loadPaymentMethods() }
    }
    
    private func loadPaymentMethods() async {
        guard let userId = authManager.currentUser?.id else {
            isLoading = false
            return
        }
        do {
            paymentMethods = try await DIContainer.shared.paymentRepository.getSavedPaymentMethods(clientId: userId)
        } catch {
            errorMessage = "Could not load payment methods."
        }
        isLoading = false
    }
    
    private func deleteMethod(at offsets: IndexSet) {
        let methodsToDelete = offsets.map { paymentMethods[$0] }
        paymentMethods.remove(atOffsets: offsets)
        
        Task {
            for method in methodsToDelete {
                try? await DIContainer.shared.paymentRepository.removePaymentMethod(methodId: method.id)
            }
        }
    }
    
    private func cardIcon(for brand: String) -> String {
        switch brand.lowercased() {
        case "visa": return "creditcard.fill"
        case "mastercard": return "creditcard.fill"
        case "amex": return "creditcard.fill"
        default: return "creditcard.fill"
        }
    }
}

// MARK: - Privacy Settings View

/// Trimmed 2026-05-16: removed Profile Visibility, Online Status,
/// Read Receipts, Location Sharing, Clear Search History, Blocked
/// Users (none of these were wired to anything — Stream Chat handles
/// online/receipts internally; we have no location-based discovery;
/// no block-list table exists). What survives is what genuinely
/// affects the user's privacy posture: device biometric lock, the
/// transparency block, analytics opt-out, GDPR research consent, and
/// the Article 15 data-export.
struct PrivacySettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @AppStorage("hu_analytics_enabled") private var analyticsEnabled = true
    @AppStorage("hu_biometric_enabled") private var biometricEnabled = false
    @State private var showDataExportAlert = false
    @State private var showBiometricError = false
    @State private var biometricErrorMessage = ""
    @State private var isExporting = false
    @State private var exportMessage = "Una copia dei tuoi dati verrà inviata al tuo indirizzo email entro 48 ore."
    // Research-data consent — backed by `client_preferences.research_consent`.
    @State private var researchConsent = false
    @State private var researchConsentLoading = false

    private var biometricType: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none: return "Blocco biometrico"
        @unknown default: return "Blocco biometrico"
        }
    }

    var body: some View {
        Form {
            Section {
                Toggle(biometricType, isOn: $biometricEnabled)
                    .onChange(of: biometricEnabled) { _, newValue in
                        if newValue { verifyBiometric() }
                    }
            } header: {
                Text("Sicurezza")
            } footer: {
                Text("Quando attivo, dovrai sbloccare con \(biometricType) ogni volta che apri l'app.")
            }

            // Plain-language explanation of how data is protected
            Section {
                VStack(alignment: .leading, spacing: HUSpacing.md) {
                    Label("I tuoi dati sono protetti", systemImage: "lock.shield.fill")
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.primary)

                    VStack(alignment: .leading, spacing: HUSpacing.sm) {
                        encryptionBullet(icon: "message.fill", text: "I messaggi con il tuo operatore sono protetti in transito e conservati in modo sicuro dal nostro provider chat.")
                        encryptionBullet(icon: "video.fill", text: "Le videocall usano connessioni LiveKit cifrate. Holistic Unity non registra nulla.")
                        encryptionBullet(icon: "person.fill", text: "Le tue informazioni personali non vengono mai vendute a terze parti.")
                        encryptionBullet(icon: "creditcard.fill", text: "I pagamenti sono gestiti da Stripe — non vediamo mai il tuo numero di carta.")
                    }
                }
                .padding(.vertical, HUSpacing.xs)
            } header: {
                Text("Come proteggiamo i tuoi dati")
            }

            Section {
                Toggle("Analytics di prodotto", isOn: $analyticsEnabled)

                // Research-data consent (opt-in, GDPR Art. 7(2)).
                Toggle(isOn: $researchConsent) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Aiuta l'ecosistema olistico")
                            .foregroundStyle(HUColor.textPrimary)
                        Text("Uso anonimo e aggregato delle tue risposte di onboarding per report di settore. Nessun dato identificabile.")
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textSecondary)
                    }
                }
                .disabled(researchConsentLoading)
                .onChange(of: researchConsent) { _, newValue in
                    Task { await updateResearchConsent(newValue) }
                }

                Button {
                    Task { await requestDataExport() }
                } label: {
                    HStack {
                        Text("Scarica i miei dati")
                        if isExporting {
                            Spacer()
                            ProgressView().tint(HUColor.primary)
                        }
                    }
                }
                .foregroundStyle(HUColor.primary)
                .disabled(isExporting)
            } header: {
                Text("Dati")
            } footer: {
                Text("Puoi cambiare il consenso ai dati di ricerca in qualsiasi momento. Nessuna delle tue informazioni personali viene mai condivisa.")
            }
        }
        .navigationTitle("Privacy e sicurezza")
        .alert("Scarica i tuoi dati", isPresented: $showDataExportAlert) {
            Button("OK") {}
        } message: {
            Text(exportMessage)
        }
        .alert("\(biometricType) non disponibile", isPresented: $showBiometricError) {
            Button("OK") {}
        } message: {
            Text(biometricErrorMessage)
        }
        .task {
            await loadResearchConsent()
        }
    }

    /// Reads the current research_consent flag from `client_preferences`.
    /// Silent on failure — leaves the toggle at its default `false` so
    /// the user can re-opt-in if the row is missing for any reason.
    private func loadResearchConsent() async {
        guard let userId = authManager.currentUser?.id else { return }
        struct Row: Decodable { let research_consent: Bool? }
        do {
            let rows: [Row] = try await SupabaseConfig.client
                .from("client_preferences")
                .select("research_consent")
                .eq("user_id", value: userId)
                .limit(1)
                .execute()
                .value
            if let consent = rows.first?.research_consent {
                researchConsent = consent
            }
        } catch {
            // Silently ignore — toggle stays at its default. The
            // user can flip it whenever they want.
        }
    }

    /// Persists a flip of the research-consent toggle. Stamps
    /// `research_consent_at` only when consent goes TRUE so the audit
    /// trail records the moment of opt-in (GDPR Art. 7(1)). When
    /// consent goes FALSE we set the timestamp to NULL — the column
    /// is meaningless without an active consent.
    private func updateResearchConsent(_ newValue: Bool) async {
        guard let userId = authManager.currentUser?.id else { return }
        researchConsentLoading = true
        defer { researchConsentLoading = false }

        struct Update: Encodable {
            let research_consent: Bool
            let research_consent_at: String?
        }
        let payload = Update(
            research_consent: newValue,
            research_consent_at: newValue ? ISO8601DateFormatter.shared.string(from: Date()) : nil
        )

        do {
            // We use update() rather than upsert() because Settings is
            // only reachable AFTER onboarding — the row is guaranteed
            // to exist. If for any reason it doesn't, the update
            // affects 0 rows silently and the user can re-flip later.
            try await SupabaseConfig.client
                .from("client_preferences")
                .update(payload)
                .eq("user_id", value: userId)
                .execute()
        } catch {
            // Revert the toggle on failure so UI matches DB
            researchConsent = !newValue
        }
    }

    private func requestDataExport() async {
        guard let userId = authManager.currentUser?.id else { return }
        isExporting = true

        // GDPR Article 15 ("right of access by the data subject") — we
        // must provide a copy of all personal data we hold. This export
        // covers every public.* table with a column referencing the
        // user. Tables NOT in scope (handled separately or out-of-scope):
        //   • auth.users          — Supabase internal, surfaced only
        //                           as user_id / email (already in `users`)
        //   • payment_methods     — fingerprints stored but real payment
        //                           data lives at Stripe; export from there
        //   • messages (content)  — stored in Stream Chat, not our DB;
        //                           user can export from Stream's UI
        //   • notifications       — transient, not legally required
        //
        // Each fetch is wrapped so a single failure (RLS denied, table
        // missing) doesn't abort the whole export; the user receives
        // whatever we could gather.

        var exportDict: [String: Any] = [
            "exported_at": ISO8601DateFormatter.shared.string(from: Date()),
            "user_id": userId,
            "disclaimer": "Personal data held by Holistic Unity. " +
                "Additional data may exist at third-party processors: " +
                "Stripe (payment methods, transaction receipts), " +
                "Stream Chat (message content), LiveKit (video session " +
                "logs — retained 24h). Request those exports directly " +
                "from each provider."
        ]

        func safeFetch(
            _ key: String,
            _ fetch: () async throws -> Data
        ) async {
            do {
                let data = try await fetch()
                if let parsed = try? JSONSerialization.jsonObject(with: data) {
                    exportDict[key] = parsed
                }
            } catch {
                exportDict[key] = ["error": "unavailable", "detail": "\(error)"]
            }
        }

        await safeFetch("user_profile") {
            try await SupabaseConfig.client.from("users")
                .select().eq("id", value: userId).execute().data
        }
        await safeFetch("bookings") {
            try await SupabaseConfig.client.from("bookings")
                .select().eq("client_id", value: userId).execute().data
        }
        await safeFetch("reviews") {
            try await SupabaseConfig.client.from("reviews")
                .select().eq("client_id", value: userId).execute().data
        }
        await safeFetch("transactions") {
            // User-side financial history. Includes amounts, IVA, payout
            // destination therapist_id but NOT full card details (those
            // live at Stripe and are linked only by the tokenized
            // `stripe_payment_intent_id`).
            try await SupabaseConfig.client.from("transactions")
                .select().eq("user_id", value: userId).execute().data
        }
        await safeFetch("session_credits") {
            try await SupabaseConfig.client.from("session_credits")
                .select().eq("client_id", value: userId).execute().data
        }
        await safeFetch("device_tokens") {
            // Push registration records — tokens are not sensitive on
            // their own, but listing them shows what devices have been
            // paired with this account.
            try await SupabaseConfig.client.from("device_tokens")
                .select().eq("user_id", value: userId).execute().data
        }
        await safeFetch("conversation_participation") {
            // Conversation metadata only — the messages themselves are
            // in Stream Chat. This tells the user which therapists
            // they've chatted with + unread counts.
            try await SupabaseConfig.client.from("conversation_participants")
                .select().eq("user_id", value: userId).execute().data
        }

        do {
            let jsonData = try JSONSerialization.data(
                withJSONObject: exportDict,
                options: [.prettyPrinted, .sortedKeys]
            )
            let tempURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("holistic_unity_data_export.json")
            try jsonData.write(to: tempURL)

            #if os(iOS)
            if let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive })
                as? UIWindowScene,
                let rootVC = scene.windows.first?.rootViewController {
                let activityVC = UIActivityViewController(
                    activityItems: [tempURL],
                    applicationActivities: nil
                )
                rootVC.present(activityVC, animated: true)
            }
            #endif

            exportMessage = "Your data export is ready and has been prepared for sharing."
        } catch {
            exportMessage = "Failed to export data. Please try again later."
        }

        isExporting = false
        showDataExportAlert = true
    }
    
    private func verifyBiometric() {
        let context = LAContext()
        var error: NSError?
        
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            biometricEnabled = false
            biometricErrorMessage = error?.localizedDescription ?? "\(biometricType) is not available on this device."
            showBiometricError = true
            return
        }
        
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Verify your identity to enable \(biometricType) lock") { success, authError in
            DispatchQueue.main.async {
                if !success {
                    biometricEnabled = false
                    if let authError {
                        biometricErrorMessage = authError.localizedDescription
                        showBiometricError = true
                    }
                }
            }
        }
    }
    
    private func encryptionBullet(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: HUSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(HUColor.primary)
                .frame(width: 18, alignment: .center)
                .padding(.top, 2)
            Text(text)
                .font(HUFont.caption())
                .foregroundStyle(HUColor.textSecondary)
        }
    }
}

// HelpSupportView removed 2026-05-16 — replaced by a single
// `mailto:` action in `SettingsView.supportGroup`. The FAQs lived
// only in code, were not maintained, and cluttered the surface.
// Community Guidelines moved into the Terms screen if/when needed.


// MARK: - Language Settings View

struct LanguageSettingsView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var selectedLanguages: Set<String> = []
    @State private var isSaving = false
    @State private var saveErrorMessage: String?
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        List {
            Section(header: Text("Your Languages"), footer: Text("Select the languages you speak. This helps match you with therapists who share your language.")) {
                ForEach(AppConstants.availableLanguages, id: \.self) { language in
                    Button {
                        if selectedLanguages.contains(language) {
                            // Don't allow deselecting the last language
                            if selectedLanguages.count > 1 {
                                selectedLanguages.remove(language)
                            }
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
        }
        .navigationTitle("Language")
        .onAppear {
            selectedLanguages = Set(authManager.currentUser?.preferredLanguages ?? ["English"])
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task { await saveLanguages() }
                }
                .font(HUFont.body(weight: .semibold))
                .foregroundStyle(HUColor.primary)
                .disabled(isSaving)
            }
        }
        .alert("Errore", isPresented: Binding(
            get: { saveErrorMessage != nil },
            set: { if !$0 { saveErrorMessage = nil } }
        )) {
            Button("OK") { saveErrorMessage = nil }
        } message: {
            Text(saveErrorMessage ?? "")
        }
    }
    
    private func saveLanguages() async {
        guard let userId = authManager.currentUser?.id else { return }
        isSaving = true
        
        let languagesArray = Array(selectedLanguages)
        
        struct LanguageUpdate: Encodable {
            let preferredLanguages: [String]
            let updatedAt: String
            
            enum CodingKeys: String, CodingKey {
                case preferredLanguages = "preferred_languages"
                case updatedAt = "updated_at"
            }
        }
        
        // Save MUST surface errors — silent failure means the user sees the
        // sheet dismiss "as if successful" but the DB never changed, and the
        // language reverts on next session. Generates support tickets and
        // erodes trust in the settings screen.
        do {
            try await SupabaseConfig.client
                .from("users")
                .update(LanguageUpdate(
                    preferredLanguages: languagesArray,
                    updatedAt: ISO8601DateFormatter.shared.string(from: Date())
                ))
                .eq("id", value: userId)
                .execute()
            authManager.currentUser?.preferredLanguages = languagesArray
            isSaving = false
            dismiss()
        } catch {
            isSaving = false
            saveErrorMessage = "Impossibile salvare. Controlla la connessione e riprova."
        }
    }
}

// LinkedAccountsView removed 2026-05-16 — Apple/Google linking is
// already handled at sign-in by Supabase auth (one verified email →
// one identity, regardless of provider). The screen was instructional
// only ("re-sign-in with Apple to link") and added no real action.

// MARK: - Legal Text View

struct LegalTextView: View {
    let title: String
    let text: String
    
    var body: some View {
        ScrollView {
            Text(text)
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .padding(HUSpacing.xl)
        }
        .navigationTitle(title)
    }
}
// MARK: - Client Payment History (BL-01)

struct PaymentHistoryView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var payments: [PaymentHistoryItem] = []
    @State private var isLoading = true

    /// Combines transaction amounts with booking service details.
    struct PaymentHistoryItem: Identifiable {
        let id: String
        let serviceName: String
        let dateTime: Date
        let amountPaid: Double      // total charged to client (incl. service fee)
        let sessionPrice: Double    // base session price
        let serviceFee: Double
        let currency: String
        let status: TransactionStatus

        var formattedDate: String {
            let fmt = DateFormatter()
            fmt.dateFormat = "d MMM yyyy 'at' HH:mm"
            return fmt.string(from: dateTime)
        }

        var currencySymbol: String {
            switch currency.lowercased() {
            case "eur": return "\u{20AC}"
            case "gbp": return "\u{00A3}"
            case "brl": return "R$"
            default: return "$"
            }
        }
    }

    var body: some View {
        List {
            if isLoading {
                Section {
                    ProgressView("Loading payment history...")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, HUSpacing.xl)
                }
            } else if payments.isEmpty {
                Section {
                    HUEmptyState(
                        icon: "creditcard.circle",
                        title: "No Payments Yet",
                        message: "Your payment history will appear here after your first session."
                    )
                }
            } else {
                ForEach(payments) { payment in
                    paymentRow(payment)
                }
            }
        }
        .navigationTitle("Payment History")
        .task {
            await loadPayments()
        }
        .refreshable {
            await loadPayments()
        }
    }

    private func paymentRow(_ payment: PaymentHistoryItem) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(payment.serviceName)
                        .font(HUFont.body(weight: .medium))
                        .foregroundStyle(HUColor.textPrimary)
                    Text(payment.formattedDate)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 3) {
                    Text(String(format: "%@%.2f", payment.currencySymbol, payment.amountPaid))
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    transactionStatusBadge(payment.status)
                }
            }

            // Fee breakdown
            if payment.serviceFee > 0 {
                HStack {
                    Text(String(format: "Session %@%.2f + Fee %@%.2f",
                                payment.currencySymbol, payment.sessionPrice,
                                payment.currencySymbol, payment.serviceFee))
                        .font(.system(size: 11))
                        .foregroundStyle(HUColor.textTertiary)
                    Spacer()
                }
                .padding(.top, 4)
            }
        }
        .padding(.vertical, HUSpacing.xxs)
    }

    @ViewBuilder
    private func transactionStatusBadge(_ status: TransactionStatus) -> some View {
        let (text, color): (String, Color) = switch status {
        case .completed: ("Completed", HUColor.success)
        case .refunded: ("Refunded", .orange)
        case .partiallyRefunded: ("Partial Refund", .orange)
        case .failed: ("Failed", HUColor.error)
        case .pending: ("Pending", HUColor.textTertiary)
        case .processing: ("Processing", HUColor.primary)
        }

        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func loadPayments() async {
        guard let userId = authManager.currentUser?.id else { return }
        isLoading = true

        // Load transactions (has actual payment amounts)
        let transactions = (try? await DIContainer.shared.paymentRepository.getTransactionHistory(
            userId: userId, role: .client
        )) ?? []

        // Load bookings to map service names and dates
        let past = (try? await DIContainer.shared.bookingRepository.getPastBookings(userId: userId, role: .client)) ?? []
        let upcoming = (try? await DIContainer.shared.bookingRepository.getUpcomingBookings(userId: userId, role: .client)) ?? []
        let bookingMap = Dictionary(uniqueKeysWithValues: (past + upcoming).map { ($0.id, $0) })

        payments = transactions.map { tx in
            let booking = bookingMap[tx.bookingId]
            return PaymentHistoryItem(
                id: tx.id,
                serviceName: booking?.serviceName ?? "Session",
                dateTime: booking?.scheduledAt ?? tx.createdAt,
                amountPaid: tx.totalCharged ?? tx.amount,
                sessionPrice: tx.amount,
                serviceFee: tx.serviceFee ?? 0,
                currency: tx.currency,
                status: tx.status
            )
        }.sorted { $0.dateTime > $1.dateTime }

        isLoading = false
    }
}

// SupportTicketsView removed 2026-05-16 — superseded by the single
// `mailto:` action in `SettingsView.supportGroup`. There was no
// server-side ticket system; the screen was an instructional stub
// telling the user to email support, which we now do directly.
