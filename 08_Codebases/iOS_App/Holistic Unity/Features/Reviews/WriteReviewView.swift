import SwiftUI

// MARK: - Write Review ViewModel

@Observable
@MainActor
final class WriteReviewViewModel {
    let therapist: TherapistProfile
    let booking: Booking
    
    var rating: Int = 0
    var reviewText: String = ""
    var isSubmitting = false
    var isSubmitted = false
    var errorMessage: String?
    
    init(therapist: TherapistProfile, booking: Booking) {
        self.therapist = therapist
        self.booking = booking
    }
    
    var canSubmit: Bool {
        rating > 0 && reviewText.trimmingCharacters(in: .whitespacesAndNewlines).count >= 10
    }
    
    func submit() {
        guard canSubmit else { return }
        isSubmitting = true
        
        Task {
            let review = Review(
                id: UUID().uuidString,
                bookingId: booking.id,
                clientId: booking.clientId,
                therapistId: booking.therapistId,
                clientName: "Me",
                rating: rating,
                text: reviewText.trimmingCharacters(in: .whitespacesAndNewlines),
                isFlagged: false,
                createdAt: Date()
            )
            
            do {
                try await DIContainer.shared.reviewRepository.submitReview(review)
                isSubmitting = false
                isSubmitted = true
            } catch let error as ReviewError {
                isSubmitting = false
                errorMessage = error.localizedDescription
            } catch {
                isSubmitting = false
                errorMessage = "Failed to submit review. Please try again."
            }
        }
    }
}

// MARK: - Write Review View

struct WriteReviewView: View {
    let therapist: TherapistProfile
    let booking: Booking
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: WriteReviewViewModel?
    
