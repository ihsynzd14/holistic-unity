import Foundation

/// Stream Chat configuration.
/// The API secret is stored server-side only (Supabase Edge Function).
/// API key loaded from Secrets.xcconfig via Info.plist.
enum StreamConfig {
    static let apiKey: String = {
        guard let value = Bundle.main.infoDictionary?["STREAM_API_KEY"] as? String, !value.isEmpty else {
            fatalError("STREAM_API_KEY not found in Info.plist. Ensure Secrets.xcconfig is linked to the target.")
        }
        return value
    }()
    
    /// Name of the APN push provider configured in the Stream Dashboard.
    /// Must match the "Name" field under Chat Messaging > Push Notifications > APN.
    static let apnProviderName = "APN"
}
