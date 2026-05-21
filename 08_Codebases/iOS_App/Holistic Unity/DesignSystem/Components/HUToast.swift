import SwiftUI

enum ToastType {
    case success
    case error
    case info
    case warning
    
    var icon: String {
        switch self {
        case .success: return "checkmark.circle.fill"
        case .error: return "xmark.circle.fill"
        case .info: return "info.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        }
    }
    
    var color: Color {
        switch self {
        case .success: return HUColor.success
        case .error: return HUColor.error
        case .info: return HUColor.info
        case .warning: return HUColor.warning
        }
    }
}

struct ToastMessage: Equatable {
    let id = UUID()
    let type: ToastType
    let message: String
    
    static func == (lhs: ToastMessage, rhs: ToastMessage) -> Bool {
        lhs.id == rhs.id
    }
}

struct HUToast: View {
    let toast: ToastMessage
    
    var body: some View {
        HStack(spacing: HUSpacing.md) {
            Image(systemName: toast.type.icon)
                .foregroundStyle(toast.type.color)
                .font(.system(size: HUSize.iconLg))
            
            Text(toast.message)
                .font(HUFont.subheadline())
                .foregroundStyle(HUColor.textPrimary)
                .lineLimit(2)
            
            Spacer()
        }
        .padding(HUSpacing.lg)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        .huShadow(.lg)
        .padding(.horizontal, HUSpacing.lg)
    }
}

// MARK: - Toast Modifier

struct ToastModifier: ViewModifier {
    @Binding var toast: ToastMessage?
    var onDismiss: (() -> Void)?
    @State private var dragOffset: CGFloat = 0
    @State private var dismissWorkItem: DispatchWorkItem?
    
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast {
                    HUToast(toast: toast)
                        .offset(y: dragOffset)
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    if value.translation.height < 0 {
                                        dragOffset = value.translation.height
                                    }
                                }
                                .onEnded { value in
                                    if value.translation.height < -30 {
                                        dismissWorkItem?.cancel()
                                        withAnimation(HUAnimation.standard) {
                                            self.toast = nil
                                        }
                                    }
                                    dragOffset = 0
                                }
                        )
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .onAppear {
                            scheduleDismiss(for: toast.id)
                        }
                        .accessibilityAddTraits(.updatesFrequently)
                        .padding(.top, HUSpacing.sm)
                }
            }
            .animation(HUAnimation.spring, value: toast)
            .onChange(of: toast) { oldToast, newToast in
                // Cancel previous timer when toast changes
                dismissWorkItem?.cancel()
                if let newToast {
                    scheduleDismiss(for: newToast.id)
                } else if oldToast != nil {
                    // Toast was dismissed — notify caller to show next queued toast
                    onDismiss?()
                }
            }
    }
    
    private func scheduleDismiss(for toastId: UUID) {
        dismissWorkItem?.cancel()
        let item = DispatchWorkItem { [toastId] in
            // Only dismiss if the toast hasn't been replaced
            if self.toast?.id == toastId {
                withAnimation(HUAnimation.standard) {
                    self.toast = nil
                }
            }
        }
        dismissWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: item)
    }
}

extension View {
    func toast(_ toast: Binding<ToastMessage?>, onDismiss: (() -> Void)? = nil) -> some View {
        modifier(ToastModifier(toast: toast, onDismiss: onDismiss))
    }
}

#Preview {
    VStack {
        HUToast(toast: ToastMessage(type: .success, message: "Booking confirmed!"))
        HUToast(toast: ToastMessage(type: .error, message: "Payment failed. Please try again."))
    }
    .padding()
}
