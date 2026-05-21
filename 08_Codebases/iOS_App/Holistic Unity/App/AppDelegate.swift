import UIKit
import UserNotifications
import os.log
// GoogleSignIn URL handling is delegated to DeepLinkRouter — no direct
// import needed here.

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Initialize TrustKit BEFORE any network request is issued by the
        // app (Stream Chat, Stripe, Supabase all make requests on demand
        // once their services are used). Currently in reporting mode —
        // see TrustKitConfig.swift for pinning state + how to flip to
        // enforcement.
        TrustKitConfig.initialize()

        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // MARK: - URL Handling

    /// Inbound URLs from UIKit — delegates to the central `DeepLinkRouter`
    /// which enforces a strict scheme/host allowlist (see
    /// `Core/Security/DeepLinkRouter.swift`). This is the cold-launch path;
    /// the SwiftUI `onOpenURL` in `Holistic_UnityApp` handles warm opens.
    /// Both converge on the same router so the allowlist can't be bypassed
    /// through either entry point.
    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        return DeepLinkRouter.handle(url)
    }
    
    // MARK: - Remote Notification Registration
    
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            await PushNotificationService.shared.didReceiveDeviceToken(deviceToken)
        }
    }
    
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Logger(subsystem: Bundle.main.bundleIdentifier ?? "HolisticUnity", category: "Push").error("Failed to register for remote notifications: \(error.localizedDescription)")
    }
    
    // MARK: - UNUserNotificationCenterDelegate
    
    /// Show notification banners even when the app is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .sound, .badge]
    }
    
    /// Handle notification tap — route to the relevant screen.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        await MainActor.run {
            PushNotificationService.shared.handleNotificationTap(userInfo: userInfo)
        }
    }
}
