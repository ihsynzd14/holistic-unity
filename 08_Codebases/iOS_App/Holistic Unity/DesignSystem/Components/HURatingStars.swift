import SwiftUI

struct HURatingStars: View {
    let rating: Double
    var maxRating: Int = 5
    var size: CGFloat = HUSize.iconMd
    var interactive: Bool = false
    var onRatingChanged: ((Int) -> Void)? = nil
    
    var body: some View {
        HStack(spacing: HUSpacing.xxs) {
            ForEach(1...maxRating, id: \.self) { star in
                Image(systemName: starImageName(for: star))
                    .font(.system(size: size))
                    .foregroundStyle(starColor(for: star))
                    .onTapGesture {
                        if interactive {
                            onRatingChanged?(star)
                        }
                    }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(String(format: "%.1f", rating)) out of \(maxRating) stars")
        .accessibilityValue(interactive ? "Tap to change rating" : "")
        .accessibilityAdjustableAction { direction in
            guard interactive else { return }
            let currentRating = Int(rating.rounded())
            switch direction {
            case .increment:
                let newRating = min(currentRating + 1, maxRating)
                onRatingChanged?(newRating)
            case .decrement:
                let newRating = max(currentRating - 1, 1)
                onRatingChanged?(newRating)
            @unknown default:
                break
            }
        }
    }
    
    private func starImageName(for star: Int) -> String {
        let doubleStarValue = Double(star)
        if doubleStarValue <= rating {
            return "star.fill"
        } else if doubleStarValue - 0.5 <= rating {
            return "star.leadinghalf.filled"
        } else {
            return "star"
        }
    }
    
    private func starColor(for star: Int) -> Color {
        let doubleStarValue = Double(star)
        // Show filled color for full and half-filled stars
        if doubleStarValue - 0.5 <= rating {
            return HUColor.starFilled
        } else {
            return HUColor.starEmpty
        }
    }
}

// MARK: - Rating Display with Count

struct HURatingDisplay: View {
    let rating: Double
    let reviewCount: Int
    var size: CGFloat = HUSize.iconSm
    
    var body: some View {
        HStack(spacing: HUSpacing.xs) {
            HURatingStars(rating: rating, size: size)
            Text(String(format: "%.1f", rating))
                .font(HUFont.subheadline(weight: .semibold))
                .foregroundStyle(HUColor.textPrimary)
            Text("(\(reviewCount))")
                .font(HUFont.caption())
                .foregroundStyle(HUColor.textSecondary)
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        HURatingStars(rating: 4.5)
        HURatingStars(rating: 3.0, size: 28, interactive: true)
        HURatingDisplay(rating: 4.8, reviewCount: 127)
    }
}
