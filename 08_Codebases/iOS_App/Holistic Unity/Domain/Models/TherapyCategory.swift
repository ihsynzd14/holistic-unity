import SwiftUI

enum TherapyCategory: String, Codable, CaseIterable, Identifiable {
    // Energy & Spiritual
    case thetaHealing = "theta_healing"
    
    // Constellation Work
    case familyConstellation = "family_constellation"
    case systemicConstellation = "systemic_constellation"
    
    // Natural Medicine
    case naturopathy
    case ayurveda
    
    // Divination & Intuitive
    case astrology
    case humanDesign = "human_design"
    case numerology
    
    // Energy Healing
    case reiki

    // Indigenous & Earth-based
    case shamanism

    var id: String { rawValue }

    /// The value stored in the Supabase DB (Italian, hyphen-separated).
    /// Used when building server-side filter queries.
    var dbValue: String {
        switch self {
        case .thetaHealing:          return "theta-healing"
        case .familyConstellation:   return "costellazioni-familiari"
        case .systemicConstellation: return "costellazioni-sistemiche"
        case .naturopathy:           return "naturopatia"
        case .ayurveda:              return "ayurveda"
        case .astrology:             return "astrologia"
        case .humanDesign:           return "human-design"
        case .numerology:            return "numerologia"
        case .reiki:                 return "reiki"
        case .shamanism:             return "sciamanesimo"
        }
    }
    
    var displayName: String {
        switch self {
        case .thetaHealing: return String(localized: "ThetaHealing", comment: "Therapy category name")
        case .reiki: return String(localized: "Distance Reiki", comment: "Therapy category name")
        case .familyConstellation: return String(localized: "Family Constellation", comment: "Therapy category name")
        case .systemicConstellation: return String(localized: "Systemic Constellation", comment: "Therapy category name")
        case .naturopathy: return String(localized: "Naturopathy", comment: "Therapy category name")
        case .ayurveda: return String(localized: "Ayurveda Consultation", comment: "Therapy category name")
        case .astrology: return String(localized: "Astrology", comment: "Therapy category name")
        case .humanDesign: return String(localized: "Human Design", comment: "Therapy category name")
        case .numerology: return String(localized: "Numerology", comment: "Therapy category name")
        case .shamanism: return String(localized: "Shamanism", comment: "Therapy category name")
        }
    }

    var icon: String {
        switch self {
        case .thetaHealing: return "brain"
        case .reiki: return "hands.sparkles"
        case .familyConstellation: return "figure.2.and.child.holdinghands"
        case .systemicConstellation: return "circle.grid.3x3"
        case .naturopathy: return "leaf.circle"
        case .ayurveda: return "tree"
        case .astrology: return "star.circle"
        case .humanDesign: return "person.crop.circle.badge.checkmark"
        case .numerology: return "number.circle"
        case .shamanism: return "flame.circle"
        }
    }

