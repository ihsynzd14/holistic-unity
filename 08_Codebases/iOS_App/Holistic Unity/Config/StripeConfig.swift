import Foundation

/// Stripe configuration constants.
/// The secret key is stored server-side only (Supabase Edge Function).
/// Publishable key loaded from Secrets.xcconfig via Info.plist.
enum StripeConfig {
    static let publishableKey: String = {
        guard let value = Bundle.main.infoDictionary?["STRIPE_PUBLISHABLE_KEY"] as? String, !value.isEmpty else {
            fatalError("STRIPE_PUBLISHABLE_KEY not found in Info.plist. Ensure Secrets.xcconfig is linked to the target.")
        }
        return value
    }()
    static let merchantDisplayName = "Holistic Unity"
    static let appleMerchantId = "merchant.com.holisticunity.app"

    static func stripeCurrency(from currency: Currency) -> String {
        switch currency {
        case .usd: "usd"
        case .eur: "eur"
        case .gbp: "gbp"
        case .brl: "brl"
        }
    }

    static func amountInSmallestUnit(_ amount: Double, currency: Currency) -> Int {
        Int(round(amount * 100))
    }

    /// ISO 3166-1 alpha-2 country code for Apple Pay's `merchantCountryCode`.
    ///
    /// Apple Pay requires the country where the *merchant* is registered, not
    /// the customer's country. For Holistic Unity that's the platform, NOT
    /// the therapist — but Stripe uses Connect with `transfer_data.destination`
    /// so the receiving merchant's country effectively matters.
    ///
    /// Heuristic: derive from the booking currency since they correlate
    /// reliably for our supported regions. Falls back to "IT" because the
    /// platform entity is Italian and the majority of therapists are IT.
    /// Earlier code hardcoded "US" which produced an Apple Pay sheet that
    /// looked U.S.-flavoured to Italian customers (USD prompts, U.S. tax
    /// formatting in the receipt) and risked App Store review questions.
    static func appleMerchantCountryCode(for currency: Currency) -> String {
        switch currency {
        case .eur: return "IT"
        case .gbp: return "GB"
        case .usd: return "US"
        case .brl: return "BR"
        }
    }

    /// Default billing address country for the Stripe PaymentSheet
    /// `defaultBillingDetails`. Same rationale as `appleMerchantCountryCode`
    /// — earlier the code hardcoded "US" which prefilled the wrong country
    /// for non-US clients.
    static func defaultBillingCountryCode(for currency: Currency) -> String {
        appleMerchantCountryCode(for: currency)
    }
}
