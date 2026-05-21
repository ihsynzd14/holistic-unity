import SwiftUI

struct HUAvatar: View {
    let url: URL?
    let name: String
    var size: CGFloat = HUSize.avatarMd
    var showOnlineIndicator: Bool = false
    var isOnline: Bool = false
    
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let url {
                // PERFORMANCE (audit 2026-05-18): request a Supabase
                // Storage thumbnail sized to the avatar (3× for
                // Retina). For Supabase URLs this drops payload from
                // 1–4 MB → 6–20 KB; for non-Supabase URLs the helper
                // returns the original URL unchanged. See
                // Core/Extensions/URL+SupabaseStorage.swift.
                AsyncImage(url: url.supabaseThumbnail(size: size)) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        initialsView
                    case .empty:
                        ProgressView()
                            .frame(width: size, height: size)
                    @unknown default:
                        initialsView
                    }
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
            } else {
                initialsView
            }
            
            if showOnlineIndicator {
                Circle()
                    .fill(isOnline ? HUColor.online : HUColor.offline)
                    .frame(width: size * 0.25, height: size * 0.25)
                    .overlay {
                        Circle()
                            .strokeBorder(HUColor.background, lineWidth: 2)
                    }
                    .accessibilityLabel(isOnline ? "Online" : "Offline")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name) avatar\(showOnlineIndicator ? (isOnline ? ", online" : ", offline") : "")")
    }
    
    private var initialsView: some View {
        Circle()
            .fill(
                LinearGradient(
                    colors: [HUColor.primaryLight, HUColor.primaryMuted.opacity(0.3)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: size, height: size)
            .overlay {
                Text(initials)
                    .font(.system(size: size * 0.36, weight: .semibold))
                    .foregroundStyle(HUColor.primaryDark)
            }
    }
    
    private var initials: String {
        let components = name.split(separator: " ")
        let first = components.first?.prefix(1) ?? ""
        let last = components.count > 1 ? components.last?.prefix(1) ?? "" : ""
        return "\(first)\(last)".uppercased()
    }
}

#Preview {
    HStack(spacing: 16) {
        HUAvatar(url: nil, name: "Jane Smith", size: 40)
        HUAvatar(url: nil, name: "John Doe", size: 64, showOnlineIndicator: true, isOnline: true)
        HUAvatar(url: nil, name: "Sarah", size: 100, showOnlineIndicator: true, isOnline: false)
    }
}
