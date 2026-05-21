import Foundation

/// LiveKit configuration constants.
/// The API secret is stored server-side only (Supabase Edge Function).
/// WebSocket URL loaded from Secrets.xcconfig via Info.plist.
enum LiveKitConfig {
    static let websocketURL: String = {
        guard let value = Bundle.main.infoDictionary?["LIVEKIT_WS_URL"] as? String, !value.isEmpty else {
            fatalError("LIVEKIT_WS_URL not found in Info.plist. Ensure Secrets.xcconfig is linked to the target.")
        }
        return value
    }()
    static let roomPrefix = "hu"
    
    /// Generates a deterministic room name from a booking ID.
    static func roomName(for bookingId: String) -> String {
        let sanitized = bookingId
            .replacingOccurrences(of: "-", with: "")
            .prefix(16)
        return "\(roomPrefix)-\(sanitized)"
    }
}
