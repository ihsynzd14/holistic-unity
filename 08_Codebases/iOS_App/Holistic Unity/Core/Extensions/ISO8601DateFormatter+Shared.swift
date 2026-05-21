import Foundation

extension ISO8601DateFormatter {
    /// Shared cached instance to avoid creating a new formatter on every use.
    /// Uses default format options (withInternetDateTime).
    static let shared = ISO8601DateFormatter()
    
    /// Shared cached instance that handles fractional seconds (for parsing Supabase timestamps).
    nonisolated(unsafe) static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    
    /// Parses a date string trying fractional seconds first (Supabase format), then standard.
    /// Returns nil only if both formats fail.
    static func parseSupabaseDate(_ string: String) -> Date? {
        withFractionalSeconds.date(from: string) ?? shared.date(from: string)
    }
}
