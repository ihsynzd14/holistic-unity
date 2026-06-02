import Foundation
import os

/// Cold-start instrumentation (pre-launch task #167).
///
/// Measures the interval from app launch (`App.init()`, the earliest
/// app-controlled point) to the **first render of the client home**
/// (`ClientTabView.onAppear`). It emits an `os_signpost` interval — visible in
/// **Instruments → os_signpost** (filter by this subsystem) — AND logs the
/// elapsed milliseconds via `os.Logger`, so the number is readable in
/// Xcode's console / Console.app **without** needing Instruments.
///
/// Target: < 1500 ms to home on an iPhone 14 (see task list).
///
/// Notes:
/// - Only the **returning-authenticated** path reaches the home at launch. For
///   a new user (onboarding/welcome) the interval simply never ends — no
///   signpost, no log. That's intentional: this metric is the warm-user cold
///   start, which is the number the < 1.5s target is about.
/// - `markHomeRendered()` is idempotent (first render wins), so tab switches or
///   re-appearances don't overwrite the measurement.
/// - Both entry points run on the main thread (`App.init` and SwiftUI
///   `onAppear`), so the static state is effectively serialized;
///   `nonisolated(unsafe)` matches the project convention for such state and
///   keeps the helper callable regardless of caller isolation.
enum LaunchMetrics {

    private static let signposter = OSSignposter(
        subsystem: AppConstants.appBundleId,
        category: "PointsOfInterest"
    )
    private static let logger = Logger(subsystem: AppConstants.appBundleId, category: "LaunchMetrics")

    /// Monotonic launch timestamp (uptime — unaffected by wall-clock changes).
    nonisolated(unsafe) private static var startTime: DispatchTime?
    nonisolated(unsafe) private static var intervalState: OSSignpostIntervalState?
    nonisolated(unsafe) private static var didRecordHome = false

    /// Start the cold-start stopwatch. Call once, as early as possible in the
    /// launch sequence. Idempotent: the first call wins.
    static func begin() {
        guard startTime == nil else { return }
        startTime = DispatchTime.now()
        intervalState = signposter.beginInterval("ColdStart")
    }

    /// Stop the stopwatch when the home is first on screen. Idempotent.
    static func markHomeRendered() {
        guard !didRecordHome, let start = startTime, let state = intervalState else { return }
        didRecordHome = true
        signposter.endInterval("ColdStart", state)

        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
        let ms = String(format: "%.1f", elapsedMs)
        logger.log("Cold start → home first render: \(ms, privacy: .public) ms (target < 1500)")
    }
}
