import Foundation
import AVFoundation
import LiveKit
import Supabase
import Sentry
import os.log

/// Service for managing LiveKit video calls.
/// Handles room connection, token fetching, and provides observable state for the UI.
@MainActor
@Observable
final class VideoCallService {

    // MARK: - Connection State

    enum CallState: Equatable {
        case idle
        case connecting
        case connected
        case reconnecting
        case failed(String)

        var isActive: Bool {
            switch self {
            case .connecting, .connected, .reconnecting: return true
            default: return false
            }
        }
    }
    
    // MARK: - Connection Quality
    
    enum ConnectionQuality: String {
        case excellent = "Excellent"
        case good = "Good"
        case poor = "Poor"
        case lost = "Lost"
    }
    
    // MARK: - Pre-Call Check
    
    struct PreCallCheckResult {
        var cameraPermission: Bool = false
        var microphonePermission: Bool = false
        var networkConnected: Bool = false
        
        var allPassed: Bool {
            cameraPermission && microphonePermission && networkConnected
        }
    }

    // MARK: - Published State

    private(set) var callState: CallState = .idle
    private(set) var room: Room?
    private(set) var localMedia: LocalMedia?
    private(set) var remoteVideoTrack: VideoTrack?
    private(set) var remoteScreenShareTrack: VideoTrack?
    private(set) var localVideoTrack: (any VideoTrack)?
    private(set) var elapsedSeconds: Int = 0
    private(set) var connectionQuality: ConnectionQuality = .good
    private(set) var preCallCheck: PreCallCheckResult?
    
    /// Tracks actual connected seconds (for failed session detection BL-02)
    private(set) var actualConnectedSeconds: Int = 0
    
    /// Whether a ghost connection has been detected
    private(set) var ghostConnectionDetected: Bool = false
    
    /// Number of reconnection attempts made
    private(set) var reconnectAttempts: Int = 0

    // MARK: - Singleton

    static let shared = VideoCallService()
    private var timerTask: Task<Void, Never>?
    private var delegateHandler: RoomDelegateHandler?
    private var heartbeatTask: Task<Void, Never>?
    private var qualityMonitorTask: Task<Void, Never>?
    private var lastRemoteTrackReceivedTime: Date?
    private var hasSeenRemoteParticipant = false
    static let maxReconnectAttempts = 3
    private static let reconnectBaseDelay: TimeInterval = 2

    private init() {}

    // MARK: - Room Name Generation

    /// Generates a deterministic room name from a booking ID.
    func generateRoomName(for bookingId: String) -> String {
        LiveKitConfig.roomName(for: bookingId)
    }

    /// Returns true if the booking has a video room name set.
    func canJoin(booking: Booking) -> Bool {
        guard let roomId = booking.videoRoomId, !roomId.isEmpty else { return false }
        return booking.canJoinVideoCall
    }
    
    // MARK: - Pre-Call Checks (SR-02)
    
    /// Runs pre-session connectivity verification checks.
    func runPreCallChecks() async -> PreCallCheckResult {
        var result = PreCallCheckResult()
        
        // Camera permission
        let cameraStatus = AVCaptureDevice.authorizationStatus(for: .video)
        if cameraStatus == .authorized {
            result.cameraPermission = true
        } else if cameraStatus == .notDetermined {
            result.cameraPermission = await AVCaptureDevice.requestAccess(for: .video)
        }
        
        // Microphone permission
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        if micStatus == .authorized {
            result.microphonePermission = true
        } else if micStatus == .notDetermined {
            result.microphonePermission = await AVCaptureDevice.requestAccess(for: .audio)
        }
        
        // Network connectivity
        result.networkConnected = NetworkMonitor.shared.isConnected
        
        preCallCheck = result
        return result
    }

    // MARK: - Connect

