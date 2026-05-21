import SwiftUI

/// Sheet that lets the user report a piece of UGC (therapist
/// profile / chat message / review). Required for App Store
/// Guideline 1.2. Submits via `ReportService.shared`.
///
/// Used by `TherapistProfileView` (target = .therapist) and can be
/// reused from chat / review surfaces with the same shape.
struct ReportSheet: View {
    let targetType: ReportService.Target
    let targetID: String
    let targetDisplayName: String

    @Environment(\.dismiss) private var dismiss
    @State private var selectedReason: ReportService.Reason?
    @State private var details: String = ""
    @State private var isSubmitting = false
    @State private var submitError: String?
    @State private var didSubmit = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Stiamo prendendo sul serio ogni segnalazione. Verrà esaminata dal team entro 48h.")
                        .font(.system(size: 13))
                        .foregroundStyle(HUColor.textSecondary)
                        .padding(.vertical, 4)
                } header: {
                    Text("Segnala \(targetDisplayName)")
                }

                Section("Motivo") {
                    ForEach(ReportService.Reason.allCases) { reason in
                        Button {
                            HUHaptic.selection()
                            selectedReason = reason
                        } label: {
                            HStack {
                                Text(reason.displayName)
                                    .foregroundStyle(HUColor.textPrimary)
                                Spacer()
                                if selectedReason == reason {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(HUColor.primary)
                                }
                            }
                        }
                    }
                }

                Section {
                    TextField("Dettagli aggiuntivi (opzionale, max 500)", text: $details, axis: .vertical)
                        .lineLimit(3...8)
                        .onChange(of: details) { _, newValue in
                            if newValue.count > 500 {
                                details = String(newValue.prefix(500))
                            }
                        }
                    Text("\(details.count)/500")
                        .font(.caption2)
                        .foregroundStyle(HUColor.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                } header: {
                    Text("Note (opzionale)")
                }

                if let submitError {
                    Section {
                        Text(submitError)
                            .font(.system(size: 13))
                            .foregroundStyle(HUColor.error)
                    }
                }

                if didSubmit {
                    Section {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(HUColor.success)
                            Text("Segnalazione inviata. Grazie.")
                                .foregroundStyle(HUColor.textPrimary)
                        }
                    }
                }
            }
            .navigationTitle("Segnala")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("Invia").bold()
                        }
                    }
                    .disabled(selectedReason == nil || isSubmitting || didSubmit)
                }
            }
        }
    }

    private func submit() async {
        guard let reason = selectedReason else { return }
        isSubmitting = true
        submitError = nil
        defer { isSubmitting = false }
        do {
            try await ReportService.shared.submitReport(
                targetType: targetType,
                targetID: targetID,
                reason: reason,
                details: details
            )
            HUHaptic.notification(.success)
            didSubmit = true
            // Auto-dismiss after a moment so the user sees confirmation
            try? await Task.sleep(for: .seconds(1.2))
            dismiss()
        } catch {
            HUHaptic.notification(.error)
            submitError = error.localizedDescription
        }
    }
}
