import SwiftUI
import EventKit
import Observation
import StripePaymentSheet
import Supabase
import os.log

private let bookingFlowLogger = Logger(subsystem: AppConstants.appBundleId, category: "BookingFlow")

/// Describes how the client wants to book a session.
enum PurchaseOption: Equatable {
    case single
    case pack
    case useCredit(SessionCredit)
}

@MainActor
@Observable
final class BookingFlowViewModel {
    var currentStep = 0
    let totalSteps = 3
    
    // Step 1: Service
    var selectedService: TherapistService?
    
    // Purchase option — set after service selection
    var purchaseOption: PurchaseOption = .single
    /// Active credit found for this client × therapist × service (if any)
    var availableCredit: SessionCredit?
    var isCheckingCredits = false

    // Step 2: Date & Time — minimum is tomorrow (1-day buffer)
    var selectedDate: Date = {
        let cal = Calendar.current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        return cal.startOfDay(for: tomorrow)
    }()
    var selectedTimeSlot: String?

    // (SessionFormat removed V1 — platform is virtual-only)

    var isProcessing = false
    var isComplete = false
    var promoCode = ""
    var promoDiscount: Double = 0
    var promoMessage: String?
    var isValidatingPromo = false
    var errorMessage: String?
    
    // Payment
    var paymentSheet: PaymentSheet?
    var isPreparingPayment = false
    var pendingPaymentIntentId: String?
    var feeBreakdown: FeeBreakdown?
    
    let therapist: TherapistProfile
    var currentUserId: String
    
    init(therapist: TherapistProfile, currentUserId: String, preselectedService: TherapistService? = nil) {
        self.therapist = therapist
        self.currentUserId = currentUserId
        // Land directly on "Choose Date & Time" (step 1) when the service is
        // already determined: either the user tapped "Book" on a specific
        // service, OR the therapist offers exactly one service (the
        // "Choose a Service" step would just show a single pointless option —
        // this was the F7·a bug where entry points labelled for the calendar
        // dumped the user on service selection). With 2+ services the service
        // step is still required: the calendar is service-specific (slots
        // depend on the chosen service's duration).
        let resolvedService = preselectedService
            ?? (therapist.services.count == 1 ? therapist.services.first : nil)
        if let resolvedService {
            self.selectedService = resolvedService
            self.currentStep = 1
            Task { @MainActor in
                await self.checkForExistingCredits()
                await self.refreshAvailableSlots()
            }
        }
    }
    
    var progress: Double {
        Double(currentStep) / Double(totalSteps - 1)
    }
    
    var canAdvance: Bool {
        switch currentStep {
        case 0: return selectedService != nil
        case 1: return selectedTimeSlot != nil
        case 2: return true
        default: return false
        }
    }
    
    func advance() {
        guard currentStep < totalSteps - 1 else { return }
        let nextStep = currentStep + 1
        withAnimation(HUAnimation.standard) { currentStep = nextStep }
        if nextStep == 1 {
            Task {
                await checkForExistingCredits()
                await refreshAvailableSlots()
            }
        }
        if nextStep == 2 {
            if case .useCredit = purchaseOption {
                // No payment needed for credit bookings
            } else {
                Task { await preparePaymentSheet() }
            }
        }
    }
    
    func goBack() {
        guard currentStep > 0 else { return }
        withAnimation(HUAnimation.standard) { currentStep -= 1 }
    }
    
    // Available time slots for the selected date (filters out already-booked slots)
    var availableSlots: [String] {
        fetchedSlots.map { $0.start }
    }
    
    var fetchedSlots: [TimeRange] = []
    var isLoadingSlots = false
    
    func refreshAvailableSlots() async {
        guard let service = selectedService else {
            fetchedSlots = []
            return
        }
        isLoadingSlots = true
        do {
            fetchedSlots = try await DIContainer.shared.bookingRepository.getAvailableSlots(
                therapistId: therapist.id,
                date: selectedDate,
                serviceDuration: service.duration
            )
        } catch {
            // Do NOT fallback to local computation — it doesn't check Google Calendar
            // and would show slots that overlap with the therapist's existing appointments.
            fetchedSlots = []
            errorMessage = String(localized: "Could not load available times. Please check your connection and try again.", comment: "Booking error when slot fetch fails")
        }
        isLoadingSlots = false
    }
    
