import Foundation
import Supabase

/// Supabase client configuration and singleton.
/// All backend communication flows through this shared client.
///
/// Credentials are provided by SupabaseSecrets.swift (in Config/).
/// That file should NOT be committed to source control.
enum SupabaseConfig {
    static let projectURL: URL = {
        guard let url = URL(string: SupabaseSecrets.url) else {
            // This should never happen with a valid configuration.
            // If it does, return a placeholder that will fail gracefully at the network layer.
            return URL(string: "https://invalid.supabase.co") ?? URL(filePath: "/")
        }
        return url
    }()
    
    static let anonKey: String = SupabaseSecrets.anonKey

    /// Custom URLSession used by the Supabase client.
    ///
    /// We dedicate a session to Supabase (rather than the shared one) and
    /// disable URL caching across BOTH simulator and device. Two reasons:
    ///
    /// 1. **Avoid stale error caching.** During the lifetime of the app
    ///    `URLSession.shared` keeps a disk-backed `URLCache` that, in the
    ///    absence of explicit `Cache-Control` headers from the server,
    ///    can heuristically retain responses (Supabase REST does not set
    ///    `Cache-Control` — it returns `cf-cache-status: DYNAMIC` only).
    ///    If the device once received a 403 on a Supabase endpoint and
    ///    that response leaked into the heuristic cache window, the iOS
    ///    URL loading system may keep replaying the cached failure for
    ///    hours, even after the server-side bug is fixed. Setting
    ///    `urlCache = nil` + `reloadIgnoringLocalAndRemoteCacheData`
    ///    guarantees every request actually hits the network and the
    ///    response is never persisted.
    ///
    /// 2. **Simulator HTTP/3 (QUIC) workaround.** On iOS Simulator the
    ///    UDP receive buffer is 9216 bytes, smaller than typical
    ///    `therapist_profiles SELECT(*)` responses. The kernel returns
    ///    `EMSGSIZE` on `recvmsg`, the QUIC connection drops, and the
    ///    request fails. With no URL cache, Alt-Svc (the server's HTTP/3
    ///    advertisement) is not persisted between launches, keeping the
    ///    simulator on HTTP/2 over TCP — which it handles correctly.
    ///
    /// We deliberately do not use `URLSessionConfiguration.ephemeral`
    /// because we still want cookies and credential caching for the
    /// Supabase session — only the response cache is suppressed.
    private static let urlSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        return URLSession(configuration: config)
    }()

    static let client = SupabaseClient(
        supabaseURL: projectURL,
        supabaseKey: anonKey,
        options: .init(
            auth: .init(
                autoRefreshToken: true,
                emitLocalSessionAsInitialSession: true
            ),
            global: .init(session: urlSession)
        )
    )
    
    // MARK: - Table Names
    
    enum Table {
        static let users = "users"
        static let therapistProfiles = "therapist_profiles"
        static let therapistServices = "therapist_services"
        static let certifications = "certifications"
        static let availability = "availability"
        static let bookings = "bookings"
        static let conversations = "conversations"
        static let conversationParticipants = "conversation_participants"
        static let messages = "messages"
        static let reviews = "reviews"
        static let notifications = "notifications"
        static let transactions = "transactions"
        static let paymentMethods = "payment_methods"
        static let sessionCredits = "session_credits"
    }
    
    // MARK: - Storage Buckets
    
    enum Bucket {
        static let profilePhotos = "profile-photos"
        static let certificates = "certificates"
        static let chatMedia = "chat-media"
        static let videoIntros = "video-intros"
    }
}
