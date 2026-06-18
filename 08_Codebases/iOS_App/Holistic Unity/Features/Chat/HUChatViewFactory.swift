import SwiftUI
import StreamChat
import StreamChatSwiftUI

/// Custom ViewFactory for Stream Chat that applies HU styling overrides.
/// Uses Stream's default message list, composer, and reactions.
class HUChatViewFactory: ViewFactory {

    @Injected(\.chatClient) public var chatClient

    static let shared = HUChatViewFactory()

    private init() {}

    // Use Stream's default channel destination (ChatChannelView)
    // No overrides needed — the Appearance theming in StreamChatService handles colors

    /// Replaces Stream's generic "No channels" placeholder with a branded
    /// empty state that explains how to start a first conversation: chats
    /// are created when you connect with a practitioner, so we point the
    /// user to Explore.
    func makeNoChannelsView() -> some View {
        HUNoChannelsView()
    }
}

/// Friendly, on-brand empty state for the Messages tab. Shown when the
/// user has no conversations yet — guides them to find a practitioner,
/// since a chat opens automatically once they book / connect.
struct HUNoChannelsView: View {
    var body: some View {
        VStack(spacing: HUSpacing.lg) {
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                HUColor.primary.opacity(0.16),
                                HUColor.primary.opacity(0.00),
                            ],
                            center: .center,
                            startRadius: 6,
                            endRadius: 90
                        )
                    )
                    .frame(width: 150, height: 150)
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 52, weight: .light))
                    .foregroundStyle(HUColor.primary)
            }

            VStack(spacing: HUSpacing.sm) {
                Text("No messages yet")
                    .font(HUFont.displayHeadline(size: 22, weight: .semiBold))
                    .foregroundStyle(HUColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text("Your chats appear here once you connect with a practitioner. Find one that resonates with you and book a session — your conversation opens automatically.")
                    .font(HUFont.body(weight: .regular))
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, HUSpacing.md)
            }

            Button {
                HUHaptic.impact(.light)
                DIContainer.shared.appState.requestExploreTab = true
            } label: {
                HStack(spacing: 8) {
                    Text("Find a practitioner")
                        .font(.system(size: 16, weight: .semibold))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(PrimaryGradient.linear)
                .clipShape(Capsule())
                .shadow(color: HUColor.primary.opacity(0.28), radius: 10, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .padding(.top, HUSpacing.xs)
        }
        .padding(HUSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HUColor.background)
    }
}