    private func localAvailableSlots(for service: TherapistService) -> [TimeRange] {
        let ranges = therapist.availability.availableRanges(for: selectedDate)
        var slots: [TimeRange] = []
        let duration = service.duration
        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current
        let now = Date()
        
        for range in ranges {
            let parts = range.start.split(separator: ":")
            guard parts.count == 2, let startHour = Int(parts[0]), let startMin = Int(parts[1]) else { continue }
            let endParts = range.end.split(separator: ":")
            guard endParts.count == 2, let endHour = Int(endParts[0]), let endMin = Int(endParts[1]) else { continue }
            
            var currentMinutes = startHour * 60 + startMin
            let endMinutes = endHour * 60 + endMin
            
            while currentMinutes + duration <= endMinutes {
                let hour = currentMinutes / 60
                let minute = currentMinutes % 60
                let startTime = String(format: "%02d:%02d", hour, minute)
                let slotEnd = currentMinutes + duration
                let endTime = String(format: "%02d:%02d", slotEnd / 60, slotEnd % 60)
                // Skip slots in the past
                if let slotDate = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: selectedDate),
                   slotDate > now {
                    slots.append(TimeRange(start: startTime, end: endTime))
                }
                currentMinutes += duration
            }
        }
        return slots
    }
    
    func validatePromoCode() async {
        let code = promoCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !code.isEmpty else { return }
        
        isValidatingPromo = true
        promoMessage = nil
        promoDiscount = 0
        
        do {
            // Validate server-side via Edge Function — codes are never exposed in the client binary
            struct PromoRequest: Encodable { let code: String }
            struct PromoResponse: Decodable { let valid: Bool; let discount: Double?; let message: String }
            let response: PromoResponse = try await SupabaseConfig.client.functions.invoke(
                "validate-promo",
                options: FunctionInvokeOptions(body: PromoRequest(code: code))
            )
            if response.valid, let discount = response.discount {
                promoDiscount = discount
                promoMessage = response.message
            } else {
                promoDiscount = 0
                promoMessage = response.message
            }
        } catch {
            promoDiscount = 0
            promoMessage = "Could not validate promo code. Please try again."
        }
        isValidatingPromo = false
    }
    
    /// The effective base price for the selected purchase option.
    /// - `.useCredit`: free (credit already paid for)
    /// - `.pack`: packPrice × packSize
    /// - `.single`: price
    var effectiveBasePrice: Double {
        guard let service = selectedService else { return 0 }
        switch purchaseOption {
        case .useCredit:
            return 0
        case .pack:
            if let packSize = service.packSize {
                let pricePerSession = service.packPrice ?? service.price
                return pricePerSession * Double(packSize)
            }
            return service.price
        case .single:
            return service.price
        }
    }

    var discountedTotal: Double? {
        guard promoDiscount > 0 else { return nil }
        return effectiveBasePrice * (1 - promoDiscount)
    }

    /// Whether this booking requires payment (non-zero price and not a free intro call)
    var requiresPayment: Bool {
        guard let service = selectedService else { return false }
        if case .useCredit = purchaseOption { return false }
        return effectiveBasePrice > 0 && !service.isIntroCall
    }
    
    /// Checks if the client has an existing credit for the selected service with this therapist.
    /// Called automatically when advancing from step 0 to step 1.
    func checkForExistingCredits() async {
        guard let service = selectedService, service.packSize != nil else {
            availableCredit = nil
            // If not a pack service, default to single
            purchaseOption = .single
            return
        }
        guard !currentUserId.isEmpty else {
            // Pack service selected but no user — default to pack purchase
            purchaseOption = .pack
            return
        }

        isCheckingCredits = true
        do {
            let credits = try await DIContainer.shared.sessionCreditRepository.getActiveCredits(
                clientId: currentUserId,
                therapistId: therapist.id
            )
            // Find a credit for this specific service (FIFO — oldest first)
            availableCredit = credits.first { $0.serviceId == service.id }
        } catch {
            availableCredit = nil
        }

        // If the user has credits for this service, default to using them;
        // otherwise this is a new pack purchase.
        if let credit = availableCredit {
            purchaseOption = .useCredit(credit)
        } else {
            purchaseOption = .pack
        }

        isCheckingCredits = false
    }

    /// Creates a free booking that consumes one session credit.
    /// C1: Uses a single atomic DB RPC — both the booking insert and credit
    /// decrement happen in one transaction. Either both succeed or both roll back;
    /// no orphaned bookings or phantom credit usage possible.
    func confirmCreditBooking() async {
        guard let service = selectedService,
              case .useCredit(let credit) = purchaseOption,
              let _ = selectedTimeSlot else { return }
        guard !currentUserId.isEmpty else {
            errorMessage = String(localized: "Unable to identify your account. Please try again.", comment: "Booking error when user id is missing")
            return
        }
        isProcessing = true
        errorMessage = nil

        let scheduledDate = buildScheduledDate() ?? selectedDate
        let bookingId = UUID().uuidString
        // All sessions are virtual — every booking always has a video room.
        let videoRoomId: String? = DIContainer.shared.videoCallService.generateRoomName(for: bookingId)

        let booking = Booking(
            id: bookingId,
            clientId: currentUserId,
            therapistId: therapist.id,
            serviceId: service.id,
            serviceName: service.name,
            duration: service.duration,
            price: 0,
            scheduledAt: scheduledDate,
            timezone: therapist.availability.timezone,
            status: .confirmed,
            videoRoomId: videoRoomId,
            platformFee: 0,
            therapistPayout: 0,
            rescheduleCount: 0,
            packBookingId: credit.packBookingId,
            createdAt: Date(),
            updatedAt: Date()
        )

        do {
            _ = try await DIContainer.shared.bookingRepository.createBookingWithCredit(
                booking: booking,
                creditId: credit.id
            )
            isProcessing = false
            isComplete = true
        } catch {
            errorMessage = String(localized: "Booking failed: \(error.localizedDescription)", comment: "Booking creation generic error")
            isProcessing = false
        }
    }

    /// The pending booking ID created before payment
    var pendingBookingId: String?
    
    /// Builds a scheduled date from the selected date + time slot
    private func buildScheduledDate() -> Date? {
        guard let timeSlot = selectedTimeSlot else { return nil }
        // Slots are generated in the therapist's timezone, so the chosen slot
        // must be materialized back in that same zone — using the device zone
        // here was the cross-timezone booking bug (Problem B).
        return therapist.availability.resolveSlotInstant(slot: timeSlot, on: selectedDate)
    }
    
    /// C2: Prepares the Stripe PaymentSheet by creating a pending booking AND
    /// its PaymentIntent atomically in a single edge function call.
    /// If Stripe fails, the edge function rolls back the booking server-side —
    /// no orphaned bookings or unlinked payment intents.
    func preparePaymentSheet() async {
        guard requiresPayment, let service = selectedService else { return }
        guard paymentSheet == nil else { return }
        guard !currentUserId.isEmpty else {
            errorMessage = String(localized: "Unable to identify your account. Please try again.", comment: "Booking error when user id is missing")
            return
        }

        isPreparingPayment = true
        errorMessage = nil

        do {
            let scheduledDate = buildScheduledDate() ?? selectedDate
            let finalAmount = discountedTotal ?? effectiveBasePrice
            let bookingId = UUID().uuidString
            let formatter = ISO8601DateFormatter.shared

            // All sessions are virtual — always generate a video room.
            let videoRoomId: String? = DIContainer.shared.videoCallService.generateRoomName(for: bookingId)

            let currency = StripeConfig.stripeCurrency(from: therapist.currency)

            let request = BookingPaymentRequest(
                bookingId: bookingId,
                therapistId: therapist.id,
                serviceId: service.id,
                serviceName: service.name,
                duration: service.duration,
                price: finalAmount,
                scheduledAt: formatter.string(from: scheduledDate),
                timezone: therapist.availability.timezone,
                videoRoomId: videoRoomId,
                promoCode: promoCode.isEmpty ? nil : promoCode,
                discount: promoDiscount > 0 ? promoDiscount : nil,
                packBookingId: nil,
                currency: currency
            )

            let result = try await DIContainer.shared.paymentRepository.createBookingWithPayment(request)

            pendingBookingId = result.bookingId
            pendingPaymentIntentId = result.paymentIntentId
            feeBreakdown = result.feeBreakdown

            var config = PaymentSheet.Configuration()
            config.merchantDisplayName = StripeConfig.merchantDisplayName
            // Country must match the booking currency (and the therapist's
            // Connect account locale). Hardcoding "US" produced Apple Pay
            // sheets in USD/U.S. format for Italian clients and risks App
            // Store review concerns about misrepresenting payment region.
            let payCountry = StripeConfig.appleMerchantCountryCode(for: therapist.currency)
            config.applePay = .init(
                merchantId: StripeConfig.appleMerchantId,
                merchantCountryCode: payCountry
            )
            config.allowsDelayedPaymentMethods = false
            config.defaultBillingDetails.address.country = StripeConfig.defaultBillingCountryCode(for: therapist.currency)
            config.customer = .init(id: result.customerId, ephemeralKeySecret: result.ephemeralKeySecret)

            paymentSheet = PaymentSheet(
                paymentIntentClientSecret: result.clientSecret,
                configuration: config
            )
        } catch {
            let msg = error.localizedDescription
            // Booking-overlap errors need special treatment: the slot is gone,
            // so send the user back to date selection and show a clear message
            // instead of the generic "Could not prepare payment" prefix.
            if msg == StripeErrorMapper.bookingOverlap {
                errorMessage = msg
                selectedTimeSlot = nil
                withAnimation(HUAnimation.standard) { currentStep = 1 }
            } else {
                errorMessage = String(localized: "Could not prepare payment: \(msg)", comment: "Stripe PaymentSheet preparation error")
            }
            // No need to cancel pending booking — the edge function handles rollback server-side
        }

        isPreparingPayment = false
    }
    
    /// Handles the result from PaymentSheet presentation.
    func handlePaymentResult(_ result: PaymentSheetResult) async {
        switch result {
        case .completed:
            await finalizeBooking()
        case .failed(let error):
            errorMessage = String(localized: "Payment failed: \(error.localizedDescription)", comment: "PaymentSheet failed result")
            await cancelPendingPaymentBooking(reason: "Payment failed")
        case .canceled:
            // Booking row was created in pending_payment then immediately
            // cancelled — say "released" rather than "not booked yet" so
            // the user understands the slot is free again for them or
            // anyone else to grab. Old copy ("not booked yet") was true
            // but suggested the booking was still in flight.
            errorMessage = String(localized: "Payment cancelled. The slot has been released — you can pick a new time.", comment: "PaymentSheet user-cancelled, booking row released")
            await cancelPendingPaymentBooking(reason: "Payment cancelled by client")
        }
    }
    
    private func cancelPendingPaymentBooking(reason: String) async {
        if let bookingId = pendingBookingId {
            // Best-effort cancel with retry. The Edge Function created the
            // row in `pending_payment` and the Vercel cron
            // `/api/cron/cleanup-pending-payment` will eventually release
            // the slot anyway (after ~35 minutes). But the user might
            // immediately try to rebook the same slot, so we try hard to
            // cancel synchronously first. 3 attempts with exponential
            // backoff covers transient Supabase 5xx without dragging the
            // UI into a 30-second hang.
            var attempt = 0
            let maxAttempts = 3
            while attempt < maxAttempts {
                do {
                    try await DIContainer.shared.bookingRepository.updateBookingStatus(
                        bookingId: bookingId, status: .cancelled, reason: reason
                    )
                    break
                } catch {
                    attempt += 1
                    if attempt >= maxAttempts {
                        // Final failure — log and rely on the cron safety net.
                        bookingFlowLogger.error("Failed to cancel orphaned booking \(bookingId, privacy: .public) after \(maxAttempts) attempts: \(error.localizedDescription, privacy: .public). Cron will release the slot within 35 minutes.")
                    } else {
                        // 0.5s, 1s, 2s
                        let delayNs = UInt64(500_000_000) << (attempt - 1)
                        try? await Task.sleep(nanoseconds: delayNs)
                    }
                }
            }
        }
        pendingBookingId = nil
        pendingPaymentIntentId = nil
        paymentSheet = nil
        // Keep feeBreakdown so the user sees the correct total on "Retry Payment Setup"
    }
    
    /// After payment succeeds, mark the local flow complete and let the
    /// Stripe webhook do the canonical state transition.
    ///
    /// **Why we do NOT update the booking status here**: the Edge Function
    /// `stripe-webhook` listens for `payment_intent.succeeded` and is the
    /// single source of truth for flipping `pending_payment → confirmed`,
    /// inserting the `transactions` row, generating the video room id,
    /// firing Brevo emails and in-app notifications. Earlier this method
    /// also called `updateBookingStatus(.confirmed)` from the client,
    /// which created two race conditions:
    ///
    ///   1. The client UPDATE could land BEFORE the webhook, which then
    ///      sees status='confirmed' and skips its idempotency-protected
    ///      branch — losing video_room_id backfill if the iOS client never
    ///      generated one.
    ///   2. The client UPDATE could land AFTER the webhook had already
    ///      flipped to `confirmed` and written extra fields, and the
    ///      blanket UPDATE risked clobbering some of them depending on
    ///      future schema changes.
    ///
    /// The webhook is reliable in practice (Stripe retries on 5xx, our
    /// `stripe_webhook_events` table dedups). If for any reason it never
    /// fires, the user's `confirmPayment` poll on `transactions` will time
    /// out after 15 attempts and surface a clear error — at which point we
    /// have a server-side bug to fix, not a client to paper over.
    private func finalizeBooking() async {
        guard pendingBookingId != nil else {
            errorMessage = String(localized: "Booking not found. Please try again.", comment: "Finalize step missing pending booking id")
            return
        }
        // Webhook handles the canonical confirm + transaction insert + video
        // room + notifications. Just clear local flow state.
        isProcessing = false
        isComplete = true
        pendingBookingId = nil
        pendingPaymentIntentId = nil
        paymentSheet = nil
    }
    
    /// Creates a booking directly for free services (no payment needed).
    func confirmBooking() async {
        guard let service = selectedService, let _ = selectedTimeSlot else { return }
        guard !currentUserId.isEmpty else {
            errorMessage = String(localized: "Unable to identify your account. Please try again.", comment: "Booking error when user id is missing")
            return
        }
        isProcessing = true
        errorMessage = nil

        let scheduledDate = buildScheduledDate() ?? selectedDate
        let platformFee = service.price * AppConstants.Platform.commissionPercentage
        let bookingId = UUID().uuidString

        // Compute the video room name up-front (deterministic — no network call needed).
        // Embedding it in the initial insert removes the two-step create-then-update
        // failure mode that could leave the booking without a video room ID.
        // All sessions are virtual — always generate a video room.
        let videoRoomId: String? = DIContainer.shared.videoCallService.generateRoomName(for: bookingId)

        let booking = Booking(
            id: bookingId,
            clientId: currentUserId,
            therapistId: therapist.id,
            serviceId: service.id,
            serviceName: service.name,
            duration: service.duration,
            price: service.price,
            scheduledAt: scheduledDate,
            timezone: therapist.availability.timezone,
            status: .pending,
            videoRoomId: videoRoomId,
            platformFee: platformFee,
            therapistPayout: service.price - platformFee,
            promoCode: promoCode.isEmpty ? nil : promoCode,
            rescheduleCount: 0,
            packBookingId: nil,
            createdAt: Date(),
            updatedAt: Date()
        )

        do {
            _ = try await DIContainer.shared.bookingRepository.createBooking(booking)
            isProcessing = false
            isComplete = true
        } catch {
            errorMessage = String(localized: "Booking failed: \(error.localizedDescription)", comment: "Booking creation generic error")
            isProcessing = false
        }
    }
}

