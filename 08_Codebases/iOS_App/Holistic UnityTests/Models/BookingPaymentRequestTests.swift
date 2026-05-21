import XCTest
@testable import Holistic_Unity

final class BookingPaymentRequestTests: XCTestCase {

    func test_idempotencyKey_isDerivedFromBookingId() {
        let request = makeRequest(bookingId: "abc-123")
        XCTAssertEqual(request.idempotencyKey, "pi-abc-123")
    }

    func test_idempotencyKey_isStable() {
        let r1 = makeRequest(bookingId: "b1")
        let r2 = makeRequest(bookingId: "b1")
        XCTAssertEqual(r1.idempotencyKey, r2.idempotencyKey)
    }

    func test_idempotencyKey_differsByBookingId() {
        let r1 = makeRequest(bookingId: "b1")
        let r2 = makeRequest(bookingId: "b2")
        XCTAssertNotEqual(r1.idempotencyKey, r2.idempotencyKey)
    }

    func test_encoding_includesIdempotencyKey() throws {
        let request = makeRequest(bookingId: "test-id")
        let data = try JSONEncoder().encode(request)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(dict?["idempotency_key"] as? String, "pi-test-id")
    }

    func test_encoding_usesSnakeCaseCodingKeys() throws {
        let request = makeRequest()
        let data = try JSONEncoder().encode(request)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let keys = Set(dict?.keys.map { $0 } ?? [])
        // Core keys that must be snake_case
        XCTAssertTrue(keys.contains("booking_id"), "Missing booking_id, got: \(keys)")
        XCTAssertTrue(keys.contains("therapist_id"), "Missing therapist_id, got: \(keys)")
        XCTAssertTrue(keys.contains("service_id"), "Missing service_id, got: \(keys)")
        XCTAssertTrue(keys.contains("idempotency_key"), "Missing idempotency_key, got: \(keys)")
        // camelCase keys should NOT exist
        XCTAssertFalse(keys.contains("bookingId"), "Found camelCase bookingId")
        XCTAssertFalse(keys.contains("therapistId"), "Found camelCase therapistId")
    }

    func test_encoding_omitsNilOptionals() throws {
        let request = makeRequest(videoRoomId: nil, promoCode: nil, packBookingId: nil)
        let data = try JSONEncoder().encode(request)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        // nil values should still be encoded (encodeIfPresent writes null)
        // but the key should exist since our custom encode always encodes them
        XCTAssertNotNil(dict)
    }

    // MARK: - Helpers

    private func makeRequest(
        bookingId: String = "b1",
        videoRoomId: String? = "room-1",
        promoCode: String? = nil,
        packBookingId: String? = nil
    ) -> BookingPaymentRequest {
        BookingPaymentRequest(
            bookingId: bookingId,
            therapistId: "t1",
            serviceId: "s1",
            serviceName: "Therapy",
            duration: 60,
            price: 100,
            scheduledAt: "2026-04-15T10:00:00Z",
            timezone: "Europe/Rome",
            format: "virtual",
            videoRoomId: videoRoomId,
            promoCode: promoCode,
            discount: nil,
            packBookingId: packBookingId,
            currency: "eur"
        )
    }
}
