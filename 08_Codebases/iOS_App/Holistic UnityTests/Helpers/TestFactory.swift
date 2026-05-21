import Foundation
@testable import Holistic_Unity

enum TestFactory {

    static func makeSessionCredit(
        id: String = "credit-1",
        clientId: String = "client-1",
        therapistId: String = "therapist-1",
        serviceId: String = "service-1",
        packBookingId: String = "pack-booking-1",
        sessionsTotal: Int = 4,
        sessionsRemaining: Int = 3
    ) -> SessionCredit {
        SessionCredit(
            id: id,
            clientId: clientId,
            therapistId: therapistId,
            serviceId: serviceId,
            packBookingId: packBookingId,
            sessionsTotal: sessionsTotal,
            sessionsRemaining: sessionsRemaining,
            createdAt: Date(),
            updatedAt: Date()
        )
    }

    static func makeTherapistService(
        id: String = "service-1",
        name: String = "Individual Therapy",
        price: Double = 100,
        duration: Int = 60,
        isIntroCall: Bool = false,
        packSize: Int? = nil,
        packPrice: Double? = nil
    ) -> TherapistService {
        TherapistService(
            id: id,
            name: name,
            description: "Test service",
            duration: duration,
            price: price,
            format: .virtual,
            category: .thetaHealing,
            isIntroCall: isIntroCall,
            packSize: packSize,
            packPrice: packPrice
        )
    }

    static func makeTherapistProfile(
        id: String = "therapist-1",
        services: [TherapistService] = [],
        currency: Currency = .usd
    ) -> TherapistProfile {
        var profile = TherapistProfile.draft(userId: id, name: "Dr. Test")
        profile.services = services
        profile.currency = currency
        return profile
    }

    static func makeBooking(
        id: String = "booking-1",
        clientId: String = "client-1",
        therapistId: String = "therapist-1",
        serviceId: String = "service-1",
        price: Double = 100,
        duration: Int = 60,
        status: BookingStatus = .confirmed,
        packBookingId: String? = nil,
        proposedScheduledAt: Date? = nil,
        scheduledAt: Date = Date().addingTimeInterval(86400)
    ) -> Booking {
        Booking(
            id: id,
            clientId: clientId,
            therapistId: therapistId,
            serviceId: serviceId,
            serviceName: "Test Session",
            duration: duration,
            price: price,
            scheduledAt: scheduledAt,
            timezone: "Europe/Rome",
            format: .virtual,
            status: status,
            videoRoomId: "room-\(id)",
            platformFee: price * 0.20,
            therapistPayout: price * 0.80,
            proposedScheduledAt: proposedScheduledAt,
            rescheduleCount: 0,
            packBookingId: packBookingId,
            createdAt: Date(),
            updatedAt: Date()
        )
    }
}
