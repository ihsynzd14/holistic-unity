import Foundation

// ═══════════════════════════════════════════════════════════════════
//  Onboarding Answer Types
//
//  Mirror of `client-webapp/src/lib/onboarding/steps.ts`. The value
//  strings (rawValues) are intentionally identical to the web — we
//  share the same `client_preferences` table, so a value typed on iOS
//  must be readable by the web admin dashboard and vice-versa.
//
//  Display labels (Italian-first) live on each enum's `displayName`,
//  with optional `subtitle` for explanatory copy.
//
//  Order of enum cases matches the order in which options appear on
//  screen (top-to-bottom for cards, left-to-right for chips).
//
//  Last sync with web: 2026-05-16
// ═══════════════════════════════════════════════════════════════════

// MARK: - Intent

enum OnboardingIntent: String, Codable, CaseIterable, Identifiable {
    case stop
    case selfDiscovery   = "self_discovery"
    case transition
    case curiosity
    case supportOther    = "support_other"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .stop:          return String(localized: "Ho bisogno di fermarmi", comment: "Onboarding intent option")
        case .selfDiscovery: return String(localized: "Voglio capire qualcosa di me", comment: "Onboarding intent option")
        case .transition:    return String(localized: "Sto attraversando un cambiamento", comment: "Onboarding intent option")
        case .curiosity:     return String(localized: "Sono curioso/a di esplorare", comment: "Onboarding intent option")
        case .supportOther:  return String(localized: "Cerco supporto per qualcuno", comment: "Onboarding intent option")
        }
    }
}

// MARK: - Focus area

enum FocusArea: String, Codable, CaseIterable, Identifiable {
    case body
    case mind
    case energy
    case relationships
    case lifeDirection   = "life_direction"
    case dailyRitual     = "daily_ritual"
    case familyRoots     = "family_roots"
    case innerListening  = "inner_listening"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .body:            return String(localized: "Il corpo", comment: "Focus area")
        case .mind:            return String(localized: "La mente", comment: "Focus area")
        case .energy:          return String(localized: "L'energia", comment: "Focus area")
        case .relationships:   return String(localized: "Le relazioni", comment: "Focus area")
        case .lifeDirection:   return String(localized: "La direzione di vita", comment: "Focus area")
        case .dailyRitual:     return String(localized: "Il rituale quotidiano", comment: "Focus area")
        case .familyRoots:     return String(localized: "Le radici familiari", comment: "Focus area")
        case .innerListening:  return String(localized: "L'ascolto interiore", comment: "Focus area")
        }
    }

    var subtitle: String {
        switch self {
        case .body:            return String(localized: "Energia, vitalità, ritmi naturali", comment: "Focus area subtitle")
        case .mind:            return String(localized: "Pensieri ricorrenti, chiarezza, lucidità", comment: "Focus area subtitle")
        case .energy:          return String(localized: "Sensazione di blocco o di flusso", comment: "Focus area subtitle")
        case .relationships:   return String(localized: "Famiglia, partner, amicizie", comment: "Focus area subtitle")
        case .lifeDirection:   return String(localized: "Vocazione, scelte, prossimi passi", comment: "Focus area subtitle")
        case .dailyRitual:     return String(localized: "Sonno, alimentazione, cura di sé", comment: "Focus area subtitle")
        case .familyRoots:     return String(localized: "Storia, eredità, dinamiche tramandate", comment: "Focus area subtitle")
        case .innerListening:  return String(localized: "Intuito, segnali, presenza", comment: "Focus area subtitle")
        }
    }
}

// MARK: - Familiar practice (matches DB practice category_key strings)

enum FamiliarPractice: String, Codable, CaseIterable, Identifiable {
    // Sentinel "none" — sits at the bottom of the picker. When this
    // is selected the picker should auto-clear all other selections.
    case thetaHealing            = "ThetaHealing"
    case costellazioniFamiliari  = "Costellazioni Familiari"
    case costellazioniSistemiche = "Costellazioni Sistemiche"
    case reiki                   = "Reiki"
    case naturopatia             = "Naturopatia"
    case astrologia              = "Astrologia"
    case humanDesign             = "Human Design"
    case numerologia             = "Numerologia"
    case ayurveda                = "Ayurveda"
    case sciamanesimo            = "Sciamanesimo"
    case none

