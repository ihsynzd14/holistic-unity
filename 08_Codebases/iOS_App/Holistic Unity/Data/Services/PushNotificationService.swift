import Foundation
import UIKit
import UserNotifications
import Supabase
import StreamChat
import os.log

/// Manages remote push notification registration, device token lifecycle,
/// and preference syncing with the backend.
@MainActor
final class PushNotificationService {
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "HolisticUnity", category: "Push")
    static let shared = PushNotificationService()
    
    /// The raw APNs device token, stored so it can be forwarded to Stream
    /// after the chat client connects (which may happen after the token arrives).
    private(set) var pendingDeviceToken: Data?
    private var currentUserId: String?
    
    private init() {}
    
    // MARK: - Permission & Registration
    
    /// Requests notification permission and registers for remote notifications.
    func requestPermissionAndRegister() async {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
        } catch {
            logger.error("Permission request failed: \(error.localizedDescription)")
        }
    }
    
    private func registerForRemoteNotificationsIfAuthorized() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        default:
            break
        }
    }
    
    // MARK: - Device Token Handling
    
    /// Called from AppDelegate when APNs delivers a device token.
    func didReceiveDeviceToken(_ token: Data) async {
        let tokenString = token.map { String(format: "%02x", $0) }.joined()
        self.pendingDeviceToken = token
        
        // If user is already signed in, register immediately
        if let userId = currentUserId {
            await saveTokenToSupabase(tokenString: tokenString, userId: userId)
            registerTokenWithStreamChat(token: token)
        }
    }
    
    /// Called after user signs in or session is restored.
    func onUserAuthenticated(userId: String) async {
        self.currentUserId = userId
        
        // Do not prompt here; onboarding/settings owns notification consent.
        await registerForRemoteNotificationsIfAuthorized()
        
        // If we already have a pending token, register it now
        if let token = pendingDeviceToken {
            let tokenString = token.map { String(format: "%02x", $0) }.joined()
            await saveTokenToSupabase(tokenString: tokenString, userId: userId)
            registerTokenWithStreamChat(token: token)
        }
    }
    
    /// Called on sign-out to deregister the device.
    func onUserSignedOut() async {
        // Remove device from Stream Chat
        if let token = pendingDeviceToken {
            deregisterTokenFromStreamChat(token: token)
        }
        
        // Clear token from Supabase
        if let userId = currentUserId {
            await clearTokenFromSupabase(userId: userId)
        }
        
        currentUserId = nil
    }
    
    // MARK: - Supabase Token Management
    
    private func saveTokenToSupabase(tokenString: String, userId: String) async {
        let dto = DeviceTokenDTO(
            userId: userId,
            token: tokenString,
            platform: "ios"
        )
        do {
            try await SupabaseConfig.client
                .from("device_tokens")
                .upsert(dto, onConflict: "user_id,token")
                .execute()
        } catch {
            logger.error("Failed to save device token to Supabase: \(error.localizedDescription)")
        }
    }
    
    private func clearTokenFromSupabase(userId: String) async {
        guard let token = pendingDeviceToken else { return }
        let tokenString = token.map { String(format: "%02x", $0) }.joined()
        do {
            try await SupabaseConfig.client
                .from("device_tokens")
                .delete()
                .eq("user_id", value: userId)
                .eq("token", value: tokenString)
                .execute()
        } catch {
            logger.error("Failed to clear device token: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Stream Chat Registration
    
    /// Registers the APNs token with Stream Chat for message push delivery.
    func registerTokenWithStreamChat(token: Data) {
        guard StreamChatService.shared.isConnected else {
            logger.info("Stream not connected yet — token will be registered after connection")
            return
        }
        StreamChatService.shared.chatClient
            .currentUserController()
            .addDevice(.apn(token: token, providerName: StreamConfig.apnProviderName)) { [self] error in
                if let error {
                    logger.error("Failed to register device with Stream: \(error.localizedDescription)")
                } else {
                    logger.info("Registered device with Stream Chat (provider: \(StreamConfig.apnProviderName))")
                    // Clear the pending token so repeated connectUser calls don't re-register
                    self.pendingDeviceToken = nil
                }
            }
    }

    /// Registers the pending APNs token with Stream Chat if one is waiting.
    /// Called by StreamChatService after the chat client successfully connects,
    /// ensuring the token is always forwarded even if it arrived before connection.
    func flushPendingDeviceTokenIfNeeded() {
        guard let token = pendingDeviceToken else { return }
        registerTokenWithStreamChat(token: token)
    }
    
    private func deregisterTokenFromStreamChat(token: Data) {
        guard StreamChatService.shared.isConnected else { return }
        let tokenString = token.map { String(format: "%02x", $0) }.joined()
        StreamChatService.shared.chatClient
            .currentUserController()
            .removeDevice(id: tokenString) { [self] error in
                if let error {
                    logger.error("Failed to deregister device from Stream: \(error.localizedDescription)")
                } else {
                    logger.info("Deregistered device from Stream Chat")
                }
            }
    }
    
    // MARK: - Notification Preferences Sync
    
    /// Syncs the user's notification preferences to the backend.
    func syncPreferences(
        userId: String,
        pushEnabled: Bool,
        bookingReminders: Bool,
        newMessages: Bool,
        sessionReminders: Bool,
        promotional: Bool
    ) async {
        let prefs = NotificationPreferencesDTO(
            userId: userId,
            pushEnabled: pushEnabled,
            pushBookingReminders: bookingReminders,
            pushNewMessages: newMessages,
            pushSessionReminders: sessionReminders,
            pushPromotional: promotional
        )
        do {
            try await SupabaseConfig.client
                .from("user_notification_preferences")
                .upsert(prefs, onConflict: "user_id")
                .execute()
        } catch {
            logger.error("Failed to sync preferences: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Notification Tap Handling
    
    func handleNotificationTap(userInfo: [AnyHashable: Any]) {
        let appState = DIContainer.shared.appState
        if let bookingId = userInfo["bookingId"] as? String {
            logger.info("Tapped notification for booking: \(bookingId)")
            appState.pendingDeepLink = .booking(id: bookingId)
        } else if let conversationId = userInfo["conversationId"] as? String {
            logger.info("Tapped notification for chat: \(conversationId)")
            appState.pendingDeepLink = .chat(conversationId: conversationId)
        }
    }
}

// MARK: - DTOs

/// DTO for upserting a device token to the `device_tokens` table.
private struct DeviceTokenDTO: Encodable {
    let userId: String
    let token: String
    let platform: String
    
    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case token
        case platform
    }
}

/// Notification preferences DTO for upserting to Supabase.
struct NotificationPreferencesDTO: Encodable {
    let userId: String
    let pushEnabled: Bool
    let pushBookingReminders: Bool
    let pushNewMessages: Bool
    let pushSessionReminders: Bool
    let pushPromotional: Bool
    
    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case pushEnabled = "push_enabled"
        case pushBookingReminders = "push_booking_reminders"
        case pushNewMessages = "push_new_messages"
        case pushSessionReminders = "push_session_reminders"
        case pushPromotional = "push_promotional"
    }
}
