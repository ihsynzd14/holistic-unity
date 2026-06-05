import SwiftUI
import WebKit
import SafariServices

// MARK: - YouTube playback strategy
//
// Every YouTube path (Shorts modal + inline profile preview) now loads our
// own hosted player page — `app.holisticunity.app/embed/youtube?v=ID` — as a
// REAL `URLRequest` navigation.
//
// WHY: WKWebView's previous `loadHTMLString(html, baseURL:)` approach never
// sends a real HTTP `Referer`, so YouTube's player refused to embed and
// returned the error 150/152/153 family ("playback disabled here") even for
// videos whose owners DO allow embedding — which is exactly what users hit
// (Shorts + youtu.be links failing while Vimeo worked, since Vimeo never
// enforced this). Loading a genuinely-served same-origin page makes WKWebView
// send a real `Referer`, which YouTube accepts. See the web route at
// client-webapp `src/app/embed/youtube/route.ts`.
//
// FALLBACK: for the rare video whose owner genuinely disabled embedding, the
// hosted page's IFrame API fires `onError` and posts the code to the `ytError`
// message handler — we then open the original video in an in-app
// SFSafariViewController, where it always plays.

/// Parses YouTube video IDs out of the various URL shapes `video_intro_url`
/// can take. YouTube IDs are exactly 11 chars from `[A-Za-z0-9_-]`; anything
/// else is rejected (also our injection-safety gate before the ID reaches a
/// URL/JS context).
enum YouTubeID {
    static func extract(from url: URL) -> String? {
        let s = url.absoluteString
        // `watch?v=ID`
        if s.contains("youtube.com/watch") || s.contains("youtube-nocookie.com/watch"),
           let v = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "v" })?.value,
           isValid(v) {
            return v
        }
        // `shorts/ID`, `embed/ID`, `youtu.be/ID` — ID is the last path component.
        if s.contains("youtube.com/shorts/") || s.contains("youtube-nocookie.com/shorts/")
            || s.contains("youtube.com/embed/") || s.contains("youtube-nocookie.com/embed/")
            || s.contains("youtu.be/") {
            let id = url.lastPathComponent
            if isValid(id) { return id }
        }
        return nil
    }

    static func isValid(_ id: String) -> Bool {
        guard id.count == 11 else { return false }
        return id.unicodeScalars.allSatisfy {
            ($0 >= "A" && $0 <= "Z") || ($0 >= "a" && $0 <= "z") ||
            ($0 >= "0" && $0 <= "9") || $0 == "_" || $0 == "-"
        }
    }

    /// Canonical watch URL — what we hand to SFSafariViewController when an
    /// embed is blocked. Always plays (only *embedding* is restricted).
    static func watchURL(from url: URL) -> URL {
        guard let id = extract(from: url) else { return url }
        return URL(string: "https://www.youtube.com/watch?v=\(id)") ?? url
    }
}

// MARK: - YouTube Shorts In-App Player (full-screen modal)

struct YouTubeShortsPlayerView: View {
    /// Original watch/shorts URL from `video_intro_url`.
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var fallbackURL: URL?

    var body: some View {
        NavigationStack {
            Group {
                if let id = YouTubeID.extract(from: url),
                   let embedURL = AppConstants.Webapp.youTubeEmbedURL(videoID: id, autoplay: true) {
                    EmbedWebView(url: embedURL, onEmbedBlocked: {
                        fallbackURL = YouTubeID.watchURL(from: url)
                    })
                    .ignoresSafeArea(edges: .bottom)
                } else {
                    Color.black.ignoresSafeArea()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(item: $fallbackURL) { SafariView(url: $0) }
        }
    }
}

// MARK: - Inline Video Preview (profile tile)

/// Inline video embed shown on the therapist profile.
///
/// YouTube videos load the hosted player page (real `Referer` → no error
/// 15x). If that page reports embedding is blocked, we show a fallback card
/// whose button opens the original video in an in-app SFSafariViewController.
/// Vimeo / direct embeds keep the simple `URLRequest` load (they always
/// worked) and never trigger the fallback.
struct VideoThumbnailPreview: View {
    /// Embeddable URL — the hosted YouTube player page, or a Vimeo player URL.
    let embedURL: URL
    /// Original video URL — opened in SFSafariViewController when the embed
    /// is blocked.
    let originalURL: URL
    @State private var embedFailed = false
    @State private var showSafari = false

    var body: some View {
        ZStack {
            EmbedWebView(url: embedURL, onEmbedBlocked: { embedFailed = true })
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
                        showSafari = true
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
        .sheet(isPresented: $showSafari) {
            SafariView(url: YouTubeID.watchURL(from: originalURL))
        }
    }
}

// MARK: - Shared WebView

/// Loads an embeddable video URL via a real `URLRequest` navigation and
/// listens for the hosted YouTube page's `ytError` bridge message. Used by
/// both the Shorts modal and the inline preview, for YouTube and Vimeo alike
/// (Vimeo simply never posts `ytError`).
private struct EmbedWebView: UIViewRepresentable {
    let url: URL
    /// Fired when the hosted YouTube page reports embedding is blocked.
    var onEmbedBlocked: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onEmbedBlocked: onEmbedBlocked) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "ytError")
        config.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.backgroundColor = .clear
        webView.isOpaque = false
        // A Safari user-agent — the default WKWebView UA makes YouTube refuse
        // some embeds.
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Load once per URL — updateUIView runs on every parent state change
        // (e.g. when embedFailed flips), and reloading would restart playback.
        guard context.coordinator.loadedURL != url else { return }
        context.coordinator.loadedURL = url
        webView.load(URLRequest(url: url))
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // Break the WKUserContentController → handler strong reference so the
        // coordinator (and webView) can deallocate.
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "ytError")
        webView.stopLoading()
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let onEmbedBlocked: () -> Void
        var loadedURL: URL?
        init(onEmbedBlocked: @escaping () -> Void) { self.onEmbedBlocked = onEmbedBlocked }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "ytError" else { return }
            Task { @MainActor in self.onEmbedBlocked() }
        }
    }
}

// MARK: - In-app Safari

private struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
