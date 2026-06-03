import SwiftUI
import WebKit

// MARK: - YouTube Shorts In-App Player
// Extracted from TherapistEditProfileView — used by TherapistProfileView (client browsing)

struct YouTubeShortsPlayerView: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            YouTubeShortsWebView(url: url)
                .ignoresSafeArea(edges: .bottom)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

private struct YouTubeShortsWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // SECURITY (audit 2026-05-18, F3): the YouTube Shorts video ID
        // comes from `video_intro_url` in the DB, which is therapist-
        // controlled. The previous code interpolated `lastPathComponent`
        // directly into an iframe `src` attribute inside a string-built
        // HTML document, with `baseURL = https://www.youtube.com`. A
        // therapist could craft a URL like
        //   https://youtube.com/shorts/abc%22%3E%3Cscript%3E...%3C/script%3E%3Cdiv%20a%3D%22
        // whose lastPathComponent decodes to
        //   abc"><script>...</script><div a="
        // — escaping the attribute and executing arbitrary JS in the
        // youtube.com origin context, every time any client opened
        // that therapist's profile. STORED XSS.
        //
        // Fix: hard-validate the ID against the YouTube ID format
        // (11 chars, [A-Za-z0-9_-]) before injecting. On mismatch,
        // load a blank page rather than risk injection. We also drop
        // `loadHTMLString` in favour of direct `load(URLRequest:)`,
        // which entirely removes the string-concatenation surface.
        let rawID = url.lastPathComponent
        guard isValidYouTubeID(rawID) else {
            webView.loadHTMLString("<html><body style='background:#000;color:#fff;font:14px sans-serif;display:flex;align-items:center;justify-content:center;height:100%'>Video non disponibile</body></html>", baseURL: nil)
            return
        }
        // SECURITY / PLAYBACK (2026-06-02, F7): A direct URLRequest to the
        // /embed/ URL gives the YouTube IFrame player no valid parent origin,
        // triggering embed-restriction error 150/153. Fix: render the
        // already-validated ID inside a minimal iframe document and supply
        // https://www.youtube.com as the baseURL. The ID has passed the
        // strict 11-char [A-Za-z0-9_-] gate above, so interpolating it into
        // the src attribute is injection-safe — this does NOT reintroduce F3.
        let html = """
        <!doctype html><html><head>\
        <meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1'>\
        <style>html,body{margin:0;background:#000;height:100%}iframe{border:0;width:100%;height:100%}</style>\
        </head><body>\
        <iframe src='https://www.youtube-nocookie.com/embed/\(rawID)?autoplay=1&playsinline=1&rel=0&modestbranding=1'\
                allow='autoplay; encrypted-media; picture-in-picture' allowfullscreen></iframe>\
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://www.youtube.com"))
    }

    /// Validates a YouTube video ID. YouTube IDs are always exactly
    /// 11 characters drawn from `[A-Za-z0-9_-]`. Anything outside
    /// that set is treated as an injection attempt.
    private func isValidYouTubeID(_ id: String) -> Bool {
        guard id.count == 11 else { return false }
        return id.unicodeScalars.allSatisfy { scalar in
            (scalar >= "A" && scalar <= "Z") ||
            (scalar >= "a" && scalar <= "z") ||
            (scalar >= "0" && scalar <= "9") ||
            scalar == "_" || scalar == "-"
        }
    }
}

// MARK: - Video Thumbnail Preview (WebView embed)

/// Inline video embed shown on the therapist profile.
///
/// F7·b (2026-06-03): YouTube error 150/153 means the video owner disabled
/// embedding — unfixable app-side for that video. For YouTube we now drive the
/// **IFrame Player API** so we can observe `onError` and replace the dead
/// player with a "Guarda su YouTube" fallback that opens the original URL
/// externally. The API also receives a valid `origin` (playerVars) and the
/// WebView a Safari user-agent — the two things the bare-iframe path lacked.
/// Vimeo / direct embeds keep the simple `URLRequest` load (they work today).
struct VideoThumbnailPreview: View {
    let embedURL: URL
    /// Original watch URL — opened in the YouTube app / Safari when the embed
    /// is blocked.
    let originalURL: URL
    @State private var embedFailed = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            WebEmbedView(embedURL: embedURL, onError: { embedFailed = true })
            if embedFailed {
                VStack(spacing: HUSpacing.sm) {
                    Image(systemName: "play.slash.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.white.opacity(0.9))
                    Text("Questo video non può essere riprodotto qui")
                        .font(HUFont.caption())
                        .foregroundStyle(.white.opacity(0.9))
                        .multilineTextAlignment(.center)
                    Button {
                        openURL(originalURL)
                    } label: {
                        Label("Guarda su YouTube", systemImage: "arrow.up.right.square")
                            .font(HUFont.subheadline(weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, HUSpacing.lg)
                            .padding(.vertical, HUSpacing.sm)
                            .background(Capsule().fill(.red))
                    }
                }
                .padding(HUSpacing.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
            }
        }
    }
}

private struct WebEmbedView: UIViewRepresentable {
    let embedURL: URL
    let onError: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onError: onError) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "ytError")
        config.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.backgroundColor = .clear
        webView.isOpaque = false
        // (a) Match YouTubeShortsWebView's Safari user-agent. The default
        // WKWebView UA makes YouTube refuse some embeds; this inline preview
        // was the only YouTube path missing it.
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Load once per URL — updateUIView runs on every parent state change
        // (e.g. when embedFailed flips), and reloading would restart playback.
        guard context.coordinator.loadedURL != embedURL else { return }
        context.coordinator.loadedURL = embedURL

        let host = embedURL.host ?? ""
        let isYouTube = host.contains("youtube.com") || host.contains("youtube-nocookie.com")
        guard isYouTube else {
            // Vimeo / other: direct load (unchanged — works today).
            webView.load(URLRequest(url: embedURL))
            return
        }

        // YouTube via IFrame Player API. The ID was validated upstream
        // (videoEmbedURL → isValidYouTubeID); re-validate before injecting into
        // a <script> context to keep it injection-safe.
        let videoId = embedURL.lastPathComponent
        guard isValidYouTubeID(videoId) else {
            DispatchQueue.main.async { self.onError() }
            return
        }
        // (b) origin is supplied via playerVars so the player has a legitimate
        // parent origin (matches baseURL below).
        let html = """
        <!doctype html><html><head>\
        <meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1'>\
        <style>html,body{margin:0;background:#000;height:100%}#player{width:100%;height:100%}</style>\
        </head><body>\
        <div id='player'></div>\
        <script src='https://www.youtube.com/iframe_api'></script>\
        <script>\
        var player;\
        function onYouTubeIframeAPIReady(){\
          player=new YT.Player('player',{\
            videoId:'\(videoId)',\
            playerVars:{playsinline:1,rel:0,modestbranding:1,origin:'https://www.youtube.com'},\
            events:{onError:function(e){\
              if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.ytError){\
                window.webkit.messageHandlers.ytError.postMessage(String(e.data));\
              }\
            }}\
          });\
        }\
        </script>\
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://www.youtube.com"))
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // Break the WKUserContentController → handler strong reference so the
        // coordinator (and webView) can deallocate.
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "ytError")
        webView.stopLoading()
    }

    /// YouTube IDs are exactly 11 chars from `[A-Za-z0-9_-]`.
    private func isValidYouTubeID(_ id: String) -> Bool {
        guard id.count == 11 else { return false }
        return id.unicodeScalars.allSatisfy {
            ($0 >= "A" && $0 <= "Z") || ($0 >= "a" && $0 <= "z") ||
            ($0 >= "0" && $0 <= "9") || $0 == "_" || $0 == "-"
        }
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let onError: () -> Void
        var loadedURL: URL?
        init(onError: @escaping () -> Void) { self.onError = onError }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "ytError" else { return }
            Task { @MainActor in self.onError() }
        }
    }
}
