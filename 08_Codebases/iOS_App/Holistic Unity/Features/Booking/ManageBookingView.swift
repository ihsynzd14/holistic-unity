import SwiftUI
import Supabase

// MARK: - Manage Booking View (Reschedule / Cancel)

struct ManageBookingView: View {
    let booking: Booking
    let therapist: TherapistProfile?
    var initialMode: ManageMode = .reschedule
    
    @Environment(\.dismiss) private var dismiss
    @State private var mode: ManageMode = .reschedule
    @State private var selectedDate: Date = Date()
    @State private var selectedTimeSlot: String?
    @State private var availableSlots: [TimeRange] = []
    @State private var isLoadingSlots = false
    @State private var cancellationReason = ""
    @State private var isProcessing = false
    @State private var errorMessage: String?
    @State private var showSuccessAlert = false
    @State private var successMessage = ""
    @State private var showCancelConfirmation = false
    
    enum ManageMode: String, CaseIterable {
        case reschedule = "Reschedule"
        case cancel = "Cancel"
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HUSpacing.xl) {
                    // Current booking info
                    currentBookingCard
                    
                    // Mode picker
                    Picker("Action", selection: $mode) {
                        ForEach(ManageMode.allCases, id: \.self) { m in
                            Text(m.rawValue).tag(m)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, HUSpacing.xl)
                    
                    // Content based on mode
                    switch mode {
                    case .reschedule:
                        rescheduleContent
                    case .cancel:
                        cancelContent
                    }
                }
                .padding(.vertical, HUSpacing.lg)
            }
            .background(HUColor.background)
            .navigationTitle(mode == .reschedule ? "Reschedule Session" : "Cancel Session")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .alert("Success", isPresented: $showSuccessAlert) {
                Button("OK") { dismiss() }
            } message: {
                Text(successMessage)
            }
            .alert("Error", isPresented: .init(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK") {}
            } message: {
                Text(errorMessage ?? "")
            }
            .confirmationDialog(
                "Are you sure you want to cancel?",
                isPresented: $showCancelConfirmation,
                titleVisibility: .visible
            ) {
                Button("Yes, Cancel Session", role: .destructive) {
                    Task { await performCancel() }
                }
                Button("No, Keep Session", role: .cancel) {}
            } message: {
                if isCreditBooking {
                    Text("Your session credit will be restored and available for rebooking.")
                } else if refundPercentage > 0 {
                    Text("You will receive a \(Int(refundPercentage * 100))% refund of \(currencySymbol)\(String(format: "%.2f", refundAmount)). The remaining \(currencySymbol)\(String(format: "%.2f", booking.price - refundAmount)) will not be refunded. This may take 5–10 business days.")
                } else {
                    Text("Your session is within \(therapist?.cancellationPolicy.refundCutoffHours ?? 24) hours, so no refund is available. This cannot be undone.")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .task {
                // Set the initial mode (reschedule or cancel)
                mode = initialMode
                // Initialize date from booking
                selectedDate = max(Calendar.current.startOfDay(for: Date().addingTimeInterval(86400)), Calendar.current.startOfDay(for: booking.scheduledAt))
                await loadAvailableSlots()
            }
            .onChange(of: selectedDate) {
                selectedTimeSlot = nil
                Task { await loadAvailableSlots() }
            }
        }
    }
    
    // MARK: - Current Booking Card
    
    private var currentBookingCard: some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            Text("Current Session")
                .font(HUFont.caption(weight: .semibold))
                .foregroundStyle(HUColor.textSecondary)
            
            HStack(spacing: HUSpacing.md) {
                if let therapist {
                    HUAvatar(url: therapist.photoURL, name: therapist.displayName, size: 44)
                }
                
                VStack(alignment: .leading, spacing: 3) {
                    Text(therapist?.displayName ?? "Therapist")
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    Text(booking.serviceName)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                    HStack(spacing: 4) {
                        Image(systemName: "calendar")
                            .font(.system(size: 11))
                        Text(booking.formattedDateTime)
                            .font(HUFont.caption())
                    }
                    .foregroundStyle(HUColor.primary)
                }
                
                Spacer()
                
                HUBadge(text: booking.status.displayName, style: .info)
            }
            .padding(HUSpacing.md)
            .background(HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
        }
        .padding(.horizontal, HUSpacing.xl)
    }
    
