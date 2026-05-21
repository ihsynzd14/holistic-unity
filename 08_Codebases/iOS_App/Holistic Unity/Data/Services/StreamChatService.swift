import Foundation
import Combine
import StreamChat
import StreamChatSwiftUI
import SwiftUI
import Supabase
import os.log

/// Manages the Stream ChatClient lifecycle, user connection, and appearance theming.
/// Singleton accessed via `StreamChatService.shared`.
@MainActor
final class StreamChatService: ObservableObject {
    
    static let shared = StreamChatService()
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "HolisticUnity", category: "Stream")
    
    // MARK: - Public State
    
    let chatClient: ChatClient
    private(set) var streamChat: StreamChat?
    @Published var totalUnreadCount: Int = 0
    @Published var isConnected: Bool = false
    
    private var unreadCountObserver: Task<Void, Never>?
    private var currentUserController: CurrentChatUserController?
    
    // MARK: - Init
    
    private init() {
        var config = ChatClientConfig(apiKey: .init(StreamConfig.apiKey))
        config.isLocalStorageEnabled = true
        self.chatClient = ChatClient(config: config)
        
        // Configure appearance with HU brand colors
        let appearance = Self.makeAppearance()
        self.streamChat = StreamChat(chatClient: chatClient, appearance: appearance)
    }
    
    // MARK: - User Connection
    
    /// Connects the current user to Stream Chat.
    /// Fetches a JWT from the `stream-token` Supabase Edge Function.
    func connectUser(userId: String, name: String, imageURL: URL?) async {
        do {
            let token = try await fetchStreamToken()
            
            let userInfo = UserInfo(
                id: userId,
                name: name,
                imageURL: imageURL
            )
            
            try await chatClient.connectUser(userInfo: userInfo, token: .init(stringLiteral: token))
            isConnected = true
            observeUnreadCount()
            logger.info("User connected: \(userId)")
            
            // Register pending APNs token with Stream for push delivery.
            // The token may have arrived before this connection completed (common
            // on first launch), so we flush it here once the client is ready.
            PushNotificationService.shared.flushPendingDeviceTokenIfNeeded()
            
            // Run one-time migration in the background — don't block the chat UI
            Task {
                await StreamMigrationService.shared.migrateIfNeeded(currentUserId: userId)
            }
        } catch {
            logger.error("Failed to connect user: \(error.localizedDescription)")
        }
    }
    
    /// Disconnects the current user from Stream Chat.
    /// Must be awaited before invalidating the Supabase session to avoid
    /// Stream making auth calls with an already-revoked token.
    func disconnectUser() async {
        unreadCountObserver?.cancel()
        unreadCountObserver = nil
        currentUserController = nil
        isConnected = false
        totalUnreadCount = 0
        await chatClient.disconnect()
        logger.info("User disconnected")
    }
    
    // MARK: - Channel Management
    
    /// Gets or creates a 1-on-1 direct message channel between two users.
    /// Returns the `ChannelId` for navigation.
    func getOrCreateChannel(currentUserId: String, otherUserId: String) async throws -> ChannelId {
        // Wait up to 8 seconds for the Stream connection to establish.
        // This handles the race condition where the user taps "Message" before
        // the background connectUser() task completes after login.
        if !isConnected {
            let deadline = Date().addingTimeInterval(8)
            while !isConnected && Date() < deadline {
                try await Task.sleep(for: .milliseconds(300))
            }
            guard isConnected else {
                throw StreamChatError.notConnected
            }
        }
        
        let controller = try chatClient.channelController(
            createDirectMessageChannelWith: [currentUserId, otherUserId],
            extraData: [:]
        )
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.synchronize { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
        
        guard let cid = controller.cid else {
            throw StreamChatError.channelNotFound
        }
        return cid
    }
    
    /// Returns a synchronized channel controller ready for use.
    /// Consolidates the repetitive pattern of creating + synchronizing a channel controller.
    func synchronizedController(for channelId: ChannelId) async throws -> ChatChannelController {
        let controller = chatClient.channelController(for: channelId)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            controller.synchronize { error in
                if let error { cont.resume(throwing: error) }
                else { cont.resume() }
            }
        }
        return controller
    }
    
    // MARK: - Token Fetching
    
    private struct TokenResponse: Decodable {
        let token: String
    }
    
    private func fetchStreamToken() async throws -> String {
        // Ensure valid Supabase session before calling edge function
        _ = try await SupabaseConfig.client.auth.session
        
        do {
            let response: TokenResponse = try await SupabaseConfig.client.functions.invoke(
                "stream-token",
                options: FunctionInvokeOptions()
            )
            return response.token
        } catch {
            // If 401, the session may be stale — refresh and retry once
            let errorDesc = "\(error)".lowercased()
            let isAuthError = errorDesc.contains("401") || errorDesc.contains("unauthorized")
            
            guard isAuthError else { throw error }
            
            logger.warning("Token fetch got 401, refreshing session and retrying...")
            _ = try await SupabaseConfig.client.auth.refreshSession()
            
            let response: TokenResponse = try await SupabaseConfig.client.functions.invoke(
                "stream-token",
                options: FunctionInvokeOptions()
            )
            return response.token
        }
    }
    
    // MARK: - Unread Count Observation
    
    private func observeUnreadCount() {
        unreadCountObserver?.cancel()
        // Create the controller once and reuse it
        let controller = chatClient.currentUserController()
        self.currentUserController = controller
        // Observe unread count via Stream's Combine publisher on the ObservableObject wrapper.
        // This fires immediately on any unread count change — no polling required.
        unreadCountObserver = Task { [weak self] in
            guard let self else { return }
            controller.synchronize()
            // Stream's controller exposes a Combine publisher via .observableObject.objectWillChange.
            // Use AsyncStream to bridge Combine → async/await without introducing extra dependencies.
            let stream = AsyncStream<Int> { continuation in
                let cancellable = controller.observableObject.objectWillChange.sink { [weak controller] _ in
                    continuation.yield(controller?.unreadCount.messages ?? 0)
                }
                continuation.onTermination = { _ in cancellable.cancel() }
            }
            for await count in stream {
                guard !Task.isCancelled else { return }
                if self.totalUnreadCount != count {
                    self.totalUnreadCount = count
                }
            }
        }
    }
    
    // MARK: - Block / Mute (Guideline 1.2)

    /// Mutes the given user so their messages stop arriving in
    /// real time. Wraps Stream Chat's `muteUser` controller call.
    /// Safe to call repeatedly — Stream dedupes server-side.
    func muteUser(_ userId: String) async {
        let controller = chatClient.userController(userId: .init(userId))
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            controller.mute { _ in cont.resume() }
        }
    }

    /// Unmutes the given user (used by Settings → Blocked users list).
    func unmuteUser(_ userId: String) async {
        let controller = chatClient.userController(userId: .init(userId))
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            controller.unmute { _ in cont.resume() }
        }
    }

    // MARK: - Appearance

    private static func makeAppearance() -> Appearance {
        let colors = ColorPalette()
        
        // Map HU brand colors to Stream's palette
        let primary = UIColor(red: 0.56, green: 0.22, blue: 0.44, alpha: 1)        // HUColor.primary
        let primaryLight = UIColor(red: 0.96, green: 0.90, blue: 0.94, alpha: 1)    // HUColor.primaryLight
        let secondaryBg = UIColor.secondarySystemBackground                          // HUColor.secondaryBackground
        let textPrimary = UIColor.label                                               // HUColor.textPrimary
        
        colors.tintColor = Color(uiColor: primary)
        colors.messageCurrentUserBackground = [primary]
        colors.messageCurrentUserTextColor = .white
        colors.messageOtherUserBackground = [secondaryBg]
        colors.messageOtherUserTextColor = textPrimary
        colors.highlightedAccentBackground = primaryLight
        
        let fonts = Fonts()
        // Use system fonts to match the rest of the app
        
        return Appearance(colors: colors, fonts: fonts)
    }
}
