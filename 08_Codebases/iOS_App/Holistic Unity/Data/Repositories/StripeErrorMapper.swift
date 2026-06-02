import Foundation

/// Maps Stripe / Supabase Edge Function payment errors to user-friendly
/// messages localized via `String(localized:)` (English keys, Italian
/// translations live in `Localizable.xcstrings`).
///
/// Stripe's API returns errors with a `code` (e.g. `card_declined`,
/// `insufficient_funds`, `expired_card`) and a human-readable English
/// `message`. Our payment edge functions repackage these into a JSON
/// `{ "error": ..., "details": ..., "code": ... }` shape and forward
/// them to the client. Previously the client surfaced those raw English
/// strings to Italian users, who'd see e.g. "Your card has insufficient
/// funds." instead of "Fondi insufficienti sulla carta."
///
/// This mapper resolves the payload to a localized message in two
/// passes:
///   1. **Code match** — if the payload includes a recognized Stripe
///      error code (or `decline_code` for granular decline reasons),
///      return the matching localized message directly.
///   2. **Substring fallback** — if no code field is present (older
///      edge functions, or non-Stripe errors), do best-effort
///      substring matching on the combined `error`/`details` text.
///
/// If neither pass finds a signal we return a generic fallback. The
/// original English text is preserved in `os.log` upstream so support
/// and Sentry can still inspect the raw error.
enum StripeErrorMapper {

    /// Returns a localized user-friendly message for a parsed Stripe /
    /// edge-function error JSON payload. Falls back to
    /// `genericFallback` when the payload yields no actionable signal.
    ///
    /// - Parameter json: Parsed JSON dictionary from the edge function
    ///   response body. Pass `nil` if the body wasn't JSON-parseable.
    static func friendlyMessage(from json: [String: Any]?) -> String {
        // First pass — match by explicit Stripe error code.
        let code = (json?["code"] as? String) ?? (json?["decline_code"] as? String)
        if let code, let message = messageForCode(code) {
            return message
        }

        // Second pass — substring matching on the message text. Stripe
        // wraps the same underlying conditions in slightly different
        // English phrasings depending on the API version / endpoint,
        // so we check several phrasings per condition.
        let errorText = (json?["error"] as? String) ?? ""
        let details = (json?["details"] as? String) ?? ""
        let allText = "\(errorText) \(details)".lowercased()

        if !allText.trimmingCharacters(in: .whitespaces).isEmpty {
            if allText.contains("insufficient_funds") || allText.contains("insufficient funds") {
                return Self.insufficientFunds
            }
            if allText.contains("expired_card") || (allText.contains("expired") && allText.contains("card")) {
                return Self.expiredCard
            }
            if allText.contains("incorrect_cvc")
                || (allText.contains("cvc") && allText.contains("incorrect"))
                || (allText.contains("security code") && allText.contains("incorrect")) {
                return Self.incorrectCVC
            }
            if allText.contains("incorrect_number")
                || (allText.contains("card number") && (allText.contains("incorrect") || allText.contains("invalid"))) {
                return Self.incorrectNumber
            }
            if allText.contains("authentication_required")
                || allText.contains("3d secure")
                || allText.contains("3ds") {
                return Self.authenticationRequired
            }
            if allText.contains("processing_error") || allText.contains("processing error") {
                return Self.processingError
            }
            if allText.contains("try_again_later") || allText.contains("try again later") {
                return Self.tryAgainLater
            }
            if allText.contains("booking_overlap") || allText.contains("overlaps with an existing booking") {
                return Self.bookingOverlap
            }
            // Catch-all decline — checked last so the more specific
            // matches above win when both apply (e.g. an
            // `insufficient_funds` error also contains "declined").
            if allText.contains("card_declined")
                || allText.contains("card declined")
                || allText.contains("declined") {
                return Self.cardDeclined
            }
        }

        return Self.genericFallback
    }

    /// Generic fallback for when no error code / text matches. Also used
    /// by callers that lack a JSON payload entirely (e.g. malformed
    /// HTTP response before the body was parseable).
    static var genericFallback: String {
        String(
            localized: "Payment failed. Please check your details or try a different payment method.",
            comment: "Generic fallback for unmapped Stripe / payment edge-function errors"
        )
    }

    // MARK: - Code → Message Map

    private static func messageForCode(_ code: String) -> String? {
        switch code {
        case "card_declined", "generic_decline":
            return Self.cardDeclined
        case "insufficient_funds":
            return Self.insufficientFunds
        case "expired_card":
            return Self.expiredCard
        case "incorrect_cvc":
            return Self.incorrectCVC
        case "incorrect_number", "invalid_number":
            return Self.incorrectNumber
        case "authentication_required":
            return Self.authenticationRequired
        case "processing_error":
            return Self.processingError
        case "try_again_later":
            return Self.tryAgainLater
        case "booking_overlap":
            return Self.bookingOverlap
        default:
            return nil
        }
    }

    // MARK: - Localized Messages

    private static var cardDeclined: String {
        String(
            localized: "Your bank declined the payment. Please contact your bank or try a different payment method.",
            comment: "Stripe card_declined / generic_decline error"
        )
    }

    private static var insufficientFunds: String {
        String(
            localized: "Insufficient funds on the card. Please check your balance and try again.",
            comment: "Stripe insufficient_funds error"
        )
    }

    private static var expiredCard: String {
        String(
            localized: "The card has expired. Please update your payment details and try again.",
            comment: "Stripe expired_card error"
        )
    }

    private static var incorrectCVC: String {
        String(
            localized: "The security code (CVC) is incorrect. Please check the 3 digits on the back of the card.",
            comment: "Stripe incorrect_cvc error"
        )
    }

    private static var incorrectNumber: String {
        String(
            localized: "The card number is incorrect. Please check and try again.",
            comment: "Stripe incorrect_number / invalid_number error"
        )
    }

    private static var authenticationRequired: String {
        String(
            localized: "Your bank requires 3D Secure authentication. Please follow your bank's instructions to complete the payment.",
            comment: "Stripe authentication_required error (3DS)"
        )
    }

    private static var processingError: String {
        String(
            localized: "There was an error processing the payment. Please try again in a few minutes.",
            comment: "Stripe processing_error error"
        )
    }

    private static var tryAgainLater: String {
        String(
            localized: "Temporary issue with the payment service. Please try again in a few minutes.",
            comment: "Stripe try_again_later / temporary issue"
        )
    }

    static var bookingOverlap: String {
        String(
            localized: "This time slot was just taken by another booking. Please go back and choose a different time.",
            comment: "Edge function booking_overlap — therapist already has a booking at the selected time"
        )
    }
}
