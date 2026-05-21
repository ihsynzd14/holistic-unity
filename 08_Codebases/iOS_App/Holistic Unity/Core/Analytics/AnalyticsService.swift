import Foundation

/// Thin protocol wrapping product analytics.
///
/// We intentionally put a boundary between our code and any specific
/// analytics vendor for two reasons:
///
///   1. **Privacy posture.** V1 uses TelemetryDeck (privacy-first, EU-hosted,
///      no IDFA, no ATT prompt, no user-identifiable payloads). If we ever
///      swap vendor, the rest of the app stays untouched.
///   2. **Testability.** `MockAnalyticsService` in unit tests asserts the
///      right events fire without any SDK actually running.
///
/// **What we instrument + what we don't:**
///
///   ✅ Aggregate screen views, feature adoption, funnel conversion,
///      retention cohorts.
///   ✅ Outcome events (booking_created, review_submitted, session_joined)
///      with coarse metadata (session_duration_bucket, category).
///
///   ❌ User identifiers, emails, phone numbers, message content, therapy
///      notes, IP addresses.
///   ❌ Financial amounts (use Stripe dashboards for revenue metrics).
///   ❌ PII of any kind. Event parameters must be safe to show to anyone.
///
/// If you're tempted to log a parameter and have to think about whether
/// it's PII — it is. Don't log it.
protocol AnalyticsService: AnyObject {

    /// Must be called once at app launch, after SentrySDK.start but before
    /// any signal() call. No-op if analytics is disabled in config.
    func initialize()

    /// Emit a product analytics event.
    ///
    /// - Parameter name: Dot-separated verb-object, e.g. `"booking.created"`,
    ///   `"onboarding.step_completed"`. Keep it stable — renames break
    ///   retention cohorts in the analytics dashboard.
    /// - Parameter parameters: Optional small dict of NON-PII metadata.
    ///   Values are coerced to String. Keep keys short + stable.
    func signal(_ name: String, parameters: [String: String]?)

    /// Associate a one-way pseudonymous identifier with this session,
    /// so funnel aggregates by user-segment work without leaking identity.
    ///
    /// The input is hashed (SHA-256) before leaving the device so the
    /// analytics provider never sees the raw Supabase user id.
    func setPseudonymousUserID(_ rawUserID: String?)
}

extension AnalyticsService {
    /// Convenience — calls without parameters.
    func signal(_ name: String) {
        signal(name, parameters: nil)
    }
}

/// No-op analytics — used when the vendor SDK is not linked, or when
/// `AnalyticsConfig.enabled == false` (explicit opt-out, debug builds, etc.).
final class NoopAnalyticsService: AnalyticsService {
    func initialize() {}
    func signal(_ name: String, parameters: [String: String]?) {}
    func setPseudonymousUserID(_ rawUserID: String?) {}
}
