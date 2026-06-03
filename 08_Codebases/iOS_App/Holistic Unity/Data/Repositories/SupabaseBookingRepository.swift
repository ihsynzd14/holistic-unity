import Foundation
import Supabase

// MARK: - Atomic Credit Booking DTOs (nonisolated to avoid MainActor inference)

struct CreditBookingRPCParams: Encodable, Sendable {
    let p_booking_id: String
    let p_client_id: String
    let p_therapist_id: String
    let p_service_id: String
    let p_service_name: String
    let p_duration: Int
    let p_scheduled_at: String
    let p_timezone: String
    let p_format: String
    let p_video_room_id: String?
    let p_pack_booking_id: String?
    let p_credit_id: String
}

struct CreditBookingRPCResponse: Decodable, Sendable {
    let booking_id: String
    let credit_id: String
    let sessions_remaining: Int
}

enum BookingError: LocalizedError {
    case noProposedDate
    case maxReschedulesReached
    case proposedSlotNoLongerAvailable

    var errorDescription: String? {
        switch self {
        case .noProposedDate:
            return String(
                localized: "No proposed reschedule date found.",
                comment: "BookingError.noProposedDate - approveReschedule found no proposedScheduledAt on the booking row"
            )
        case .maxReschedulesReached:
            return String(
                localized: "You have reached the maximum number of reschedules for this booking.",
                comment: "BookingError.maxReschedulesReached - rescheduleCount exceeded the policy cap"
            )
        case .proposedSlotNoLongerAvailable:
            return String(
                localized: "The proposed time slot is no longer available. Please select a new time.",
                comment: "BookingError.proposedSlotNoLongerAvailable - the slot was booked by someone else between request and approval"
            )
        }
    }
}

/// Supabase implementation of BookingRepositoryProtocol.
/// Handles booking CRUD, status management, and availability queries.
final class SupabaseBookingRepository: BookingRepositoryProtocol, @unchecked Sendable {

    // Select only the columns mapped by BookingDTO to avoid decoding failures
    // when the DB table has extra columns not present in the DTO.
    private static let bookingColumns = "id,client_id,therapist_id,service_id,service_name,duration,price,scheduled_at,timezone,status,cancellation_reason,video_room_id,stripe_payment_intent_id,platform_fee,therapist_payout,promo_code,discount,proposed_scheduled_at,reschedule_count,pack_booking_id,created_at,updated_at"

