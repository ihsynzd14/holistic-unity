import SwiftUI
import Observation
import Supabase

// ═══════════════════════════════════════════════════════════════════
//  Client Onboarding — full web parity (2026-05-16)
//
//  Mirrors `client-webapp/src/app/welcome/page.tsx` exactly. iOS and
//  the web ask the same 9 questions in the same order, save to the
//  same `client_preferences` row, and surface the same matchmaking
//  recommendations on the closing screen.
//
//  Logical step sequence:
//      0. Welcome           — painted serif hero, no progress chrome
//      1. Intent            — single, 5 cards
//      2. Focus areas       — multi, 8 cards (min 1)
//      3. Familiar practices— multi, 10 painted tiles + "non conosco" sentinel
//      4. Approaches        — multi, 6 cards (min 1)
//      5. Timing            — single, 4 cards
//      6. Life season       — single, 6 cards   ← added 2026-05-16
//      7. Current practices — multi, 9 chips    ← added 2026-05-16
//      8. Cosmic marker     — single optional   ← added 2026-05-16
//      9. Notes             — text optional
//     10. Ritual + Reveal   — breathing → 3 practices + 3 therapists
//                              + GDPR research consent toggle + CTA
//
//  Welcome and Ritual sit OUTSIDE the progress bar (they're emotional
//  bookends, not "form steps"). The bar shows 1/9 … 9/9 for the
//  in-between screens.
//
//  No medical / clinical language anywhere — the web has the same
//  rule documented in steps.ts. Always "esplorazione", "pratica",
//  "operatore"; never "cura", "diagnosi", "terapia".
// ═══════════════════════════════════════════════════════════════════

// MARK: - Step enum

enum OnboardingStep: String {
    case welcome
    case intent
    case focusAreas
    case familiarPractices
    case approaches
    case timing
    case lifeSeason
    case currentPractices
    case cosmicMarker
    case notes
    case ritual
}

// MARK: - Recommendation row data

/// Snapshot of a `practices` row used by the reveal screen.
struct RecommendedPractice: Identifiable, Equatable {
    let slug: String
    let title: String
    let tagline: String
    let categoryKey: String

    var id: String { slug }
}

/// Snapshot of a `therapist_profiles_public` row used by the reveal
/// screen. Fields mirror what the web fetches.
struct RecommendedTherapist: Identifiable, Equatable {
    let id: String
    let displayName: String?
    let tagline: String?
    let photoURL: String?
    let city: String?
    let averageRating: Double?
    let totalReviews: Int?
    let isVerified: Bool?
    let hasMFA: Bool?
    let categories: [String]?
}

// MARK: - View Model

@MainActor
@Observable
final class ClientOnboardingViewModel {
    var currentStep = 0
    var answers = OnboardingAnswers()

    // Matchmaking results (loaded just before the reveal screen)
    var recommendedPractices: [RecommendedPractice] = []
    var recommendedTherapists: [RecommendedTherapist] = []
    var matchmakingLoading = false

    var isLoading = false
    var errorMessage: String?

    /// Full sequence including welcome + ritual.
    var stepSequence: [OnboardingStep] {
        [
            .welcome,
            .intent,
            .focusAreas,
            .familiarPractices,
            .approaches,
            .timing,
            .lifeSeason,
            .currentPractices,
            .cosmicMarker,
            .notes,
            .ritual
        ]
    }

    var totalSteps: Int { stepSequence.count }

    var currentLogicalStep: OnboardingStep {
        stepSequence[min(currentStep, stepSequence.count - 1)]
    }

    /// Steps that show inside the progress bar — everything except
    /// welcome and ritual.
    var progressSequence: [OnboardingStep] {
        stepSequence.filter { $0 != .welcome && $0 != .ritual }
    }

    var progressIndex: Int {
        progressSequence.firstIndex(of: currentLogicalStep) ?? -1
    }

    var showsProgressBar: Bool { progressIndex >= 0 }

    /// Per-step validation. Most steps have a sentinel "non saprei" /
    /// "nessuna" option so the user always has a way to advance.
    /// Cosmic marker and notes are explicitly optional and can be
    /// skipped via a dedicated button.
    var canAdvance: Bool {
        switch currentLogicalStep {
        case .welcome:           return true
        case .intent:            return answers.intent != nil
        case .focusAreas:        return !answers.focusAreas.isEmpty
        case .familiarPractices: return !answers.familiarPractices.isEmpty
        case .approaches:        return !answers.approaches.isEmpty
        case .timing:            return answers.timing != nil
        case .lifeSeason:        return answers.lifeSeason != nil
        case .currentPractices:  return !answers.currentPractices.isEmpty
        case .cosmicMarker:      return true   // optional — skip allowed
        case .notes:             return true   // optional — skip allowed
        case .ritual:            return true
        }
    }

    func advance() {
        guard currentStep < totalSteps - 1 else { return }
        // Pre-load matchmaking when we leave Notes, so the reveal
        // screen has data ready before it animates in.
        let next = currentStep + 1
        let nextLogical = stepSequence[min(next, stepSequence.count - 1)]
        if nextLogical == .ritual {
            Task { await loadMatchmaking() }
        }
        withAnimation(HUAnimation.standard) { currentStep += 1 }
    }

    func goBack() {
        guard currentStep > 0 else { return }
        withAnimation(HUAnimation.standard) { currentStep -= 1 }
    }

    // MARK: Toggle helpers

    func toggleFocus(_ area: FocusArea) {
        if answers.focusAreas.contains(area) {
            answers.focusAreas.remove(area)
        } else {
            answers.focusAreas.insert(area)
        }
    }

    /// Familiar-practices picker: tapping `.none` clears all other
    /// selections (and vice-versa) — same behavior as the web.
    func toggleFamiliarPractice(_ practice: FamiliarPractice) {
        if practice == .none {
            if answers.familiarPractices.contains(.none) {
                answers.familiarPractices.removeAll()
            } else {
                answers.familiarPractices = [.none]
            }
        } else {
            answers.familiarPractices.remove(.none)
            if answers.familiarPractices.contains(practice) {
                answers.familiarPractices.remove(practice)
            } else {
                answers.familiarPractices.insert(practice)
            }
        }
    }

    func toggleApproach(_ approach: Approach) {
        if answers.approaches.contains(approach) {
            answers.approaches.remove(approach)
        } else {
            answers.approaches.insert(approach)
        }
    }

