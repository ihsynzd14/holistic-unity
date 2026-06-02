import Foundation

/// Cached, reusable display `DateFormatter`s.
///
/// Allocating a `DateFormatter` is expensive (each init builds an underlying
/// ICU formatter), so these are configured once and shared instead of being
/// created inline on every view redraw or list-row build. Mirrors the existing
/// `ISO8601DateFormatter+Shared` caching used for parsing.
///
/// None are mutated after setup, so formatting from them is safe to read across
/// threads. `nonisolated(unsafe)` matches the project convention for shared
/// formatter instances (see `ISO8601DateFormatter+Shared`).
extension DateFormatter {

    /// "lun 5 mag" — weekday · day · abbreviated month (it_IT).
    nonisolated(unsafe) static let italianWeekdayDayMonth: DateFormatter = makeItalianDisplay("EEE d MMM")

    /// "5 mag" — day · abbreviated month (it_IT).
    nonisolated(unsafe) static let italianDayMonth: DateFormatter = makeItalianDisplay("d MMM")

    /// "mag" — abbreviated month only (it_IT).
    nonisolated(unsafe) static let italianMonthAbbrev: DateFormatter = makeItalianDisplay("MMM")

    /// "5" — day of month only (it_IT).
    nonisolated(unsafe) static let italianDayOfMonth: DateFormatter = makeItalianDisplay("d")

    /// "5 maggio 2026" — day · full month · year (it_IT).
    nonisolated(unsafe) static let italianDayFullMonthYear: DateFormatter = makeItalianDisplay("d MMMM yyyy")

    /// "5 mag 2026 at 14:30" — payment-history timestamp. Device locale, matching
    /// the prior inline formatter (no explicit locale was set there).
    nonisolated(unsafe) static let paymentTimestamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy 'at' HH:mm"
        return f
    }()

    /// Builds an it_IT display formatter with the given `dateFormat`.
    private static func makeItalianDisplay(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "it_IT")
        f.dateFormat = format
        return f
    }
}