    /// A short paragraph describing the practice
    var practiceDescription: String {
        switch self {
        case .thetaHealing:
            return "ThetaHealing is a meditation and spiritual philosophy technique that uses focused thought and prayer to access the theta brainwave state. In this deeply relaxed state, practitioners work with you to identify and transform limiting beliefs, heal emotional wounds, and create positive changes at the subconscious level. Sessions are highly effective online."
        case .reiki:
            return "Distance Reiki is a Japanese energy healing technique where practitioners channel universal life force energy to promote balance and well-being. During a remote session, the practitioner connects energetically with you regardless of physical location, working with your energy field to stimulate healing and restore physical, emotional, and spiritual harmony."
        case .familyConstellation:
            return "Family Constellation is a therapeutic approach that reveals hidden dynamics within family systems that may be influencing your current life. Through guided exploration of your family's energetic field, practitioners help you uncover inherited patterns, unresolved traumas, and entanglements passed down through generations, allowing deep healing and release."
        case .systemicConstellation:
            return "Systemic Constellation extends constellation work beyond family to any system — workplaces, organizations, relationships, or inner conflicts. By mapping out the elements of a system and observing their dynamics, practitioners help you understand hidden influences and find resolution, restoring balance and flow in all areas of life."
        case .naturopathy:
            return "Naturopathy is a holistic approach to wellness that emphasizes the body's inherent ability to heal itself. Naturopathic practitioners combine modern scientific knowledge with traditional and natural therapies — including nutrition, botanical medicine, and lifestyle counseling — to treat the root cause of illness rather than just symptoms."
        case .ayurveda:
            return "Ayurveda is one of the world's oldest holistic healing systems, originating in India over 5,000 years ago. It focuses on balancing the three doshas (Vata, Pitta, Kapha) — your unique mind-body constitution — through personalized dietary guidance, herbal remedies, lifestyle practices, and cleansing techniques to achieve optimal health."
        case .astrology:
            return "Astrology is the study of celestial bodies and their influence on human affairs and personality. Through birth chart analysis, transit readings, and forecasting, astrologers help you understand your life patterns, strengths, challenges, and timing for important decisions. Consultations are naturally suited to video sessions."
        case .humanDesign:
            return "Human Design is a system that combines astrology, the I Ching, Kabbalah, and the chakra system to create a unique 'body graph' based on your birth data. Readers help you understand your energetic type, decision-making strategy, and life purpose, offering a practical guide to living authentically."
        case .numerology:
            return "Numerology is the study of the mystical significance of numbers and their influence on human life. By analyzing key numbers derived from your birth date and name, numerologists reveal insights about your personality, life path, opportunities, and challenges."
        case .shamanism:
            return "Shamanism is one of humanity's oldest spiritual traditions, practiced for tens of thousands of years across indigenous cultures worldwide. Practitioners work in altered states of consciousness — often supported by drumming, breath, and intention — to journey on your behalf, retrieve lost soul fragments, clear stagnant energies, and reconnect you with the wisdom of nature, ancestors, and your own inner guidance."
        }
    }

    /// Key benefits of this practice
    var benefits: [String] {
        switch self {
        case .thetaHealing:
            return ["Transformation of limiting beliefs", "Emotional and physical healing", "Manifestation support", "Deep spiritual connection"]
        case .reiki:
            return ["Deep relaxation and stress reduction", "Emotional balance and clarity", "Support for the body's natural healing", "Pain and tension relief"]
        case .familyConstellation:
            return ["Healing inherited family patterns", "Understanding relationship dynamics", "Release of generational trauma", "Greater clarity on life purpose"]
        case .systemicConstellation:
            return ["Clarity on workplace and team dynamics", "Resolution of inner conflicts", "Understanding hidden systemic influences", "Restoring balance in relationships"]
        case .naturopathy:
            return ["Root-cause approach to health issues", "Strengthened immune response", "Improved digestive health", "Sustainable lifestyle changes"]
        case .ayurveda:
            return ["Personalized health optimization", "Improved digestion and metabolism", "Balanced energy throughout the day", "Strengthened immune system"]
        case .astrology:
            return ["Self-understanding and clarity", "Optimal timing for decisions", "Relationship compatibility insights", "Career and life purpose guidance"]
        case .humanDesign:
            return ["Understanding your energetic type", "Aligned decision-making", "Improved relationships", "Living authentically"]
        case .numerology:
            return ["Life path clarity", "Understanding personal cycles", "Relationship insights", "Career and purpose guidance"]
        case .shamanism:
            return ["Reconnection with nature and intuition", "Release of energetic blocks and old trauma", "Soul retrieval and integration", "Deeper sense of meaning and belonging"]
        }
    }

    /// Who is this practice best suited for
    var whoIsItFor: String {
        switch self {
        case .thetaHealing:
            return "Anyone looking to transform deep-seated beliefs and patterns. Particularly effective for those dealing with emotional trauma, self-sabotage, chronic health issues, or anyone seeking rapid personal transformation."
        case .reiki:
            return "Anyone seeking gentle, non-invasive healing. Ideal for those dealing with stress, emotional challenges, chronic fatigue, or anyone curious about energy work. No prior experience needed."
        case .familyConstellation:
            return "Those experiencing recurring patterns in relationships, health, or career that seem to have no clear origin. Especially helpful for people dealing with family estrangement, grief, or a sense of carrying burdens that aren't entirely their own."
        case .systemicConstellation:
            return "Professionals navigating workplace challenges, individuals dealing with complex relationship dynamics, or anyone feeling stuck in patterns that extend beyond the family system. Also effective for organizational leaders and teams."
        case .naturopathy:
            return "People who prefer natural approaches to health and want to address the root cause of their conditions. Ideal for chronic issues, digestive problems, and preventive wellness."
        case .ayurveda:
            return "Those interested in a comprehensive, personalized approach to health. Particularly helpful for people with digestive issues, hormonal imbalances, or those wanting to align their lifestyle with their natural constitution."
        case .astrology:
            return "Anyone curious about self-understanding through the lens of the stars. Helpful for those navigating major life decisions, relationship dynamics, or seeking timing guidance for important moves."
        case .humanDesign:
            return "Anyone seeking a practical framework for self-understanding. Especially helpful for people-pleasers, those struggling with decision-making, or anyone feeling out of alignment with their true nature."
        case .numerology:
            return "People fascinated by numbers and patterns who want to understand their life path, personal cycles, and compatibility. Great for those making career or relationship decisions."
        case .shamanism:
            return "Those drawn to earth-based and ancestral wisdom who feel disconnected from themselves, nature, or a sense of purpose. Particularly supportive for people processing grief, transitions, or unresolved patterns that haven't responded to talk-based approaches."
        }
    }