    /// Connects to a LiveKit room for the given booking.
    /// Safe to call multiple times — rejects if already connecting/connected.
    func connect(roomName: String, participantName: String, bookingId: String = "") async {
        guard !callState.isActive else { return }

        callState = .connecting
        elapsedSeconds = 0
        actualConnectedSeconds = 0
        reconnectAttempts = 0
        ghostConnectionDetected = false
        hasSeenRemoteParticipant = false

        // SR-01: Persist session state before connecting
        UserDefaultsManager.shared.saveActiveSession(
            roomName: roomName,
            participantName: participantName,
            bookingId: bookingId
        )

        let lkRoom = Room()
        let handler = RoomDelegateHandler(service: self)
        self.delegateHandler = handler
        lkRoom.delegates.add(delegate: handler)

        do {
            // 1. Fetch token from Supabase Edge Function
            let token = try await fetchToken(roomName: roomName, participantName: participantName)

            // 2. Connect room
            try await lkRoom.connect(url: LiveKitConfig.websocketURL, token: token)

            // 3. Store references before enabling media (so disconnect can reach the room)
            self.room = lkRoom
            self.localMedia = LocalMedia(room: lkRoom)

            // 4. Enable camera and microphone
            try await lkRoom.localParticipant.setCamera(enabled: true)
            try await lkRoom.localParticipant.setMicrophone(enabled: true)

            // 5. Finalize
            self.callState = .connected
            self.lastRemoteTrackReceivedTime = Date()
            updateTracks()
            startTimer()
            startHeartbeat()
            startQualityMonitor()
        } catch {
            // Clean up the room if it was partially connected
            await lkRoom.disconnect()
            if self.room === lkRoom {
                self.room = nil
                self.localMedia = nil
            }
            self.delegateHandler = nil
            
            // Provide a user-friendly message for common failures
            let message: String
            let errorDesc = error.localizedDescription.lowercased()
            if errorDesc.contains("401") || errorDesc.contains("unauthorized") || errorDesc.contains("jwt") {
                message = "Authentication failed. Please close this screen and try again. If the problem persists, sign out and sign back in."
            } else if errorDesc.contains("expired") || errorDesc.contains("token") {
                message = "The session token has expired. Please close and rejoin. If you keep seeing this, sign out and sign back in."
            } else {
                message = error.localizedDescription
            }
            captureFailure(
                error,
                operation: "video_call_connect",
                roomName: roomName,
                bookingId: bookingId
            )
            callState = .failed(message)
        }
    }
    
    // MARK: - Reconnect with Backoff (SR-01)
    
    /// Attempts to reconnect with progressive backoff.
    func reconnectWithBackoff(roomName: String, participantName: String, bookingId: String = "") async {
        guard reconnectAttempts < Self.maxReconnectAttempts else {
            callState = .failed("Unable to reconnect after \(Self.maxReconnectAttempts) attempts. Please check your connection and try again.")
            return
        }
        
        reconnectAttempts += 1
        let delay = Self.reconnectBaseDelay * pow(2.0, Double(reconnectAttempts - 1))
        
        callState = .reconnecting
        
        try? await Task.sleep(for: .seconds(delay))
        guard callState == .reconnecting else { return }
        
        await disconnect(clearSession: false)
        await connect(roomName: roomName, participantName: participantName, bookingId: bookingId)
    }

    private static let logger = Logger(subsystem: AppConstants.appBundleId, category: "VideoCallService")

    // MARK: - Disconnect