struct BookingFlowView: View {
    let therapist: TherapistProfile
    @State private var viewModel: BookingFlowViewModel
    @State private var calendarAlertMessage: String?
    @State private var showCalendarAlert = false
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    
    init(therapist: TherapistProfile, preselectedService: TherapistService? = nil) {
        self.therapist = therapist
        // Temporary placeholder userId; overwritten in onAppear with real auth user
        _viewModel = State(initialValue: BookingFlowViewModel(
            therapist: therapist,
            currentUserId: "",
            preselectedService: preselectedService
        ))
    }
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !viewModel.isComplete {
                    // Progress
                    ProgressView(value: viewModel.progress)
                        .tint(HUColor.primary)
                        .padding(.horizontal, HUSpacing.lg)
                        .padding(.top, HUSpacing.sm)
                    
                    // Step content
                    Group {
                        switch viewModel.currentStep {
                        case 0: serviceSelectionStep
                        case 1: dateTimeSelectionStep
                        case 2: confirmationStep
                        default: EmptyView()
                        }
                    }
                    .frame(maxHeight: .infinity)
                    
                    // Error message
                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.error)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, HUSpacing.xl)
                            .transition(.opacity)
                    }
                    
                    // Navigation
                    HStack(spacing: HUSpacing.md) {
                        if viewModel.currentStep > 0 {
                            HUButton("Back", style: .outline) {
                                viewModel.goBack()
                            }
                        }
                        
                        if viewModel.currentStep < viewModel.totalSteps - 1 {
                            HUButton("Continue", isDisabled: !viewModel.canAdvance) {
                                viewModel.advance()
                            }
                        } else if case .useCredit = viewModel.purchaseOption {
                            // Credit booking — free, confirm directly
                            HUButton("Use Credit & Confirm", icon: "checkmark.seal", isLoading: viewModel.isProcessing, isDisabled: viewModel.isProcessing) {
                                HUHaptic.impact(.medium)
                                Task { await viewModel.confirmCreditBooking() }
                            }
                        } else if viewModel.requiresPayment {
                            // Paid booking — use Stripe PaymentSheet
                            if viewModel.isPreparingPayment {
                                HUButton("Preparing Payment…", isLoading: true) {}
                            } else if let paymentSheet = viewModel.paymentSheet {
                                PaymentSheet.PaymentButton(
                                    paymentSheet: paymentSheet,
                                    onCompletion: { result in
                                        Task { await viewModel.handlePaymentResult(result) }
                                    }
                                ) {
                                    HStack(spacing: HUSpacing.sm) {
                                        Image(systemName: "creditcard")
                                        Text("Pay & Confirm")
                                    }
                                    .font(HUFont.headline())
                                    .foregroundStyle(HUColor.textOnPrimary)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, HUSpacing.lg)
                                    .background(viewModel.isProcessing ? HUColor.primary.opacity(0.5) : HUColor.primary)
                                    .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
                                }
                                .disabled(viewModel.isProcessing)
                            } else {
                                HUButton("Retry Payment Setup", icon: "arrow.clockwise", isLoading: viewModel.isPreparingPayment) {
                                    Task { await viewModel.preparePaymentSheet() }
                                }
                            }
                        } else {
                            // Free intro call — confirm directly
                            HUButton("Confirm Booking", icon: "checkmark.circle", isLoading: viewModel.isProcessing, isDisabled: viewModel.isProcessing) {
                                HUHaptic.impact(.medium)
                                Task { await viewModel.confirmBooking() }
                            }
                        }
                    }
                    .padding(.horizontal, HUSpacing.xl)
                    .padding(.bottom, HUSpacing.xl)
                } else {
                    bookingSuccessView
                }
            }
            .background(HUColor.background)
            .navigationTitle("Book Session")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                if let userId = authManager.currentUser?.id, viewModel.currentUserId.isEmpty {
                    viewModel.currentUserId = userId
                }
            }
        }
    }
    
    // MARK: - Step 1: Service Selection
    
    private var serviceSelectionStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HUSpacing.xl) {
                stepHeader(title: "Choose a Service", subtitle: "Select the session type you'd like to book")
                
                ForEach(therapist.services) { service in
                    let isPack = service.packSize != nil
                    let packSize = service.packSize ?? 1
                    let packTotal: Double = {
                        if let n = service.packSize {
                            return (service.packPrice ?? service.price) * Double(n)
                        }
                        return service.price
                    }()
                    let isSelected = viewModel.selectedService?.id == service.id

                    Button {
                        withAnimation { viewModel.selectedService = service }
                    } label: {
                        VStack(alignment: .leading, spacing: HUSpacing.sm) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: HUSpacing.xs) {
                                    HStack(spacing: HUSpacing.xs) {
                                        Text(service.name)
                                            .font(HUFont.headline())
                                            .foregroundStyle(HUColor.textPrimary)
                                        if isPack {
                                            Text("PACK")
                                                .font(.system(size: 10, weight: .bold))
                                                .foregroundStyle(.white)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(HUColor.primary)
                                                .clipShape(Capsule())
                                        }
                                    }
                                    Text(service.description)
                                        .font(HUFont.caption())
                                        .foregroundStyle(HUColor.textSecondary)
                                        .lineLimit(2)
                                    HStack(spacing: HUSpacing.sm) {
                                        Label("\(service.duration) min / session", systemImage: "clock")
                                        if isPack {
                                            Label("\(packSize) sessions", systemImage: "square.stack")
                                        }
                                    }
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.textTertiary)
                                }

                                Spacer()

                                VStack(alignment: .trailing, spacing: HUSpacing.xs) {
                                    if isPack {
                                        Text(String(format: "%@%.2f", therapist.currency.symbol, packTotal))
                                            .font(HUFont.title3())
                                            .foregroundStyle(HUColor.primary)
                                        // Show per-session price
                                        let perSession = service.packPrice ?? service.price
                                        Text(String(format: "%@%.2f / session", therapist.currency.symbol, perSession))
                                            .font(HUFont.caption())
                                            .foregroundStyle(HUColor.textSecondary)
                                        // Show saving if packPrice < price
                                        if let packPrice = service.packPrice, packPrice < service.price {
                                            let saving = (service.price - packPrice) * Double(packSize)
                                            Text(String(format: "Save %@%.2f", therapist.currency.symbol, saving))
                                                .font(.system(size: 10, weight: .semibold))
                                                .foregroundStyle(HUColor.success)
                                        }
                                    } else {
                                        Text(String(format: "%@%.2f", therapist.currency.symbol, service.price))
                                            .font(HUFont.title3())
                                            .foregroundStyle(HUColor.primary)
                                    }

                                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 24))
                                        .foregroundStyle(isSelected ? HUColor.primary : HUColor.textTertiary)
                                }
                            }
                        }
                        .padding(HUSpacing.lg)
                        .background(isSelected ? HUColor.primaryLight.opacity(0.3) : HUColor.secondaryBackground)
                        .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
                        .overlay {
                            if isSelected {
                                RoundedRectangle(cornerRadius: HURadius.xl)
                                    .strokeBorder(HUColor.primary, lineWidth: 2)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, HUSpacing.xl)
            .padding(.vertical, HUSpacing.lg)
        }
    }
    
    // MARK: - Step 2: Date & Time
    
    private var dateTimeSelectionStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HUSpacing.xl) {
                stepHeader(title: "Choose Date & Time", subtitle: "Select when you'd like your session")

                // Purchase option picker (shown only for pack services that have credits available)
                if viewModel.isCheckingCredits {
                    HStack {
                        ProgressView()
                            .controlSize(.mini)
                        Text("Checking your credits…")
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textSecondary)
                    }
                } else if viewModel.selectedService?.packSize != nil {
                    // Show purchase options for pack-enabled services:
                    // credit use (if available), buy pack, or single session
                    purchaseOptionSelector(credit: viewModel.availableCredit)
                }

                // Date picker
                DatePicker(
                    "Select Date",
                    selection: $viewModel.selectedDate,
                    // Tomorrow … +bookingWindowDays. Bounded so iOS exposes the
                    // same monthly horizon as the web client (was open-ended).
                    in: AppConstants.Booking.selectableDateRange,
                    displayedComponents: .date
                )
                .datePickerStyle(.graphical)
                .tint(HUColor.primary)
                .onChange(of: viewModel.selectedDate) { _, _ in
                    viewModel.selectedTimeSlot = nil
                    Task { await viewModel.refreshAvailableSlots() }
                }
                
                // Time slots
                VStack(alignment: .leading, spacing: HUSpacing.md) {
                    Text("Available Times")
                        .font(HUFont.headline())

                    // Cross-timezone clarity: slot labels are in the therapist's
                    // wall-clock time. Only shown when it differs from the
                    // device zone, so same-zone (e.g. IT↔IT) users see no change.
                    if therapist.availability.resolvedTimeZone.identifier != TimeZone.current.identifier {
                        Text(String(localized: "Times shown in the therapist's timezone (\(therapist.availability.timezone)).", comment: "Hint under the slot grid when the client and therapist are in different timezones"))
                            .font(HUFont.caption())
                            .foregroundStyle(HUColor.textSecondary)
                    }

                    if viewModel.isLoadingSlots {
                        HULoadingView(message: "Checking availability…")
                            .frame(height: 100)
                    } else if viewModel.availableSlots.isEmpty {
                        VStack(spacing: HUSpacing.sm) {
                            Image(systemName: "calendar.badge.exclamationmark")
                                .font(.system(size: 28))
                                .foregroundStyle(HUColor.textTertiary)
                            Text("No available slots on this date")
                                .font(HUFont.subheadline())
                                .foregroundStyle(HUColor.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, HUSpacing.xl)
                    } else {
                        LazyVGrid(columns: [
                            GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())
                        ], spacing: HUSpacing.sm) {
                            ForEach(viewModel.availableSlots, id: \.self) { slot in
                                Button {
                                    viewModel.selectedTimeSlot = slot
                                } label: {
                                    Text(formatSlot(slot))
                                        .font(HUFont.subheadline(weight: viewModel.selectedTimeSlot == slot ? .semibold : .regular))
                                        .foregroundStyle(viewModel.selectedTimeSlot == slot ? HUColor.textOnPrimary : HUColor.textPrimary)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, HUSpacing.md)
                                        .background(viewModel.selectedTimeSlot == slot ? HUColor.primary : HUColor.secondaryBackground)
                                        .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, HUSpacing.xl)
            .padding(.vertical, HUSpacing.lg)
        }
    }
    
    // MARK: - Purchase Option Selector

    @ViewBuilder
    private func purchaseOptionSelector(credit: SessionCredit?) -> some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            Text("How would you like to book?")
                .font(HUFont.headline())

            // Use credit option (only shown if client has active credits)
            if let credit {
                purchaseOptionButton(
                    title: "Use Session Credit",
                    subtitle: "\(credit.sessionsRemaining) of \(credit.sessionsTotal) sessions remaining — free",
                    icon: "checkmark.seal.fill",
                    isSelected: {
                        if case .useCredit = viewModel.purchaseOption { return true }
                        return false
                    }()
                ) {
                    viewModel.purchaseOption = .useCredit(credit)
                    // Reset payment sheet if previously prepared
                    viewModel.paymentSheet = nil
                }
            }

            // Buy new pack option
            if let packSize = viewModel.selectedService?.packSize {
                let packPricePerSession = viewModel.selectedService?.packPrice ?? viewModel.selectedService?.price ?? 0
                purchaseOptionButton(
                    title: "Buy Pack of \(packSize)",
                    subtitle: String(format: "%.0f %@/session — save %.0f%%",
                        packPricePerSession,
                        viewModel.therapist.currency.symbol,
                        ((viewModel.selectedService?.price ?? 0) - packPricePerSession) / max(viewModel.selectedService?.price ?? 1, 1) * 100
                    ),
                    icon: "square.stack.fill",
                    isSelected: viewModel.purchaseOption == .pack
                ) {
                    viewModel.purchaseOption = .pack
                    viewModel.paymentSheet = nil
                }
            }

            // Single session option
            purchaseOptionButton(
                title: "Single Session",
                subtitle: String(format: "%.0f %@ for one session",
                    viewModel.selectedService?.price ?? 0,
                    viewModel.therapist.currency.symbol
                ),
                icon: "1.circle.fill",
                isSelected: viewModel.purchaseOption == .single
            ) {
                viewModel.purchaseOption = .single
                viewModel.paymentSheet = nil
            }
        }
    }

    private func purchaseOptionButton(
        title: String,
        subtitle: String,
        icon: String,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: HUSpacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? HUColor.primary : HUColor.textTertiary)
                    .frame(width: 32)

                VStack(alignment: .leading, spacing: HUSpacing.xs) {
                    Text(title)
                        .font(HUFont.subheadline(weight: .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                    Text(subtitle)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                }

                Spacer()

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? HUColor.primary : HUColor.textTertiary)
            }
            .padding(HUSpacing.md)
            .background(isSelected ? HUColor.primaryLight.opacity(0.3) : HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: HURadius.xl)
                        .strokeBorder(HUColor.primary, lineWidth: 2)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Step 3: Confirmation
    
    private var confirmationStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HUSpacing.xl) {
                stepHeader(title: "Review & Pay", subtitle: "Confirm your booking details")
                
                // Summary card
                VStack(spacing: HUSpacing.lg) {
                    HStack(spacing: HUSpacing.md) {
                        HUAvatar(url: nil, name: therapist.displayName, size: HUSize.avatarMd)
                        VStack(alignment: .leading) {
                            Text(therapist.displayName)
                                .font(HUFont.headline())
                            if let service = viewModel.selectedService {
                                Text(service.name)
                                    .font(HUFont.caption())
                                    .foregroundStyle(HUColor.textSecondary)
                            }
                        }
                    }
                    
                    Divider()
                    
                    VStack(spacing: HUSpacing.md) {
                        summaryRow(icon: "calendar", title: "Date", value: viewModel.selectedDate.formatted(date: .abbreviated, time: .omitted))
                        summaryRow(icon: "clock", title: "Time", value: viewModel.selectedTimeSlot.map { formatSlot($0) } ?? "—")
                        summaryRow(icon: "timer", title: "Duration", value: "\(viewModel.selectedService?.duration ?? 0) min")
                        summaryRow(icon: "video", title: "Format", value: "Virtual")
                        summaryRow(icon: "globe", title: "Timezone", value: TimeZone.current.abbreviation() ?? TimeZone.current.identifier)
                    }
                    
                    Divider()
                    
                    // Pricing
                    if let service = viewModel.selectedService {
                        if case .useCredit(let credit) = viewModel.purchaseOption {
                            // Credit booking — show credit info
                            VStack(spacing: HUSpacing.sm) {
                                HStack {
                                    Label("Session Credit", systemImage: "checkmark.seal.fill")
                                        .font(HUFont.subheadline())
                                        .foregroundStyle(HUColor.primary)
                                    Spacer()
                                    Text("\(credit.sessionsRemaining - 1) credits remaining after this")
                                        .font(HUFont.caption())
                                        .foregroundStyle(HUColor.textSecondary)
                                }
                                Divider()
                                HStack {
                                    Text("Total")
                                        .font(HUFont.headline())
                                    Spacer()
                                    Text("FREE")
                                        .font(HUFont.title3())
                                        .foregroundStyle(HUColor.success)
                                }
                            }
                        } else {
                            VStack(spacing: HUSpacing.sm) {
                                // Show the correct pricing based on what the user actually selected
                                if case .pack = viewModel.purchaseOption, let packSize = service.packSize {
                                    let perSession = service.packPrice ?? service.price
                                    pricingRow(
                                        title: "Pack of \(packSize) × \(service.duration) min",
                                        amount: viewModel.effectiveBasePrice
                                    )
                                    HStack {
                                        Text(String(format: "%@%.2f / session", therapist.currency.symbol, perSession))
                                            .font(HUFont.caption())
                                            .foregroundStyle(HUColor.textSecondary)
                                        Spacer()
                                    }
                                } else {
                                    // Single session (even if service has pack option)
                                    pricingRow(title: "\(service.duration) min Session", amount: service.price)
                                }

                                if viewModel.promoDiscount > 0 {
                                    HStack {
                                        Text("Discount (\(Int(viewModel.promoDiscount * 100))%)")
                                            .font(HUFont.subheadline())
                                            .foregroundStyle(HUColor.success)
                                        Spacer()
                                        Text(String(format: "-%@%.2f", therapist.currency.symbol, viewModel.effectiveBasePrice * viewModel.promoDiscount))
                                            .font(HUFont.subheadline(weight: .medium))
                                            .foregroundStyle(HUColor.success)
                                    }
                                }

                                if let breakdown = viewModel.feeBreakdown {
                                    HStack {
                                        Text("Processing fee")
                                            .font(HUFont.subheadline())
                                            .foregroundStyle(HUColor.textSecondary)
                                        Spacer()
                                        Text(String(format: "%@%.2f", therapist.currency.symbol, breakdown.serviceFee))
                                            .font(HUFont.subheadline(weight: .medium))
                                            .foregroundStyle(HUColor.textSecondary)
                                    }
                                }

                                Divider()

                                HStack {
                                    Text("Total")
                                        .font(HUFont.headline())
                                    Spacer()
                                    let totalAmount = viewModel.feeBreakdown?.totalCharged ?? (viewModel.discountedTotal ?? viewModel.effectiveBasePrice)
                                    let basePrice = viewModel.feeBreakdown.map { _ in viewModel.effectiveBasePrice } ?? viewModel.effectiveBasePrice
                                    if viewModel.promoDiscount > 0, viewModel.feeBreakdown == nil {
                                        VStack(alignment: .trailing, spacing: 2) {
                                            Text(String(format: "%@%.2f", therapist.currency.symbol, basePrice))
                                                .font(HUFont.caption())
                                                .strikethrough()
                                                .foregroundStyle(HUColor.textTertiary)
                                            Text(String(format: "%@%.2f", therapist.currency.symbol, totalAmount))
                                                .font(HUFont.title3())
                                                .foregroundStyle(HUColor.primary)
                                        }
                                    } else {
                                        Text(String(format: "%@%.2f", therapist.currency.symbol, totalAmount))
                                            .font(HUFont.title3())
                                            .foregroundStyle(HUColor.primary)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(HUSpacing.xl)
                .background(HUColor.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: HURadius.xxl))
                
                // Promo code
                VStack(alignment: .leading, spacing: HUSpacing.sm) {
                    HStack(alignment: .bottom, spacing: HUSpacing.sm) {
                        HUTextField(label: "Promo Code", text: $viewModel.promoCode, placeholder: "Enter promo code", icon: "tag")
                        
                        Button {
                            Task { await viewModel.validatePromoCode() }
                        } label: {
                            Text("Apply")
                                .font(HUFont.subheadline(weight: .semibold))
                                .foregroundStyle(HUColor.textOnPrimary)
                                .padding(.horizontal, HUSpacing.lg)
                                .padding(.vertical, HUSpacing.md)
                                .background(viewModel.promoCode.isEmpty ? HUColor.textTertiary : HUColor.primary)
                                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                        }
                        .disabled(viewModel.promoCode.isEmpty || viewModel.isValidatingPromo)
                    }
                    
                    if let message = viewModel.promoMessage {
                        HStack(spacing: HUSpacing.xs) {
                            Image(systemName: viewModel.promoDiscount > 0 ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .font(.caption)
                            Text(message)
                                .font(HUFont.caption())
                        }
                        .foregroundStyle(viewModel.promoDiscount > 0 ? HUColor.success : HUColor.error)
                    }
                }
            }
            .padding(.horizontal, HUSpacing.xl)
            .padding(.vertical, HUSpacing.lg)
        }
    }
    
    // MARK: - Success
    
    private var bookingSuccessView: some View {
        ZStack {
        VStack(spacing: HUSpacing.xxl) {
            Spacer()
            
            Image("success_booking")
                .resizable()
                .scaledToFit()
                .frame(width: 160, height: 160)
            
            VStack(spacing: HUSpacing.sm) {
                Text("Booking Confirmed!")
                    .font(HUFont.title())
                    .foregroundStyle(HUColor.textPrimary)
                
                Text("Your session with \(therapist.displayName) has been booked successfully.")
                    .font(HUFont.body())
                    .foregroundStyle(HUColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
            
            VStack(spacing: HUSpacing.md) {
                if let service = viewModel.selectedService {
                    Text(service.name)
                        .font(HUFont.headline())
                }
                Text("\(viewModel.selectedDate.formatted(date: .abbreviated, time: .omitted)) at \(viewModel.selectedTimeSlot.map { formatSlot($0) } ?? "")")
                    .font(HUFont.subheadline())
                    .foregroundStyle(HUColor.textSecondary)
            }
            .padding(HUSpacing.xl)
            .background(HUColor.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: HURadius.xl))

            // Show credit creation notice for pack purchases
            if case .pack = viewModel.purchaseOption,
               let service = viewModel.selectedService,
               let packSize = service.packSize, packSize > 1 {
                HStack(spacing: HUSpacing.sm) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(HUColor.primary)
                    Text("\(packSize - 1) session credits added to your account for future bookings with \(therapist.displayName).")
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                .padding(HUSpacing.md)
                .background(HUColor.primaryLight.opacity(0.3))
                .clipShape(RoundedRectangle(cornerRadius: HURadius.lg))
                .padding(.horizontal, HUSpacing.xl)
            }

            Spacer()
            
            VStack(spacing: HUSpacing.md) {
                HUButton("Add to Calendar", style: .outline, icon: "calendar.badge.plus") {
                    Task { await addToCalendar() }
                }
                
                HUButton("Done") {
                    dismiss()
                }
            }
            .padding(.horizontal, HUSpacing.xl)
            .padding(.bottom, HUSpacing.xxl)
            .alert("Calendar", isPresented: $showCalendarAlert) {
                Button("OK") {}
            } message: {
                Text(calendarAlertMessage ?? "")
            }
        }
        
        ConfettiView()
        }
        .onAppear { HUHaptic.notification(.success) }
    }
    
    // MARK: - Helpers
    
    private func addToCalendar() async {
        let store = EKEventStore()
        
        do {
            let granted = try await store.requestFullAccessToEvents()
            guard granted else {
                calendarAlertMessage = "Calendar access was denied. You can enable it in Settings > Privacy > Calendars."
                showCalendarAlert = true
                return
            }
        } catch {
            calendarAlertMessage = "Could not access your calendar: \(error.localizedDescription)"
            showCalendarAlert = true
            return
        }
        
        guard let timeSlot = viewModel.selectedTimeSlot,
              let service = viewModel.selectedService else { return }
        
        // Build the event in the therapist's timezone so the calendar entry
        // lands at the real session instant (matches the booked scheduled_at).
        guard let startDate = therapist.availability.resolveSlotInstant(slot: timeSlot, on: viewModel.selectedDate) else { return }
        let endDate = startDate.addingTimeInterval(TimeInterval(service.duration * 60))
        
        let event = EKEvent(eventStore: store)
        event.title = "\(service.name) with \(therapist.displayName)"
        event.startDate = startDate
        event.endDate = endDate
        event.notes = "Holistic Unity session — join via the app."
        event.calendar = store.defaultCalendarForNewEvents
        
        // Add a 30-minute reminder
        event.addAlarm(EKAlarm(relativeOffset: -1800))
        
        do {
            try store.save(event, span: .thisEvent)
            calendarAlertMessage = "Session added to your calendar with a 30-minute reminder."
            showCalendarAlert = true
        } catch {
            calendarAlertMessage = "Failed to save event: \(error.localizedDescription)"
            showCalendarAlert = true
        }
    }
    
    private func formatSlot(_ slot: String) -> String {
        let parts = slot.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let min = Int(parts[1]) else { return slot }
        let ampm = hour >= 12 ? "PM" : "AM"
        let displayHour = hour > 12 ? hour - 12 : (hour == 0 ? 12 : hour)
        return String(format: "%d:%02d %@", displayHour, min, ampm)
    }
    
    private func summaryRow(icon: String, title: String, value: String) -> some View {
        HStack {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(HUColor.primary)
                .frame(width: 24)
            Text(title)
                .font(HUFont.subheadline())
                .foregroundStyle(HUColor.textSecondary)
            Spacer()
            Text(value)
                .font(HUFont.subheadline(weight: .medium))
                .foregroundStyle(HUColor.textPrimary)
        }
    }
    
    private func pricingRow(title: String, amount: Double) -> some View {
        HStack {
            Text(title)
                .font(HUFont.subheadline())
                .foregroundStyle(HUColor.textSecondary)
            Spacer()
            Text(String(format: "%@%.2f", therapist.currency.symbol, amount))
                .font(HUFont.subheadline(weight: .medium))
        }
    }
    private func stepHeader(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: HUSpacing.sm) {
            Text(title)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(HUColor.textPrimary)
            Text(subtitle)
                .font(HUFont.body())
                .foregroundStyle(HUColor.textSecondary)
        }
    }
}

#Preview {
    BookingFlowView(therapist: MockData.therapists[0])
        .environment(AuthManager(authRepository: MockAuthRepository()))
}
