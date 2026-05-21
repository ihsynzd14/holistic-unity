import SwiftUI

// MARK: - Color Palette

enum HUColor {
    // Primary brand colors — extracted from the lotus logo (#7B2252 berry)
    // WCAG AA contrast ratio: 7.8:1 on white
    static let primary = Color(red: 0.482, green: 0.133, blue: 0.322)    // #7B2252 berry
    static let primaryDark = Color(red: 0.361, green: 0.102, blue: 0.243) // #5C1A3E darker berry
    static let primaryLight = Color(red: 0.961, green: 0.878, blue: 0.922) // #F5E0EB soft pink tint
    static let primaryMuted = Color(red: 0.690, green: 0.416, blue: 0.557) // #B06A8E muted berry
    static let accent = Color(red: 0.95, green: 0.75, blue: 0.20)        // Gold/yellow accent
    static let accentLight = Color(red: 0.98, green: 0.92, blue: 0.72)
    
    // Semantic colors — adaptive for light/dark mode
    static let background = Color(.systemBackground)
    static let secondaryBackground = Color(.secondarySystemBackground)
    static let tertiaryBackground = Color(.tertiarySystemBackground)
    static let groupedBackground = Color(.systemGroupedBackground)
    
    // Text — adaptive
    static let textPrimary = Color(.label)
    static let textSecondary = Color(.secondaryLabel)
    static let textTertiary = Color(.tertiaryLabel)
    static let textOnPrimary = Color.white
    
    // Status
    static let success = Color(red: 0.20, green: 0.72, blue: 0.40)
    static let warning = Color(red: 0.96, green: 0.72, blue: 0.10)
    static let error = Color(red: 0.88, green: 0.26, blue: 0.22)
    static let info = Color(red: 0.22, green: 0.53, blue: 0.84)
    
    // Misc — adaptive where needed
    static let divider = Color(.separator)
    static let cardShadow = Color.black.opacity(0.08)
    static let overlay = Color.black.opacity(0.4)
    static let starFilled = Color(red: 1.0, green: 0.79, blue: 0.0)
    static let starEmpty = Color.gray.opacity(0.25)
    static let online = Color(red: 0.20, green: 0.78, blue: 0.40)
    static let offline = Color.gray.opacity(0.4)
    
    // Card backgrounds — soft pastel tones (slightly adjusted in dark mode via opacity)
    static let cardGreen = Color(red: 0.85, green: 0.95, blue: 0.87).opacity(0.85)
    static let cardPink = Color(red: 0.98, green: 0.88, blue: 0.92).opacity(0.85)
    static let cardPurple = Color(red: 0.91, green: 0.87, blue: 0.98).opacity(0.85)
    static let cardYellow = Color(red: 0.99, green: 0.96, blue: 0.85).opacity(0.85)
    static let cardOrange = Color(red: 0.99, green: 0.91, blue: 0.84).opacity(0.85)

    // ─────────────────────────────────────────────────────────────
    // Onboarding-only accent palette (matches web design system)
    //
    // The onboarding flow uses a brighter magenta (`#AE0062`) than
    // the rest of the app's berry primary (`#7B2252`). We do NOT
    // override HUColor.primary because the existing app screens were
    // designed against the berry tone — swapping it globally would
    // shift contrast across dozens of components. Onboarding gets its
    // own scoped accent so the welcome flow can match the painted
    // brand assets while everything else stays consistent.
    // ─────────────────────────────────────────────────────────────
    static let brandMagenta     = Color(red: 0.682, green: 0.000, blue: 0.384) // #AE0062
    static let brandMagentaDark = Color(red: 0.545, green: 0.000, blue: 0.306) // #8B004E
    static let brandCream       = Color(red: 0.992, green: 0.965, blue: 0.941) // #FDF6F0
    static let brandGold        = Color(red: 0.788, green: 0.663, blue: 0.431) // #C9A96E — eyebrow accent
    static let brandGoldLight   = Color(red: 0.831, green: 0.737, blue: 0.557) // #D4BC8E

    // Painted tile tints — used by the category grid in onboarding.
    // Solid (no opacity) so the painted illustrations sit on a flat
    // pastel surface, matching the web mockup exactly.
    static let tileGold   = Color(red: 0.988, green: 0.961, blue: 0.851) // #FCF5D9
    static let tilePink   = Color(red: 0.980, green: 0.878, blue: 0.922) // #FAE0EB
    static let tilePurple = Color(red: 0.910, green: 0.871, blue: 0.980) // #E8DEFA
    static let tileGreen  = Color(red: 0.851, green: 0.949, blue: 0.867) // #D9F2DD
    static let tileOrange = Color(red: 0.988, green: 0.910, blue: 0.839) // #FCE8D6
}

// MARK: - Onboarding Gradient

