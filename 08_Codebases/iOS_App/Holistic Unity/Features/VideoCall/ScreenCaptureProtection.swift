import SwiftUI
import UIKit

// MARK: - Screen Capture Protection
//
// Video therapy sessions contain sensitive health conversations.
// iOS exposes `UIScreen.isCaptured` (true when the screen is being
// recorded or mirrored to an external display). When this becomes
// true, we blur the view to a solid black panel so the recording
// captures nothing useful, and surface a prompt telling the user
// to stop recording to resume the session.
//
// This is best-effort — a determined attacker can still point a
// phone camera at the screen. But it defeats casual recording,
// AirPlay mirroring, and QuickTime screen capture via USB.

@MainActor
@Observable
final class ScreenCaptureMonitor {
    var isCaptured: Bool = false

    // Store as a nonisolated Sendable box so `deinit` (nonisolated)
    // can safely read it without crossing actor boundaries.
    private nonisolated(unsafe) var observer: NSObjectProtocol?

    init() {
        // Initial state
        isCaptured = UIScreen.main.isCaptured
        observer = NotificationCenter.default.addObserver(
            forName: UIScreen.capturedDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // The handler already runs on .main; hop to MainActor formally
            // to read `isCaptured` without a data race.
            Task { @MainActor [weak self] in
                self?.isCaptured = UIScreen.main.isCaptured
            }
        }
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}

// MARK: - Modifier

struct ScreenCaptureProtectionModifier: ViewModifier {
    @State private var monitor = ScreenCaptureMonitor()

    func body(content: Content) -> some View {
        ZStack {
            content
                // Blur the protected content if recording is active.
                .blur(radius: monitor.isCaptured ? 40 : 0)
                .allowsHitTesting(!monitor.isCaptured)

            if monitor.isCaptured {
                // Opaque overlay — blocks pixel-level capture even if
                // the blur effect is bypassed by some capture paths.
                Color.black.opacity(0.92)
                    .ignoresSafeArea()
                    .overlay(alignment: .center) {
                        VStack(spacing: HUSpacing.md) {
                            Image(systemName: "video.slash.fill")
                                .font(.system(size: 44))
                                .foregroundStyle(.white.opacity(0.85))
                            Text(String(localized: "Screen recording detected",
                                        comment: "Video call privacy overlay title"))
                                .font(HUFont.displaySubtitle(size: 20, weight: .semiBold))
                                .foregroundStyle(.white)
                            Text(String(localized: "For your therapist's and your privacy, the video is paused while your screen is being recorded or mirrored. Stop the recording to resume.",
                                        comment: "Video call privacy overlay body"))
                                .font(HUFont.subheadline())
                                .foregroundStyle(.white.opacity(0.8))
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, HUSpacing.xl)
                        }
                    }
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: monitor.isCaptured)
    }
}

extension View {
    /// Applies iOS screen-capture protection: blurs content and shows
    /// a privacy overlay whenever `UIScreen.isCaptured == true`
    /// (ReplayKit, QuickTime capture, AirPlay mirroring, etc.).
    /// Use on views containing sensitive content such as video sessions.
    func protectAgainstScreenCapture() -> some View {
        modifier(ScreenCaptureProtectionModifier())
    }
}