    var id: String { rawValue }

    var label: String {
        switch self {
        case .thetaHealing:            return "ThetaHealing®"
        case .costellazioniFamiliari:  return "Costellazioni Familiari"
        case .costellazioniSistemiche: return "Costellazioni Sistemiche"
        case .reiki:                   return "Reiki"
        case .naturopatia:             return "Naturopatia"
        case .astrologia:              return "Astrologia"
        case .humanDesign:             return "Human Design"
        case .numerologia:             return "Numerologia"
        case .ayurveda:                return "Ayurveda"
        case .sciamanesimo:            return "Sciamanesimo"
        case .none:                    return String(localized: "Non le conosco bene", comment: "Familiar practice fallback")
        }
    }

    var subtitle: String? {
        switch self {
        case .none: return String(localized: "Va benissimo, ti guidiamo noi", comment: "Familiar practice fallback subtitle")
        default:    return nil
        }
    }

    /// Maps to the canonical `TherapyCategory` enum (used everywhere
    /// else in the app, e.g. for painted illustration assets). Returns
    /// nil for the `none` sentinel.
    var therapyCategory: TherapyCategory? {
        switch self {
        case .thetaHealing:            return .thetaHealing
        case .costellazioniFamiliari:  return .familyConstellation
        case .costellazioniSistemiche: return .systemicConstellation
        case .reiki:                   return .reiki
        case .naturopatia:             return .naturopathy
        case .astrologia:              return .astrology
        case .humanDesign:             return .humanDesign
        case .numerologia:             return .numerology
        case .ayurveda:                return .ayurveda
        case .sciamanesimo:            return .shamanism
        case .none:                    return nil
        }
    }

    /// Reverse mapping — useful when the reveal step needs to render
    /// the painted illustration for a category_key returned by the
    /// matchmaking algorithm.
    static func from(categoryKey: String) -> FamiliarPractice? {
        FamiliarPractice(rawValue: categoryKey)
    }
}

// MARK: - Approach

enum Approach: String, Codable, CaseIterable, Identifiable {
    case energetic
    case selfKnowledge   = "self_knowledge"
    case spiritual
    case symbolic
    case bodyCare        = "body_care"
    case open

    var id: String { rawValue }

    var label: String {
        switch self {
        case .energetic:     return String(localized: "Lavoro energetico", comment: "Approach option")
        case .selfKnowledge: return String(localized: "Conoscenza di sé", comment: "Approach option")
        case .spiritual:     return String(localized: "Riconnessione spirituale", comment: "Approach option")
        case .symbolic:      return String(localized: "Lettura simbolica", comment: "Approach option")
        case .bodyCare:      return String(localized: "Cura del corpo", comment: "Approach option")
        case .open:          return String(localized: "Lasciamo decidere a te", comment: "Approach option")
        }
    }

    var subtitle: String {
        switch self {
        case .energetic:     return String(localized: "Riequilibrio sottile, channeling", comment: "Approach subtitle")
        case .selfKnowledge: return String(localized: "Mappe interpretative, simboli, archetipi", comment: "Approach subtitle")
        case .spiritual:     return String(localized: "Senso del sacro, presenza, ascolto", comment: "Approach subtitle")
        case .symbolic:      return String(localized: "Numeri, astri, lettere, sincronicità", comment: "Approach subtitle")
        case .bodyCare:      return String(localized: "Alimentazione, ritmi, fitoterapia", comment: "Approach subtitle")
        case .open:          return String(localized: "Suggeriscimi tu cosa fa per me", comment: "Approach subtitle")
        }
    }
}

// MARK: - Timing

enum OnboardingTiming: String, Codable, CaseIterable, Identifiable {
    case asap
    case thisWeek = "this_week"
    case fewWeeks = "few_weeks"
    case exploring

    var id: String { rawValue }

    var label: String {
        switch self {
        case .asap:      return String(localized: "Appena possibile", comment: "Timing option")
        case .thisWeek:  return String(localized: "Questa settimana", comment: "Timing option")
        case .fewWeeks:  return String(localized: "Tra qualche settimana", comment: "Timing option")
        case .exploring: return String(localized: "Sto solo esplorando, senza fretta", comment: "Timing option")
        }
    }
}

// MARK: - Life season