/// Magenta gradient used for the onboarding primary CTA. Scoped to
/// the new client onboarding flow — the rest of the app keeps using
/// `PrimaryGradient` (berry).
struct OnboardingMagentaGradient {
    static var linear: LinearGradient {
        LinearGradient(
            colors: [HUColor.brandMagenta, HUColor.brandMagentaDark],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Typography
//
// Type system has two faces:
//   - DISPLAY  → Fraunces (humanist serif, variable). Used for H1/H2 hero
//                moments: greeting, page titles, category labels, quotes.
//                Gives the brand warm editorial personality.
//   - BODY     → SF Pro (system). Used everywhere else. Optimal legibility
//                on iOS, respects Dynamic Type, no licensing.
//
// Fraunces static cuts bundled as individual TTF files at 72pt optical size
// (the optical size best suited for display sizes 24-48pt on a phone).
// PostScript names: `Fraunces72pt-Regular`, `-SemiBold`, `-Bold`, `-Italic`.
// Only these four cuts are registered to keep the app binary small.

enum HUFont {
    // MARK: Display (Fraunces serif)

    private static func fraunces(_ size: CGFloat, weight: FrauncesWeight = .semiBold) -> Font {
        .custom(weight.postScriptName, size: size)
    }

    enum FrauncesWeight {
        case regular
        case semiBold
        case bold
        case italic

        var postScriptName: String {
            switch self {
            case .regular:  return "Fraunces72pt-Regular"
            case .semiBold: return "Fraunces72pt-SemiBold"
            case .bold:     return "Fraunces72pt-Bold"
            case .italic:   return "Fraunces72pt-Italic"
            }
        }
    }

    /// Hero-scale serif display — use for welcome screens, brand moments.
    static func display(size: CGFloat = 44, weight: FrauncesWeight = .bold) -> Font {
        fraunces(size, weight: weight)
    }

    /// H1 serif — page title level.
    static func displayTitle(size: CGFloat = 32, weight: FrauncesWeight = .bold) -> Font {
        fraunces(size, weight: weight)
    }

    /// H2 serif — section header level.
    static func displayHeadline(size: CGFloat = 22, weight: FrauncesWeight = .semiBold) -> Font {
        fraunces(size, weight: weight)
    }

    /// H3 serif — for editorial card titles.
    static func displaySubtitle(size: CGFloat = 18, weight: FrauncesWeight = .semiBold) -> Font {
        fraunces(size, weight: weight)
    }

    // MARK: System body (SF Pro)

    static func largeTitle(weight: Font.Weight = .bold) -> Font {
        .system(.largeTitle, design: .default, weight: weight)
    }

    static func title(weight: Font.Weight = .bold) -> Font {
        .system(.title, design: .default, weight: weight)
    }

    static func title2(weight: Font.Weight = .semibold) -> Font {
        .system(.title2, design: .default, weight: weight)
    }

    static func title3(weight: Font.Weight = .semibold) -> Font {
        .system(.title3, design: .default, weight: weight)
    }

    static func headline(weight: Font.Weight = .semibold) -> Font {
        .system(.headline, design: .default, weight: weight)
    }

    static func body(weight: Font.Weight = .regular) -> Font {
        .system(.body, design: .default, weight: weight)
    }

    static func callout(weight: Font.Weight = .regular) -> Font {
        .system(.callout, design: .default, weight: weight)
    }

    static func subheadline(weight: Font.Weight = .regular) -> Font {
        .system(.subheadline, design: .default, weight: weight)
    }

    static func footnote(weight: Font.Weight = .regular) -> Font {
        .system(.footnote, design: .default, weight: weight)
    }

    static func caption(weight: Font.Weight = .regular) -> Font {
        .system(.caption, design: .default, weight: weight)
    }
}

// MARK: - Spacing

enum HUSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 40
    static let huge: CGFloat = 48
    static let massive: CGFloat = 64
}

// MARK: - Corner Radius

enum HURadius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 10
    static let lg: CGFloat = 14
    static let xl: CGFloat = 18
    static let xxl: CGFloat = 22
    static let xxxl: CGFloat = 28
    static let pill: CGFloat = 100
}

// MARK: - Shadows

struct HUShadow {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
    
    static let sm = HUShadow(color: HUColor.cardShadow, radius: 3, x: 0, y: 1)
    static let md = HUShadow(color: HUColor.cardShadow, radius: 8, x: 0, y: 2)
    static let lg = HUShadow(color: HUColor.cardShadow, radius: 16, x: 0, y: 4)
}

// MARK: - Animation

enum HUAnimation {
    static let quick = Animation.easeInOut(duration: 0.15)
    static let standard = Animation.easeInOut(duration: 0.25)
    static let slow = Animation.easeInOut(duration: 0.4)
    static let spring = Animation.spring(response: 0.35, dampingFraction: 0.7)
}

// MARK: - Icon / Avatar Sizes

enum HUSize {
    static let iconSm: CGFloat = 16
    static let iconMd: CGFloat = 20
    static let iconLg: CGFloat = 24
    static let iconXl: CGFloat = 32
    static let avatarSm: CGFloat = 40
    static let avatarMd: CGFloat = 64
    static let avatarLg: CGFloat = 100
    static let avatarHero: CGFloat = 120
}