    func disconnect(clearSession: Bool = true) async {
        guard callState != .idle else { return }

        Self.logger.info("Disconnecting from video call (clearSession: \(clearSession))")

        timerTask?.cancel()
        timerTask = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        qualityMonitorTask?.cancel()
        qualityMonitorTask = nil

        if let room {
            let roomState = room.connectionState
            await room.disconnect()
            Self.logger.info("Video call disconnected (was: \(String(describing: roomState)), session: \(self.elapsedSeconds)s)")
        }

        room = nil
        localMedia = nil
        delegateHandler = nil
        remoteVideoTrack = nil
        remoteScreenShareTrack = nil
        localVideoTrack = nil
        hasSeenRemoteParticipant = false
        ghostConnectionDetected = false
        lastRemoteTrackReceivedTime = nil
        callState = .idle
        elapsedSeconds = 0

        // Reset AVAudioSession to `.playback` / `.ambient` so other apps' audio
        // isn't stuck in .playAndRecord mode after the call ends. LiveKit
        // configures .playAndRecord during the call; without this reset
        // background music apps (Spotify, Apple Music) can misbehave.
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.ambient, mode: .default, options: [])
            try audioSession.setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            Self.logger.warning("Failed to reset AVAudioSession after disconnect: \(error.localizedDescription, privacy: .public)")
        }

        // SR-01: Clear persisted session state
        if clearSession {
            UserDefaultsManager.shared.clearActiveSession()
        }
    }

    // MARK: - Controls

    func toggleMicrophone() async {
        guard let localMedia else { return }
        await localMedia.toggleMicrophone()
    }

    func toggleCamera() async {
        guard let localMedia else { return }
        await localMedia.toggleCamera()
    }

    func switchCamera() async {
        guard let localMedia else { return }
        await localMedia.switchCamera()
    }

    // MARK: - Token Fetching

    private struct TokenRequest: Encodable {
        let roomName: String
        let participantName: String
    }

    private struct TokenResponse: Decodable {
        let token: String
    }

    private func fetchToken(roomName: String, participantName: String) async throws -> String {
        // Ensure we have a valid, non-expired session before calling the edge function.
        // The Supabase SDK auto-refreshes tokens, but if the refresh failed silently
        // (e.g. brief network blip), the cached token may be expired — causing a 401.
        _ = try await SupabaseConfig.client.auth.session
        
        do {
            let response: TokenResponse = try await SupabaseConfig.client.functions.invoke(
                "livekit-token",
                options: FunctionInvokeOptions(
                    body: TokenRequest(roomName: roomName, participantName: participantName)
                )
            )
            return response.token
        } catch {
            // If the first attempt fails (e.g. stale cached JWT), force a fresh session
            // refresh and retry once before giving up.
            let errorDesc = error.localizedDescription.lowercased()
            let isAuthError = errorDesc.contains("401") || errorDesc.contains("unauthorized") || errorDesc.contains("jwt")
            
            guard isAuthError else { throw error }
            
            Logger(subsystem: Bundle.main.bundleIdentifier ?? "HolisticUnity", category: "VideoCall").warning("Token fetch failed with auth error, retrying with refreshed session...")
            _ = try await SupabaseConfig.client.auth.refreshSession()
            
            let response: TokenResponse = try await SupabaseConfig.client.functions.invoke(
                "livekit-token",
                options: FunctionInvokeOptions(
                    body: TokenRequest(roomName: roomName, participantName: participantName)
                )
            )
            return response.token
        }
    }

    // MARK: - Track Management

    func updateTracks() {
        guard let room else { return }

        // Local video track
        localVideoTrack = localMedia?.cameraTrack

        // Remote video track — use first remote participant's camera + screen share
        if let remoteParticipant = room.remoteParticipants.values.first {
            hasSeenRemoteParticipant = true

            // Camera track
            let newTrack = remoteParticipant.firstCameraVideoTrack
            if newTrack != nil {
                lastRemoteTrackReceivedTime = Date()
                ghostConnectionDetected = false
            }
            remoteVideoTrack = newTrack

            // Screen share track — check all publications for screenShareVideo source
            let screenSharePub = remoteParticipant.trackPublications.values.first(where: {
                $0.source == .screenShareVideo && $0.track != nil
            })
            remoteScreenShareTrack = screenSharePub?.track as? VideoTrack
        } else {
            // No remote participants — clear tracks
            remoteVideoTrack = nil
            remoteScreenShareTrack = nil
            if !hasSeenRemoteParticipant {
                ghostConnectionDetected = false
            }
        }
    }

    // MARK: - Timer

    private func startTimer() {
        timerTask?.cancel()
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { break }
                self?.elapsedSeconds += 1
                if self?.callState == .connected {
                    self?.actualConnectedSeconds += 1
                }
            }
        }
    }
    
    // MARK: - Heartbeat / Ghost Connection Detection (SR-03)
    
    private func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                
                guard let self else { break }
                
                // Check if we have a remote participant but no recent track updates
                if let room = self.room,
                   !room.remoteParticipants.isEmpty,
                   let lastReceived = self.lastRemoteTrackReceivedTime {
                    let timeSinceLastTrack = Date().timeIntervalSince(lastReceived)
                    
                    // If no track updates for 15 seconds, flag ghost connection
                    if timeSinceLastTrack > 15 && self.callState == .connected {
                        self.ghostConnectionDetected = true
                    }
                }
                
                // Force a track update to check for new data
                self.updateTracks()
            }
        }
    }
    
    // MARK: - Connection Quality Monitoring (SR-01)
    
    private func startQualityMonitor() {
        qualityMonitorTask?.cancel()
        qualityMonitorTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { break }
                
                guard let self else { break }
                
                // Monitor network connectivity
                let isNetworkConnected = NetworkMonitor.shared.isConnected
                
                if !isNetworkConnected {
                    self.connectionQuality = .lost
                } else if self.callState == .reconnecting {
                    self.connectionQuality = .poor
                } else if self.ghostConnectionDetected {
                    self.connectionQuality = .poor
                } else {
                    // Check WiFi vs cellular
                    let connectionType = NetworkMonitor.shared.connectionType
                    self.connectionQuality = connectionType == .wifi ? .excellent : .good
                }
            }
        }
    }

    // MARK: - Delegate Callbacks

    func handleConnectionStateChange(_ state: ConnectionState) {
        switch state {
        case .connected:
            callState = .connected
            reconnectAttempts = 0
            ghostConnectionDetected = false
        case .reconnecting:
            callState = .reconnecting
        case .disconnected:
            if callState == .connected || callState == .reconnecting {
                transitionToFailed("Connection lost. You can try to rejoin the session.")
            }
        default:
            break
        }
    }

    func handleParticipantChange() {
        updateTracks()
        guard let room else { return }
        if hasSeenRemoteParticipant,
           room.remoteParticipants.isEmpty,
           callState == .connected || callState == .reconnecting {
            transitionToFailed("The other participant left the session. You can try to rejoin if the session is still active.")
        }
    }
    
    // MARK: - Failed Session Detection (BL-02)
    
    /// If the session lasted less than 2 minutes of actual connected time, it's likely a technical failure.
    var isLikelyFailedSession: Bool {
        actualConnectedSeconds > 0 && actualConnectedSeconds < 120
    }
    
    /// Flags a booking as a potential technical failure in Supabase.
    func flagSessionAsFailed(bookingId: String) async {
        guard !bookingId.isEmpty else { return }
        struct FailedFlag: Encodable {
            let technicalFailure: Bool
            let connectedSeconds: Int
            let updatedAt: String
            
            enum CodingKeys: String, CodingKey {
                case technicalFailure = "technical_failure"
                case connectedSeconds = "connected_seconds"
                case updatedAt = "updated_at"
            }
        }
        
        _ = try? await SupabaseConfig.client
            .from("bookings")
            .update(FailedFlag(
                technicalFailure: true,
                connectedSeconds: actualConnectedSeconds,
                updatedAt: ISO8601DateFormatter.shared.string(from: Date())
            ))
            .eq("id", value: bookingId)
            .execute()
    }
    
    // MARK: - Session Recovery Info
    
    /// Returns interrupted session info if one exists (for app relaunch recovery)
    static func interruptedSessionInfo() -> (roomName: String, participantName: String, bookingId: String)? {
        let manager = UserDefaultsManager.shared
        guard manager.hasInterruptedSession,
              let roomName = manager.activeSessionRoomName,
              let participantName = manager.activeSessionParticipantName,
              let bookingId = manager.activeSessionBookingId else {
            return nil
        }
        return (roomName, participantName, bookingId)
    }
    
    /// Clears any interrupted session data without reconnecting
    static func dismissInterruptedSession() {
        UserDefaultsManager.shared.clearActiveSession()
    }

    // MARK: - Failure Handling

    private func transitionToFailed(_ message: String) {
        timerTask?.cancel()
        timerTask = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        qualityMonitorTask?.cancel()
        qualityMonitorTask = nil
        callState = .failed(message)
        captureFailure(
            NSError(domain: "VideoCallService", code: 1, userInfo: [NSLocalizedDescriptionKey: message]),
            operation: "video_call_state_transition"
        )
    }

    private func captureFailure(_ error: Error, operation: String, roomName: String? = nil, bookingId: String? = nil) {
        SentrySDK.capture(error: error) { scope in
            scope.setTag(value: "video_call", key: "area")
            scope.setTag(value: operation, key: "operation")
            if let roomName, !roomName.isEmpty {
                scope.setContext(value: ["room_name": roomName], key: "livekit")
            }
            if let bookingId, !bookingId.isEmpty {
                scope.setContext(value: ["booking_id": bookingId], key: "booking")
            }
        }
    }
}

// MARK: - Room Delegate Handler

/// Separate class to conform to RoomDelegate (requires NSObject + @objc).
private final class RoomDelegateHandler: NSObject, RoomDelegate, @unchecked Sendable {
    private weak var service: VideoCallService?

    init(service: VideoCallService) {
        self.service = service
    }

    nonisolated func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) {
        Task { @MainActor [weak self] in
            self?.service?.handleConnectionStateChange(connectionState)
        }
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor [weak self] in
            self?.service?.handleParticipantChange()
        }
    }

    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor [weak self] in
            self?.service?.handleParticipantChange()
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor [weak self] in
            self?.service?.handleParticipantChange()
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor [weak self] in
            self?.service?.handleParticipantChange()
        }
    }

    nonisolated func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) {
        Task { @MainActor [weak self] in
            self?.service?.updateTracks()
        }
    }
}
