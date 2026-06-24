"use client";

import { useEffect, useState } from "react";
import {
  Chat,
  Channel,
  ChannelHeader,
  ChannelList,
  MessageInput,
  MessageList,
  Thread,
  Window,
} from "stream-chat-react";
import { StreamChat } from "stream-chat";
import "stream-chat-react/dist/css/v2/index.css";

export default function StreamChatProvider() {
  const [client, setClient] = useState<StreamChat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let chatClient: StreamChat | null = null;
    let didCancel = false;

    async function init() {
      try {
        const res = await fetch("/api/stream/token", { method: "POST" });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to get Stream token");
        }
        const { token, userId, apiKey } = await res.json();

        chatClient = StreamChat.getInstance(apiKey);

        if (!chatClient.userID) {
          await chatClient.connectUser(
            { id: userId, name: "Holistic Unity", image: "/logo.png" },
            token
          );
        }

        if (!didCancel) {
          setClient(chatClient);
          setLoading(false);
        }
      } catch (err) {
        if (!didCancel) {
          setError(err instanceof Error ? err.message : "Failed to connect to chat");
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      didCancel = true;
      if (chatClient) chatClient.disconnectUser().catch(() => {});
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-berry/20 border-t-berry" />
          <p className="text-sm text-charcoal-muted">Connecting to chat...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center rounded-2xl border border-berry/5 bg-white/70 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-error-light">
            <svg className="h-7 w-7 text-error" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-charcoal">{error}</p>
          <p className="max-w-sm text-center text-xs text-charcoal-muted">
            Make sure the STREAM_API_SECRET environment variable is set.
          </p>
        </div>
      </div>
    );
  }

  if (!client) return null;

  const filters = { type: "messaging", members: { $in: ["holistic-unity-support"] } };
  const sort = { last_message_at: -1 as const };
  const options = { limit: 20, presence: true, state: true };

  return (
    <div className="hu-stream-chat h-[calc(100vh-12rem)] overflow-hidden rounded-2xl border border-berry/5 shadow-sm backdrop-blur-sm">
      <Chat client={client} theme="str-chat__theme-light">
        <div className="flex h-full">
          {/* Channel list sidebar */}
          <div className="w-[320px] shrink-0 border-r border-berry/5 bg-white/80">
            <ChannelList
              filters={filters}
              sort={sort}
              options={options}
              setActiveChannelOnMount={true}
              showChannelSearch
              additionalChannelSearchProps={{ searchForChannels: true }}
              EmptyStateIndicator={() => (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-berry-subtle/50">
                    <svg className="h-7 w-7 text-berry-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                  </div>
                  <p className="mt-3 text-sm font-medium text-charcoal">No conversations yet</p>
                  <p className="mt-1 text-xs text-charcoal-muted">
                    When therapists contact support, their messages will appear here.
                  </p>
                </div>
              )}
            />
          </div>

          {/* Active channel */}
          <div className="flex-1 bg-white/60">
            <Channel>
              <Window>
                <ChannelHeader />
                <MessageList />
                <MessageInput focus />
              </Window>
              <Thread />
            </Channel>
          </div>
        </div>
      </Chat>
    </div>
  );
}