    /// Asset catalog name for the category illustration, if available.
    var illustrationName: String? {
        switch self {
        case .thetaHealing: return "IllustThetaHealing"
        case .reiki: return "IllustReiki"
        case .familyConstellation: return "IllustFamilyConstellation"
        case .systemicConstellation: return "IllustSystemicConstellation"
        case .naturopathy: return "IllustNaturopathy"
        case .ayurveda: return "IllustAyurveda"
        case .astrology: return "IllustAstrology"
        case .humanDesign: return "IllustHumanDesign"
        case .numerology: return "IllustNumerology"
        case .shamanism: return "IllustSciamanesimo"
        }
    }
    
    var color: Color {
        switch self {
        // Energy & Spiritual
        case .thetaHealing: return Color(red: 0.80, green: 0.60, blue: 0.75)
        case .reiki: return Color(red: 0.67, green: 0.53, blue: 0.80)
        // Constellation Work
        case .familyConstellation: return Color(red: 0.60, green: 0.55, blue: 0.78)
        case .systemicConstellation: return Color(red: 0.55, green: 0.60, blue: 0.75)
        // Natural Medicine
        case .naturopathy: return Color(red: 0.75, green: 0.65, blue: 0.45)
        case .ayurveda: return Color(red: 0.75, green: 0.65, blue: 0.45)
        // Divination & Intuitive
        case .astrology: return Color(red: 0.45, green: 0.55, blue: 0.78)
        case .humanDesign: return Color(red: 0.60, green: 0.55, blue: 0.72)
        case .numerology: return Color(red: 0.45, green: 0.55, blue: 0.78)
        // Indigenous & Earth-based
        case .shamanism: return Color(red: 0.72, green: 0.45, blue: 0.32)
        }
    }
}

// MARK: - Wellness Goals

enum WellnessGoal: String, Codable, CaseIterable, Identifiable {
    case stressRelief = "stress_relief"
    case painManagement = "pain_management"
    case spiritualGrowth = "spiritual_growth"
    case betterSleep = "better_sleep"
    case emotionalHealing = "emotional_healing"
    case improvedEnergy = "improved_energy"
    case anxietyRelief = "anxiety_relief"
    case selfDiscovery = "self_discovery"
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .stressRelief: return String(localized: "Stress Relief", comment: "Wellness goal")
        case .painManagement: return String(localized: "Pain Management", comment: "Wellness goal")
        case .spiritualGrowth: return String(localized: "Spiritual Growth", comment: "Wellness goal")
        case .betterSleep: return String(localized: "Better Sleep", comment: "Wellness goal")
        case .emotionalHealing: return String(localized: "Emotional Healing", comment: "Wellness goal")
        case .improvedEnergy: return String(localized: "Improved Energy", comment: "Wellness goal")
        case .anxietyRelief: return String(localized: "Anxiety Relief", comment: "Wellness goal")
        case .selfDiscovery: return String(localized: "Self-Discovery", comment: "Wellness goal")
        }
    }
    
    var icon: String {
        switch self {
        case .stressRelief: return "brain.head.profile"
        case .painManagement: return "bandage"
        case .spiritualGrowth: return "sparkles"
        case .betterSleep: return "moon.zzz"
        case .emotionalHealing: return "heart.circle"
        case .improvedEnergy: return "bolt.fill"
        case .anxietyRelief: return "leaf"
        case .selfDiscovery: return "magnifyingglass"
        }
    }
}
