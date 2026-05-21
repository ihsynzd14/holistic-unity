import Foundation
import Supabase
import os.log

/// Supabase-backed implementation of PaymentRepositoryProtocol.
/// All Stripe secret-key operations are delegated to Supabase Edge Functions.
final class SupabasePaymentRepository: PaymentRepositoryProtocol, @unchecked Sendable {
    
    // Select only the columns mapped by TransactionDTO to avoid decoding failures
    // when the DB table has extra columns not present in the DTO.
    private static let transactionColumns = "id,booking_id,client_id,therapist_id,amount,platform_fee,therapist_payout,currency,status,stripe_payment_intent_id,refund_amount,created_at,updated_at,payout_status,payout_after,total_charged,commission_base,iva_amount,iva_applied,service_fee,therapist_country"

    private let client: SupabaseClient
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "HolisticUnity", category: "Payment")

    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
    }
    
    // MARK: - Payment Intent
    
    func createPaymentIntent(bookingId: String, therapistId: String, amount: Double, currency: String) async throws -> PaymentIntentResult {
        // C4: Validate inputs before calling edge function
        guard amount > 0, amount.isFinite, !amount.isNaN else {
            throw PaymentError.paymentFailed("Invalid payment amount")
        }
        guard !bookingId.isEmpty, !therapistId.isEmpty, !currency.isEmpty else {
            throw PaymentError.paymentFailed("Missing required payment parameters")
        }

        struct Request: Encodable {
            let bookingId: String
            let therapistId: String
            let amount: Int
            let currency: String
            let idempotencyKey: String

            enum CodingKeys: String, CodingKey {
                case bookingId = "booking_id"
                case therapistId = "therapist_id"
                case amount, currency
                case idempotencyKey = "idempotency_key"
            }
        }

        let amountInCents = Int(round(amount * 100))
        // C4: Idempotency key derived from booking ID to prevent duplicate charges on retry
        let idempotencyKey = "pi-\(bookingId)"
        let request = Request(bookingId: bookingId, therapistId: therapistId, amount: amountInCents, currency: currency, idempotencyKey: idempotencyKey)

        return try await invokeFunction("create-payment-intent", body: request)
    }
    
    func confirmPayment(paymentIntentId: String) async throws -> Transaction {
        // After PaymentSheet completes, the webhook creates the transaction row.
        // Poll with exponential backoff until it appears.
        let maxAttempts = 15
        var delaySeconds: UInt64 = 1

        for attempt in 1...maxAttempts {
            let results: [TransactionDTO] = try await client
                .from(SupabaseConfig.Table.transactions)
                .select(Self.transactionColumns)
                .eq("stripe_payment_intent_id", value: paymentIntentId)
                .limit(1)
                .execute()
                .value

            if let dto = results.first {
                // Only accept completed transactions — webhook may create
                // rows in 'pending' or 'failed' status before final settlement.
                guard dto.status == "completed" || dto.status == "processing" else {
                    logger.warning("Transaction found for \(paymentIntentId) but status=\(dto.status ?? "nil"), continuing poll...")
                    if attempt < maxAttempts {
                        try await Task.sleep(nanoseconds: delaySeconds * 1_000_000_000)
                        delaySeconds = min(delaySeconds * 2, 4)
                    }
                    continue
                }
                return dto.toDomain()
            }

            if attempt < maxAttempts {
                try await Task.sleep(nanoseconds: delaySeconds * 1_000_000_000)
                // Exponential backoff: 1s, 2s, 4s, 4s, 4s... (capped at 4s)
                delaySeconds = min(delaySeconds * 2, 4)
            }
        }

        throw PaymentError.transactionNotFound
    }
    
    func requestRefund(transactionId: String) async throws {
        struct Request: Encodable {
            let transactionId: String
            
            enum CodingKeys: String, CodingKey {
                case transactionId = "transaction_id"
            }
        }
        
        let request = Request(transactionId: transactionId)
        
        let _: EmptyResponse = try await invokeFunction("request-refund", body: request)
    }
    
    func getTransaction(bookingId: String) async throws -> Transaction? {
        let dtos: [TransactionDTO] = try await client
            .from(SupabaseConfig.Table.transactions)
            .select(Self.transactionColumns)
            .eq("booking_id", value: bookingId)
            .limit(1)
            .execute()
            .value
        return dtos.first.map { $0.toDomain() }
    }
    
    // MARK: - Transaction History
    
    func getTransactionHistory(userId: String, role: UserRole) async throws -> [Transaction] {
        let column = role == .client ? "client_id" : "therapist_id"
        
        let dtos: [TransactionDTO] = try await client
            .from(SupabaseConfig.Table.transactions)
            .select(Self.transactionColumns)
            .eq(column, value: userId)
            .order("created_at", ascending: false)
            .execute()
            .value
        
        return dtos.map { $0.toDomain() }
    }
    
    func getEarningsSummary(therapistId: String) async throws -> EarningsSummary {
        let transactions = try await getTransactionHistory(userId: therapistId, role: .therapist)
        let completed = transactions.filter { $0.status == .completed }
        
        let now = Date()
        let calendar = Calendar.current
        let startOfWeek = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
        let startOfMonth = calendar.dateInterval(of: .month, for: now)?.start ?? now
        
        let totalEarnings = completed.reduce(0.0) { $0 + $1.therapistPayout }
        let thisWeek = completed.filter { $0.createdAt >= startOfWeek }.reduce(0.0) { $0 + $1.therapistPayout }
        let thisMonth = completed.filter { $0.createdAt >= startOfMonth }.reduce(0.0) { $0 + $1.therapistPayout }
        let pendingPayout = transactions.filter { $0.status == .processing }.reduce(0.0) { $0 + $1.therapistPayout }
        
        return EarningsSummary(
            totalEarnings: totalEarnings,
            thisWeek: thisWeek,
            thisMonth: thisMonth,
            pendingPayout: pendingPayout,
            totalSessions: completed.count
        )
    }
    
    // MARK: - Stripe Connect
    
    func createStripeConnectAccount(therapistId: String) async throws -> String {
        struct Request: Encodable {
            let therapistId: String
            enum CodingKeys: String, CodingKey {
                case therapistId = "therapist_id"
            }
        }
        
        struct Response: Decodable {
            let onboardingUrl: String
            let accountId: String
            
            enum CodingKeys: String, CodingKey {
                case onboardingUrl = "onboarding_url"
                case accountId = "account_id"
            }
        }
        
        let response: Response = try await invokeFunction("create-connect-account", body: Request(therapistId: therapistId))
        return response.onboardingUrl
    }
    
    func getStripeConnectDashboardURL(therapistId: String) async throws -> String {
        struct Request: Encodable {
            let therapistId: String
            enum CodingKeys: String, CodingKey {
                case therapistId = "therapist_id"
            }
        }
        
        struct Response: Decodable {
            let dashboardUrl: String
            enum CodingKeys: String, CodingKey {
                case dashboardUrl = "dashboard_url"
            }
        }
        
        let response: Response = try await invokeFunction("connect-dashboard", body: Request(therapistId: therapistId))
        return response.dashboardUrl
    }
    
    // MARK: - Saved Payment Methods
    
    func getSavedPaymentMethods(clientId: String) async throws -> [SavedPaymentMethod] {
        let dtos: [PaymentMethodDTO] = try await client
            .from(SupabaseConfig.Table.paymentMethods)
            .select()
            .eq("user_id", value: clientId)
            .order("created_at", ascending: false)
            .execute()
            .value
        
        return dtos.map { $0.toDomain() }
    }
    
    func addPaymentMethod(clientId: String, token: String) async throws -> SavedPaymentMethod {
        // Payment methods are saved automatically by Stripe during checkout.
        // This method is provided for manual additions if needed.
        struct Request: Encodable {
            let clientId: String
            let paymentMethodId: String
            
            enum CodingKeys: String, CodingKey {
                case clientId = "client_id"
                case paymentMethodId = "payment_method_id"
            }
        }
        
        struct Response: Decodable {
            let paymentMethod: PaymentMethodDTO
            
            enum CodingKeys: String, CodingKey {
                case paymentMethod = "payment_method"
            }
        }
        
        let response: Response = try await invokeFunction("add-payment-method", body: Request(clientId: clientId, paymentMethodId: token))
        return response.paymentMethod.toDomain()
    }
    
    func removePaymentMethod(methodId: String) async throws {
        struct Request: Encodable {
            let paymentMethodRowId: String

            enum CodingKeys: String, CodingKey {
                case paymentMethodRowId = "payment_method_row_id"
            }
        }

        let request = Request(paymentMethodRowId: methodId)
        let _: EmptyResponse = try await invokeFunction("detach-payment-method", body: request)
    }
    
    // MARK: - Atomic Booking + Payment (C2)

    func createBookingWithPayment(_ request: BookingPaymentRequest) async throws -> BookingPaymentResult {
        return try await invokeFunction("create-booking-with-payment", body: request)
    }

    // MARK: - Edge Function Helper
    
    /// Invokes a Supabase Edge Function via raw HTTP request.
    /// Bypasses the SDK's FunctionsClient to ensure the Authorization header
    /// contains the user's JWT (not the anon key) when it reaches the Supabase gateway.
    private func invokeFunction<T: Encodable, R: Decodable>(_ name: String, body: T) async throws -> R {
        let session = try await client.auth.session
        let userId = session.user.id.uuidString
        logger.info("Invoking '\(name)' | user=\(userId)")

        return try await rawInvokeEdgeFunction(name, body: body, accessToken: session.accessToken)
    }

    /// Makes a direct HTTP POST to the edge function URL with the given access token.
    /// - Parameter isRetry: Prevents infinite recursion on 401 retry.
    private func rawInvokeEdgeFunction<T: Encodable, R: Decodable>(
        _ name: String,
        body: T,
        accessToken: String,
        isRetry: Bool = false
    ) async throws -> R {
        let baseURL = SupabaseSecrets.url
        guard let url = URL(string: "\(baseURL)/functions/v1/\(name)") else {
            throw PaymentError.paymentFailed("Invalid edge function URL: \(name)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        // Send the anon key as Authorization so the Supabase gateway accepts the request
        // without JWT verification, then pass the real user JWT in x-user-token
        // for the edge function to authenticate the user internally.
        request.setValue("Bearer \(SupabaseSecrets.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(SupabaseSecrets.anonKey, forHTTPHeaderField: "apikey")
        request.setValue(accessToken, forHTTPHeaderField: "x-user-token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(body)

        // SECURITY (audit 2026-05-18): payment edge functions return
        // Stripe response bodies (payment intent client secrets,
        // connected account IDs). Using `URLSession.shared` means
        // iOS may heuristically disk-cache the response if the
        // server omits Cache-Control headers — leaking payment data
        // across sessions/users. Use a private ephemeral session.
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let session = URLSession(configuration: .ephemeral)
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw PaymentError.paymentFailed("Invalid server response")
        }

        // Log the response for debugging
        if httpResponse.statusCode != 200 {
            let bodyStr = String(data: data, encoding: .utf8) ?? "(non-UTF8)"
            logger.error("Edge function '\(name)' returned \(httpResponse.statusCode): \(bodyStr)")
        }

        guard 200..<300 ~= httpResponse.statusCode else {
            // Parse error from response body
            let errorMsg: String
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let msg = json["error"] as? String
                let details = json["details"] as? String
                errorMsg = [msg, details].compactMap { $0 }.joined(separator: " — ")
            } else {
                errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            }

            // On first 401, try refreshing session and retry once
            if httpResponse.statusCode == 401 && !isRetry {
                logger.warning("Edge function '\(name)' returned 401, refreshing session...")
                do {
                    let refreshed = try await client.auth.refreshSession()
                    return try await rawInvokeEdgeFunction(name, body: body, accessToken: refreshed.accessToken, isRetry: true)
                } catch {
                    logger.error("Session refresh failed: \(error.localizedDescription)")
                    throw PaymentError.paymentFailed("Authentication expired. Please sign out and sign back in.")
                }
            }

            throw PaymentError.paymentFailed(errorMsg.isEmpty ? "Edge function '\(name)' failed with status \(httpResponse.statusCode)" : errorMsg)
        }

        let decoder = JSONDecoder()
        return try decoder.decode(R.self, from: data)
    }
}

// MARK: - Payment Errors

enum PaymentError: LocalizedError {
    case transactionNotFound
    case connectAccountNotSetUp
    case paymentFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .transactionNotFound:
            return "Payment confirmation is still processing. Please check back in a moment."
        case .connectAccountNotSetUp:
            return "Payment account is not set up yet."
        case .paymentFailed(let reason):
            return "Payment failed: \(reason)"
        }
    }
}

// MARK: - Empty Response Helper

private struct EmptyResponse: Decodable {}
