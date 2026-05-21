import SwiftUI
import Supabase
import AuthenticationServices
import CryptoKit
import GoogleSignIn

struct AuthView: View {
    let mode: WelcomeView.AuthMode
    
    @Environment(AuthManager.self) private var authManager
    
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showForgotPassword = false
    @State private var currentNonce: String?
    
    private var isSignUp: Bool { mode == .signUp }
    
    var body: some View {
        ScrollView {
            VStack(spacing: HUSpacing.xl) {
                // Header
                VStack(spacing: HUSpacing.sm) {
                    Image("AppLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .shadow(color: HUColor.cardShadow, radius: 4, y: 2)
                        .padding(.bottom, HUSpacing.sm)
                    
                    Text(isSignUp ? "Create Account" : "Welcome Back")
                        .font(HUFont.displayTitle(size: 32, weight: .bold))
                        .foregroundStyle(HUColor.textPrimary)

                    Text(isSignUp ? "Start your holistic wellness journey" : "Sign in to continue")
                        .font(HUFont.body())
                        .foregroundStyle(HUColor.textSecondary)
                }
                .padding(.top, HUSpacing.xl)
                
                // Social auth buttons
                VStack(spacing: HUSpacing.md) {
                    // Apple Sign-In
                    SignInWithAppleButton(.continue) { request in
                        guard let nonce = randomNonceString() else {
                            errorMessage = "Unable to generate a secure token. Please try again."
                            return
                        }
                        currentNonce = nonce
                        request.requestedScopes = [.fullName, .email]
                        request.nonce = sha256(nonce)
                    } onCompletion: { result in
                        handleAppleSignIn(result)
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 48)
                    .clipShape(Capsule())
                    
                    // Google Sign-In via native SDK
                    socialButton(icon: "g.circle.fill", title: "Continue with Google") {
                        signInWithGoogle()
                    }
                }
                
                // Divider
                HStack {
                    Rectangle()
                        .fill(HUColor.divider)
                        .frame(height: 1)
                    Text("or")
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textTertiary)
                    Rectangle()
                        .fill(HUColor.divider)
                        .frame(height: 1)
                }
                
                // Email form
                VStack(spacing: HUSpacing.lg) {
                    if isSignUp {
                        HUTextField(
                            label: "Full Name",
                            text: $displayName,
                            placeholder: "Your full name",
                            icon: "person"
                        )
                    }
                    
                    HUTextField(
                        label: "Email",
                        text: $email,
                        placeholder: "you@example.com",
                        icon: "envelope",
                        keyboardType: .emailAddress,
                        textContentType: .emailAddress,
                        autocorrectionDisabled: true,
                        autocapitalization: .never
                    )
                    
                    HUTextField(
                        label: "Password",
                        text: $password,
                        placeholder: isSignUp ? "Create a password" : "Enter your password",
                        icon: "lock",
                        isSecure: true
                    )
                    
                    if isSignUp {
                        PasswordStrengthView(password: password)
                    }
                    
                    if !isSignUp {
                        HStack {
                            Spacer()
                            Button("Forgot Password?") {
                                showForgotPassword = true
                            }
                            .font(HUFont.subheadline(weight: .medium))
                            .foregroundStyle(HUColor.primary)
                        }
                    }
                }
                
                // Error message
                if let errorMessage {
                    Text(errorMessage)
                        .font(HUFont.subheadline())
                        .foregroundStyle(HUColor.error)
                        .multilineTextAlignment(.center)
                }
                
                // Submit button
                HUButton(
                    isSignUp ? "Create Account" : "Sign In",
                    isLoading: isLoading,
                    isDisabled: !isFormValid
                ) {
                    performAuth()
                }
                
                Spacer()
            }
            .padding(.horizontal, HUSpacing.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(HUColor.background)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(isPresented: $showForgotPassword) {
            ForgotPasswordSheet(email: email)
        }
    }
    
    private var isFormValid: Bool {
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)
        let hasEmail = !trimmedEmail.isEmpty && isValidEmail(trimmedEmail)
        let hasPassword = password.count >= AppConstants.Validation.minPasswordLength
        let hasName = isSignUp ? !displayName.trimmingCharacters(in: .whitespaces).isEmpty : true
        return hasEmail && hasPassword && hasName
    }
    
    private func isValidEmail(_ email: String) -> Bool {
        let pattern = #"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"#
        return email.range(of: pattern, options: .regularExpression) != nil
    }
    
    private func performAuth() {
        isLoading = true
        errorMessage = nil
        
        Task {
            do {
                if isSignUp {
                    try await authManager.signUp(email: email, password: password, displayName: displayName)
                } else {
                    try await authManager.signIn(email: email, password: password)
                }
            } catch let error as AuthError {
                errorMessage = error.localizedDescription
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
    
    // MARK: - Apple Sign-In
    
    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let appleCredential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                errorMessage = "Apple Sign-In failed: unexpected credential type"
                return
            }
            guard let identityToken = appleCredential.identityToken,
                  let idTokenString = String(data: identityToken, encoding: .utf8) else {
                errorMessage = "Apple Sign-In failed: missing identity token"
                return
            }
            guard let nonce = currentNonce else {
                errorMessage = "Apple Sign-In failed: missing nonce. Please try again."
                return
            }
            
            isLoading = true
            errorMessage = nil
            Task {
                do {
                    try await authManager.signInWithApple(idToken: idTokenString, nonce: nonce)
                } catch {
                    errorMessage = "Apple Sign-In error: \(error.localizedDescription)"
                }
                isLoading = false
            }
            
        case .failure(let error):
            // User cancelled is not an error to show
            let nsError = error as NSError
            if nsError.code != ASAuthorizationError.canceled.rawValue {
                errorMessage = "Apple Sign-In failed: \(error.localizedDescription)"
            }
        }
    }
    
    // MARK: - Google Sign-In (Native SDK)

    private func signInWithGoogle() {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootViewController = windowScene.windows.first?.rootViewController else {
            errorMessage = "Unable to present Google Sign-In"
            return
        }

        isLoading = true
        errorMessage = nil

        GIDSignIn.sharedInstance.signIn(withPresenting: rootViewController) { result, error in
            Task { @MainActor in
                defer { isLoading = false }

                if let error {
                    // Don't show error if user simply cancelled
                    let nsError = error as NSError
                    if nsError.code == GIDSignInError.canceled.rawValue { return }
                    errorMessage = "Google Sign-In failed: \(error.localizedDescription)"
                    return
                }

                guard let googleUser = result?.user,
                      let idToken = googleUser.idToken?.tokenString else {
                    errorMessage = "Google Sign-In failed: missing token"
                    return
                }

                let accessToken = googleUser.accessToken.tokenString

                do {
                    try await authManager.signInWithGoogle(idToken: idToken, accessToken: accessToken)
                } catch {
                    errorMessage = "Google Sign-In error: \(error.localizedDescription)"
                }
            }
        }
    }
    
    // MARK: - Nonce Helpers
    
    private func randomNonceString(length: Int = 32) -> String? {
        guard length > 0 else { return nil }
        var randomBytes = [UInt8](repeating: 0, count: length)
        let errorCode = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
        guard errorCode == errSecSuccess else {
            return nil
        }
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        return String(randomBytes.map { charset[Int($0) % charset.count] })
    }
    
    private func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.compactMap { String(format: "%02x", $0) }.joined()
    }
    
