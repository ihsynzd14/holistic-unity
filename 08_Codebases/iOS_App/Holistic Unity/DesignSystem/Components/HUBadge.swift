import SwiftUI

enum HUBadgeStyle {
    case primary
    case success
    case warning
    case error
    case info
    case neutral
    
    var backgroundColor: Color {
        switch self {
        case .primary: return HUColor.primaryLight
        case .success: return HUColor.success.opacity(0.15)
        case .warning: return HUColor.warning.opacity(0.15)
        case .error: return HUColor.error.opacity(0.15)
        case .info: return HUColor.info.opacity(0.15)
        case .neutral: return HUColor.secondaryBackground
        }
    }
    
    var textColor: Color {
        switch self {
        case .primary: return HUColor.primaryDark
        case .success: return HUColor.success
        case .warning: return .orange
        case .error: return HUColor.error
        case .info: return HUColor.info
        case .neutral: return HUColor.textSecondary
        }
    }
}

struct HUBadge: View {
    let text: String
    var style: HUBadgeStyle = .primary
    var icon: String? = nil
    
    var body: some View {
        HStack(spacing: HUSpacing.xs) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
            }
            Text(text)
                .font(HUFont.caption(weight: .semibold))
        }
        .foregroundStyle(style.textColor)
        .padding(.horizontal, HUSpacing.sm)
        .padding(.vertical, HUSpacing.xs)
        .background(style.backgroundColor)
        .clipShape(Capsule())
        .accessibilityLabel(text)
    }
}

#Preview {
    HStack {
        HUBadge(text: "Verified", style: .success, icon: "checkmark.seal.fill")
        HUBadge(text: "Virtual", style: .info)
        HUBadge(text: "Pending", style: .warning)
        HUBadge(text: "Reiki", style: .primary)
    }
}