    var body: some View {
        NavigationStack {
            Group {
                if let viewModel {
                    if viewModel.isSubmitted {
                        successView
                    } else {
                        reviewForm(viewModel: viewModel)
                    }
                } else {
                    HULoadingView()
                }
            }
            .navigationTitle("Write a Review")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                if viewModel == nil {
                    viewModel = WriteReviewViewModel(therapist: therapist, booking: booking)
                }
            }
        }
    }
    
    // MARK: - Review Form
    
    private func reviewForm(viewModel: WriteReviewViewModel) -> some View {
        ScrollView {
            VStack(spacing: HUSpacing.xl) {
                // Therapist info
                therapistHeader(viewModel: viewModel)
                
                Divider()
                    .padding(.horizontal, HUSpacing.xl)
                
                // Rating
                ratingSection(viewModel: viewModel)
                
                // Review text
                reviewTextSection(viewModel: viewModel)
                
                // Guidelines
                guidelinesSection
                
                // Submit button
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.error)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, HUSpacing.xl)
                }
                
                HUButton(
                    "Submit Review",
                    style: .primary,
                    isLoading: viewModel.isSubmitting,
                    isDisabled: !viewModel.canSubmit
                ) {
                    viewModel.errorMessage = nil
                    viewModel.submit()
                }
                .padding(.horizontal, HUSpacing.xl)
            }
            .padding(.vertical, HUSpacing.xl)
        }
    }
    
    private func therapistHeader(viewModel: WriteReviewViewModel) -> some View {
        VStack(spacing: HUSpacing.md) {
            HUAvatar(url: viewModel.therapist.photoURL, name: viewModel.therapist.displayName, size: 64)
            
            Text("How was your session with \(viewModel.therapist.displayName)?")
                .font(HUFont.headline())
                .foregroundStyle(HUColor.textPrimary)
                .multilineTextAlignment(.center)
            
            Text(viewModel.booking.serviceName)
                .font(HUFont.caption())
                .foregroundStyle(HUColor.textSecondary)
        }
        .padding(.horizontal, HUSpacing.xl)
    }
    
    private func ratingSection(viewModel: WriteReviewViewModel) -> some View {
        VStack(spacing: HUSpacing.md) {
            Text("Your Rating")
                .font(HUFont.body(weight: .semibold))
                .foregroundStyle(HUColor.textPrimary)
            
            HStack(spacing: HUSpacing.md) {
                ForEach(1...5, id: \.self) { star in
                    Button {
                        HUHaptic.impact(.light)
                        withAnimation(.spring(response: 0.3)) {
                            viewModel.rating = star
                        }
                    } label: {
                        Image(systemName: star <= viewModel.rating ? "star.fill" : "star")
                            .font(.system(size: 36))
                            .foregroundStyle(star <= viewModel.rating ? .yellow : HUColor.textTertiary)
                            .symbolEffect(.bounce, value: viewModel.rating)
                    }
                }
            }
            
            if viewModel.rating > 0 {
                Text(ratingLabel(viewModel.rating))
                    .font(HUFont.caption(weight: .medium))
                    .foregroundStyle(HUColor.primary)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, HUSpacing.xl)
    }
    
    private func reviewTextSection(viewModel: WriteReviewViewModel) -> some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            Text("Your Review")
                .font(HUFont.body(weight: .semibold))
                .foregroundStyle(HUColor.textPrimary)
            
            TextEditor(text: Binding(
                get: { viewModel.reviewText },
                set: { viewModel.reviewText = $0 }
            ))
                .frame(minHeight: 120)
                .padding(HUSpacing.sm)
                .background(HUColor.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                .overlay(
                    RoundedRectangle(cornerRadius: HURadius.lg)
                        .stroke(HUColor.textTertiary.opacity(0.3), lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    if viewModel.reviewText.isEmpty {
                        Text("Share your experience... (minimum 10 characters)")
                            .font(HUFont.body())
                            .foregroundStyle(HUColor.textTertiary)
                            .padding(.horizontal, HUSpacing.md)
                            .padding(.vertical, HUSpacing.md)
                            .allowsHitTesting(false)
                    }
                }
            
            Text("\(viewModel.reviewText.count) / 500 characters")
                .font(.caption)
                .foregroundStyle(HUColor.textTertiary)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, HUSpacing.xl)
    }
    
    private var guidelinesSection: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            Text("Review Guidelines")
                .font(HUFont.caption(weight: .semibold))
                .foregroundStyle(HUColor.textSecondary)
            
            VStack(alignment: .leading, spacing: HUSpacing.xs) {
                guidelineRow("Be honest and constructive")
                guidelineRow("Focus on your experience")
                guidelineRow("Avoid personal attacks")
                guidelineRow("Don't share private health details")
            }
        }
        .padding(HUSpacing.lg)
        .background(HUColor.secondaryBackground.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        .padding(.horizontal, HUSpacing.xl)
    }
    
    private func guidelineRow(_ text: String) -> some View {
        HStack(spacing: HUSpacing.sm) {
            Image(systemName: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(HUColor.success)
            Text(text)
                .font(HUFont.caption())
                .foregroundStyle(HUColor.textSecondary)
        }
    }
    
    // MARK: - Success View
    
    private var successView: some View {
        ZStack {
            VStack(spacing: HUSpacing.xl) {
                Spacer()
                
                Image("success_review")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 140, height: 140)
                
                Text("Thank You!")
                    .font(HUFont.title2(weight: .bold))
                    .foregroundStyle(HUColor.textPrimary)
                
                Text("Your review has been submitted successfully. It helps other clients find the right therapist.")
                    .font(HUFont.body())
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HUSpacing.xxl)
                
                Spacer()
                
                HUButton("Done", style: .primary) {
                    dismiss()
                }
                .padding(.horizontal, HUSpacing.xl)
                .padding(.bottom, HUSpacing.xl)
            }
            
            ConfettiView()
        }
        .onAppear { HUHaptic.notification(.success) }
    }
    
    // MARK: - Helper
    
    private func ratingLabel(_ rating: Int) -> String {
        switch rating {
        case 1: return "Poor"
        case 2: return "Below Average"
        case 3: return "Average"
        case 4: return "Great"
        case 5: return "Excellent!"
        default: return ""
        }
    }
}
