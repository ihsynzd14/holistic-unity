import SwiftUI
import LiveKit

/// Full-screen video call view for therapy sessions.
/// Displays remote participant video full-screen with local PiP overlay and controls.
struct VideoCallView: View {
    let roomName: String
    let participantName: String
    var bookingId: String = ""
    
    @Environment(\.dismiss) private var dismiss
    @State private var videoService = DIContainer.shared.videoCallService
    @State private var showEndCallAlert = false
    @State private var controlsVisible = true
    @State private var hideControlsTask: Task<Void, Never>?
    @State private var showPreCallChecks = true
    @State private var preCallResult: VideoCallService.PreCallCheckResult?
    @State private var isRunningChecks = true
    @State private var showPostSession = false
    @State private var sessionWasFailed = false
    @State private var shouldClearSessionOnDisappear = false
    
    var body: some View {
        ZStack {
            // Background
            Color.black.ignoresSafeArea()
            
            if showPostSession {
                postSessionView
            } else if showPreCallChecks {
                preCallCheckView
            } else {
                switch videoService.callState {
                case .idle, .connecting:
                    connectingView
                case .connected, .reconnecting:
                    callView
                case .failed(let message):
                    errorView(message: message)
                }
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(videoService.callState == .connected && !showPreCallChecks && !showPostSession)
        // Privacy: blur + overlay when the screen is being recorded/mirrored.
        // Therapy sessions contain sensitive health content; prevent casual
        // capture via ReplayKit, AirPlay mirroring, or QuickTime USB capture.
        .protectAgainstScreenCapture()
        .task {
            // SR-02: Run pre-call checks before connecting
            let result = await videoService.runPreCallChecks()
            preCallResult = result
            isRunningChecks = false
        }
        .onDisappear {
            hideControlsTask?.cancel()
            hideControlsTask = nil
            Task {
                await videoService.disconnect(clearSession: shouldClearSessionOnDisappear)
            }
        }
    }
    
    // MARK: - Pre-Call Check View (SR-02)
    
    private var preCallCheckView: some View {
        VStack(spacing: HUSpacing.xxl) {
            Text("Session Check")
                .font(HUFont.title2())
                .foregroundStyle(.white)
            
            Text("Verifying your setup before joining...")
                .font(HUFont.subheadline())
                .foregroundStyle(.white.opacity(0.6))
            
            if isRunningChecks {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                    .padding(.vertical, HUSpacing.xl)
                    .accessibilityLabel("Running pre-call checks")
            } else if let result = preCallResult {
                VStack(spacing: HUSpacing.lg) {
                    checkRow(
                        icon: "camera.fill",
                        title: "Camera Access",
                        passed: result.cameraPermission,
                        failHint: "Go to Settings > Privacy > Camera to enable"
                    )
                    
                    checkRow(
                        icon: "mic.fill",
                        title: "Microphone Access",
                        passed: result.microphonePermission,
                        failHint: "Go to Settings > Privacy > Microphone to enable"
                    )
                    
                    checkRow(
                        icon: "wifi",
                        title: "Network Connection",
                        passed: result.networkConnected,
                        failHint: "Check your Wi-Fi or mobile data connection"
                    )
                }
                .padding(.vertical, HUSpacing.lg)
                
                HStack(spacing: HUSpacing.lg) {
                    Button {
                        Task {
                            shouldClearSessionOnDisappear = true
                            await videoService.disconnect()
                            dismiss()
                        }
                    } label: {
                        Text("Cancel")
                            .font(HUFont.subheadline(weight: .semibold))
                            .foregroundStyle(.white.opacity(0.7))
                            .padding(.horizontal, HUSpacing.xxl)
                            .padding(.vertical, HUSpacing.md)
                            .background(.white.opacity(0.15))
                            .clipShape(Capsule())
                    }
                    
                    if !result.allPassed {
                        Button {
                            isRunningChecks = true
                            Task {
                                let newResult = await videoService.runPreCallChecks()
                                preCallResult = newResult
                                isRunningChecks = false
                            }
                        } label: {
                            Text("Re-check")
                                .font(HUFont.subheadline(weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, HUSpacing.xxl)
                                .padding(.vertical, HUSpacing.md)
                                .background(.white.opacity(0.2))
                                .clipShape(Capsule())
                        }
                    }
                    
                    Button {
                        showPreCallChecks = false
                        Task {
                            await videoService.connect(roomName: roomName, participantName: participantName, bookingId: bookingId)
                        }
                    } label: {
                        Text(result.allPassed ? "Join Session" : "Join Anyway")
                            .font(HUFont.subheadline(weight: .semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, HUSpacing.xxl)
                            .padding(.vertical, HUSpacing.md)
                            .background(.white)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(.horizontal, HUSpacing.xl)
    }
    
    private func checkRow(icon: String, title: String, passed: Bool, failHint: String) -> some View {
        HStack(spacing: HUSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(.white.opacity(0.7))
                .frame(width: 30)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(HUFont.body(weight: .medium))
                    .foregroundStyle(.white)
                if !passed {
                    Text(failHint)
                        .font(HUFont.caption())
                        .foregroundStyle(.orange)
                }
            }
            
            Spacer()
            
            Image(systemName: passed ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: 20))
                .foregroundStyle(passed ? .green : .orange)
        }
        .padding(.horizontal, HUSpacing.lg)
        .padding(.vertical, HUSpacing.sm)
        .background(.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
    }
    
    // MARK: - Connecting View
    
    private var connectingView: some View {
        VStack(spacing: HUSpacing.xl) {
            ProgressView()
                .controlSize(.large)
                .tint(.white)
                .accessibilityLabel("Connecting to video session")
            
            Text("Connecting...")
                .font(HUFont.headline())
                .foregroundStyle(.white)
            
            Text("Setting up your video session")
                .font(HUFont.subheadline())
                .foregroundStyle(.white.opacity(0.6))
            
            Button {
                Task {
                    await videoService.disconnect()
                    dismiss()
                }
            } label: {
                Text("Cancel")
                    .font(HUFont.subheadline(weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.horizontal, HUSpacing.xxl)
                    .padding(.vertical, HUSpacing.md)
                    .background(.white.opacity(0.15))
                    .clipShape(Capsule())
            }
            .padding(.top, HUSpacing.md)
        }
    }
    
    // MARK: - Error View
    
    private func errorView(message: String) -> some View {
        VStack(spacing: HUSpacing.xl) {
            Image(systemName: "video.slash.fill")
                .font(.system(size: 48))
                .foregroundStyle(.white.opacity(0.5))
            
            Text("Connection Failed")
                .font(HUFont.title2())
                .foregroundStyle(.white)
            
            Text(message)
                .font(HUFont.subheadline())
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
                .padding(.horizontal, HUSpacing.xxl)
            
            HStack(spacing: HUSpacing.lg) {
                Button {
                    Task {
                        await videoService.disconnect(clearSession: false)
                        dismiss()
                    }
                } label: {
                    Text("Close")
                        .font(HUFont.subheadline(weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, HUSpacing.xxl)
                        .padding(.vertical, HUSpacing.md)
                        .background(.white.opacity(0.2))
                        .clipShape(Capsule())
                }
                
                Button {
                    Task {
                        await videoService.reconnectWithBackoff(
                            roomName: roomName,
                            participantName: participantName,
                            bookingId: bookingId
                        )
                    }
                } label: {
                    Text("Try Again (\(VideoCallService.maxReconnectAttempts - videoService.reconnectAttempts) left)")
                        .font(HUFont.subheadline(weight: .semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, HUSpacing.xxl)
                        .padding(.vertical, HUSpacing.md)
                        .background(.white)
                        .clipShape(Capsule())
                }
                .disabled(videoService.reconnectAttempts >= 3)
            }
        }
    }
    
    // MARK: - Active Call View
    
    private var callView: some View {
        ZStack {
            // Remote video (full screen) — shows screen share when active
            remoteVideoView

            // Remote camera PiP (top-left) — only visible during screen share
            remotecameraPiPView

            // Local video PiP (bottom-right)
            localPiPView
            
            // SR-03: Ghost connection banner
            if videoService.ghostConnectionDetected {
                VStack {
                    ghostConnectionBanner
                    Spacer()
                }
            }
            
            // SR-01: Connection quality degradation warning
            if videoService.connectionQuality == .poor || videoService.connectionQuality == .lost {
                VStack {
                    Spacer()
                    connectionQualityBanner
                        .padding(.bottom, 80)
                }
            }
            
            // Controls overlay
            if controlsVisible {
                controlsOverlay
                    .transition(.opacity)
            }
        }
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.2)) {
                controlsVisible.toggle()
            }
            scheduleControlsHide()
        }
        .onAppear {
            scheduleControlsHide()
        }
        .alert("End Session", isPresented: $showEndCallAlert) {
            Button("Cancel", role: .cancel) {}
            Button("End Call", role: .destructive) {
                Task {
                    // BL-02: Check if session was too short (< 2 min)
                    sessionWasFailed = videoService.isLikelyFailedSession
                    if sessionWasFailed {
                        await videoService.flagSessionAsFailed(bookingId: bookingId)
                    }
                    shouldClearSessionOnDisappear = true
                    await videoService.disconnect()
                    showPostSession = true
                }
            }
        } message: {
            Text("Are you sure you want to end this video session?")
        }
    }
    
    // MARK: - Ghost Connection Banner (SR-03)
    
    private var ghostConnectionBanner: some View {
        HStack(spacing: HUSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
            Text("Connection issue detected — audio/video may not be reaching the other participant")
                .font(HUFont.caption())
            
            Spacer()
            
            Button {
                Task {
                    await videoService.reconnectWithBackoff(
                        roomName: roomName,
                        participantName: participantName,
                        bookingId: bookingId
                    )
                }
            } label: {
                Text("Retry")
                    .font(HUFont.caption(weight: .semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(.white.opacity(0.3))
                    .clipShape(Capsule())
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, HUSpacing.md)
        .padding(.vertical, HUSpacing.sm)
        .background(.orange.opacity(0.9))
        .padding(.horizontal, HUSpacing.sm)
        .padding(.top, HUSpacing.sm)
    }
    
    // MARK: - Connection Quality Banner (SR-01)
    
    private var connectionQualityBanner: some View {
        HStack(spacing: HUSpacing.sm) {
            Image(systemName: videoService.connectionQuality == .lost ? "wifi.slash" : "wifi.exclamationmark")
                .font(.system(size: 14))
            Text(videoService.connectionQuality == .lost
                 ? "Network connection lost"
                 : "Poor connection — consider switching to audio-only")
                .font(HUFont.caption())
            
            Spacer()
            
            if videoService.connectionQuality == .poor {
                Button {
                    Task { await videoService.toggleCamera() }
                } label: {
                    Text("Audio Only")
                        .font(HUFont.caption(weight: .semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(.white.opacity(0.3))
                        .clipShape(Capsule())
                }
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, HUSpacing.md)
        .padding(.vertical, HUSpacing.sm)
        .background(videoService.connectionQuality == .lost ? Color.red.opacity(0.9) : Color.orange.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
        .padding(.horizontal, HUSpacing.sm)
    }
    
    // MARK: - Remote Video
    
    private var remoteVideoView: some View {
        Group {
            if let screenTrack = videoService.remoteScreenShareTrack {
                // Screen share active: show shared screen full-screen with .fit (not .fill)
                // so content isn't cropped. Camera moves to secondary PiP.
                SwiftUIVideoView(screenTrack, layoutMode: .fit)
                    .ignoresSafeArea()
                    .accessibilityLabel("Screen share from therapist")
            } else if let remoteTrack = videoService.remoteVideoTrack {
                SwiftUIVideoView(remoteTrack, layoutMode: .fill)
                    .ignoresSafeArea()
                    .accessibilityLabel("Remote participant video")
            } else {
                // Waiting for other participant
                VStack(spacing: HUSpacing.lg) {
                    Image(systemName: "person.wave.2.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(.white.opacity(0.4))
                        .symbolEffect(.pulse)

                    Text("Waiting for other participant...")
                        .font(HUFont.headline())
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
        }
    }

    /// When screen share is active, show the therapist's camera as a secondary PiP (top-left).
    private var remotecameraPiPView: some View {
        Group {
            if videoService.remoteScreenShareTrack != nil,
               let remoteCameraTrack = videoService.remoteVideoTrack {
                VStack {
                    HStack {
                        SwiftUIVideoView(remoteCameraTrack, layoutMode: .fill)
                            .frame(width: 100, height: 140)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(.white.opacity(0.15), lineWidth: 1)
                            )
                            .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
                            .padding(.leading, HUSpacing.lg)
                            .padding(.top, 60)
                            .accessibilityLabel("Therapist camera")
                        Spacer()
                    }
                    Spacer()
                }
            }
        }
    }
    
    // MARK: - Local PiP
    
    private var localPiPView: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Group {
                    if let localTrack = videoService.localVideoTrack {
                        SwiftUIVideoView(localTrack, layoutMode: .fill, mirrorMode: .mirror)
                            .accessibilityLabel("Your camera")
                    } else {
                        ZStack {
                            Color(.darkGray)
                            Image(systemName: "video.slash")
                                .font(.system(size: 20))
                                .foregroundStyle(.white.opacity(0.5))
                        }
                        .accessibilityLabel("Camera off")
                    }
                }
                .frame(width: 120, height: 170)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.4), radius: 8)
                .padding(.trailing, HUSpacing.lg)
                .padding(.bottom, 100) // Above control bar
            }
        }
    }
    
    // MARK: - Controls Overlay
    
    private var controlsOverlay: some View {
        VStack {
            // Top bar: status + timer
            topBar
            
            Spacer()
            
            // Bottom controls
            controlBar
        }
    }
    
    private var topBar: some View {
        HStack {
            // Connection status with quality indicator
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                
                Text(statusText)
                    .font(HUFont.caption(weight: .medium))
                    .foregroundStyle(.white)
                
                // Quality indicator
                if videoService.callState == .connected {
                    Image(systemName: qualityIcon)
                        .font(.system(size: 10))
                        .foregroundStyle(qualityColor)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.black.opacity(0.5))
            .clipShape(Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Connection status: \(statusText), quality: \(videoService.connectionQuality.rawValue)")
            
            Spacer()
            
            // Session timer
            Text(formattedTime)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.black.opacity(0.5))
                .clipShape(Capsule())
                .accessibilityLabel("Session duration: \(formattedTime)")
        }
        .padding(.horizontal, HUSpacing.lg)
        .padding(.top, HUSpacing.sm)
    }
    
    private var controlBar: some View {
        HStack(spacing: HUSpacing.xxl) {
            // Microphone toggle
            controlButton(
                icon: videoService.localMedia?.isMicrophoneEnabled == true ? "mic.fill" : "mic.slash.fill",
                isActive: videoService.localMedia?.isMicrophoneEnabled == true,
                accessibilityLabel: videoService.localMedia?.isMicrophoneEnabled == true ? "Mute microphone" : "Unmute microphone"
            ) {
                Task { await videoService.toggleMicrophone() }
            }
            
            // Camera toggle
            controlButton(
                icon: videoService.localMedia?.isCameraEnabled == true ? "video.fill" : "video.slash.fill",
                isActive: videoService.localMedia?.isCameraEnabled == true,
                accessibilityLabel: videoService.localMedia?.isCameraEnabled == true ? "Turn off camera" : "Turn on camera"
            ) {
                Task { await videoService.toggleCamera() }
            }
            
            // Flip camera
            controlButton(
                icon: "camera.rotate.fill",
                isActive: true,
                accessibilityLabel: "Switch camera"
            ) {
                Task { await videoService.switchCamera() }
            }
            
            // End call
            Button {
                showEndCallAlert = true
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(.white)
                    .frame(width: 60, height: 60)
                    .background(Color.red)
                    .clipShape(Circle())
            }
            .accessibilityLabel("End call")
        }
        .padding(.bottom, HUSpacing.xxl)
    }
    
    // MARK: - Control Button
    
    private func controlButton(icon: String, isActive: Bool, accessibilityLabel: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(.white)
                .frame(width: 50, height: 50)
                .background(isActive ? .white.opacity(0.2) : .white.opacity(0.1))
                .clipShape(Circle())
                .overlay(
                    Circle()
                        .strokeBorder(.white.opacity(isActive ? 0.3 : 0.15), lineWidth: 1)
                )
        }
        .accessibilityLabel(accessibilityLabel)
    }
    
    // MARK: - Helpers
    
    private var statusColor: Color {
        switch videoService.callState {
        case .connected: return .green
        case .reconnecting: return .orange
        default: return .gray
        }
    }
    
    private var statusText: String {
        switch videoService.callState {
        case .connected: return "Connected"
        case .reconnecting: return "Reconnecting..."
        default: return "Connecting"
        }
    }
    
    private var qualityIcon: String {
        switch videoService.connectionQuality {
        case .excellent: return "wifi"
        case .good: return "wifi"
        case .poor: return "wifi.exclamationmark"
        case .lost: return "wifi.slash"
        }
    }
    
    private var qualityColor: Color {
        switch videoService.connectionQuality {
        case .excellent: return .green
        case .good: return .green
        case .poor: return .orange
        case .lost: return .red
        }
    }
    
    private var formattedTime: String {
        let hours = videoService.elapsedSeconds / 3600
        let minutes = (videoService.elapsedSeconds % 3600) / 60
        let seconds = videoService.elapsedSeconds % 60
        if hours > 0 {
            return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%02d:%02d", minutes, seconds)
    }
    
    private func scheduleControlsHide() {
        hideControlsTask?.cancel()
        hideControlsTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                controlsVisible = false
            }
        }
    }
}

// MARK: - Post-Session View (BL-02 + UE-02)

extension VideoCallView {
    var postSessionView: some View {
        VStack(spacing: HUSpacing.xxl) {
            Spacer()
            
            if sessionWasFailed {
                // BL-02: Technical failure detected
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 60))
                    .foregroundStyle(.orange)
                
                VStack(spacing: HUSpacing.sm) {
                    Text("Session Issue Detected")
                        .font(HUFont.title2())
                        .foregroundStyle(.white)
                    
                    Text("Your session was very short, which may indicate a technical problem. We've flagged this for review and support will follow up.")
                        .font(HUFont.body())
                        .foregroundStyle(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, HUSpacing.xl)
                }
                
                VStack(spacing: HUSpacing.sm) {
                    Text("Potential causes:")
                        .font(HUFont.caption(weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                    Text("Poor network connection • Audio/video permissions • Server disruption")
                        .font(HUFont.caption())
                        .foregroundStyle(.white.opacity(0.4))
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, HUSpacing.xl)
            } else {
                // UE-02: Successful session ended
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 60))
                    .foregroundStyle(.green)
                
                VStack(spacing: HUSpacing.sm) {
                    Text("Session Complete")
                        .font(HUFont.title2())
                        .foregroundStyle(.white)
                    
                    Text("We hope your session went well!")
                        .font(HUFont.body())
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
            
            Spacer()
            
            // UE-02: Re-booking prompt
            VStack(spacing: HUSpacing.md) {
                if !sessionWasFailed {
                    Text("Ready to book your next session?")
                        .font(HUFont.subheadline())
                        .foregroundStyle(.white.opacity(0.6))
                }
                
                Button {
                    shouldClearSessionOnDisappear = true
                    dismiss()
                } label: {
                    Text(sessionWasFailed ? "Contact Support" : "Done")
                        .font(HUFont.subheadline(weight: .semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, HUSpacing.md)
                        .background(.white)
                        .clipShape(Capsule())
                }
                .padding(.horizontal, HUSpacing.xxl)
                
                if sessionWasFailed {
                    Button {
                        shouldClearSessionOnDisappear = true
                        dismiss()
                    } label: {
                        Text("Close")
                            .font(HUFont.subheadline(weight: .semibold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .padding(.bottom, HUSpacing.xxl)
        }
    }
}

// MARK: - Session Recovery Banner (shown on app home when interrupted session detected)

struct SessionRecoveryBanner: View {
    let roomName: String
    let participantName: String
    let bookingId: String
    let onRejoin: () -> Void
    let onDismiss: () -> Void
    
    var body: some View {
        HStack(spacing: HUSpacing.md) {
            Image(systemName: "video.fill")
                .font(.system(size: 18))
                .foregroundStyle(HUColor.primary)
            
            VStack(alignment: .leading, spacing: 2) {
                Text("Interrupted Session")
                    .font(HUFont.body(weight: .semibold))
                    .foregroundStyle(HUColor.textPrimary)
                Text("It looks like your last session was interrupted. Would you like to rejoin?")
                    .font(HUFont.caption())
                    .foregroundStyle(HUColor.textSecondary)
            }
            
            Spacer()
        }
        .padding(HUSpacing.md)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        .overlay(alignment: .bottomTrailing) {
            HStack(spacing: HUSpacing.sm) {
                Button("Dismiss") {
                    onDismiss()
                }
                .font(HUFont.caption())
                .foregroundStyle(HUColor.textSecondary)
                
                Button("Rejoin") {
                    onRejoin()
                }
                .font(HUFont.caption(weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(HUColor.primary)
                .clipShape(Capsule())
            }
            .padding(HUSpacing.md)
        }
        .padding(.horizontal, HUSpacing.lg)
    }
}
