import SwiftUI

// MARK: - TierBadge

/// Renders the tier badge image (PNG asset) at a given size.
/// Use `if let tier = profile.tier { TierBadge(tier: tier) }` at every call site.
struct TierBadge: View {
    let tier: TherapistTier
    var size: CGFloat = 40

    var body: some View {
        Image("tier_\(tier.rawValue)")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityLabel("\(tier.rawValue.capitalized) tier")
    }
}

// MARK: - TierPill

/// Horizontal pill showing chevron indicator + tier label.
/// `compact` variant uses a smaller font and tighter padding for list cards.
struct TierPill: View {
    let tier: TherapistTier
    var compact: Bool = false

    private var chevrons: String {
        switch tier {
        case .practitioner: return ">"
        case .trainer:      return ">>"
        case .supervisor:   return ">>>"
        }
    }

    private var label: String {
        tier.rawValue.uppercased()
    }

    private var pillColor: Color {
        switch tier {
        case .practitioner: return HUColor.primary
        case .trainer:      return HUColor.primaryDark
        case .supervisor:   return HUColor.brandGold
        }
    }

    var body: some View {
        HStack(spacing: compact ? 3 : 4) {
            Text(chevrons)
                .font(compact
                    ? .system(size: 9, weight: .bold, design: .monospaced)
                    : .system(size: 11, weight: .bold, design: .monospaced))
            Text(label)
                .font(compact
                    ? .system(size: 9, weight: .semibold)
                    : .system(size: 11, weight: .semibold))
                .tracking(0.5)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, compact ? 7 : 10)
        .padding(.vertical, compact ? 3 : 5)
        .background(pillColor)
        .clipShape(Capsule())
        .shadow(
            color: tier == .supervisor ? HUColor.brandGold.opacity(0.45) : .clear,
            radius: 6,
            y: 2
        )
        .accessibilityLabel("\(tier.rawValue.capitalized) tier")
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: HUSpacing.md) {
        ForEach(TherapistTier.allCases, id: \.rawValue) { tier in
            HStack(spacing: HUSpacing.sm) {
                TierBadge(tier: tier, size: 56)
                TierBadge(tier: tier, size: 22)
                TierPill(tier: tier)
                TierPill(tier: tier, compact: true)
            }
        }
    }
    .padding()
}
