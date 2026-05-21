import Foundation
import UIKit

/// Supabase Storage **image transformations** at the URL level.
///
/// Why this matters for performance:
/// We previously fed every `AsyncImage` the raw public storage URL,
/// which downloads the original upload — a 1–4 MB photo a therapist
/// took with their iPhone. That same blob was being rendered into a
/// 40pt avatar, a 56pt list card, AND a 140pt hero portrait. At 100×
/// users, this saturates Supabase Storage egress and lights up the
/// device's cellular data + battery.
///
/// Supabase Storage's image transform endpoint (`/render/image/...`)
/// resizes + re-encodes on the fly and caches at the Cloudflare edge
/// in front of the project. Adding `?width=W&quality=Q` to a public
/// URL turns a 4 MB original into a 6–20 KB JPEG/WebP that's served
/// from cache after the first request. The transform endpoint is
/// available on every Supabase project (Free included).
///
/// References: https://supabase.com/docs/guides/storage/serving/image-transformations
extension URL {

    /// Returns a thumbnail variant of the URL appropriate for an
    /// avatar / list cell. For non-Supabase-Storage URLs (Stream
    /// Chat avatars, gravatar, external CDNs) returns `self` so
    /// the caller can use the helper unconditionally.
    ///
    /// - parameter size: target size in **points**. The function
    ///   multiplies by the device's screen scale to request the
    ///   right number of physical pixels (3× on iPhone Retina).
    /// - parameter quality: JPEG quality 20–100. 70 is the sweet
    ///   spot for photos at small sizes — visually indistinguishable
    ///   from 100 but ~3× smaller payload.
    /// - parameter mode: cover (default — crop to fill) or contain.
    func supabaseThumbnail(
        size: CGFloat,
        quality: Int = 70,
        mode: ResizeMode = .cover
    ) -> URL {
        guard let host = self.host, host.contains(".supabase.co") else {
            return self
        }
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else {
            return self
        }
        let originalPath = components.path
        guard let publicRange = originalPath.range(of: "/storage/v1/object/public/") else {
            // Not a public-object URL (private signed URL etc.) — leave it alone.
            return self
        }
        // Pivot the path to the render-image endpoint.
        components.path = originalPath.replacingCharacters(
            in: publicRange,
            with: "/storage/v1/render/image/public/"
        )

        // Convert points → physical pixels using the current screen
        // scale, capped at 3× (no benefit beyond, even on 3× displays
        // when serving JPEG).
        let scale = max(1, min(3, Int(UIScreen.main.scale.rounded())))
        let px = Int(size) * scale

        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "width", value: "\(px)"))
        items.append(URLQueryItem(name: "height", value: "\(px)"))
        items.append(URLQueryItem(name: "resize", value: mode.rawValue))
        items.append(URLQueryItem(name: "quality", value: "\(max(20, min(100, quality)))"))
        components.queryItems = items

        return components.url ?? self
    }

    enum ResizeMode: String {
        case cover    // crop to fill (square avatars)
        case contain  // letterbox to fit (preserve aspect)
        case fill     // stretch (rarely what you want)
    }
}
