import SwiftUI

// MARK: - Button Styles

enum HUButtonStyle {
    case primary
    case secondary
    case outline
    case text
    case destructive
}

struct HUButton: View {
    let title: String
    let style: HUButtonStyle
    let icon: String?
    let isLoading: Bool
    let isDisabled: Bool
    let action: () -> Void
    
    init(
        _ title: String,
        style: HUButtonStyle = .primary,
        icon: String? = nil,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.style = style
        self.icon = icon
        self.isLoading = isLoading
        self.isDisabled = isDisabled
        self.action = action
    }
    
    var body: some View {
        Button(action: {
            guard !isLoading && !isDisabled else { return }
            HUHaptic.impact(.light)
            action()
        }) {
            HStack(spacing: HUSpacing.sm) {
                if isLoading {
                    ProgressView()
                        .tint(foregroundColor)
                } else {
                    if let icon {
                        Image(systemName: icon)
                            .font(.system(size: 16, weight: .semibold))
                    }
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .foregroundStyle(foregroundColor)
            .background(backgroundColor)
            .clipShape(Capsule())
            .overlay {
                if style == .outline {
                    Capsule()
                        .strokeBorder(HUColor.primary, lineWidth: 1.5)
                }
            }
        }
        .buttonStyle(HUPressButtonStyle())
        .disabled(isDisabled || isLoading)
        // Keep the brand color readable even when disabled. 0.5 made the
        // button look broken at first paint (before email/password are
        // typed); 0.7 still signals "not ready" without muting the brand.
        .opacity(isDisabled ? 0.7 : 1.0)
        .accessibilityLabel(isLoading ? "\(title), loading" : title)
        .accessibilityAddTraits(.isButton)
    }
    
    private var foregroundColor: Color {
        switch style {
        case .primary: return HUColor.textOnPrimary
        case .secondary: return HUColor.primary
        case .outline: return HUColor.primary
        case .text: return HUColor.primary
        case .destructive: return .white
        }
    }
    
    private var backgroundColor: Color {
        switch style {
        case .primary: return HUColor.primary
        case .secondary: return HUColor.primaryLight
        case .outline: return .clear
        case .text: return .clear
        case .destructive: return HUColor.error
        }
    }
}

// MARK: - Press Button Style

struct HUPressButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.85 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

#Preview {
    VStack(spacing: 16) {
        HUButton("Get Started", style: .primary, icon: "arrow.right") {}
        HUButton("Secondary", style: .secondary) {}
        HUButton("Outline", style: .outline) {}
        HUButton("Loading", isLoading: true) {}
        HUButton("Disabled", isDisabled: true) {}
        HUButton("Delete Account", style: .destructive) {}
    }
    .padding()
}