    private let client: SupabaseClient
    
    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
    }
    
    // MARK: - Create & Read
    
    func createBooking(_ booking: Booking) async throws -> Booking {
        let dto = BookingDTO.from(booking)
        
        try await client.from(SupabaseConfig.Table.bookings)
            .insert(dto)
            .execute()
        
        return booking
    }
    
    func getBooking(bookingId: String) async throws -> Booking {
        let dto: BookingDTO = try await client
            .from(SupabaseConfig.Table.bookings)
            .select(Self.bookingColumns)
            .eq("id", value: bookingId)
            .single()
            .execute()
            .value
        
        return dto.toDomain()
    }
    
    func updateBookingStatus(bookingId: String, status: BookingStatus, reason: String?) async throws {
        var updates: [String: String] = [
            "status": status.rawValue,
            "updated_at": ISO8601DateFormatter.shared.string(from: Date())
        ]
        
        if let reason {
            updates["cancellation_reason"] = reason
        }
        
        try await client.from(SupabaseConfig.Table.bookings)
            .update(updates)
            .eq("id", value: bookingId)
            .execute()
    }
    
    // MARK: - Booking Lists
    
    func getUpcomingBookings(userId: String, role: UserRole) async throws -> [Booking] {
        let column = role == .client ? "client_id" : "therapist_id"
        // Include sessions from the start of today (not just future ones)
        // so that sessions scheduled earlier today remain visible for rejoin.
        // Also include "completed" so the 3-hour rejoin grace period works.
        let startOfToday = Calendar.current.startOfDay(for: Date())
        let from = ISO8601DateFormatter.shared.string(from: startOfToday)

        let dtos: [BookingDTO] = try await client
            .from(SupabaseConfig.Table.bookings)
            .select(Self.bookingColumns)
            .eq(column, value: userId)
            .gte("scheduled_at", value: from)
            .in("status", values: ["pending", "confirmed", "in_progress", "reschedule_pending", "completed"])
            .order("scheduled_at", ascending: true)
            .execute()
            .value

        return dtos.map { $0.toDomain() }
    }
    
    func getPastBookings(userId: String, role: UserRole) async throws -> [Booking] {
        try await getPastBookings(userId: userId, role: role, limit: 20, offset: 0)
    }

    func getPastBookings(userId: String, role: UserRole, limit: Int, offset: Int) async throws -> [Booking] {
        let column = role == .client ? "client_id" : "therapist_id"

        let dtos: [BookingDTO] = try await client
            .from(SupabaseConfig.Table.bookings)
            .select(Self.bookingColumns)
            .eq(column, value: userId)
            .in("status", values: ["completed", "cancelled", "no_show"])
            .order("scheduled_at", ascending: false)
            .range(from: offset, to: offset + limit - 1)
            .execute()
            .value

        return dtos.map { $0.toDomain() }
    }
    
    func getPendingBookingRequests(therapistId: String) async throws -> [Booking] {
        let dtos: [BookingDTO] = try await client
            .from(SupabaseConfig.Table.bookings)
            .select(Self.bookingColumns)
            .eq("therapist_id", value: therapistId)
            .eq("status", value: "pending")
            .order("created_at", ascending: false)
            .execute()
            .value
        
        return dtos.map { $0.toDomain() }
    }
    
    // MARK: - Availability
    
    func getAvailableSlots(therapistId: String, date: Date, serviceDuration: Int) async throws -> [TimeRange] {
        // Fetch therapist profile first so we can use the therapist's own timezone
        // for all date/time calculations. Using the client's local calendar would
        // produce wrong slots when the client and therapist are in different timezones.
        let therapistProfile = try await DIContainer.shared.therapistRepository.getProfile(therapistId: therapistId)

        let therapistTimezone = TimeZone(identifier: therapistProfile.availability.timezone) ?? TimeZone.current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = therapistTimezone

        let startOfDay = calendar.startOfDay(for: date)
        guard let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) else { return [] }

        let formatter = ISO8601DateFormatter.shared

        let existingBookings: [BookingDTO] = try await client
            .from(SupabaseConfig.Table.bookings)
            .select(Self.bookingColumns)
            .eq("therapist_id", value: therapistId)
            .gte("scheduled_at", value: formatter.string(from: startOfDay))
            .lt("scheduled_at", value: formatter.string(from: endOfDay))
            .in("status", values: ["pending", "confirmed", "in_progress", "reschedule_pending"])
            .execute()
            .value

        let dayRanges = therapistProfile.availability.availableRanges(for: date)

        // If therapist has no availability set for this day, return empty
        guard !dayRanges.isEmpty else { return [] }

        // Generate slots from therapist's availability ranges
        var slots: [TimeRange] = []
        let slotDuration = serviceDuration

        // Honor the therapist's booking policy (Problem C): a minimum-notice
        // window before a session can start, and a buffer enforced between
        // consecutive sessions. Mirrors the web slot engine
        // (client-webapp lib/booking/slots.ts) so iOS and web offer the same
        // slots. Previously iOS only filtered past + zero-buffer overlaps,
        // silently ignoring both therapist settings.
        let bufferInterval = TimeInterval(max(therapistProfile.availability.bufferMinutes, 0) * 60)
        let minNoticeInterval = TimeInterval(max(therapistProfile.availability.minNoticeHours, 0) * 3600)
        let earliestBookable = Date().addingTimeInterval(minNoticeInterval)

        for range in dayRanges {
            let startParts = range.start.split(separator: ":")
            let endParts = range.end.split(separator: ":")
            guard startParts.count == 2, endParts.count == 2,
                  let startHour = Int(startParts[0]), let startMin = Int(startParts[1]),
                  let endHour = Int(endParts[0]), let endMin = Int(endParts[1]) else { continue }

            var currentMinutes = startHour * 60 + startMin
            let rangeEndMinutes = endHour * 60 + endMin

            while currentMinutes + slotDuration <= rangeEndMinutes {
                let slotStartHour = currentMinutes / 60
                let slotStartMin = currentMinutes % 60
                let slotEndMinutes = currentMinutes + slotDuration

                let startTime = String(format: "%02d:%02d", slotStartHour, slotStartMin)
                let endTime = String(format: "%02d:%02d", slotEndMinutes / 60, slotEndMinutes % 60)

                // Build slot dates in the therapist's timezone for conflict checking
                guard let slotStart = calendar.date(bySettingHour: slotStartHour, minute: slotStartMin, second: 0, of: date) else { continue }
                let slotEnd = slotStart.addingTimeInterval(TimeInterval(slotDuration * 60))

                let hasConflict = existingBookings.contains { booking in
                    guard let bookingStart = formatter.date(from: booking.scheduledAt) else { return false }
                    let bookingEnd = bookingStart.addingTimeInterval(TimeInterval(booking.duration * 60))
                    // Extend the busy interval by the buffer on both sides so a
                    // new session can't be booked back-to-back with an existing one.
                    let busyStart = bookingStart.addingTimeInterval(-bufferInterval)
                    let busyEnd = bookingEnd.addingTimeInterval(bufferInterval)
                    return slotStart < busyEnd && slotEnd > busyStart
                }

                // Skip slots before the minimum-notice cutoff. This also
                // excludes past slots, since earliestBookable >= now.
                let tooSoon = slotStart < earliestBookable

                if !hasConflict && !tooSoon {
                    slots.append(TimeRange(start: startTime, end: endTime))
                }

                currentMinutes += 15 // 15-minute slot cadence (matches web computeSlots slotStepMinutes)
            }
        }

        return slots
    }
    
    // MARK: - Booking Actions
    
    func acceptBooking(bookingId: String) async throws {
        try await updateBookingStatus(bookingId: bookingId, status: .confirmed, reason: nil)
    }
    
    func declineBooking(bookingId: String, reason: String) async throws {
        try await updateBookingStatus(bookingId: bookingId, status: .cancelled, reason: reason)
    }
    
    func cancelBooking(bookingId: String, reason: String) async throws {
        try await updateBookingStatus(bookingId: bookingId, status: .cancelled, reason: reason)
    }
    
    func rescheduleBooking(bookingId: String, newDate: Date) async throws {
        let formatter = ISO8601DateFormatter.shared
        try await client.from(SupabaseConfig.Table.bookings)
            .update([
                "scheduled_at": formatter.string(from: newDate),
                "updated_at": formatter.string(from: Date())
            ])
            .eq("id", value: bookingId)
            .execute()
    }
    
    func requestReschedule(bookingId: String, proposedDate: Date) async throws {
        let formatter = ISO8601DateFormatter.shared
        try await client.from(SupabaseConfig.Table.bookings)
            .update([
                "status": "reschedule_pending",
                "proposed_scheduled_at": formatter.string(from: proposedDate),
                "updated_at": formatter.string(from: Date())
            ])
            .eq("id", value: bookingId)
            .execute()
    }
    
    private struct RescheduleApprovalUpdate: Encodable {
        let scheduledAt: String
        let proposedScheduledAt: String?
        let status: String
        let rescheduleCount: Int
        let updatedAt: String
        
        enum CodingKeys: String, CodingKey {
            case scheduledAt = "scheduled_at"
            case proposedScheduledAt = "proposed_scheduled_at"
            case status
            case rescheduleCount = "reschedule_count"
            case updatedAt = "updated_at"
        }
    }
    
    func approveReschedule(bookingId: String) async throws {
        let booking = try await getBooking(bookingId: bookingId)
        guard let proposedDate = booking.proposedScheduledAt else {
            throw BookingError.noProposedDate
        }
        
        let formatter = ISO8601DateFormatter.shared
        let update = RescheduleApprovalUpdate(
            scheduledAt: formatter.string(from: proposedDate),
            proposedScheduledAt: nil,
            status: BookingStatus.confirmed.rawValue,
            rescheduleCount: booking.rescheduleCount + 1,
            updatedAt: formatter.string(from: Date())
        )
        
        try await client.from(SupabaseConfig.Table.bookings)
            .update(update)
            .eq("id", value: bookingId)
            .execute()
    }
    
    private struct RescheduleDeclineUpdate: Encodable {
        let proposedScheduledAt: String?
        let status: String
        let rescheduleCount: Int
        let updatedAt: String

        enum CodingKeys: String, CodingKey {
            case proposedScheduledAt = "proposed_scheduled_at"
            case status
            case rescheduleCount = "reschedule_count"
            case updatedAt = "updated_at"
        }
    }

    func declineReschedule(bookingId: String) async throws {
        // Fetch current count so we can increment it — declining a reschedule
        // consumes the attempt just like approving one does.
        let booking = try await getBooking(bookingId: bookingId)
        let update = RescheduleDeclineUpdate(
            proposedScheduledAt: nil,
            status: BookingStatus.confirmed.rawValue,
            rescheduleCount: booking.rescheduleCount + 1,
            updatedAt: ISO8601DateFormatter.shared.string(from: Date())
        )

        try await client.from(SupabaseConfig.Table.bookings)
            .update(update)
            .eq("id", value: bookingId)
            .execute()
    }
    
    func updateVideoRoomId(bookingId: String, videoRoomId: String) async throws {
        try await client.from(SupabaseConfig.Table.bookings)
            .update([
                "video_room_id": videoRoomId,
                "updated_at": ISO8601DateFormatter.shared.string(from: Date())
            ])
            .eq("id", value: bookingId)
            .execute()
    }
    
    func updateBookingPaymentIntent(bookingId: String, paymentIntentId: String) async throws {
        try await client.from(SupabaseConfig.Table.bookings)
            .update([
                "stripe_payment_intent_id": paymentIntentId,
                "updated_at": ISO8601DateFormatter.shared.string(from: Date())
            ])
            .eq("id", value: bookingId)
            .execute()
    }

    // MARK: - Atomic Credit Booking (C1)

    func createBookingWithCredit(booking: Booking, creditId: String) async throws -> CreditBookingResult {
        let formatter = ISO8601DateFormatter.shared

        // Use AnyJSON dictionary to avoid MainActor-isolated Encodable conformance issues
        let params: [String: AnyJSON] = [
            "p_booking_id": .string(booking.id),
            "p_client_id": .string(booking.clientId),
            "p_therapist_id": .string(booking.therapistId),
            "p_service_id": .string(booking.serviceId),
            "p_service_name": .string(booking.serviceName),
            "p_duration": .integer(booking.duration),
            "p_scheduled_at": .string(formatter.string(from: booking.scheduledAt)),
            "p_timezone": .string(booking.timezone),
            "p_video_room_id": booking.videoRoomId.map { .string($0) } ?? .null,
            "p_pack_booking_id": booking.packBookingId.map { .string($0) } ?? .null,
            "p_credit_id": .string(creditId),
        ]

        let response: CreditBookingRPCResponse = try await client
            .rpc("create_booking_with_credit", params: params)
            .single()
            .execute()
            .value

        return CreditBookingResult(
            bookingId: response.booking_id,
            creditId: response.credit_id,
            sessionsRemaining: response.sessions_remaining
        )
    }
}
