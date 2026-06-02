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

struct VideoThumbnailPreview: UIViewRepresentable {
    let embedURL: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.backgroundColor = .clear
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // SECURITY / PLAYBACK (2026-06-02, F7): YouTube embeds loaded via a
        // direct URLRequest have no valid parent origin, triggering error 153.
        // For YouTube hosts only, render the validated ID inside an iframe
        // document with baseURL = https://www.youtube.com so the player
        // receives a legitimate origin. The ID has already been validated by
        // TherapistProfileView.videoEmbedURL (isValidYouTubeID gate) before
        // reaching this view, so interpolation is injection-safe.
        // Vimeo embeds are NOT affected — they work fine with a direct load
        // and must stay on that path to avoid regression.
        let host = embedURL.host ?? ""
        if host.contains("youtube.com") || host.contains("youtube-nocookie.com") {
            let html = """
            <!doctype html><html><head>\
            <meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1'>\
            <style>html,body{margin:0;background:#000;height:100%}iframe{border:0;width:100%;height:100%}</style>\
            </head><body>\
            <iframe src='\(embedURL.absoluteString)'\
                    allow='autoplay; encrypted-media; picture-in-picture' allowfullscreen></iframe>\
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: URL(string: "https://www.youtube.com"))
        } else {
            // Vimeo and any other host: direct load (unchanged from original).
            webView.load(URLRequest(url: embedURL))
        }
    }
}
