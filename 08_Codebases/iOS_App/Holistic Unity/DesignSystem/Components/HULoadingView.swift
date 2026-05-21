import SwiftUI

// MARK: - Shimmer Modifier

struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    
    func body(content: Content) -> some View {
        if reduceMotion {
            content
                .opacity(0.6)
        } else {
            content
                .overlay(
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: phase - 0.2),
                            .init(color: .white.opacity(0.4), location: phase),
                            .init(color: .clear, location: phase + 0.2)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .mask(content)
                )
                .onAppear {
                    withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                        phase = 1.2
                    }
                }
        }
    }
}

extension View {
    func shimmer() -> some View {
        modifier(ShimmerModifier())
    }
}

// MARK: - Skeleton Shapes

struct SkeletonRow: View {
    var body: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(HUColor.divider.opacity(0.5))
                .frame(width: 60, height: 60)
            
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(HUColor.divider.opacity(0.5))
                    .frame(width: 140, height: 14)
                
                RoundedRectangle(cornerRadius: 4)
                    .fill(HUColor.divider.opacity(0.3))
                    .frame(width: 200, height: 10)
                
                RoundedRectangle(cornerRadius: 4)
                    .fill(HUColor.divider.opacity(0.3))
                    .frame(width: 100, height: 10)
            }
            
            Spacer()
        }
        .padding(14)
        .background(HUColor.background)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        .shimmer()
    }
}

struct SkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RoundedRectangle(cornerRadius: 4)
                .fill(HUColor.divider.opacity(0.5))
                .frame(height: 16)
                .frame(maxWidth: 160)
            
            RoundedRectangle(cornerRadius: 4)
                .fill(HUColor.divider.opacity(0.3))
                .frame(height: 12)
            
            RoundedRectangle(cornerRadius: 4)
                .fill(HUColor.divider.opacity(0.3))
                .frame(height: 12)
                .frame(maxWidth: 200)
        }
        .padding(HUSpacing.lg)
        .background(HUColor.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        .shimmer()
    }
}

struct SkeletonList: View {
    var count: Int = 3
    
    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<count, id: \.self) { _ in
                SkeletonRow()
            }
        }
    }
}

// MARK: - Loading View

struct HULoadingView: View {
    var message: String? = nil
    
    var body: some View {
        VStack(spacing: HUSpacing.lg) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(HUColor.primary)
            if let message {
                Text(message)
                    .font(HUFont.subheadline())
                    .foregroundStyle(HUColor.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct HUEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    
    var body: some View {
        VStack(spacing: HUSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 56))
                .foregroundStyle(HUColor.textTertiary)
            
            VStack(spacing: HUSpacing.sm) {
                Text(title)
                    .font(HUFont.title3())
                    .foregroundStyle(HUColor.textPrimary)
                Text(message)
                    .font(HUFont.body())
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
            
            if let actionTitle, let action {
                HUButton(actionTitle, style: .secondary, action: action)
                    .frame(width: 200)
            }
        }
        .padding(HUSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct HUErrorView: View {
    let message: String
    var retryAction: (() -> Void)? = nil
    
    var body: some View {
        HUEmptyState(
            icon: "exclamationmark.triangle",
            title: "Something went wrong",
            message: message,
            actionTitle: retryAction != nil ? "Try Again" : nil,
            action: retryAction
        )
    }
}

#Preview {
    VStack {
        SkeletonList(count: 3)
            .padding()
        HUEmptyState(
            icon: "heart.slash",
            title: "No Favorites Yet",
            message: "Save therapists you love to find them here",
            actionTitle: "Explore",
            action: {}
        )
    }
}
