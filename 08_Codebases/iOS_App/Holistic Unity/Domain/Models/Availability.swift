import Foundation

// MARK: - Time Range

struct TimeRange: Codable, Equatable, Identifiable {
    var id: String = UUID().uuidString
    var start: String // "HH:mm" format
    var end: String   // "HH:mm" format
    
    var startDate: Date? {
        Self.timeFormatter.date(from: start)
    }
    
    var endDate: Date? {
        Self.timeFormatter.date(from: end)
    }
    
    var displayString: String {
        "\(start) - \(end)"
    }
    
    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()
}

// MARK: - Day of Week

enum DayOfWeek: String, Codable, CaseIterable, Identifiable {
    case monday, tuesday, wednesday, thursday, friday, saturday, sunday
    
    var id: String { rawValue }
    
    var shortName: String {
        switch self {
        case .monday: return "Mon"
        case .tuesday: return "Tue"
        case .wednesday: return "Wed"
        case .thursday: return "Thu"
        case .friday: return "Fri"
        case .saturday: return "Sat"
        case .sunday: return "Sun"
        }
    }
    
    var initial: String {
        String(shortName.prefix(1))
    }
}

// MARK: - Availability Exception

struct AvailabilityException: Codable, Equatable, Identifiable {
    var id: String = UUID().uuidString
    var date: Date
    var isAvailable: Bool
    var customRanges: [TimeRange]?

    var dateString: String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    enum CodingKeys: String, CodingKey {
        case id, date, isAvailable, customRanges
    }