enum LifeSeason: String, Codable, CaseIterable, Identifiable {
    case transition
    case stability
    case growth
    case realignment
    case disorientation
    case unsure

    var id: String { rawValue }

    var label: String {
        switch self {
        case .transition:     return String(localized: "Sono in transizione", comment: "Life season option")
        case .stability:      return String(localized: "In una fase stabile", comment: "Life season option")
        case .growth:         return String(localized: "In crescita attiva", comment: "Life season option")
        case .realignment:    return String(localized: "In riallineamento", comment: "Life season option")
        case .disorientation: return String(localized: "Un po' disorientato/a", comment: "Life season option")
        case .unsure:         return String(localized: "Non saprei dire", comment: "Life season option")
        }
    }

    var subtitle: String {
        switch self {
        case .transition:     return String(localized: "Sto attraversando un cambiamento importante", comment: "Life season subtitle")
        case .stability:      return String(localized: "Voglio approfondire e integrare", comment: "Life season subtitle")
        case .growth:         return String(localized: "Mi sto espandendo, esploro tanto", comment: "Life season subtitle")
        case .realignment:    return String(localized: "Sto ritrovando il mio centro", comment: "Life season subtitle")
        case .disorientation: return String(localized: "Cerco una direzione, non so bene dove andare", comment: "Life season subtitle")
        case .unsure:         return String(localized: "Va bene così, possiamo lasciarlo aperto", comment: "Life season subtitle")
        }
    }
}

// MARK: - Current practice (multi)

enum CurrentPractice: String, Codable, CaseIterable, Identifiable {
    case yoga
    case meditation
    case journaling
    case breathwork
    case consciousNutrition = "conscious_nutrition"
    case movement
    case natureTime         = "nature_time"
    case digitalDetox       = "digital_detox"
    case none

    var id: String { rawValue }

    var label: String {
        switch self {
        case .yoga:               return String(localized: "Yoga", comment: "Current practice")
        case .meditation:         return String(localized: "Meditazione", comment: "Current practice")
        case .journaling:         return String(localized: "Journaling / scrittura", comment: "Current practice")
        case .breathwork:         return String(localized: "Respirazione consapevole", comment: "Current practice")
        case .consciousNutrition: return String(localized: "Alimentazione consapevole", comment: "Current practice")
        case .movement:           return String(localized: "Movimento (danza, camminata, sport)", comment: "Current practice")
        case .natureTime:         return String(localized: "Tempo in natura", comment: "Current practice")
        case .digitalDetox:       return String(localized: "Pause dal digitale", comment: "Current practice")
        case .none:               return String(localized: "Nessuna ancora", comment: "Current practice — sentinel")
        }
    }
}

// MARK: - Cosmic marker (zodiac, stored as "zodiac:<sign>")

enum CosmicMarker: String, Codable, CaseIterable, Identifiable {
    case aries       = "zodiac:aries"
    case taurus      = "zodiac:taurus"
    case gemini      = "zodiac:gemini"
    case cancer      = "zodiac:cancer"
    case leo         = "zodiac:leo"
    case virgo       = "zodiac:virgo"
    case libra       = "zodiac:libra"
    case scorpio     = "zodiac:scorpio"
    case sagittarius = "zodiac:sagittarius"
    case capricorn   = "zodiac:capricorn"
    case aquarius    = "zodiac:aquarius"
    case pisces      = "zodiac:pisces"
    case unknown

    var id: String { rawValue }

    var label: String {
        switch self {
        case .aries:       return String(localized: "Ariete",     comment: "Zodiac sign")
        case .taurus:      return String(localized: "Toro",       comment: "Zodiac sign")
        case .gemini:      return String(localized: "Gemelli",    comment: "Zodiac sign")
        case .cancer:      return String(localized: "Cancro",     comment: "Zodiac sign")
        case .leo:         return String(localized: "Leone",      comment: "Zodiac sign")
        case .virgo:       return String(localized: "Vergine",    comment: "Zodiac sign")
        case .libra:       return String(localized: "Bilancia",   comment: "Zodiac sign")
        case .scorpio:     return String(localized: "Scorpione",  comment: "Zodiac sign")
        case .sagittarius: return String(localized: "Sagittario", comment: "Zodiac sign")
        case .capricorn:   return String(localized: "Capricorno", comment: "Zodiac sign")
        case .aquarius:    return String(localized: "Acquario",   comment: "Zodiac sign")
        case .pisces:      return String(localized: "Pesci",      comment: "Zodiac sign")
        case .unknown:     return String(localized: "Non lo so / preferisco non dire", comment: "Zodiac unknown")
        }
    }

