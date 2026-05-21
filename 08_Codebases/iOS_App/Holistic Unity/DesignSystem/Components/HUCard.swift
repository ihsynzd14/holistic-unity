import SwiftUI

struct HUCard<Content: View>: View {
    var padding: CGFloat = HUSpacing.lg
    @ViewBuilder let content: () -> Content
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(padding)
        .background(HUColor.background)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
        .huShadow(.sm)
    }
}

#Preview {
    HUCard {
        Text("Card Content")
            .font(HUFont.headline())
        Text("Some descriptive text here")
            .font(HUFont.body())
            .foregroundStyle(HUColor.textSecondary)
    }
    .padding()
}
