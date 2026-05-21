import SwiftUI
import Supabase

// MARK: - Notifications View

struct NotificationsView: View {
    private var manager = NotificationManager.shared
    @State private var selectedFilter: NotificationFilter = .all
    @State private var navigateToBookingId: String?
    @State private var navigateToConversationId: String?
    @State private var showBookings = false
    @State private var showMessages = false
    @State private var showClearAllConfirmation = false
    
    enum NotificationFilter: String, CaseIterable {
        case all = "All"
        case unread = "Unread"
        case bookings = "Bookings"
        case messages = "Messages"
    }
    
    private var filteredNotifications: [AppNotification] {
        switch selectedFilter {
        case .all:
            return manager.notifications
        case .unread:
            return manager.notifications.filter { !$0.isRead }
        case .bookings:
            return manager.notifications.filter { $0.type == .bookingConfirmed || $0.type == .sessionReminder || $0.type == .bookingCancelled || $0.type == .rescheduleRequested || $0.type == .rescheduleApproved || $0.type == .rescheduleDeclined || $0.type == .bookingRequest || $0.type == .bookingDeclined }
        case .messages:
            return manager.notifications.filter { $0.type == .newMessage }
        }
    }
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Filter bar
                filterBar
                
                if manager.isLoading && manager.notifications.isEmpty {
                    Spacer()
                    HULoadingView(message: "Loading notifications…")
                    Spacer()
                } else if filteredNotifications.isEmpty {
                    Spacer()
                    VStack(spacing: HUSpacing.lg) {
                        Image("empty_notifications")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 140, height: 140)
                        VStack(spacing: HUSpacing.sm) {
                            Text("No Notifications")
                                .font(HUFont.title3())
                                .foregroundStyle(HUColor.textPrimary)
                            Text("You're all caught up!")
                                .font(HUFont.body())
                                .foregroundStyle(HUColor.textSecondary)
                        }
                    }
                    .padding(HUSpacing.xxl)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.opacity)
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
                            let grouped = manager.groupedNotifications(filteredNotifications)
                            ForEach(grouped, id: \.0) { group, notifications in
                                Section {
                                    ForEach(notifications) { notification in
                                        NotificationRow(notification: notification) {
                                            manager.markAsRead(notification)
                                            handleNotificationTap(notification)
                                        }
                                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                            Button(role: .destructive) {
                                                withAnimation {
                                                    manager.deleteNotification(notification)
                                                }
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                        }
                                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                            if !notification.isRead {
                                                Button {
                                                    withAnimation {
                                                        manager.markAsRead(notification)
                                                    }
                                                } label: {
                                                    Label("Read", systemImage: "envelope.open")
                                                }
                                                .tint(HUColor.info)
                                            }
                                        }
                                        
                                        if notification.id != notifications.last?.id {
                                            Divider()
                                                .padding(.leading, 72)
                                        }
                                    }
                                } header: {
                                    Text(group.rawValue)
                                        .font(HUFont.caption(weight: .semibold))
                                        .foregroundStyle(HUColor.textSecondary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, HUSpacing.xl)
                                        .padding(.vertical, HUSpacing.sm)
                                        .background(HUColor.background)
                                }
                            }
                        }
                        .padding(.horizontal, HUSpacing.md)
                    }
                }
            }
            .navigationTitle("Notifications")
            .refreshable {
                await manager.loadNotifications()
            }
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    Menu {
                        Button {
                            HUHaptic.impact(.light)
                            manager.markAllAsRead()
                        } label: {
                            Label("Mark All as Read", systemImage: "checkmark.circle")
                        }
                        
                        Button(role: .destructive) {
                            HUHaptic.notification(.warning)
                            showClearAllConfirmation = true
                        } label: {
                            Label("Clear All", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showBookings) {
                NavigationStack {
                    ClientBookingsView()
                }
            }
            .sheet(isPresented: $showMessages) {
                StreamChannelListView()
            }
            .alert("Clear All Notifications", isPresented: $showClearAllConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Clear All", role: .destructive) {
                    withAnimation { manager.clearAll() }
                }
            } message: {
                Text("This will permanently remove all your notifications. This action cannot be undone.")
            }
        }
    }
    
    // MARK: - Filter Bar
    
    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: HUSpacing.sm) {
                ForEach(NotificationFilter.allCases, id: \.self) { filter in
                    Button {
                        HUHaptic.selection()
                        withAnimation { selectedFilter = filter }
                    } label: {
                        HStack(spacing: HUSpacing.xs) {
                            Text(filter.rawValue)
                            
                            if filter == .unread {
                                let count = manager.unreadCount
                                if count > 0 {
                                    Text("\(count)")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(selectedFilter == filter ? HUColor.primary : HUColor.textOnPrimary)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(selectedFilter == filter ? HUColor.textOnPrimary : HUColor.primary)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                        .font(HUFont.caption(weight: .semibold))
                        .foregroundStyle(selectedFilter == filter ? HUColor.textOnPrimary : HUColor.textPrimary)
                        .padding(.horizontal, HUSpacing.lg)
                        .padding(.vertical, HUSpacing.sm)
                        .background(selectedFilter == filter ? HUColor.primary : HUColor.secondaryBackground)
                        .clipShape(Capsule())
                    }
                }
            }
            .padding(.horizontal, HUSpacing.xl)
            .padding(.vertical, HUSpacing.md)
        }
    }
    
    // MARK: - Actions
    
    private func handleNotificationTap(_ notification: AppNotification) {
        HUHaptic.impact(.light)
        if let bookingId = notification.data?.bookingId {
            navigateToBookingId = bookingId
            showBookings = true
        } else if let conversationId = notification.data?.conversationId {
            navigateToConversationId = conversationId
            showMessages = true
        }
    }
}

