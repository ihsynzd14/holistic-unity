import SwiftUI
import Observation

/// Global observable app state, injected into the environment
@MainActor
@Observable
final class AppState {
    /// Currently displayed toast. Set to nil when dismissed.
    var toast: ToastMessage?
    /// Pending toasts waiting to be shown after the current one is dismissed.
    private var toastQueue: [ToastMessage] = []
    var isOffline: Bool = false

    /// Deep link destination set by push notification taps.
    /// Tab views should observe this, navigate, then set it to nil.
    var pendingDeepLink: DeepLink?

    enum DeepLink: Equatable {
        case booking(id: String)
        case chat(conversationId: String)
    }
    
    /// Locked to "light" since 2026-05-16. The brand palette + painted
    /// illustrations are light-only; dark mode would invert the cream
    /// surfaces and the painted assets would float on black. Kept as
    /// a persisted property only so legacy reads don't crash — the
    /// value is ignored everywhere now and the system-level lock
    /// happens via `UIUserInterfaceStyle = Light` in Info.plist.
    var appearanceMode: String = "light"

    /// Always returns `.light`. Even if some legacy code calls this
    /// (e.g. `AppCoordinator.preferredColorScheme`), the UI stays
    /// locked to the brand palette.
    var colorSchemeOverride: ColorScheme? { .light }
    
    let authManager: AuthManager
    let networkMonitor = NetworkMonitor.shared
    
    init(authManager: AuthManager) {
        self.authManager = authManager
        // Sync initial offline state — the monitor starts immediately, but its first
        // pathUpdateHandler callback may fire after the first render. Reading currentPath
        // synchronously avoids showing a wrong "online" state on cold launch when offline.
        self.isOffline = !networkMonitor.isConnected
    }
    
    func showToast(_ type: ToastType, message: String) {
        let newToast = ToastMessage(type: type, message: message)
        if toast == nil {
            toast = newToast
        } else {
            toastQueue.append(newToast)
        }
    }

    /// Called when the current toast is dismissed. Shows the next queued toast after a short delay.
    func onToastDismissed() {
        guard !toastQueue.isEmpty else { return }
        // Small delay so sequential toasts don't visually collide
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard self.toast == nil, !self.toastQueue.isEmpty else { return }
            self.toast = self.toastQueue.removeFirst()
        }
    }
}