    // MARK: - Reschedule Content
    
    private var rescheduleContent: some View {
        VStack(alignment: .leading, spacing: HUSpacing.lg) {
            // Reschedule already pending banner
            if booking.status == .reschedulePending {
                HStack(spacing: HUSpacing.sm) {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Reschedule request pending")
                            .font(HUFont.caption(weight: .semibold))
                            .foregroundStyle(HUColor.textPrimary)
                        if let proposed = booking.formattedProposedDateTime {
                            Text("Proposed: \(proposed)")
                                .font(HUFont.caption())
                                .foregroundStyle(HUColor.textSecondary)
                        }
                        Text("Waiting for therapist approval")
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textTertiary)
                    }
                    Spacer()
                }
                .padding(HUSpacing.md)
                .background(Color.orange.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                .padding(.horizontal, HUSpacing.xl)
            }
            
            // Reschedule limit reached banner
            if booking.rescheduleCount >= AppConstants.Booking.maxRescheduleCount {
                HStack(spacing: HUSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(HUColor.error)
                    Text("Reschedule limit reached (\(AppConstants.Booking.maxRescheduleCount) reschedules)")
                        .font(HUFont.caption(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                }
                .padding(HUSpacing.md)
                .background(HUColor.error.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                .padding(.horizontal, HUSpacing.xl)
            }
            
            if !rescheduleDisabled {
                // Date picker
                VStack(alignment: .leading, spacing: HUSpacing.sm) {
                    Text("Select New Date")
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    
                    DatePicker(
                        "Date",
                        selection: $selectedDate,
                        in: Date().addingTimeInterval(86400)...,
                        displayedComponents: .date
                    )
                    .datePickerStyle(.graphical)
                    .tint(HUColor.primary)
                }
                .padding(.horizontal, HUSpacing.xl)
                
                // Time slots
                VStack(alignment: .leading, spacing: HUSpacing.sm) {
                    Text("Available Times")
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    
                    if isLoadingSlots {
                        HStack {
                            Spacer()
                            ProgressView()
                                .tint(HUColor.primary)
                            Text("Loading slots…")
                                .font(HUFont.caption())
                                .foregroundStyle(HUColor.textSecondary)
                            Spacer()
                        }
                        .padding(.vertical, HUSpacing.lg)
                    } else if availableSlots.isEmpty {
                        Text("No available slots for this date")
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textTertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, HUSpacing.lg)
                    } else {
                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ], spacing: HUSpacing.sm) {
                            ForEach(availableSlots) { slot in
                                Button {
                                    selectedTimeSlot = slot.start
                                } label: {
                                    Text(slot.start)
                                        .font(HUFont.caption(weight: .medium))
                                        .foregroundStyle(selectedTimeSlot == slot.start ? HUColor.textOnPrimary : HUColor.textPrimary)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 10)
                                        .background(selectedTimeSlot == slot.start ? HUColor.primary : HUColor.secondaryBackground)
                                        .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, HUSpacing.xl)
                
                // Reschedule button
                HUButton(
                    "Request Reschedule",
                    isLoading: isProcessing
                ) {
                    Task { await performReschedule() }
                }
                .disabled(selectedTimeSlot == nil || isProcessing)
                .padding(.horizontal, HUSpacing.xl)
                
                Text("Your therapist will review and approve the new time.")
                    .font(HUFont.caption())
                    .foregroundStyle(HUColor.textTertiary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, HUSpacing.xl)
            }
        }
    }
    
    private var rescheduleDisabled: Bool {
        booking.status == .reschedulePending || booking.rescheduleCount >= AppConstants.Booking.maxRescheduleCount
    }
    
    // MARK: - Cancel Content (Step 1: Inform the user)
    
    private var cancelContent: some View {
        VStack(alignment: .leading, spacing: HUSpacing.lg) {
            // Refund summary — the most important info first
            refundSummaryCard
            
            // Cancellation policy details
            if let therapist {
                VStack(alignment: .leading, spacing: HUSpacing.sm) {
                    HStack(spacing: HUSpacing.xs) {
                        Image(systemName: "doc.text")
                            .foregroundStyle(HUColor.textSecondary)
                        Text("Refund Policy: \(therapist.cancellationPolicy.displayName)")
                            .font(HUFont.caption(weight: .semibold))
                            .foregroundStyle(HUColor.textPrimary)
                    }
                    
                    Text(therapist.cancellationPolicy.description)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                }
                .padding(HUSpacing.md)
                .background(HUColor.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
            }
            
            // Reason
            VStack(alignment: .leading, spacing: HUSpacing.sm) {
                Text("Reason for cancellation (optional)")
                    .font(HUFont.body(weight: .semibold))
                    .foregroundStyle(HUColor.textPrimary)
                
                TextEditor(text: $cancellationReason)
                    .frame(minHeight: 100)
                    .padding(HUSpacing.sm)
                    .background(HUColor.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: HURadius.md))
                    .overlay(
                        RoundedRectangle(cornerRadius: HURadius.md)
                            .stroke(HUColor.divider, lineWidth: 1)
                    )
            }
            
            // Cancel button — triggers Step 2 (confirmation)
            Button {
                showCancelConfirmation = true
            } label: {
                HStack {
                    if isProcessing {
                        ProgressView()
                            .tint(.white)
                    }
                    Text("Cancel Session")
                        .font(HUFont.body(weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(HUColor.error)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
            }
            .disabled(isProcessing)
        }
        .padding(.horizontal, HUSpacing.xl)
    }
    
    // MARK: - Refund Summary
    
    private var refundPercentage: Double {
        let policy = therapist?.cancellationPolicy ?? .flexible
        let hoursUntilSession = booking.scheduledAt.timeIntervalSince(Date()) / 3600.0
        return policy.refundPercentage(hoursUntilSession: hoursUntilSession)
    }
    
    private var refundAmount: Double {
        booking.price * refundPercentage
    }
    
    private var currencySymbol: String {
        (therapist?.currency ?? .eur).symbol
    }
    
    private var refundSummaryCard: some View {
        VStack(alignment: .leading, spacing: HUSpacing.md) {
            // Header with icon
            HStack(spacing: HUSpacing.sm) {
                if isCreditBooking {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(HUColor.primary)
                    Text("Session credit will be restored")
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                } else {
                    Image(systemName: refundPercentage > 0 ? "exclamationmark.triangle.fill" : "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(refundPercentage > 0 ? HUColor.warning : HUColor.error)
                    Text(refundPercentage > 0 ? "You are eligible for a 50% refund" : "No refund available")
                        .font(HUFont.body(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                }
            }

            Divider()

            // Details
            VStack(alignment: .leading, spacing: HUSpacing.sm) {
                if isCreditBooking {
                    Text("This session was booked using a session credit. Cancelling will restore the credit so you can rebook anytime.")
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                } else if refundPercentage > 0 {
                    let cutoffHours = therapist?.cancellationPolicy.refundCutoffHours ?? 24
                    detailRow(label: "Session price", value: "\(currencySymbol)\(String(format: "%.2f", booking.price))", color: HUColor.textPrimary)
                    detailRow(label: "Refund (50%)", value: "\(currencySymbol)\(String(format: "%.2f", refundAmount))", color: HUColor.warning)

                    Text("Your session is more than \(cutoffHours) hours away, so you are eligible for a 50% refund.")
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                } else {
                    let cutoffHours = therapist?.cancellationPolicy.refundCutoffHours ?? 24
                    Text("Your session is within \(cutoffHours) hours, so no refund is available.")
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                }

                if !isCreditBooking && refundPercentage > 0 {
                    HStack(spacing: HUSpacing.xs) {
                        Image(systemName: "clock")
                            .font(.caption2)
                        Text("Refunds typically take 5–10 business days to appear on your payment method.")
                            .font(HUFont.caption())
                    }
                    .foregroundStyle(HUColor.textTertiary)
                    .padding(.top, 2)
                }
            }
        }
        .padding(HUSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: HURadius.lg)
                .fill(HUColor.secondaryBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: HURadius.lg)
                        .strokeBorder(
                            isCreditBooking ? HUColor.primary.opacity(0.3) :
                            refundPercentage > 0 ? HUColor.warning.opacity(0.3) : HUColor.error.opacity(0.3),
                            lineWidth: 1
                        )
                )
        )
    }
    
    private func detailRow(label: String, value: String, color: Color) -> some View {
        HStack {
            Text(label)
                .font(HUFont.caption())
                .foregroundStyle(HUColor.textSecondary)
            Spacer()
            Text(value)
                .font(HUFont.caption(weight: .semibold))
                .foregroundStyle(color)
        }
    }
    
    // MARK: - Actions
    
    private func loadAvailableSlots() async {
        isLoadingSlots = true
        do {
            availableSlots = try await DIContainer.shared.bookingRepository.getAvailableSlots(
                therapistId: booking.therapistId,
                date: selectedDate,
                serviceDuration: booking.duration
            )
        } catch {
            availableSlots = []
        }
        isLoadingSlots = false
    }
    
    private func performReschedule() async {
        guard let timeSlot = selectedTimeSlot else { return }
        
        if booking.rescheduleCount >= AppConstants.Booking.maxRescheduleCount {
            errorMessage = "This booking has reached the maximum number of reschedules (\(AppConstants.Booking.maxRescheduleCount))."
            return
        }
        
        // Parse the selected time into a full Date
        let timeParts = timeSlot.split(separator: ":")
        guard timeParts.count == 2,
              let hour = Int(timeParts[0]),
              let minute = Int(timeParts[1]) else {
            errorMessage = "Invalid time slot selected"
            return
        }
        
        guard let newDate = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: selectedDate) else {
            errorMessage = "Could not create date from selection"
            return
        }
        
        isProcessing = true
        do {
            try await DIContainer.shared.bookingRepository.requestReschedule(
                bookingId: booking.id,
                proposedDate: newDate
            )
            
            // Insert in-app notification for the therapist
            let notifDTO = NotificationDTO(
                id: UUID().uuidString,
                userId: booking.therapistId,
                type: NotificationType.rescheduleRequested.rawValue,
                title: "Reschedule Request",
                body: "A client wants to reschedule their \(booking.serviceName) to \(newDate.formatted(date: .abbreviated, time: .shortened)).",
                bookingId: booking.id,
                conversationId: nil,
                therapistId: booking.therapistId,
                clientId: booking.clientId,
                isRead: false,
                createdAt: ISO8601DateFormatter.shared.string(from: Date())
            )
            _ = try? await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .insert(notifDTO)
                .execute()
            
            successMessage = "Reschedule request sent! Your therapist will review and approve the new time."
            showSuccessAlert = true
        } catch {
            errorMessage = String(
                localized: "Failed to request reschedule: \(error.localizedDescription)",
                comment: "ManageBookingView - reschedule request submission failed"
            )
        }
        isProcessing = false
    }
    
    private var isCreditBooking: Bool {
        booking.packBookingId != nil && booking.price == 0
    }

    private func performCancel() async {
        isProcessing = true
        do {
            let reason = cancellationReason.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayReason = reason.isEmpty ? "Cancelled by client" : reason

            var refundSucceeded = false
            var creditRestored = false

            if isCreditBooking {
                // Credit booking — restore the session credit instead of a Stripe refund
                if let packBookingId = booking.packBookingId,
                   let credit = try await DIContainer.shared.sessionCreditRepository.getCredit(byPackBookingId: packBookingId) {
                    do {
                        _ = try await DIContainer.shared.sessionCreditRepository.restoreCredit(creditId: credit.id)
                        creditRestored = true
                    } catch {
                        errorMessage = String(
                            localized: "Could not restore your session credit: \(error.localizedDescription)",
                            comment: "ManageBookingView - cancel flow: failed to restore session credit on cancelled credit-booking"
                        )
                    }
                } else {
                    errorMessage = String(
                        localized: "Could not find the session credit for this booking.",
                        comment: "ManageBookingView - cancel flow: credit lookup returned no row for this packBookingId"
                    )
                }
            } else if refundPercentage > 0 {
                // Paid booking — attempt Stripe refund BEFORE cancelling the booking so the
                // transaction is still in "completed" status (required by the refund Edge Function).
                do {
                    if let transaction = try await DIContainer.shared.paymentRepository.getTransaction(bookingId: booking.id) {
                        try await DIContainer.shared.paymentRepository.requestRefund(
                            transactionId: transaction.id
                        )
                        refundSucceeded = true
                    } else {
                        errorMessage = String(
                            localized: "No completed payment was found for this booking, so no refund was requested.",
                            comment: "ManageBookingView - cancel flow: no completed Stripe transaction exists for this paid booking"
                        )
                    }
                } catch {
                    errorMessage = String(
                        localized: "Refund request failed: \(error.localizedDescription)",
                        comment: "ManageBookingView - cancel flow: Stripe refund edge function call failed"
                    )
                }
            }

            // Cancel the booking after refund/credit-restore attempt (or if no refund needed)
            try await DIContainer.shared.bookingRepository.cancelBooking(
                bookingId: booking.id,
                reason: displayReason
            )
            
            // Send in-app notification to the therapist
            let therapistNotif = NotificationDTO(
                id: UUID().uuidString,
                userId: booking.therapistId,
                type: NotificationType.bookingCancelled.rawValue,
                title: "Session Cancelled",
                body: "A client has cancelled their \(booking.serviceName) scheduled for \(booking.formattedDateTime).",
                bookingId: booking.id,
                conversationId: nil,
                therapistId: booking.therapistId,
                clientId: booking.clientId,
                isRead: false,
                createdAt: ISO8601DateFormatter.shared.string(from: Date())
            )
            _ = try? await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .insert(therapistNotif)
                .execute()
            
            // Send in-app notification to the client with refund/credit details
            let clientRefundBody: String
            let clientNotifTitle: String
            let clientNotifType: String
            if creditRestored {
                clientRefundBody = "Your \(booking.serviceName) has been cancelled. Your session credit has been restored and is available for rebooking."
                clientNotifTitle = "Credit Restored"
                clientNotifType = NotificationType.bookingCancelled.rawValue
            } else if refundSucceeded {
                clientRefundBody = "Your \(booking.serviceName) has been cancelled. A 50% refund of \(currencySymbol)\(String(format: "%.2f", refundAmount)) has been submitted. Please allow 5–10 business days for the funds to appear on your payment method."
                clientNotifTitle = "Refund Submitted"
                clientNotifType = NotificationType.refundIssued.rawValue
            } else if !isCreditBooking && refundPercentage > 0 {
                clientRefundBody = "Your \(booking.serviceName) has been cancelled. We were unable to process your refund automatically. Please contact support for assistance."
                clientNotifTitle = "Session Cancelled"
                clientNotifType = NotificationType.bookingCancelled.rawValue
            } else {
                clientRefundBody = "Your \(booking.serviceName) has been cancelled. As the session was within \(therapist?.cancellationPolicy.refundCutoffHours ?? 24) hours, no refund is available."
                clientNotifTitle = "Session Cancelled"
                clientNotifType = NotificationType.bookingCancelled.rawValue
            }

            let clientNotif = NotificationDTO(
                id: UUID().uuidString,
                userId: booking.clientId,
                type: clientNotifType,
                title: clientNotifTitle,
                body: clientRefundBody,
                bookingId: booking.id,
                conversationId: nil,
                therapistId: booking.therapistId,
                clientId: booking.clientId,
                isRead: false,
                createdAt: ISO8601DateFormatter.shared.string(from: Date())
            )
            _ = try? await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .insert(clientNotif)
                .execute()

            // Set user-facing success message
            if creditRestored {
                successMessage = "Session cancelled. Your session credit has been restored — you can use it to book another session anytime."
            } else if refundSucceeded {
                successMessage = "Session cancelled. A 50% refund of \(currencySymbol)\(String(format: "%.2f", refundAmount)) has been submitted — it will appear on your payment method within 5–10 business days."
            } else if !isCreditBooking && refundPercentage > 0 {
                successMessage = "Session cancelled, but the refund could not be processed automatically. Please contact support."
            } else {
                successMessage = "Session has been cancelled. As the session was within \(therapist?.cancellationPolicy.refundCutoffHours ?? 24) hours, no refund is available."
            }
            showSuccessAlert = true
        } catch {
            errorMessage = String(
                localized: "Failed to cancel: \(error.localizedDescription)",
                comment: "ManageBookingView - cancel flow: bookingRepository.cancelBooking threw"
            )
        }
        isProcessing = false
    }
}