// MARK: - Notification Row

struct NotificationRow: View {
    let notification: AppNotification
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: HUSpacing.md) {
                // Icon
                notificationIcon
                
                // Content
                VStack(alignment: .leading, spacing: HUSpacing.xxs) {
                    Text(notification.title)
                        .font(HUFont.body(weight: notification.isRead ? .regular : .semibold))
                        .foregroundStyle(HUColor.textPrimary)
                        .lineLimit(1)
                    
                    Text(notification.body)
                        .font(HUFont.caption())
                        .foregroundStyle(HUColor.textSecondary)
                        .lineLimit(2)
                    
                    Text(timeAgo(notification.createdAt))
                        .font(.caption2)
                        .foregroundStyle(HUColor.textTertiary)
                        .padding(.top, 2)
                }
                
                Spacer()
                
                if !notification.isRead {
                    Circle()
                        .fill(HUColor.primary)
                        .frame(width: 8, height: 8)
                        .accessibilityLabel("Unread")
                }
            }
            .padding(.vertical, HUSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(notification.isRead ? 0.8 : 1.0)
        .accessibilityLabel("\(notification.isRead ? "" : "Unread. ")\(notification.title). \(notification.body)")
    }
    
    private var notificationIcon: some View {
        let (icon, color) = iconForType(notification.type)
        return Image(systemName: icon)
            .font(.body)
            .foregroundStyle(.white)
            .frame(width: 40, height: 40)
            .background(color)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
    
    private func iconForType(_ type: NotificationType) -> (String, Color) {
        switch type {
        case .bookingConfirmed:
            return ("calendar.badge.checkmark", .green)
        case .bookingCancelled:
            return ("calendar.badge.minus", .red)
        case .sessionReminder:
            return ("bell.fill", .orange)
        case .newMessage:
            return ("bubble.left.fill", HUColor.primary)
        case .reviewReceived:
            return ("star.fill", .yellow)
        case .paymentProcessed:
            return ("dollarsign.circle.fill", .green)
        case .profileApproved:
            return ("checkmark.seal.fill", .blue)
        case .bookingDeclined:
            return ("calendar.badge.exclamationmark", .red)
        case .bookingRequest:
            return ("calendar.badge.plus", .blue)
        case .videoSessionStarting:
            return ("video.fill", .green)
        case .refundIssued:
            return ("arrow.uturn.left.circle.fill", .orange)
        case .profileChangesRequested:
            return ("pencil.circle.fill", .yellow)
        case .rescheduleRequested:
            return ("arrow.triangle.2.circlepath", .orange)
        case .rescheduleApproved:
            return ("calendar.badge.checkmark", .green)
        case .rescheduleDeclined:
            return ("calendar.badge.exclamationmark", .red)
        case .promotional:
            return ("megaphone.fill", .purple)
        }
    }
    
    private func timeAgo(_ date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        if interval < 60 {
            return "Just now"
        } else if interval < 3600 {
            return "\(Int(interval / 60))m ago"
        } else if interval < 86400 {
            return "\(Int(interval / 3600))h ago"
        } else if interval < 7 * 86400 {
            return "\(Int(interval / 86400))d ago"
        } else {
            return date.formatted(.dateTime.month(.abbreviated).day())
        }
    }
}

// MARK: - Mock Notifications

#if DEBUG
enum MockNotifications {
    static let all: [AppNotification] = [
        AppNotification(
            id: "n1",
            userId: "cl1",
            type: .bookingConfirmed,
            title: "Booking Confirmed",
            body: "Your naturopathic consultation with ND. Lorenzo M. is confirmed for Thursday at 10:00 AM.",
            data: AppNotification.NotificationData(bookingId: "bk1"),
            isRead: false,
            createdAt: Date().addingTimeInterval(-2 * 3600)
        ),
        AppNotification(
            id: "n2",
            userId: "cl1",
            type: .newMessage,
            title: "New Message",
            body: "ND. Lorenzo M.: Looking forward to our session on Thursday!",
            data: AppNotification.NotificationData(conversationId: "conv1"),
            isRead: false,
            createdAt: Date().addingTimeInterval(-3 * 3600)
        ),
        AppNotification(
            id: "n3",
            userId: "cl1",
            type: .sessionReminder,
            title: "Session Reminder",
            body: "Your constellation session with Sofia Rodriguez is tomorrow at 2:00 PM.",
            data: AppNotification.NotificationData(bookingId: "bk2"),
            isRead: true,
            createdAt: Date().addingTimeInterval(-24 * 3600)
        ),
        AppNotification(
            id: "n4",
            userId: "cl1",
            type: .reviewReceived,
            title: "Review Response",
            body: "ND. Lorenzo M. replied to your review: \"Thank you for your kind words!\"",
            data: nil,
            isRead: true,
            createdAt: Date().addingTimeInterval(-2 * 86400)
        ),
        AppNotification(
            id: "n5",
            userId: "cl1",
            type: .promotional,
            title: "Welcome to Holistic Unity",
            body: "Discover holistic therapists near you and start your wellness journey today.",
            data: nil,
            isRead: true,
            createdAt: Date().addingTimeInterval(-7 * 86400)
        ),
        AppNotification(
            id: "n6",
            userId: "cl1",
            type: .paymentProcessed,
            title: "Payment Processed",
            body: "Your payment of $150.00 for the naturopathic consultation has been processed.",
            data: nil,
            isRead: true,
            createdAt: Date().addingTimeInterval(-3 * 86400)
        )
    ]
}
#endif
