import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - View Modifier Extensions

extension View {
    func huShadow(_ style: HUShadow) -> some View {
        self.shadow(color: style.color, radius: style.radius, x: style.x, y: style.y)
    }
    
    func huCard() -> some View {
        self
            .background(HUColor.background)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
            .huShadow(.md)
    }
    
    func huPrimaryGradient() -> some View {
        self.background(
            LinearGradient(
                colors: [HUColor.primary, HUColor.primaryDark],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }
    
    /// Applies a staggered fade-in + slide-up animation based on item index.
    /// Respects the user's Reduce Motion accessibility setting.
    func staggeredAppearance(index: Int, isVisible: Bool) -> some View {
        modifier(StaggeredAppearanceModifier(index: index, isVisible: isVisible))
    }
}

// MARK: - Staggered Appearance Modifier

private struct StaggeredAppearanceModifier: ViewModifier {
    let index: Int
    let isVisible: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    
    func body(content: Content) -> some View {
        if reduceMotion {
            content.opacity(isVisible ? 1 : 0)
        } else {
            content
                .opacity(isVisible ? 1 : 0)
                .offset(y: isVisible ? 0 : 20)
                .animation(
                    .spring(response: 0.4, dampingFraction: 0.8)
                        .delay(Double(index) * 0.06),
                    value: isVisible
                )
        }
    }
}

// MARK: - Primary Gradient

struct PrimaryGradient: ShapeStyle {
    static var linear: LinearGradient {
        LinearGradient(
            colors: [HUColor.primary, HUColor.primaryDark],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Haptic Feedback

enum HUHaptic {
    #if canImport(UIKit)
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
    
    static func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }
    
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
    #endif
}

// MARK: - Confetti View

struct ConfettiView: View {
    @State private var particles: [ConfettiParticle] = []
    @State private var isAnimating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    
    private let colors: [Color] = [
        HUColor.primary, HUColor.accent, HUColor.success,
        HUColor.info, .pink, .orange, .purple
    ]
    
    struct ConfettiParticle: Identifiable {
        let id = UUID()
        let color: Color
        let size: CGFloat
        let startX: CGFloat
        let rotationSpeed: Double
        var delay: Double
    }
    
    var body: some View {
        if reduceMotion {
            // Static confetti scatter for Reduce Motion users
            GeometryReader { geo in
                ZStack {
                    ForEach(0..<12, id: \.self) { i in
                        Circle()
                            .fill(colors[i % colors.count])
                            .frame(width: 8, height: 8)
                            .offset(
                                x: CGFloat.random(in: -geo.size.width/3...geo.size.width/3),
                                y: CGFloat.random(in: -geo.size.height/4...geo.size.height/4)
                            )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .opacity(isAnimating ? 0 : 1)
                .onAppear {
                    // Fade out after 2 seconds
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        withAnimation(.easeOut(duration: 0.5)) {
                            isAnimating = true
                        }
                    }
                }
            }
            .allowsHitTesting(false)
        } else {
            GeometryReader { geo in
                ZStack {
                    ForEach(particles) { particle in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(particle.color)
                            .frame(width: particle.size, height: particle.size * 0.6)
                            .offset(
                                x: particle.startX - geo.size.width / 2,
                                y: isAnimating ? geo.size.height + 20 : -20
                            )
                            .rotationEffect(.degrees(isAnimating ? Double.random(in: 360...720) : 0))
                            .opacity(isAnimating ? 0 : 1)
                            .animation(
                                .easeIn(duration: Double.random(in: 2.0...3.5))
                                    .delay(particle.delay),
                                value: isAnimating
                            )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onAppear {
                    particles = (0..<40).map { _ in
                        ConfettiParticle(
                            color: colors.randomElement() ?? .purple,
                            size: CGFloat.random(in: 6...12),
                            startX: CGFloat.random(in: 0...geo.size.width),
                            rotationSpeed: Double.random(in: 1...3),
                            delay: Double.random(in: 0...0.5)
                        )
                    }
                    isAnimating = true
                }
            }
            .allowsHitTesting(false)
        }
    }
}

// MARK: - Offline Banner

struct OfflineBanner: View {
    var body: some View {
        HStack(spacing: HUSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 14, weight: .medium))
            Text("No Internet Connection")
                .font(HUFont.caption(weight: .semibold))
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, HUSpacing.sm)
        .background(HUColor.error.opacity(0.9))
    }
}

// MARK: - Password Strength

enum PasswordStrength: Int {
    case empty = 0
    case weak = 1
    case fair = 2
    case strong = 3
    case veryStrong = 4
    
    var label: String {
        switch self {
        case .empty: return ""
        case .weak: return "Weak"
        case .fair: return "Fair"
        case .strong: return "Strong"
        case .veryStrong: return "Very Strong"
        }
    }
    
    var color: Color {
        switch self {
        case .empty: return .clear
        case .weak: return HUColor.error
        case .fair: return HUColor.warning
        case .strong: return HUColor.info
        case .veryStrong: return HUColor.success
        }
    }
    
    static func evaluate(_ password: String) -> PasswordStrength {
        guard !password.isEmpty else { return .empty }
        var score = 0
        if password.count >= 8 { score += 1 }
        if password.rangeOfCharacter(from: .uppercaseLetters) != nil { score += 1 }
        if password.rangeOfCharacter(from: .decimalDigits) != nil { score += 1 }
        if password.rangeOfCharacter(from: CharacterSet(charactersIn: "!@#$%^&*()-_=+[]{}|;:',.<>?/`~")) != nil { score += 1 }
        return PasswordStrength(rawValue: score) ?? .weak
    }
}

struct PasswordStrengthView: View {
    let password: String
    
    private var strength: PasswordStrength {
        PasswordStrength.evaluate(password)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                ForEach(1...4, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(level <= strength.rawValue ? strength.color : HUColor.divider)
                        .frame(height: 4)
                }
            }
            
            if strength != .empty {
                Text(strength.label)
                    .font(HUFont.caption(weight: .medium))
                    .foregroundStyle(strength.color)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: strength.rawValue)
    }
}