    // The DB stores exception dates as plain "yyyy-MM-dd" strings.
    // Swift's default Date decoder expects ISO8601 full timestamps, so
    // we decode the date manually to handle both formats.
    private static let ymdFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    init(id: String = UUID().uuidString, date: Date, isAvailable: Bool, customRanges: [TimeRange]? = nil) {
        self.id = id
        self.date = date
        self.isAvailable = isAvailable
        self.customRanges = customRanges
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? UUID().uuidString
        isAvailable = try container.decode(Bool.self, forKey: .isAvailable)
        customRanges = try? container.decode([TimeRange].self, forKey: .customRanges)

        let dateString = try container.decode(String.self, forKey: .date)
        if let parsed = Self.ymdFormatter.date(from: dateString) {
            date = parsed
        } else if let parsed = ISO8601DateFormatter.parseSupabaseDate(dateString) {
            date = parsed
        } else {
            throw DecodingError.dataCorruptedError(
                forKey: .date,
                in: container,
                debugDescription: "Invalid date format: \(dateString)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(Self.ymdFormatter.string(from: date), forKey: .date)
        try container.encode(isAvailable, forKey: .isAvailable)
        try container.encodeIfPresent(customRanges, forKey: .customRanges)
    }
}

// MARK: - Therapist Availability

struct TherapistAvailability: Equatable {
    var recurring: [DayOfWeek: [TimeRange]]
    var exceptions: [AvailabilityException]
    var timezone: String
    var minNoticeHours: Int
    var bufferMinutes: Int
    
    static let `default` = TherapistAvailability(
        recurring: [:],
        exceptions: [],
        timezone: TimeZone.current.identifier,
        minNoticeHours: AppConstants.Booking.minNoticeHoursDefault,
        bufferMinutes: AppConstants.Booking.bufferMinutesDefault
    )
    
    /// Sample availability for preview/mock data with weekday slots
    static let sample = TherapistAvailability(
        recurring: [
            .monday: [TimeRange(start: "09:00", end: "13:00"), TimeRange(start: "14:00", end: "18:00")],
            .tuesday: [TimeRange(start: "09:00", end: "13:00"), TimeRange(start: "14:00", end: "18:00")],
            .wednesday: [TimeRange(start: "10:00", end: "14:00")],
            .thursday: [TimeRange(start: "09:00", end: "13:00"), TimeRange(start: "14:00", end: "18:00")],
            .friday: [TimeRange(start: "09:00", end: "13:00"), TimeRange(start: "14:00", end: "17:00")],
            .saturday: [TimeRange(start: "10:00", end: "14:00")]
        ],
        exceptions: [],
        timezone: TimeZone.current.identifier,
        minNoticeHours: 2,
        bufferMinutes: AppConstants.Booking.bufferMinutesDefault
    )
    
    /// Returns time ranges for a specific day, considering exceptions
    func availableRanges(for date: Date) -> [TimeRange] {
        // Check exceptions first
        if let exception = exceptions.first(where: { Calendar.current.isDate($0.date, inSameDayAs: date) }) {
            if !exception.isAvailable { return [] }
            if let customRanges = exception.customRanges { return customRanges }
        }
        
        // Fall back to recurring schedule
        let weekday = dayOfWeek(for: date)
        return recurring[weekday] ?? []
    }
    
    private func dayOfWeek(for date: Date) -> DayOfWeek {
        let weekday = Calendar.current.component(.weekday, from: date)
        switch weekday {
        case 1: return .sunday
        case 2: return .monday
        case 3: return .tuesday
        case 4: return .wednesday
        case 5: return .thursday
        case 6: return .friday
        case 7: return .saturday
        default: return .monday
        }
    }
}

// MARK: - Custom Codable for TherapistAvailability
// Swift's default Codable encodes [DayOfWeek: [TimeRange]] as an alternating array
// (e.g. ["monday", [...], "sunday", [...]]) but Supabase JSONB normalizes this to a
// JSON object (e.g. {"monday": [...], "sunday": [...]}). This custom conformance
// encodes as a JSON object and can decode from both formats for compatibility.

extension TherapistAvailability: Codable {
    enum CodingKeys: String, CodingKey {
        case recurring, exceptions, timezone, minNoticeHours, bufferMinutes
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(exceptions, forKey: .exceptions)
        try container.encode(timezone, forKey: .timezone)
        try container.encode(minNoticeHours, forKey: .minNoticeHours)
        try container.encode(bufferMinutes, forKey: .bufferMinutes)
        
        // Encode recurring as a JSON object with string keys
        let stringKeyedRecurring = Dictionary(
            uniqueKeysWithValues: recurring.map { ($0.key.rawValue, $0.value) }
        )
        try container.encode(stringKeyedRecurring, forKey: .recurring)
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // Tolerant decoding: legacy/partial availability JSON missing any of
        // these keys must not fail the whole decode (which would break slot
        // loading entirely). Mirrors the web engine's `?? default` behaviour.
        exceptions = (try? container.decode([AvailabilityException].self, forKey: .exceptions)) ?? []
        timezone = (try? container.decode(String.self, forKey: .timezone)) ?? TimeZone.current.identifier
        minNoticeHours = (try? container.decode(Int.self, forKey: .minNoticeHours)) ?? AppConstants.Booking.minNoticeHoursDefault
        bufferMinutes = (try? container.decode(Int.self, forKey: .bufferMinutes)) ?? AppConstants.Booking.bufferMinutesDefault
        
        // Try decoding as a JSON object (string-keyed dictionary) first — this is what
        // Supabase JSONB returns. Fall back to Swift's default alternating-array format.
        if let stringKeyed = try? container.decode([String: [TimeRange]].self, forKey: .recurring) {
            recurring = Dictionary(
                uniqueKeysWithValues: stringKeyed.compactMap { key, value in
                    guard let day = DayOfWeek(rawValue: key) else { return nil }
                    return (day, value)
                }
            )
        } else {
            recurring = try container.decode([DayOfWeek: [TimeRange]].self, forKey: .recurring)
        }
    }
}

// MARK: - Slot ↔ instant resolution (timezone-correct)

extension TherapistAvailability {
    /// The therapist's wall-clock timezone, falling back to the device zone
    /// when the stored identifier is invalid or empty.
    var resolvedTimeZone: TimeZone {
        TimeZone(identifier: timezone) ?? .current
    }

    /// Converts a slot label ("HH:mm" — therapist-local wall-clock, which is
    /// how `getAvailableSlots` generates slots) into an absolute instant on
    /// the given calendar `day`, interpreted IN THE THERAPIST'S TIMEZONE.
    ///
    /// Materializing the slot in the *device's* timezone (the previous
    /// behaviour) stored the wrong absolute time whenever client and therapist
    /// were in different zones — a slot meaning "09:00 in Europe/Rome" was
    /// saved as "09:00 in the client's zone". Resolving in the therapist's zone
    /// keeps the stored `scheduled_at` identical to the slot instant that was
    /// conflict-checked during generation.
    func resolveSlotInstant(slot: String, on day: Date) -> Date? {
        let parts = slot.split(separator: ":")
        guard parts.count >= 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = resolvedTimeZone
        var components = calendar.dateComponents([.year, .month, .day], from: day)
        components.hour = hour
        components.minute = minute
        components.second = 0
        return calendar.date(from: components)
    }
}
