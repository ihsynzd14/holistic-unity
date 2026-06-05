import Foundation

enum AppConstants {
    static let appName = "Holistic Unity"
    static let appBundleId = "Holistic-Unity-Healing"
    
    // MARK: - API
    enum API {
        static let baseURL = "https://api.holisticunity.com/v1"
        static let timeoutInterval: TimeInterval = 30
        static let maxRetryAttempts = 3
    }
    
    // MARK: - Booking
    enum Booking {
        static let minNoticeHoursDefault = 24
        static let bufferMinutesDefault = 15
        static let maxSessionExtensionMinutes = 60
        static let sessionExtensionIncrementMinutes = 15
        static let videoCallEarlyJoinMinutes = 10
        static let videoCallGracePeriodMinutes = 10
        static let maxRescheduleCount = 3

        /// How far ahead clients can book — a rolling month-plus window.
        /// Mirrors the web client's `BOOKING_WINDOW_DAYS` so iOS and web expose
        /// the SAME horizon (previously the iOS pickers were open-ended, letting
        /// clients book arbitrarily far out while web capped the window).
        static let bookingWindowDays = 42

        /// Selectable range for the booking / reschedule date pickers:
        /// tomorrow (1-day min notice) through `bookingWindowDays` ahead.
        /// Computed on access so it stays correct across midnight.
        static var selectableDateRange: ClosedRange<Date> {
            let cal = Calendar.current
            let today = Date()
            let lower = cal.startOfDay(for: cal.date(byAdding: .day, value: 1, to: today) ?? today)
            let upper = cal.startOfDay(for: cal.date(byAdding: .day, value: bookingWindowDays, to: today) ?? today)
            return lower...upper
        }
    }
    
    // MARK: - Media
    enum Media {
        static let maxProfilePhotoSizeMB = 10
        static let maxVideoIntroSeconds = 90
        static let maxVideoUploadSeconds = 180
        static let maxVideoUploadSizeMB = 500
        static let maxVoiceNoteDurationSeconds = 300
        static let imageCompressionQuality: CGFloat = 0.7
        static let videoTargetResolution = 720
        static let profilePhotoSize: CGFloat = 400
    }
    
    // MARK: - Validation
    enum Validation {
        static let maxBioLength = 160
        static let maxDescriptionLength = 2000
        static let maxReviewLength = 500
        static let minPasswordLength = 8
    }
    
    // MARK: - Rate Limiting
    enum RateLimit {
        static let maxChatMessagesPerMinute = 60
        static let maxBookingRequestsPerHour = 10
    }
    
    // MARK: - Support
    enum Support {
        /// Stream Chat user ID for the admin support account.
        /// Matches the ID used by the admin dashboard.
        static let supportUserId = "holistic-unity-support"
        static let supportDisplayName = "Holistic Unity"
        static let email = "support@holisticunity.app"
        static let responseTimeframe = "We respond within 24-48 hours"
        static let hours = "Email support available Monday-Friday"
    }

    // MARK: - Platform
    enum Platform {
        static let commissionPercentage: Double = 0.20
    }
    
    // MARK: - Languages
    static let availableLanguages = [
        "English", "Spanish", "French", "Italian", "German",
        "Portuguese", "Mandarin", "Japanese", "Korean", "Arabic",
        "Hindi", "Russian", "Dutch", "Swedish"
    ]

    // MARK: - Webapp
    enum Webapp {
        static let therapistPortalURL = "https://therapist-webapp-tau.vercel.app"

        /// Client-facing web app (Vercel → app.holisticunity.app). Also hosts
        /// the `/embed/youtube` player page that the in-app WKWebView loads to
        /// play YouTube intro videos with a real `Referer` header — see
        /// VideoPlayerViews.swift for the WKWebView error-152 context.
        static let clientBaseURL = "https://app.holisticunity.app"

        /// Hosted YouTube IFrame player for a validated 11-char video ID.
        /// `autoplay` is used by the full-screen Shorts player; the inline
        /// profile preview leaves it off so the user taps to start.
        static func youTubeEmbedURL(videoID: String, autoplay: Bool = false) -> URL? {
            URL(string: "\(clientBaseURL)/embed/youtube?v=\(videoID)\(autoplay ? "&autoplay=1" : "")")
        }
    }

    // MARK: - Pagination
    enum Pagination {
        static let defaultPageSize = 20
        static let searchDebounceMilliseconds = 300
    }
    
    // MARK: - Cache
    enum Cache {
        static let maxMemoryCacheMB = 50
        static let maxDiskCacheMB = 200
        static let cacheExpirationHours = 24
    }
    
    // MARK: - Legal
    enum Legal {
        static let termsOfService = """
        Terms of Service
        
        Last updated: March 2026
        
        Welcome to Holistic Unity. By using our platform, you agree to these terms.
        
        1. Service Description
        Holistic Unity connects clients with certified holistic therapists for virtual sessions. We are a marketplace platform and do not provide therapy services directly.
        
        2. User Accounts
        You must provide accurate information when creating an account. You are responsible for maintaining the security of your account credentials.
        
        3. Bookings & Payments
        All session fees are paid by the client at the time of booking. A platform commission is deducted from the therapist's payout. Cancellation policies vary by therapist.
        
        4. Therapist Verification
        All therapists undergo a review process. However, Holistic Unity does not guarantee the quality of any individual session.
        
        5. User Conduct
        Users must treat all participants with respect. Harassment, fraud, or misuse of the platform will result in account termination.
        
        6. Limitation of Liability
        Holistic Unity is not liable for any outcomes resulting from therapy sessions booked through the platform.
        
        For questions, contact support@holisticunity.app.
        """
        
        static let privacyPolicy = """
        Privacy Policy
        
        Last updated: March 2026
        
        Your privacy matters to us. This policy explains how Holistic Unity collects, uses, and protects your data.
        
        1. Information We Collect
        - Account information (name, email, profile photo)
        - Booking and session history
        - Messages exchanged through the platform
        - Payment information (when payment processing is enabled)
        
        2. How We Use Your Data
        - To facilitate bookings and sessions
        - To process payments
        - To improve our services
        - To send relevant notifications
        
        3. Data Sharing
        We do not sell your personal data. We share limited information with therapists (your name and booking details) to facilitate sessions.

        3a. Anonymous Aggregate Research (opt-in)
        With your explicit opt-in consent (default OFF, toggle in Settings → Privacy → Data), we may process your onboarding answers in aggregated and anonymised form to produce industry research and insights. No personal or identifiable information is ever included; direct identifiers (name, email, account ID) are stripped before aggregation; free-text notes are excluded. Legal basis: GDPR Art. 6(1)(a). You can withdraw consent at any time from Settings without affecting any other use of your data.

        4. Data Security
        Data is protected in transit and at rest where supported by our providers. Messages are stored securely by our chat provider.
        
        5. Your Rights
        You can request to download or delete your data at any time through the app settings.
        
        For questions, contact privacy@holisticunity.app.
        """
    }
}
