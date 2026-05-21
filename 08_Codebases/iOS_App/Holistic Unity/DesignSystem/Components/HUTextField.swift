import SwiftUI

struct HUTextField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var icon: String? = nil
    var isSecure: Bool = false
    var maxLength: Int? = nil
    var errorMessage: String? = nil
    var helperText: String? = nil
    
    #if canImport(UIKit)
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil
    /// Disables iOS autocorrect + suggestion bar. Critical for email
    /// fields — iOS used to mangle `support@holisticunity.app` into
    /// `support@holisticunity.app.app` by appending the suggested
    /// `.app` TLD twice. Default false to keep behaviour unchanged
    /// for non-email fields.
    var autocorrectionDisabled: Bool = false
    /// Capitalisation strategy. Email/username fields want `.never`;
    /// names want `.words`; default body text uses `.sentences`.
    var autocapitalization: TextInputAutocapitalization = .sentences
    #endif
    
    @FocusState private var isFocused: Bool
    @State private var isSecureVisible = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: HUSpacing.xs) {
            Text(label)
                .font(HUFont.subheadline(weight: .medium))
                .foregroundStyle(HUColor.textPrimary)
            
            HStack(spacing: HUSpacing.sm) {
                if let icon {
                    Image(systemName: icon)
                        .foregroundStyle(isFocused ? HUColor.primary : HUColor.textTertiary)
                        .frame(width: HUSize.iconLg)
                }
                
                Group {
                    if isSecure && !isSecureVisible {
                        SecureField(placeholder, text: $text)
                    } else {
                        let field = TextField(placeholder, text: $text)
                        #if canImport(UIKit)
                        field
                            .keyboardType(keyboardType)
                            .textContentType(textContentType)
                            .autocorrectionDisabled(autocorrectionDisabled)
                            .textInputAutocapitalization(autocapitalization)
                        #else
                        field
                        #endif
                    }
                }
                .focused($isFocused)
                .font(HUFont.body())
                .foregroundStyle(HUColor.textPrimary)
                
                if isSecure {
                    Button {
                        isSecureVisible.toggle()
                    } label: {
                        Image(systemName: isSecureVisible ? "eye.slash" : "eye")
                            .foregroundStyle(HUColor.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isSecureVisible ? "Hide password" : "Show password")
                }
                
                if let maxLength {
                    Text("\(text.count)/\(maxLength)")
                        .font(HUFont.caption())
                        .foregroundStyle(text.count > maxLength ? HUColor.error : HUColor.textTertiary)
                }
            }
            .padding(.horizontal, HUSpacing.lg)
            .padding(.vertical, HUSpacing.md)
            .background(HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: HURadius.lg)
                    .strokeBorder(
                        errorMessage != nil ? HUColor.error :
                            isFocused ? HUColor.primary : Color.clear,
                        lineWidth: 1.5
                    )
            }
            .onChange(of: text) { _, newValue in
                if let maxLength, newValue.count > maxLength {
                    text = String(newValue.prefix(maxLength))
                }
            }
            
            if let errorMessage {
                Text(errorMessage)
                    .font(HUFont.caption())
                    .foregroundStyle(HUColor.error)
            } else if let helperText {
                Text(helperText)
                    .font(HUFont.caption())
                    .foregroundStyle(HUColor.textTertiary)
            }
        }
    }
}

// MARK: - Multi-line Text Editor Variant

struct HUTextEditor: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var maxLength: Int? = nil
    var minHeight: CGFloat = 100
    
    var body: some View {
        VStack(alignment: .leading, spacing: HUSpacing.xs) {
            HStack {
                Text(label)
                    .font(HUFont.subheadline(weight: .medium))
                    .foregroundStyle(HUColor.textPrimary)
                Spacer()
                if let maxLength {
                    Text("\(text.count)/\(maxLength)")
                        .font(HUFont.caption())
                        .foregroundStyle(text.count > maxLength ? HUColor.error : HUColor.textTertiary)
                }
            }
            
            TextEditor(text: $text)
                .font(HUFont.body())
                .foregroundStyle(HUColor.textPrimary)
                .frame(minHeight: minHeight)
                .scrollContentBackground(.hidden)
                .padding(HUSpacing.sm)
                .background(HUColor.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(placeholder)
                            .font(HUFont.body())
                            .foregroundStyle(HUColor.textTertiary)
                            .padding(.horizontal, HUSpacing.md)
                            .padding(.vertical, HUSpacing.md)
                            .allowsHitTesting(false)
                    }
                }
                .onChange(of: text) { _, newValue in
                    if let maxLength, newValue.count > maxLength {
                        text = String(newValue.prefix(maxLength))
                    }
                }
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        HUTextField(label: "Email", text: .constant(""), placeholder: "you@example.com", icon: "envelope")
        HUTextField(label: "Password", text: .constant(""), placeholder: "Enter password", icon: "lock", isSecure: true)
        HUTextEditor(label: "Description", text: .constant(""), placeholder: "Tell us about yourself...", maxLength: 2000)
    }
    .padding()
}