    /// Current-practices: tapping `.none` clears the rest, mirrors the
    /// familiar-practices behavior.
    func toggleCurrentPractice(_ practice: CurrentPractice) {
        if practice == .none {
            if answers.currentPractices.contains(.none) {
                answers.currentPractices.removeAll()
            } else {
                answers.currentPractices = [.none]
            }
        } else {
            answers.currentPractices.remove(.none)
            if answers.currentPractices.contains(practice) {
                answers.currentPractices.remove(practice)
            } else {
                answers.currentPractices.insert(practice)
            }
        }
    }

    // MARK: Matchmaking

    /// Pulls top-3 practices and top-3 therapists from Supabase using
    /// the same algorithm the web runs. Failure is silent — the reveal
    /// screen falls back to a generic "all modalities" message rather
    /// than blocking onboarding completion.
    func loadMatchmaking() async {
        matchmakingLoading = true
        defer { matchmakingLoading = false }

        let recommendedKeys = OnboardingMatchmaker.recommendPractices(answers, n: 3)
        guard !recommendedKeys.isEmpty else {
            recommendedPractices = []
            recommendedTherapists = []
            return
        }

        // Practices
        do {
            let practiceRows: [PracticeRow] = try await SupabaseConfig.client
                .from("practices")
                .select("slug,title,tagline,category_key")
                .in("category_key", values: recommendedKeys)
                .eq("is_published", value: true)
                .execute()
                .value

            // Preserve recommended order
            recommendedPractices = recommendedKeys.compactMap { key in
                practiceRows.first { $0.category_key == key }
            }.map {
                RecommendedPractice(
                    slug: $0.slug,
                    title: $0.title,
                    tagline: $0.tagline ?? "",
                    categoryKey: $0.category_key
                )
            }
        } catch {
            recommendedPractices = []
        }

        // Therapists — convert PascalCase practice keys to kebab-case
        // category keys (the format actually stored in
        // therapist_profiles_public.categories[]).
        let therapistKeys = recommendedKeys.map(OnboardingMatchmaker.therapistCategoryKey)
        do {
            let therapistRows: [TherapistRow] = try await SupabaseConfig.client
                .from("therapist_profiles_public")
                .select("id,display_name,tagline,photo_url,city,average_rating,total_reviews,is_verified,has_mfa,categories")
                .overlaps("categories", value: therapistKeys)
                .order("average_rating", ascending: false, nullsFirst: false)
                .limit(3)
                .execute()
                .value

            recommendedTherapists = therapistRows.map {
                RecommendedTherapist(
                    id: $0.id,
                    displayName: $0.display_name,
                    tagline: $0.tagline,
                    photoURL: $0.photo_url,
                    city: $0.city,
                    averageRating: $0.average_rating,
                    totalReviews: $0.total_reviews,
                    isVerified: $0.is_verified,
                    hasMFA: $0.has_mfa,
                    categories: $0.categories
                )
            }
        } catch {
            recommendedTherapists = []
        }
    }

    // MARK: Persist + finish

    /// Upserts the full answer set into `client_preferences` and tells
    /// AuthManager that onboarding is complete. Notification permission
    /// is requested only when the user kept the toggle on in the reveal
    /// screen (default ON).
    func completeOnboarding(
        authManager: AuthManager,
        notificationsEnabled: Bool
    ) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        if notificationsEnabled {
            await PushNotificationService.shared.requestPermissionAndRegister()
        }

        guard let userId = authManager.currentUser?.id else {
            errorMessage = String(
                localized: "Identità utente non disponibile. Esci e accedi di nuovo.",
                comment: "Onboarding save: missing user id"
            )
            return
        }

        struct PreferencesUpsert: Encodable {
            let user_id: String
            let intent: String?
            let focus_areas: [String]
            let familiar_practices: [String]
            let approaches: [String]
            let timing: String?
            let life_season: String?
            let current_practices: [String]
            let cosmic_marker: String?
            let notes: String?
            let research_consent: Bool
            let research_consent_at: String?
            let completed_at: String
        }

        let nowIso = ISO8601DateFormatter.shared.string(from: Date())
        let payload = PreferencesUpsert(
            user_id: userId,
            intent: answers.intent?.rawValue,
            focus_areas: answers.focusAreas.map(\.rawValue).sorted(),
            familiar_practices: answers.familiarPractices.map(\.rawValue).sorted(),
            approaches: answers.approaches.map(\.rawValue).sorted(),
            timing: answers.timing?.rawValue,
            life_season: answers.lifeSeason?.rawValue,
            current_practices: answers.currentPractices.map(\.rawValue).sorted(),
            cosmic_marker: answers.cosmicMarker?.dbValue,
            notes: answers.notes.isEmpty ? nil : answers.notes,
            research_consent: answers.researchConsent,
            research_consent_at: answers.researchConsent ? nowIso : nil,
            completed_at: nowIso
        )

        do {
            try await SupabaseConfig.client
                .from("client_preferences")
                .upsert(payload, onConflict: "user_id")
                .execute()
        } catch {
            errorMessage = String(
                localized: "Non riusciamo a salvare le preferenze: \(error.localizedDescription)",
                comment: "Onboarding save error"
            )
            return
        }

        authManager.completeOnboarding()
    }

    // MARK: DTOs (kept private to the view model)

    private struct PracticeRow: Decodable {
        let slug: String
        let title: String
        let tagline: String?
        let category_key: String
    }

    private struct TherapistRow: Decodable {
        let id: String
        let display_name: String?
        let tagline: String?
        let photo_url: String?
        let city: String?
        let average_rating: Double?
        let total_reviews: Int?
        let is_verified: Bool?
        let has_mfa: Bool?
        let categories: [String]?
    }
}

// MARK: - Tile palette

private extension TherapyCategory {
    var tileTint: Color {
        switch self {
        case .thetaHealing:          return HUColor.tileGold
        case .reiki:                 return HUColor.tilePink
        case .astrology:             return HUColor.tilePurple
        case .humanDesign:           return HUColor.tileGreen
        case .familyConstellation:   return HUColor.tileOrange
        case .systemicConstellation: return HUColor.tilePink
        case .numerology:            return HUColor.tilePurple
        case .naturopathy:           return HUColor.tileGreen
        case .ayurveda:              return HUColor.tileGold
        case .shamanism:             return HUColor.tileOrange
        }
    }
}

