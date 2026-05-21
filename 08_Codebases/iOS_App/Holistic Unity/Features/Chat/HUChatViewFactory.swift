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
}
