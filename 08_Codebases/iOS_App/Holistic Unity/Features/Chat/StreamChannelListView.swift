import SwiftUI
import StreamChat
import StreamChatSwiftUI

/// Wraps Stream's ChatChannelListView with the app's navigation and styling.
/// Replaces the old ConversationsView for the Messages tab.
///
/// IMPORTANT: ChatChannelListView embeds its own NavigationView internally.
/// Do NOT wrap this in a NavigationStack — that causes a double-navigation
/// conflict where the channel detail view appears frozen/blank.
struct StreamChannelListView: View {
    @Environment(AuthManager.self) private var authManager
    @StateObject private var streamService = StreamChatService.shared
    
    /// Stable controller reference — created once per userId, not on every body evaluation.
    @State private var channelListController: ChatChannelListController?
    @State private var connectionFailed = false
    
    var body: some View {
        Group {
            if streamService.isConnected, let controller = channelListController {
                // ChatChannelListView provides its own NavigationView — no wrapper needed
                ChatChannelListView(
                    viewFactory: HUChatViewFactory.shared,
                    channelListController: controller
                )
            } else if connectionFailed {
                NavigationStack {
                    VStack(spacing: 16) {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 40))
                            .foregroundStyle(.secondary)
                        Text("Couldn't load messages")
                            .font(.headline)
                        Text("Check your connection and try again")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Retry") {
                            connectionFailed = false
                            Task {
                                await retryConnection()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(HUColor.primary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemBackground))
                    .navigationTitle("Messages")
                }
            } else if authManager.currentUser != nil {
                NavigationStack {
                    VStack(spacing: 16) {
                        HULoadingView(message: "Loading messages…")
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemBackground))
                    .navigationTitle("Messages")
                }
            } else {
                NavigationStack {
                    HUEmptyState(
                        icon: "bubble.left.and.bubble.right",
                        title: "Not Signed In",
                        message: "Sign in to view your messages"
                    )
                    .navigationTitle("Messages")
                }
            }
        }
        .onChange(of: streamService.isConnected) { _, connected in
            if connected, let userId = authManager.currentUser?.id {
                createControllerIfNeeded(userId: userId)
            }
        }
        .onChange(of: authManager.currentUser?.id) { _, userId in
            // User changed — reset controller
            channelListController = nil
            if let userId, streamService.isConnected {
                createControllerIfNeeded(userId: userId)
            }
        }
        .onAppear {
            if let userId = authManager.currentUser?.id, streamService.isConnected {
                createControllerIfNeeded(userId: userId)
            }
        }
        .task {
            // If Stream hasn't connected after a reasonable wait, show retry
            if !streamService.isConnected {
                try? await Task.sleep(for: .seconds(15))
                if !streamService.isConnected && authManager.currentUser != nil {
                    connectionFailed = true
                }
            }
        }
    }
    
    private func createControllerIfNeeded(userId: String) {
        guard channelListController == nil else { return }
        let filter: Filter<ChannelListFilterScope> = .containMembers(userIds: [userId])
        let sort: [Sorting<ChannelListSortingKey>] = [.init(key: .lastMessageAt, isAscending: false)]
        let query = ChannelListQuery(filter: filter, sort: sort, pageSize: 25)
        channelListController = StreamChatService.shared.chatClient.channelListController(query: query)
    }
    
    private func retryConnection() async {
        guard let user = authManager.currentUser else { return }
        await StreamChatService.shared.connectUser(
            userId: user.id,
            name: user.displayName,
            imageURL: user.photoURL
        )
    }
}
