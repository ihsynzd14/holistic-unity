import Foundation
import Supabase
import Observation
import os.log

/// Centralized notification state manager.
/// Provides unread count for tab badges and periodic refresh for live updates.
@MainActor
@Observable
final class NotificationManager {
    static let shared = NotificationManager()
    
    var notifications: [AppNotification] = []
    var unreadCount: Int { notifications.filter { !$0.isRead }.count }
    var isLoading = false
    
    private var refreshTask: Task<Void, Never>?
    private var userId: String?
    
    private init() {}
    
    // MARK: - Lifecycle
    
    func start(userId: String) {
        self.userId = userId
        Task {
            await loadNotifications()
        }
        startPeriodicRefresh()
    }
    
    func stop() {
        refreshTask?.cancel()
        refreshTask = nil
        userId = nil
        notifications = []
    }
    
    // MARK: - Load
    
    func loadNotifications() async {
        isLoading = notifications.isEmpty
        defer { isLoading = false }
        
        do {
            guard let userId else { return }
            let dtos: [NotificationDTO] = try await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .select()
                .eq("user_id", value: userId)
                .order("created_at", ascending: false)
                .limit(100)
                .execute()
                .value
            
            notifications = dtos.map { $0.toDomain() }
        } catch {
            Logger(subsystem: Bundle.main.bundleIdentifier ?? "HolisticUnity", category: "Notifications").error("Failed to load: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Periodic Refresh
    
    private func startPeriodicRefresh() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                await self?.loadNotifications()
            }
        }
    }
    
    // MARK: - Actions
    
    func markAsRead(_ notification: AppNotification) {
        guard let index = notifications.firstIndex(where: { $0.id == notification.id }),
              !notifications[index].isRead else { return }
        notifications[index].isRead = true
        Task {
            _ = try? await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .update(["is_read": true])
                .eq("id", value: notification.id)
                .execute()
        }
    }
    
    func markAllAsRead() {
        let unreadIds = notifications.filter { !$0.isRead }.map { $0.id }
        guard !unreadIds.isEmpty else { return }
        for index in notifications.indices {
            notifications[index].isRead = true
        }
        Task {
            _ = try? await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .update(["is_read": true])
                .in("id", values: unreadIds)
                .execute()
        }
    }
    
    func deleteNotification(_ notification: AppNotification) {
        notifications.removeAll { $0.id == notification.id }
        Task {
            _ = try? await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .delete()
                .eq("id", value: notification.id)
                .execute()
        }
    }
    
    func clearAll() {
        let allIds = notifications.map { $0.id }
        notifications.removeAll()
        Task {
            _ = try? await SupabaseConfig.client
                .from(SupabaseConfig.Table.notifications)
                .delete()
                .in("id", values: allIds)
                .execute()
        }
    }
    
    // MARK: - Date Grouping
    
    enum DateGroup: String, CaseIterable {
        case today = "Today"
        case yesterday = "Yesterday"
        case thisWeek = "This Week"
        case earlier = "Earlier"
    }
    
    func groupedNotifications(_ filtered: [AppNotification]) -> [(DateGroup, [AppNotification])] {
        let calendar = Calendar.current
        let now = Date()
        
        var groups: [DateGroup: [AppNotification]] = [:]
        
        for notification in filtered {
            let group: DateGroup
            if calendar.isDateInToday(notification.createdAt) {
                group = .today
            } else if calendar.isDateInYesterday(notification.createdAt) {
                group = .yesterday
            } else if let weekAgo = calendar.date(byAdding: .day, value: -7, to: now),
                      notification.createdAt > weekAgo {
                group = .thisWeek
            } else {
                group = .earlier
            }
            groups[group, default: []].append(notification)
        }
        
        return DateGroup.allCases.compactMap { group in
            guard let items = groups[group], !items.isEmpty else { return nil }
            return (group, items)
        }
    }
}