// MARK: - Main Flow View

struct ClientOnboardingFlow: View {
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = ClientOnboardingViewModel()

    var body: some View {
        ZStack {
            stepBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                if viewModel.showsProgressBar {
                    OnboardingProgressBar(
                        index: viewModel.progressIndex,
                        total: viewModel.progressSequence.count,
                        canGoBack: viewModel.currentStep > 0,
                        onBack: viewModel.goBack
                    )
                    .padding(.top, HUSpacing.sm)
                    .transition(.opacity)
                }

                Group {
                    switch viewModel.currentLogicalStep {
                    case .welcome:           welcomeStep
                    case .intent:            intentStep
                    case .focusAreas:        focusAreasStep
                    case .familiarPractices: familiarPracticesStep
                    case .approaches:        approachesStep
                    case .timing:            timingStep
                    case .lifeSeason:        lifeSeasonStep
                    case .currentPractices:  currentPracticesStep
                    case .cosmicMarker:      cosmicMarkerStep
                    case .notes:             notesStep
                    case .ritual:            ritualStep
                    }
                }
                .id(viewModel.currentLogicalStep)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .move(edge: .trailing)),
                    removal:   .opacity.combined(with: .move(edge: .leading))
                ))
            }
        }
        .animation(HUAnimation.standard, value: viewModel.currentStep)
        .interactiveDismissDisabled(true)
    }

    @ViewBuilder
    private var stepBackground: some View {
        switch viewModel.currentLogicalStep {
        case .welcome:
            LinearGradient(
                colors: [HUColor.brandCream, Color(.systemBackground)],
                startPoint: .top,
                endPoint: .bottom
            )
        case .ritual:
            HUColor.primary
        default:
            HUColor.background
        }
    }

    // MARK: Step — Welcome

    private var welcomeStep: some View {
        VStack(spacing: 0) {
            Spacer(minLength: HUSpacing.xxl)

            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [HUColor.primaryLight, .clear],
                            center: .center,
                            startRadius: 8,
                            endRadius: 110
                        )
                    )
                    .frame(width: 220, height: 220)

                Image("AppLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 96, height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: 22))
                    .shadow(color: HUColor.primary.opacity(0.30), radius: 24, y: 10)
            }
            .padding(.bottom, HUSpacing.xl)

            Text("HOLISTIC UNITY")
                .font(.system(size: 11, weight: .bold))
                .tracking(2.4)
                .foregroundStyle(HUColor.brandGold)

            VStack(spacing: 4) {
                Text("Inizia")
                    .font(HUFont.display(size: 46, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                Text("da dove sei.")
                    .font(.custom("Fraunces72pt-Italic", size: 46))
                    .foregroundStyle(HUColor.primary)
            }
            .multilineTextAlignment(.center)
            .padding(.top, HUSpacing.md)

            Text("Poche domande gentili per trovare l'operatore giusto per te.")
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, HUSpacing.xxl)
                .padding(.top, HUSpacing.lg)
                .frame(maxWidth: 320)

            Spacer()

            VStack(spacing: HUSpacing.sm) {
                magentaPrimaryButton(title: "Inizia") {
                    HUHaptic.impact(.medium)
                    viewModel.advance()
                }

                Text("Circa 90 secondi")
                    .font(.system(size: 13))
                    .foregroundStyle(HUColor.textTertiary)
            }
            .padding(.horizontal, HUSpacing.xl)
            .padding(.bottom, HUSpacing.xxl)
        }
    }

    // MARK: Step — Intent

    private var intentStep: some View {
        ScrollableStep(
            primaryTitle: serif("Cosa ti porta", italic: "qui, oggi?"),
            subtitle: "Non c'è una risposta giusta. Quella che senti più vera per te.",
            primaryButton: ("Avanti", viewModel.canAdvance, advanceWithHaptic)
        ) {
            VStack(spacing: HUSpacing.sm) {
                ForEach(Array(OnboardingIntent.allCases.enumerated()), id: \.element.id) { idx, opt in
                    optionCard(
                        label: opt.label,
                        subtitle: nil,
                        selected: viewModel.answers.intent == opt,
                        multi: false,
                        index: idx
                    ) {
                        HUHaptic.selection()
                        withAnimation(HUAnimation.quick) {
                            viewModel.answers.intent = opt
                        }
                    }
                }
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    // MARK: Step — Focus areas

    private var focusAreasStep: some View {
        ScrollableStep(
            eyebrow: "ESPLORAZIONE",
            primaryTitle: serif("Cosa vorresti", italic: "esplorare?"),
            subtitle: "Scegli tutte le aree che senti vive in questo momento. Non devi essere preciso/a.",
            primaryButton: ("Avanti", viewModel.canAdvance, advanceWithHaptic),
            footerHint: "Puoi selezionare più di una risposta"
        ) {
            VStack(spacing: HUSpacing.sm) {
                ForEach(Array(FocusArea.allCases.enumerated()), id: \.element.id) { idx, opt in
                    optionCard(
                        label: opt.label,
                        subtitle: opt.subtitle,
                        selected: viewModel.answers.focusAreas.contains(opt),
                        multi: true,
                        index: idx
                    ) {
                        HUHaptic.selection()
                        withAnimation(HUAnimation.quick) {
                            viewModel.toggleFocus(opt)
                        }
                    }
                }
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    // MARK: Step — Familiar practices (painted tile grid)

    private var familiarPracticesStep: some View {
        let count = viewModel.answers.familiarPractices.contains(.none)
            ? 0
            : viewModel.answers.familiarPractices.count
        let buttonTitle: String = {
            if !viewModel.canAdvance {
                return String(localized: "Scegli almeno uno", comment: "Familiar practices CTA")
            }
            if viewModel.answers.familiarPractices.contains(.none) {
                return String(localized: "Avanti", comment: "Familiar practices CTA — none selected")
            }
            return String(localized: "Avanti con \(count)", comment: "Familiar practices CTA — count")
        }()

        return ScrollableStep(
            eyebrow: "PRATICHE",
            primaryTitle: serif("Hai già esplorato", italic: "qualcuna di queste?"),
            subtitle: "Se non le conosci, va benissimo: è il momento di scoprirle.",
            primaryButton: (buttonTitle, viewModel.canAdvance, advanceWithHaptic),
            footerHint: "Puoi selezionare più di una risposta"
        ) {
            VStack(spacing: HUSpacing.sm) {
                paintedTileGrid

                // "Non le conosco bene" sentinel — full-width card so
                // it reads as a separate option from the painted tiles
                // above.
                noneSentinelCard
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    private var paintedTileGrid: some View {
        let columns: [GridItem] = Array(
            repeating: GridItem(.flexible(), spacing: HUSpacing.sm),
            count: 3
        )
        let practicesWithCategory = FamiliarPractice.allCases.filter { $0 != .none }
        return LazyVGrid(columns: columns, spacing: HUSpacing.sm) {
            ForEach(Array(practicesWithCategory.enumerated()), id: \.element.id) { idx, practice in
                paintedTile(practice: practice, index: idx)
            }
        }
    }

    private func paintedTile(practice: FamiliarPractice, index: Int) -> some View {
        let cat = practice.therapyCategory
        let isSelected = viewModel.answers.familiarPractices.contains(practice)
        return Button {
            HUHaptic.selection()
            withAnimation(HUAnimation.quick) {
                viewModel.toggleFamiliarPractice(practice)
            }
        } label: {
            ZStack(alignment: .topTrailing) {
                VStack(spacing: 4) {
                    if let cat, let illust = cat.illustrationName {
                        Image(illust)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: .infinity)
                            .padding(6)
                    } else {
                        Image(systemName: cat?.icon ?? "sparkles")
                            .font(.system(size: 28))
                            .foregroundStyle(cat?.color ?? HUColor.primary)
                            .frame(maxWidth: .infinity, minHeight: 70)
                    }

                    Text(practice.label)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 4)
                        .padding(.bottom, 8)
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 130)
                .background(cat?.tileTint ?? HUColor.tilePink)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
                .overlay {
                    RoundedRectangle(cornerRadius: HURadius.xl)
                        .strokeBorder(
                            isSelected ? HUColor.brandMagenta : Color.clear,
                            lineWidth: 2.5
                        )
                }
                .scaleEffect(isSelected ? 0.97 : 1.0)

                if isSelected {
                    ZStack {
                        Circle()
                            .fill(HUColor.brandMagenta)
                            .frame(width: 22, height: 22)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .padding(8)
                    .transition(.scale.combined(with: .opacity))
                }
            }
        }
        .buttonStyle(.plain)
        .staggeredAppearance(index: index, isVisible: true)
    }

    private var noneSentinelCard: some View {
        let isSelected = viewModel.answers.familiarPractices.contains(.none)
        return Button {
            HUHaptic.selection()
            withAnimation(HUAnimation.quick) {
                viewModel.toggleFamiliarPractice(.none)
            }
        } label: {
            HStack(spacing: HUSpacing.md) {
                Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? HUColor.brandMagenta : HUColor.textSecondary)

                VStack(alignment: .leading, spacing: 2) {
                    Text(FamiliarPractice.none.label)
                        .font(HUFont.subheadline(weight: .medium))
                        .foregroundStyle(HUColor.textPrimary)
                    if let sub = FamiliarPractice.none.subtitle {
                        Text(sub)
                            .font(.system(size: 12))
                            .foregroundStyle(HUColor.textSecondary)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, HUSpacing.lg)
            .padding(.vertical, HUSpacing.md)
            .background(isSelected ? HUColor.brandMagenta.opacity(0.06) : HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay {
                RoundedRectangle(cornerRadius: HURadius.xl)
                    .strokeBorder(
                        isSelected ? HUColor.brandMagenta : HUColor.divider,
                        lineWidth: 1.5
                    )
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: Step — Approaches

    private var approachesStep: some View {
        ScrollableStep(
            eyebrow: "APPROCCIO",
            primaryTitle: serif("Quale approccio", italic: "risuona di più?"),
            subtitle: "Pensa a come preferisci entrare in contatto con te stesso/a.",
            primaryButton: ("Avanti", viewModel.canAdvance, advanceWithHaptic),
            footerHint: "Puoi selezionare più di una risposta"
        ) {
            VStack(spacing: HUSpacing.sm) {
                ForEach(Array(Approach.allCases.enumerated()), id: \.element.id) { idx, opt in
                    optionCard(
                        label: opt.label,
                        subtitle: opt.subtitle,
                        selected: viewModel.answers.approaches.contains(opt),
                        multi: true,
                        index: idx
                    ) {
                        HUHaptic.selection()
                        withAnimation(HUAnimation.quick) {
                            viewModel.toggleApproach(opt)
                        }
                    }
                }
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    // MARK: Step — Timing

    private var timingStep: some View {
        ScrollableStep(
            eyebrow: "TEMPI",
            primaryTitle: serif("Quando senti", italic: "di voler iniziare?"),
            subtitle: "Senza pressione: rispondi onestamente, ti aiuterà a trovare il momento giusto.",
            primaryButton: ("Avanti", viewModel.canAdvance, advanceWithHaptic)
        ) {
            VStack(spacing: HUSpacing.sm) {
                ForEach(Array(OnboardingTiming.allCases.enumerated()), id: \.element.id) { idx, opt in
                    optionCard(
                        label: opt.label,
                        subtitle: nil,
                        selected: viewModel.answers.timing == opt,
                        multi: false,
                        index: idx
                    ) {
                        HUHaptic.selection()
                        withAnimation(HUAnimation.quick) {
                            viewModel.answers.timing = opt
                        }
                    }
                }
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    // MARK: Step — Life season

    private var lifeSeasonStep: some View {
        ScrollableStep(
            eyebrow: "LA TUA STAGIONE",
            primaryTitle: serif("In che fase", italic: "ti senti?"),
            subtitle: "Non c'è una risposta giusta. Ascolta cosa risuona ora.",
            primaryButton: ("Avanti", viewModel.canAdvance, advanceWithHaptic)
        ) {
            VStack(spacing: HUSpacing.sm) {
                ForEach(Array(LifeSeason.allCases.enumerated()), id: \.element.id) { idx, opt in
                    optionCard(
                        label: opt.label,
                        subtitle: opt.subtitle,
                        selected: viewModel.answers.lifeSeason == opt,
                        multi: false,
                        index: idx
                    ) {
                        HUHaptic.selection()
                        withAnimation(HUAnimation.quick) {
                            viewModel.answers.lifeSeason = opt
                        }
                    }
                }
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    // MARK: Step — Current practices (chip grid)

    private var currentPracticesStep: some View {
        ScrollableStep(
            eyebrow: "ROUTINE",
            primaryTitle: serif("Cosa fa già", italic: "parte della tua routine?"),
            subtitle: "Tutto quello che pratichi, anche solo a tratti.",
            primaryButton: ("Avanti", viewModel.canAdvance, advanceWithHaptic),
            footerHint: "Puoi selezionare più di una risposta"
        ) {
            FlowLayout(spacing: HUSpacing.sm) {
                ForEach(CurrentPractice.allCases) { practice in
                    chip(
                        title: practice.label,
                        isSelected: viewModel.answers.currentPractices.contains(practice),
                        big: true
                    ) {
                        HUHaptic.selection()
                        withAnimation(HUAnimation.quick) {
                            viewModel.toggleCurrentPractice(practice)
                        }
                    }
                }
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    // MARK: Step — Cosmic marker (zodiac chips, optional)

    private var cosmicMarkerStep: some View {
        ScrollableStep(
            eyebrow: "RIFERIMENTO COSMICO",
            primaryTitle: serif("C'è un segno", italic: "che ti rappresenta?"),
            subtitle: "Solo se ti riconosci. Puoi anche saltare — è opzionale.",
            primaryButton: ("Avanti", true, advanceWithHaptic)
        ) {
            VStack(alignment: .leading, spacing: HUSpacing.lg) {
                FlowLayout(spacing: HUSpacing.sm) {
                    ForEach(CosmicMarker.allCases.filter { $0 != .unknown }) { sign in
                        chip(
                            title: sign.label,
                            isSelected: viewModel.answers.cosmicMarker == sign,
                            big: true
                        ) {
                            HUHaptic.selection()
                            withAnimation(HUAnimation.quick) {
                                viewModel.answers.cosmicMarker = sign
                            }
                        }
                    }
                }
                .padding(.top, HUSpacing.xl)

                Button {
                    HUHaptic.selection()
                    withAnimation(HUAnimation.quick) {
                        viewModel.answers.cosmicMarker = .unknown
                    }
                    advanceWithHaptic()
                } label: {
                    Text("Salta — non lo so / preferisco non dire")
                        .font(.system(size: 13))
                        .foregroundStyle(HUColor.textTertiary)
                        .underline()
                }
                .frame(maxWidth: .infinity)
                .padding(.top, HUSpacing.sm)
            }
        }
    }

    // MARK: Step — Notes (optional text)

    private var notesStep: some View {
        ScrollableStep(
            eyebrow: "OPZIONALE",
            primaryTitle: serif("C'è qualcosa che", italic: "vuoi farci sapere?"),
            subtitle: "Se senti di poter scrivere qualcosa, lo leggeremo. Altrimenti puoi anche solo passare oltre.",
            primaryButton: (
                viewModel.answers.notes.isEmpty
                    ? String(localized: "Continua senza note", comment: "Notes step CTA — empty")
                    : String(localized: "Continua", comment: "Notes step CTA — with notes"),
                true,
                advanceWithHaptic
            )
        ) {
            VStack(alignment: .leading, spacing: HUSpacing.sm) {
                ZStack(alignment: .topLeading) {
                    if viewModel.answers.notes.isEmpty {
                        Text("Es. Ho già fatto delle sessioni in passato, oppure preferisco un orario serale, oppure…")
                            .font(HUFont.body())
                            .foregroundStyle(HUColor.textTertiary)
                            .padding(.horizontal, HUSpacing.lg)
                            .padding(.vertical, HUSpacing.md + 2)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $viewModel.answers.notes)
                        .font(HUFont.body())
                        .foregroundStyle(HUColor.textPrimary)
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, HUSpacing.md)
                        .padding(.vertical, HUSpacing.sm)
                        .frame(minHeight: 160)
                }
                .background(HUColor.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
                .onChange(of: viewModel.answers.notes) { _, newValue in
                    if newValue.count > 500 {
                        viewModel.answers.notes = String(newValue.prefix(500))
                    }
                }

                HStack {
                    Text("\(viewModel.answers.notes.count)/500 · Opzionale")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textTertiary)
                    Spacer()
                }
            }
            .padding(.top, HUSpacing.xl)
        }
    }

    // MARK: Step — Ritual + Reveal

    private var ritualStep: some View {
        RitualAndRevealView(
            viewModel: viewModel,
            onFinish: { notificationsEnabled in
                Task {
                    await viewModel.completeOnboarding(
                        authManager: authManager,
                        notificationsEnabled: notificationsEnabled
                    )
                }
            }
        )
    }

    // MARK: - Reusable building blocks

    struct SerifTitleSpec: Equatable {
        let lead: String
        let italicAccent: String
    }

    private func serif(_ lead: String, italic: String) -> SerifTitleSpec {
        SerifTitleSpec(lead: lead, italicAccent: italic)
    }

    private func magentaPrimaryButton(
        title: String,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: HUSpacing.sm) {
                if isLoading { ProgressView().tint(.white) }
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                isDisabled
                    ? AnyShapeStyle(HUColor.primaryLight)
                    : AnyShapeStyle(OnboardingMagentaGradient.linear)
            )
            .clipShape(Capsule())
            .shadow(
                color: isDisabled ? .clear : HUColor.brandMagenta.opacity(0.28),
                radius: 14, y: 6
            )
            .opacity(isDisabled ? 0.6 : 1.0)
        }
        .buttonStyle(HUPressButtonStyle())
        .disabled(isDisabled || isLoading)
    }

    private func chip(
        title: String,
        isSelected: Bool,
        big: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: big ? 14 : 13, weight: isSelected ? .semibold : .medium))
                .foregroundStyle(isSelected ? HUColor.primary : HUColor.textSecondary)
                .padding(.horizontal, big ? HUSpacing.lg : HUSpacing.md)
                .padding(.vertical, big ? 10 : 8)
                .background(isSelected ? HUColor.primaryLight.opacity(0.55) : Color(.tertiarySystemBackground))
                .clipShape(Capsule())
                .overlay {
                    Capsule()
                        .strokeBorder(
                            isSelected ? HUColor.brandMagenta : HUColor.divider,
                            lineWidth: 1.5
                        )
                }
        }
        .buttonStyle(.plain)
    }

    private func optionCard(
        label: String,
        subtitle: String?,
        selected: Bool,
        multi: Bool,
        index: Int,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: HUSpacing.md) {
                ZStack {
                    if multi {
                        RoundedRectangle(cornerRadius: 5)
                            .fill(selected ? HUColor.brandMagenta : .clear)
                            .frame(width: 20, height: 20)
                            .overlay(
                                RoundedRectangle(cornerRadius: 5)
                                    .strokeBorder(
                                        selected ? HUColor.brandMagenta : HUColor.divider,
                                        lineWidth: selected ? 0 : 1.5
                                    )
                            )
                    } else {
                        Circle()
                            .fill(selected ? HUColor.brandMagenta : .clear)
                            .frame(width: 20, height: 20)
                            .overlay(
                                Circle()
                                    .strokeBorder(
                                        selected ? HUColor.brandMagenta : HUColor.divider,
                                        lineWidth: selected ? 0 : 1.5
                                    )
                            )
                    }
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .padding(.top, 2)

                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(HUFont.subheadline(weight: selected ? .semibold : .medium))
                        .foregroundStyle(HUColor.textPrimary)
                        .multilineTextAlignment(.leading)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(HUColor.textSecondary)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer()
            }
            .padding(.horizontal, HUSpacing.lg)
            .padding(.vertical, HUSpacing.md)
            .background(selected ? HUColor.brandMagenta.opacity(0.05) : HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay {
                RoundedRectangle(cornerRadius: HURadius.xl)
                    .strokeBorder(
                        selected ? HUColor.brandMagenta : HUColor.divider,
                        lineWidth: selected ? 2 : 1
                    )
            }
        }
        .buttonStyle(.plain)
        .staggeredAppearance(index: index, isVisible: true)
    }

    private func advanceWithHaptic() {
        HUHaptic.impact(.light)
        viewModel.advance()
    }

    // MARK: Scrollable step container

    /// Standard form-step layout: scrollable content with a header
    /// (eyebrow + serif title + subtitle) at the top, an optional
    /// hint ABOVE the CTA, and a pinned magenta CTA at the bottom.
    private struct ScrollableStep<Content: View>: View {
        let eyebrow: String?
        let primaryTitle: SerifTitleSpec
        let subtitle: String?
        let footerHint: String?
        let primaryButton: (title: String, enabled: Bool, action: () -> Void)
        @ViewBuilder let content: () -> Content

        init(
            eyebrow: String? = nil,
            primaryTitle: SerifTitleSpec,
            subtitle: String? = nil,
            primaryButton: (title: String, enabled: Bool, action: () -> Void),
            footerHint: String? = nil,
            @ViewBuilder content: @escaping () -> Content
        ) {
            self.eyebrow = eyebrow
            self.primaryTitle = primaryTitle
            self.subtitle = subtitle
            self.primaryButton = primaryButton
            self.footerHint = footerHint
            self.content = content
        }

        var body: some View {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: HUSpacing.lg) {
                        if let eyebrow {
                            Text(eyebrow)
                                .font(.system(size: 11, weight: .bold))
                                .tracking(2.0)
                                .foregroundStyle(HUColor.brandGold)
                        }

                        (
                            Text(primaryTitle.lead + " ")
                                .font(HUFont.display(size: 36, weight: .semiBold))
                                .foregroundColor(HUColor.textPrimary)
                            + Text(primaryTitle.italicAccent)
                                .font(.custom("Fraunces72pt-Italic", size: 36))
                                .foregroundColor(HUColor.primary)
                        )
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)

                        if let subtitle {
                            Text(subtitle)
                                .font(HUFont.body())
                                .foregroundStyle(HUColor.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        content()
                    }
                    .padding(.horizontal, HUSpacing.xl)
                    .padding(.top, HUSpacing.lg)
                    .padding(.bottom, HUSpacing.xxl)
                }

                VStack(spacing: HUSpacing.sm) {
                    if let footerHint {
                        Text(footerHint)
                            .font(.system(size: 12))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                    Button(action: primaryButton.action) {
                        Text(primaryButton.title)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(
                                primaryButton.enabled
                                    ? AnyShapeStyle(OnboardingMagentaGradient.linear)
                                    : AnyShapeStyle(HUColor.primaryLight)
                            )
                            .clipShape(Capsule())
                            .shadow(
                                color: primaryButton.enabled ? HUColor.brandMagenta.opacity(0.28) : .clear,
                                radius: 14, y: 6
                            )
                            .opacity(primaryButton.enabled ? 1.0 : 0.6)
                    }
                    .buttonStyle(HUPressButtonStyle())
                    .disabled(!primaryButton.enabled)
                }
                .padding(.horizontal, HUSpacing.xl)
                .padding(.vertical, HUSpacing.lg)
                .background(HUColor.background)
                .overlay(alignment: .top) {
                    Divider().background(HUColor.divider).opacity(0.5)
                }
            }
        }
    }
}

// MARK: - Progress bar

private struct OnboardingProgressBar: View {
    let index: Int
    let total: Int
    let canGoBack: Bool
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: HUSpacing.sm) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(HUColor.textSecondary)
                    .frame(width: 28, height: 28)
            }
            .opacity(canGoBack ? 1 : 0)
            .disabled(!canGoBack)

            HStack(spacing: 6) {
                ForEach(0..<total, id: \.self) { i in
                    Capsule()
                        .fill(i <= index ? HUColor.brandMagenta : HUColor.primaryLight)
                        .frame(height: 3)
                        .animation(HUAnimation.standard, value: index)
                }
            }

            Text("\(index + 1)/\(total)")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(HUColor.textTertiary)
                .frame(minWidth: 30, alignment: .trailing)
                .monospacedDigit()
        }
        .padding(.horizontal, HUSpacing.lg)
    }
}

// MARK: - Ritual + Reveal

private struct RitualAndRevealView: View {
    @Bindable var viewModel: ClientOnboardingViewModel
    let onFinish: (Bool) -> Void

    @Environment(AuthManager.self) private var authManager

    @State private var phase: Int = 0
    @State private var breathPhrase: String = ""
    @State private var breatheScale: CGFloat = 0.85
    @State private var breathTask: Task<Void, Never>?
    @State private var phraseTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            if phase == 0 {
                breathingPhase.transition(.opacity)
            } else {
                revealPhase.transition(.opacity)
            }
        }
        .animation(HUAnimation.slow, value: phase)
        .onAppear { startBreathing() }
        .onDisappear {
            breathTask?.cancel()
            phraseTask?.cancel()
        }
    }

    // MARK: Phase 0 — Breathing

    private var breathingPhase: some View {
        ZStack {
            LinearGradient(
                colors: [HUColor.primary, HUColor.primaryDark],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ForEach(0..<18, id: \.self) { i in
                Circle()
                    .fill(HUColor.brandGoldLight.opacity(0.55))
                    .frame(width: 3, height: 3)
                    .position(
                        x: CGFloat((i * 71) % 320) + 30,
                        y: CGFloat((i * 53) % 600) + 40
                    )
            }

            VStack(spacing: HUSpacing.xl) {
                Text("UN MOMENTO PER TE")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2.4)
                    .foregroundStyle(HUColor.brandGoldLight)

                ZStack {
                    Circle()
                        .strokeBorder(HUColor.brandGoldLight.opacity(0.18), lineWidth: 1)
                        .frame(width: 240, height: 240)
                    Circle()
                        .strokeBorder(HUColor.brandGoldLight.opacity(0.25), lineWidth: 1)
                        .frame(width: 200, height: 200)

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    HUColor.brandGoldLight.opacity(0.55),
                                    HUColor.brandGoldLight.opacity(0.10)
                                ],
                                center: .center,
                                startRadius: 6,
                                endRadius: 90
                            )
                        )
                        .frame(width: 160, height: 160)
                        .scaleEffect(breatheScale)

                    Text(breathPhrase)
                        .font(.custom("Fraunces72pt-Italic", size: 22))
                        .foregroundStyle(HUColor.brandGoldLight)
                }

                VStack(spacing: HUSpacing.sm) {
                    (
                        Text("Ciao, ")
                            .font(HUFont.display(size: 30, weight: .semiBold))
                            .foregroundColor(.white)
                        + Text(firstName + ".")
                            .font(.custom("Fraunces72pt-Italic", size: 30))
                            .foregroundColor(HUColor.brandGoldLight)
                    )
                    .multilineTextAlignment(.center)

                    Text("Fai tre respiri lenti con noi prima di iniziare.")
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, HUSpacing.xxl)
                }
            }

            VStack {
                Spacer()
                Button {
                    advanceToReveal()
                } label: {
                    Text("Salta il rituale →")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.7))
                }
                .padding(.bottom, HUSpacing.xxl)
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: Phase 1 — Reveal

    private var revealPhase: some View {
        ZStack {
            LinearGradient(
                colors: [HUColor.brandCream, Color(.systemBackground)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: HUSpacing.xl) {
                        sparkleEyebrow
                        revealHeader

                        if viewModel.matchmakingLoading {
                            ProgressView()
                                .tint(HUColor.brandMagenta)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, HUSpacing.xxl)
                        } else {
                            if !viewModel.recommendedPractices.isEmpty {
                                practicesSection
                            }
                            if !viewModel.recommendedTherapists.isEmpty {
                                therapistsSection
                            }
                            if viewModel.recommendedPractices.isEmpty
                                && viewModel.recommendedTherapists.isEmpty {
                                emptyMatchmakingCard
                            }
                        }

                        researchConsentCard
                    }
                    .padding(.horizontal, HUSpacing.xl)
                    .padding(.top, HUSpacing.lg)
                    .padding(.bottom, HUSpacing.xxl)
                }

                VStack(spacing: HUSpacing.sm) {
                    Button {
                        HUHaptic.impact(.medium)
                        onFinish(true)
                    } label: {
                        HStack(spacing: 8) {
                            if viewModel.isLoading {
                                ProgressView().tint(.white)
                            }
                            Text(viewModel.isLoading ? "Salvataggio…" : "Inizia il tuo percorso")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(OnboardingMagentaGradient.linear)
                        .clipShape(Capsule())
                        .shadow(color: HUColor.brandMagenta.opacity(0.28), radius: 14, y: 6)
                    }
                    .buttonStyle(HUPressButtonStyle())
                    .disabled(viewModel.isLoading)

                    Button {
                        onFinish(false)
                    } label: {
                        Text("Salta notifiche per ora")
                            .font(.system(size: 13))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                    .disabled(viewModel.isLoading)

                    if let err = viewModel.errorMessage {
                        Text(err)
                            .font(.system(size: 12))
                            .foregroundStyle(HUColor.error)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, HUSpacing.lg)
                    }
                }
                .padding(.horizontal, HUSpacing.xl)
                .padding(.vertical, HUSpacing.lg)
                .background(HUColor.background)
            }
        }
    }

    private var sparkleEyebrow: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkles")
                .font(.system(size: 11, weight: .bold))
            Text("IL TUO PERCORSO PERSONALIZZATO")
                .font(.system(size: 11, weight: .bold))
                .tracking(2.0)
        }
        .foregroundStyle(HUColor.brandMagenta)
        .padding(.horizontal, HUSpacing.md)
        .padding(.vertical, 6)
        .background(HUColor.brandMagenta.opacity(0.10))
        .clipShape(Capsule())
    }

    private var revealHeader: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            (
                Text("Abbiamo qualche")
                    .font(HUFont.display(size: 32, weight: .semiBold))
                    .foregroundColor(HUColor.textPrimary)
                + Text(" idea ")
                    .font(.custom("Fraunces72pt-Italic", size: 32))
                    .foregroundColor(HUColor.primary)
                + Text("per te")
                    .font(HUFont.display(size: 32, weight: .semiBold))
                    .foregroundColor(HUColor.textPrimary)
            )

            Text("In base a quello che ci hai raccontato, queste pratiche e questi operatori potrebbero risuonare con te.")
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var practicesSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            Text("PRATICHE CONSIGLIATE")
                .font(.system(size: 11, weight: .bold))
                .tracking(2.0)
                .foregroundStyle(HUColor.textSecondary)

            VStack(spacing: HUSpacing.sm) {
                ForEach(viewModel.recommendedPractices) { practice in
                    practiceCard(practice)
                }
            }
        }
    }

    private func practiceCard(_ practice: RecommendedPractice) -> some View {
        let category = FamiliarPractice.from(categoryKey: practice.categoryKey)?.therapyCategory
        return HStack(spacing: HUSpacing.md) {
            ZStack {
                Circle()
                    .fill(category?.tileTint ?? HUColor.primaryLight)
                    .frame(width: 44, height: 44)
                if let illust = category?.illustrationName {
                    Image(illust)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                } else {
                    Image(systemName: "sparkle")
                        .font(.system(size: 16))
                        .foregroundStyle(HUColor.primary)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(practice.title)
                    .font(HUFont.subheadline(weight: .semibold))
                    .foregroundStyle(HUColor.textPrimary)
                if !practice.tagline.isEmpty {
                    Text(practice.tagline)
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(2)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(HUColor.textTertiary)
        }
        .padding(HUSpacing.md)
        .background(HUColor.background)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        .overlay {
            RoundedRectangle(cornerRadius: HURadius.xl)
                .strokeBorder(HUColor.divider, lineWidth: 1)
        }
    }

    private var therapistsSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            Text("OPERATORI PER TE")
                .font(.system(size: 11, weight: .bold))
                .tracking(2.0)
                .foregroundStyle(HUColor.textSecondary)

            VStack(spacing: HUSpacing.sm) {
                ForEach(viewModel.recommendedTherapists) { t in
                    therapistCard(t)
                }
            }
        }
    }

    private func therapistCard(_ t: RecommendedTherapist) -> some View {
        HStack(spacing: HUSpacing.md) {
            ZStack {
                Circle()
                    .fill(HUColor.primaryLight)
                    .frame(width: 48, height: 48)
                if let urlStr = t.photoURL, let url = URL(string: urlStr) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Text(String((t.displayName?.prefix(1) ?? "?")).uppercased())
                            .font(HUFont.subheadline(weight: .semibold))
                            .foregroundStyle(HUColor.primary)
                    }
                    .frame(width: 48, height: 48)
                    .clipShape(Circle())
                } else {
                    Text(String((t.displayName?.prefix(1) ?? "?")).uppercased())
                        .font(HUFont.subheadline(weight: .semibold))
                        .foregroundStyle(HUColor.primary)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(t.displayName ?? "—")
                        .font(HUFont.subheadline(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    if t.isVerified == true {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(HUColor.info)
                    }
                }
                if let tagline = t.tagline {
                    Text(tagline)
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(2)
                }
                if let rating = t.averageRating, rating > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(HUColor.starFilled)
                        Text(String(format: "%.1f (%d)", rating, t.totalReviews ?? 0))
                            .font(.system(size: 11))
                            .foregroundStyle(HUColor.textTertiary)
                    }
                }
            }
            Spacer()
        }
        .padding(HUSpacing.md)
        .background(HUColor.background)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        .overlay {
            RoundedRectangle(cornerRadius: HURadius.xl)
                .strokeBorder(HUColor.divider, lineWidth: 1)
        }
    }

    private var emptyMatchmakingCard: some View {
        VStack(spacing: HUSpacing.sm) {
            Image(systemName: "sparkle")
                .font(.system(size: 24))
                .foregroundStyle(HUColor.primary)
            Text("Operatori da tutte le modalità")
                .font(HUFont.subheadline(weight: .semibold))
                .foregroundStyle(HUColor.textPrimary)
            Text("Esplora il marketplace per scoprire tutte le pratiche disponibili.")
                .font(.system(size: 13))
                .foregroundStyle(HUColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(HUSpacing.xl)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
    }

    /// GDPR-explicit research consent toggle — opt-in default false.
    /// Sits at the bottom of the reveal so the user has already
    /// experienced the value (recommendations) before being asked to
    /// opt into aggregate use.
    private var researchConsentCard: some View {
        Button {
            HUHaptic.selection()
            withAnimation(HUAnimation.quick) {
                viewModel.answers.researchConsent.toggle()
            }
        } label: {
            HStack(alignment: .top, spacing: HUSpacing.md) {
                Image(systemName: viewModel.answers.researchConsent ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22))
                    .foregroundStyle(viewModel.answers.researchConsent ? HUColor.brandMagenta : HUColor.textSecondary)
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Aiuta l'ecosistema olistico (opzionale)")
                        .font(HUFont.subheadline(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                        .multilineTextAlignment(.leading)
                    Text("Acconsento all'uso anonimo e aggregato delle mie risposte per generare report di settore. Nessun dato personale identificabile viene condiviso. Puoi cambiare idea in qualsiasi momento dalle impostazioni.")
                        .font(.system(size: 12))
                        .foregroundStyle(HUColor.textSecondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }
            .padding(HUSpacing.lg)
            .background(viewModel.answers.researchConsent ? HUColor.brandMagenta.opacity(0.06) : HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay {
                RoundedRectangle(cornerRadius: HURadius.xl)
                    .strokeBorder(
                        viewModel.answers.researchConsent ? HUColor.brandMagenta : HUColor.divider,
                        lineWidth: viewModel.answers.researchConsent ? 1.5 : 1
                    )
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: Animation

    private var firstName: String {
        let trimmed = (authManager.currentUser?.displayName ?? "")
            .trimmingCharacters(in: .whitespaces)
        let first = trimmed.components(separatedBy: " ").first ?? ""
        return first.isEmpty ? String(localized: "te", comment: "Onboarding ritual fallback name") : first
    }

    private func startBreathing() {
        withAnimation(.easeInOut(duration: 3.0).repeatForever(autoreverses: true)) {
            breatheScale = 1.18
        }
        breathPhrase = String(localized: "Inspira", comment: "Breath instruction: in")
        phraseTask = Task { @MainActor in
            let phrases = [
                String(localized: "Inspira", comment: "Breath instruction: in"),
                String(localized: "Trattieni", comment: "Breath instruction: hold"),
                String(localized: "Espira", comment: "Breath instruction: out")
            ]
            var i = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                if Task.isCancelled { break }
                i = (i + 1) % phrases.count
                breathPhrase = phrases[i]
            }
        }
        breathTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(7500))
            if Task.isCancelled { return }
            advanceToReveal()
        }
    }

    private func advanceToReveal() {
        breathTask?.cancel()
        phraseTask?.cancel()
        withAnimation(HUAnimation.slow) {
            phase = 1
        }
    }
}

// MARK: - Preview

#Preview("Onboarding flow") {
    ClientOnboardingFlow()
        .environment(AuthManager(authRepository: MockAuthRepository()))
}
