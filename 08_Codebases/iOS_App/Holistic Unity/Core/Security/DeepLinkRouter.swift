import Foundation
import GoogleSignIn
import Supabase
import Sentry
import os.log

/// Centralised deep-link dispatcher.
///
/// Every inbound URL must pass the allowlist here. Previously the handler in
/// `Holistic_UnityApp.onOpenURL` had a silent fallthrough that piped ANY
/// `holisticunity://` URL into `Supabase.auth.session(from:)` — which parses
/// `access_token` / `refresh_token` from URL fragments. An attacker who could
/// trick a user into tapping a crafted link (phishing email, QR code, etc.)
/// could have hijacked the user's session with the attacker's tokens.
///
/// Security properties enforced:
///   • Scheme allowlist — only `holisticunity` + the Google OAuth reversed
///     client ID are accepted. Anything else returns false immediately.
///   • Host allowlist via `DeepLinkHost` enum — exact match, no prefix
///     matching. Adding a new host requires a code change + review.
///   • All rejected URLs are logged to Sentry with tag
///     `security.deep_link_rejected` so we can monitor for abuse patterns
///     without surfacing the URL itself to the user.
///   • Fail-closed — unknown URLs return `false`, never fall through to
///     `Supabase.auth.session(from:)` or any other side-effectful handler.
enum DeepLinkRouter {

    private static let logger = Logger(subsystem: AppConstants.appBundleId, category: "DeepLink")

    /// Reversed Google OAuth client ID — extracted from Info.plist via the
    /// registered URL schemes. Any drift between Info.plist and this constant
    /// would break Google Sign-In.
    private static let googleReversedClientID =
        "com.googleusercontent.apps.446468190938-sfbcfb83u38cqj5fuehln7sv9iv4gj4u"

    /// Allowlist of exact host names we route on for the `holisticunity://`
    /// scheme. Unknown hosts are rejected + logged.
    enum DeepLinkHost: String, CaseIterable {
        /// Stripe Connect return — therapist finished onboarding via Express
        /// dashboard and was redirected back. iOS client has no therapist UI
        /// so this is a no-op in V1, but kept for forward compatibility with
        /// a therapist-who-is-also-client use case.
        case stripeConnectSuccess = "stripe-connect-success"
        case stripeConnectRefresh = "stripe-connect-refresh"

        /// Generic auth callback — reserved for future magic-link / password
        /// reset flows. In V1 this is a no-op; it exists so we can grow into
        /// it without loosening the allowlist under pressure.
        case authCallback = "auth-callback"
    }

    // MARK: - Entry point

    /// Call from `onOpenURL` and `AppDelegate.application(_:open:options:)`.
    /// Returns `true` if the URL was handled (even if the handler was a
    /// no-op). Returns `false` for malformed / disallowed URLs — callers
    /// should NOT forward those to any other handler.
    @discardableResult
    static func handle(_ url: URL) -> Bool {
        // Google Sign-In has its own URL scheme (reversed client ID) and
        // must be handled by GIDSignIn. Check that first since GIDSignIn
        // returns false for non-matching URLs (it's already strict).
        if url.scheme == googleReversedClientID {
            return GIDSignIn.sharedInstance.handle(url)
        }

        // From here on, only accept our custom scheme.
        guard url.scheme == "holisticunity" else {
            reject(url: url, reason: "unknown_scheme")
            return false
        }

        // Host must be present and map to a known enum case. `hasPrefix`
        // matching was previously used here — removed because it accepted
        // e.g. `stripe-connect-malicious-suffix`.
        guard let hostRaw = url.host, let host = DeepLinkHost(rawValue: hostRaw) else {
            reject(url: url, reason: "unknown_host")
            return false
        }

        switch host {
        case .stripeConnectSuccess, .stripeConnectRefresh:
            // Keep posting the notification for forward compatibility, even
            // though no observer exists in the iOS client today. Harmless
            // no-op if nothing listens.
            NotificationCenter.default.post(
                name: .stripeConnectReturn,
                object: host.rawValue
            )
            logger.info("[DeepLink] handled host=\(host.rawValue, privacy: .public)")
            return true

        case .authCallback:
            // Delegate to Supabase only for this specific, explicit host.
            // Still strictly scoped — the URL must match scheme+host above
            // before Supabase ever sees it, so tokens from arbitrary
            // `holisticunity://anything` payloads cannot reach the parser.
            Task { @MainActor in
                do {
                    try await SupabaseConfig.client.auth.session(from: url)
                    logger.info("[DeepLink] supabase session restored via auth-callback")
                } catch {
                    // Invalid / expired — don't surface to user, they just
                    // remain on the current screen. Logged for monitoring.
                    logger.error("[DeepLink] supabase session(from:) failed: \(String(describing: error), privacy: .public)")
                    reject(url: url, reason: "auth_callback_session_failed")
                }
            }
            return true
        }
    }

    // MARK: - Rejection logging

    private static func reject(url: URL, reason: String) {
        // Sanitise: log scheme + host + reason, NEVER the full URL (would
        // leak any tokens the attacker planted in fragments).
        let scheme = url.scheme ?? "(none)"
        let host = url.host ?? "(none)"
        logger.warning("[DeepLink] REJECTED scheme=\(scheme, privacy: .public) host=\(host, privacy: .public) reason=\(reason, privacy: .public)")

        // Breadcrumb to Sentry so we can spot active abuse in dashboards.
        let breadcrumb = Breadcrumb(level: .warning, category: "deep_link")
        breadcrumb.message = "rejected"
        breadcrumb.data = [
            "scheme": scheme,
            "host": host,
            "reason": reason,
        ]
        SentrySDK.addBreadcrumb(breadcrumb)

        // Also emit as a distinct event (tagged) so security dashboards can
        // alert on spikes without firing on every breadcrumb.
        SentrySDK.capture(message: "deep_link_rejected") { scope in
            scope.setTag(value: "deep_link", key: "security.event_type")
            scope.setTag(value: reason, key: "security.deep_link_reason")
        }
    }
}