    /// The value persisted to the DB. `unknown` is mapped to `nil`
    /// because the column is nullable and we don't store a "user
    /// declined" sentinel (the absence IS the signal).
    var dbValue: String? {
        self == .unknown ? nil : rawValue
    }
}

// MARK: - Aggregate answer set

/// Single source of truth for what onboarding has collected so far.
/// Used by the view model to drive validation, persistence, and
/// matchmaking. Mirrors web's `AnswerSet` shape exactly so a row
/// written by iOS round-trips identically through the web admin.
struct OnboardingAnswers: Equatable {
    var intent: OnboardingIntent?
    var focusAreas: Set<FocusArea> = []
    var familiarPractices: Set<FamiliarPractice> = []
    var approaches: Set<Approach> = []
    var timing: OnboardingTiming?
    var lifeSeason: LifeSeason?
    var currentPractices: Set<CurrentPractice> = []
    var cosmicMarker: CosmicMarker?
    var notes: String = ""
    var researchConsent: Bool = false
}

// MARK: - Practice matchmaking (port of web's recommendPractices)

/// Deterministic 1:1 port of `recommendPractices()` from the webapp.
/// Returns the top-N category keys (in the PascalCase / Italian format
/// used by `practices.category_key`).
///
/// Last verified against `client-webapp/src/lib/onboarding/steps.ts`
/// on 2026-05-16. Any change to the web version MUST be ported here
/// to keep the two platforms recommending the same practitioners.
enum OnboardingMatchmaker {

    static func recommendPractices(_ answers: OnboardingAnswers, n: Int = 3) -> [String] {
        var scores: [String: Int] = [:]
        func bump(_ key: String, by delta: Int) {
            scores[key, default: 0] += delta
        }

        // Strong signal: explicit familiarity gets the practice surfaced
        for practice in answers.familiarPractices where practice != .none {
            bump(practice.rawValue, by: 4)
        }

        // Focus areas → practices that address them
        let focusMap: [FocusArea: [String]] = [
            .body:           ["Naturopatia", "Ayurveda", "Reiki"],
            .mind:           ["ThetaHealing", "Numerologia"],
            .energy:         ["ThetaHealing", "Reiki", "Sciamanesimo"],
            .relationships:  ["Costellazioni Familiari", "Costellazioni Sistemiche"],
            .lifeDirection:  ["Astrologia", "Human Design", "Numerologia"],
            .dailyRitual:    ["Ayurveda", "Naturopatia"],
            .familyRoots:    ["Costellazioni Familiari", "Sciamanesimo"],
            .innerListening: ["ThetaHealing", "Astrologia", "Human Design", "Sciamanesimo"]
        ]
        for area in answers.focusAreas {
            for key in focusMap[area] ?? [] { bump(key, by: 2) }
        }

        // Approaches → practices that match. `.open` adds nothing
        // (let other signals decide).
        let approachMap: [Approach: [String]] = [
            .energetic:     ["ThetaHealing", "Reiki", "Sciamanesimo"],
            .selfKnowledge: ["Astrologia", "Human Design", "Numerologia"],
            .spiritual:     ["ThetaHealing", "Reiki", "Sciamanesimo"],
            .symbolic:      ["Astrologia", "Numerologia", "Human Design"],
            .bodyCare:      ["Naturopatia", "Ayurveda"]
        ]
        for approach in answers.approaches {
            for key in approachMap[approach] ?? [] { bump(key, by: 2) }
        }

        return scores
            .sorted { $0.value > $1.value }
            .prefix(n)
            .map { $0.key }
    }

    /// Convert a `practices.category_key` (PascalCase, e.g. "ThetaHealing")
    /// to the kebab-case format used by `therapist_profiles_public.categories`
    /// (e.g. "theta-healing"). Mirrors the same conversion the web does
    /// in `loadMatchmaking` since 2026-05-16.
    static func therapistCategoryKey(from practiceCategoryKey: String) -> String {
        practiceCategoryKey.lowercased().replacingOccurrences(of: " ", with: "-")
    }
}