    // MARK: - Social Button
    
    private func socialButton(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                Text(title)
                    .font(.system(size: 15, weight: .medium))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .foregroundStyle(HUColor.textPrimary)
            .background(HUColor.secondaryBackground)
            .clipShape(Capsule())
            .overlay {
                Capsule()
                    .strokeBorder(HUColor.divider, lineWidth: 1)
            }
        }
    }
}

// MARK: - Forgot Password Sheet

struct ForgotPasswordSheet: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss
    @State var email: String
    @State private var isSending = false
    @State private var isSent = false
    @State private var errorMessage: String?
    
    var body: some View {
        NavigationStack {
            VStack(spacing: HUSpacing.xl) {
                Image(systemName: isSent ? "checkmark.circle.fill" : "envelope.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(isSent ? HUColor.success : HUColor.primary)
                    .symbolEffect(.bounce, value: isSent)
                
                Text(isSent ? "Check Your Email" : "Reset Password")
                    .font(HUFont.title2(weight: .bold))
                    .foregroundStyle(HUColor.textPrimary)
                
                Text(isSent
                     ? "We've sent a password reset link to \(email)"
                     : "Enter your email address and we'll send you a link to reset your password.")
                    .font(HUFont.body())
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HUSpacing.xl)
                
                if !isSent {
                    HUTextField(
                        label: "Email",
                        text: $email,
                        placeholder: "you@example.com",
                        icon: "envelope",
                        keyboardType: .emailAddress,
                        textContentType: .emailAddress,
                        autocorrectionDisabled: true,
                        autocapitalization: .never
                    )
                    .padding(.horizontal, HUSpacing.xl)
                    
                    if let errorMessage {
                        Text(errorMessage)
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.error)
                    }
                    
                    HUButton("Send Reset Link", isLoading: isSending, isDisabled: email.trimmingCharacters(in: .whitespaces).isEmpty) {
                        isSending = true
                        errorMessage = nil
                        Task {
                            do {
                                try await authManager.sendPasswordReset(email: email)
                                HUHaptic.notification(.success)
                                isSent = true
                            } catch {
                                errorMessage = error.localizedDescription
                                HUHaptic.notification(.error)
                            }
                            isSending = false
                        }
                    }
                    .padding(.horizontal, HUSpacing.xl)
                } else {
                    HUButton("Done") {
                        dismiss()
                    }
                    .padding(.horizontal, HUSpacing.xl)
                }
                
                Spacer()
            }
            .padding(.top, HUSpacing.xxl)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

#Preview("Sign Up") {
    NavigationStack {
        AuthView(mode: .signUp)
            .environment(AuthManager(authRepository: MockAuthRepository()))
    }
}

#Preview("Sign In") {
    NavigationStack {
        AuthView(mode: .signIn)
            .environment(AuthManager(authRepository: MockAuthRepository()))
    }
}
