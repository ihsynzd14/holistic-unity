import Foundation

/// Generates personalized content for the client home screen based on onboarding data.
enum PersonalizationEngine {
    
    // MARK: - Greeting
    
    static func greeting(displayName: String?, experienceLevel: ExperienceLevel?) -> String {
        let firstName = displayName?
            .trimmingCharacters(in: .whitespaces)
            .components(separatedBy: " ")
            .first ?? ""

        let hour = Calendar.current.component(.hour, from: Date())
        // iOS will auto-localize these strings from Localizable.xcstrings.
        let timeGreeting: String
        switch hour {
        case 5..<12:  timeGreeting = String(localized: "Good morning", comment: "Home greeting, 5am–12pm")
        case 12..<17: timeGreeting = String(localized: "Good afternoon", comment: "Home greeting, 12pm–5pm")
        case 17..<22: timeGreeting = String(localized: "Good evening", comment: "Home greeting, 5pm–10pm")
        default:      timeGreeting = String(localized: "Welcome back", comment: "Home greeting, late night / fallback")
        }

        if firstName.isEmpty {
            return timeGreeting
        }
        // Compose greeting + comma + first name. The greeting itself was
        // already localized above; joining with ", " is locale-neutral
        // for both IT and EN and avoids a String-interpolation localization
        // key (which requires a LocalizedStringResource and complicates
        // build-time extraction).
        return "\(timeGreeting), \(firstName)"
    }
    
    // MARK: - Daily Intention
    //
    // A short, rotating phrase shown beneath the greeting. Replaces the
    // redundant "Holistic Unity" brand label that used to sit there.
    // The phrase is deterministic per calendar day so the user sees the
    // same one all day (not random every tab switch).

    // Each intention is wrapped in String(localized:) so iOS picks the right
    // language from Localizable.xcstrings. The IT translations are populated
    // in the catalog; EN source is the key itself.
    private static func dailyIntentionPool() -> [String] {
        [
            String(localized: "Breathe. You're exactly where you need to be.", comment: "Daily intention 1"),
            String(localized: "Slow is a direction, not a speed.", comment: "Daily intention 2"),
            String(localized: "The body knows. Listen gently.", comment: "Daily intention 3"),
            String(localized: "What wants your attention today?", comment: "Daily intention 4"),
            String(localized: "Soft heart, steady mind.", comment: "Daily intention 5"),
            String(localized: "Begin again, as often as you need.", comment: "Daily intention 6"),
            String(localized: "Return to your own centre.", comment: "Daily intention 7"),
            String(localized: "Small rituals, lasting shifts.", comment: "Daily intention 8"),
            String(localized: "Rest is also a practice.", comment: "Daily intention 9"),
            String(localized: "You're allowed to take your time.", comment: "Daily intention 10"),
            String(localized: "Honour the pause before the bloom.", comment: "Daily intention 11"),
            String(localized: "Trust the rhythm of your own season.", comment: "Daily intention 12"),
        ]
    }

    static func dailyIntention() -> String {
        // Day-of-year index — changes at local midnight, stable within a day.
        let day = Calendar.current.ordinality(of: .day, in: .year, for: Date()) ?? 1
        let pool = dailyIntentionPool()
        return pool[day % pool.count]
    }

    // MARK: - Section Titles
    
    static func categoriesSectionTitle(experienceLevel: ExperienceLevel?) -> String {
        switch experienceLevel {
        case .curious:
            return String(localized: "Start Your Journey", comment: "Categories section title for curious users")
        case .exploring:
            return String(localized: "Explore New Modalities", comment: "Categories section title for exploring users")
        case .practicing:
            return String(localized: "Your Practices", comment: "Categories section title for practicing users")
        case nil:
            return String(localized: "Choose The Best Therapy", comment: "Categories section title default")
        }
    }

    static func therapistsSectionTitle(experienceLevel: ExperienceLevel?) -> String {
        switch experienceLevel {
        case .curious:
            return String(localized: "Recommended For Beginners", comment: "Therapists section title for curious")
        case .exploring:
            return String(localized: "Therapists You'll Love", comment: "Therapists section title for exploring")
        case .practicing, nil:
            return String(localized: "Our Certified Therapists", comment: "Therapists section title default")
        }
    }
    
    // MARK: - Featured Modalities
    
    /// Returns the user's selected interests first, followed by other categories.
    static func orderedCategories(interests: [TherapyCategory]) -> [TherapyCategory] {
        guard !interests.isEmpty else {
            return TherapyCategory.allCases.map { $0 }
        }
        let interestsSet = Set(interests)
        let rest = TherapyCategory.allCases.filter { !interestsSet.contains($0) }
        return interests + rest
    }
    
    // MARK: - Daily Insight
    
    static func dailyInsightTitle(intention: Intention?) -> String {
        switch intention {
        case .selfDiscovery:
            return "Today's Reflection"
        case .healingLetGo:
            return "Healing Thought"
        case .relationships:
            return "Connection Insight"
        case .careerPurpose:
            return "Purpose Prompt"
        case .spiritualGrowth:
            return "Spiritual Insight"
        case .justExploring, nil:
            return "Daily Inspiration"
        }
    }
    
    static func dailyInsight(intention: Intention?) -> String {
        // Rotate through a small pool based on the day of year
        let dayOfYear = Calendar.current.ordinality(of: .day, in: .year, for: Date()) ?? 1
        
        let pool: [String]
        switch intention {
        case .selfDiscovery:
            pool = [
                "What part of yourself are you curious about today?",
                "Every question you ask yourself is a step toward understanding.",
                "Self-knowledge begins with gentle observation.",
                "The journey inward is the most rewarding adventure.",
            ]
        case .healingLetGo:
            pool = [
                "Healing isn't linear — every small step counts.",
                "What would it feel like to release what no longer serves you?",
                "Gentleness with yourself is the first act of healing.",
                "You are allowed to outgrow who you used to be.",
            ]
        case .relationships:
            pool = [
                "The deepest connections start with self-understanding.",
                "How can you show up more authentically in your relationships today?",
                "Healthy boundaries are an act of love.",
                "Every relationship reflects something within you.",
            ]
        case .careerPurpose:
            pool = [
                "Your purpose isn't something to find — it's something to create.",
                "What work would you do even if no one was watching?",
                "Alignment with your values is the compass to purpose.",
                "Small steps in the right direction still move you forward.",
            ]
        case .spiritualGrowth:
            pool = [
                "Stillness is where spiritual growth begins.",
                "Trust the process — even when you can't see the path.",
                "Your intuition is your inner compass.",
                "The universe is always communicating — are you listening?",
            ]
        case .justExploring, nil:
            pool = [
                "Every wellness journey starts with a single session.",
                "Stay open — the right practice will find you.",
                "Curiosity is the doorway to transformation.",
                "There's no wrong way to explore your well-being.",
            ]
        }
        
        return pool[(dayOfYear - 1) % pool.count]
    }
    
    // MARK: - Birth Data Prompt
    
    /// Returns a prompt message if the user has birth-data-dependent interests but skipped entering it.
    static func birthDataPrompt(interests: [TherapyCategory], hasSkippedBirthData: Bool) -> String? {
        guard hasSkippedBirthData else { return nil }
        let birthModalities: Set<TherapyCategory> = [.astrology, .humanDesign, .numerology]
        let relevant = interests.filter { birthModalities.contains($0) }
        guard !relevant.isEmpty else { return nil }
        
        let names = relevant.map(\.displayName).joined(separator: " and ")
        return "Add your birth details for more personalized \(names) readings."
    }
}
