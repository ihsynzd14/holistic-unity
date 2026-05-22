"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StreamChat } from "stream-chat";
import {
  Chat,
  Channel,
  ChannelList,
  MessageList,
  MessageInput,
  Thread,
  Window,
  useChatContext,
  useChannelStateContext,
} from "stream-chat-react";
import "stream-chat-react/dist/css/v2/index.css";
import { ArrowLeft, MessageCircle, CalendarPlus, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

const STREAM_API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY || "";

export default function MessagesPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  // ?to=<therapist_id> is set by the "Scrivi all'operatore" button on
  // /checkout/success. After Stream Chat connects we use this to
  // create-or-find the 1:1 channel and set it as active so the user
  // lands directly in the conversation, not on an empty inbox.
  const targetUserId = searchParams.get("to");

  const [client, setClient] = useState<StreamChat | null>(null);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const connectionErrorMessage = t.dashboard.connectionError;
  const notAuthenticatedMessage = t.dashboard.notAuthenticated;
  const therapistFallbackName = t.dashboard.therapist;
  const tokenErrorMessage = t.dashboard.tokenError;

  useEffect(() => {
    let chatClient: StreamChat | null = null;

    async function init() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError(notAuthenticatedMessage);
          setLoading(false);
          return;
        }

        // Pull display_name AND photo_url so we can pass the real
        // avatar to Stream Chat. Falling back to ui-avatars only when
        // photo_url is null (new account, no upload yet).
        const { data: userData } = await supabase
          .from("users")
          .select("display_name, photo_url")
          .eq("id", user.id)
          .single();

        // Get or create Stream Chat token (with timeout)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let tokenData: { token?: string; error?: string };
        try {
          const tokenRes = await fetch("/api/stream/token", {
            method: "POST",
            signal: controller.signal,
          });
          clearTimeout(timeout);
          tokenData = await tokenRes.json();
          if (!tokenRes.ok) {
            setError(tokenData.error || tokenErrorMessage);
            setLoading(false);
            return;
          }
        } catch (fetchErr) {
          clearTimeout(timeout);
          const msg = fetchErr instanceof Error && fetchErr.name === "AbortError"
            ? "Timeout: il server non ha risposto entro 10 secondi"
            : `Errore di rete: ${fetchErr instanceof Error ? fetchErr.message : "connessione fallita"}`;
          setError(msg);
          setLoading(false);
          return;
        }

        if (!tokenData.token) {
          setError("Token non ricevuto dal server");
          setLoading(false);
          return;
        }

        if (!STREAM_API_KEY) {
          setError("NEXT_PUBLIC_STREAM_API_KEY non configurata. Contatta l'amministratore.");
          setLoading(false);
          return;
        }

        chatClient = StreamChat.getInstance(STREAM_API_KEY);
        try {
          // Use the user's real photo if uploaded, otherwise an
          // initials avatar in the brand berry. Stream Chat caches
          // this user record by `id` — to refresh an avatar after
          // a photo upload the user must reconnect (we already do
          // that on every page mount via this useEffect, so it
          // self-heals on next visit).
          const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(
            userData?.display_name || "U",
          )}&background=8B2252&color=fff`;
          await chatClient.connectUser(
            {
              id: user.id,
              name: userData?.display_name || user.email || therapistFallbackName,
              image: userData?.photo_url || fallbackAvatar,
            },
            tokenData.token
          );
        } catch (wsErr) {
          const msg = wsErr instanceof Error ? wsErr.message : JSON.stringify(wsErr);
          throw new Error(`Connessione Stream Chat fallita: ${msg}`);
        }

        setClient(chatClient);
        setUserId(user.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : connectionErrorMessage);
      } finally {
        setLoading(false);
      }
    }

    init();

    return () => {
      if (chatClient) chatClient.disconnectUser();
    };
  }, [
    connectionErrorMessage,
    notAuthenticatedMessage,
    therapistFallbackName,
    tokenErrorMessage,
  ]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Spinner className="mx-auto" />
          <p className="mt-3 text-sm text-charcoal-muted">{t.dashboard.loadingMessages}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-2xl border border-error/20 bg-error-light p-8 text-center">
          <p className="font-medium text-error">{error}</p>
          <button
            onClick={() => { setError(""); setLoading(true); window.location.reload(); }}
            className="mt-4 rounded-full bg-berry px-6 py-2.5 text-sm font-medium text-white transition-all hover:bg-berry-dark"
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  if (!client) return null;

  const filters = { type: "messaging", members: { $in: [userId] } };
  const sort = [{ last_message_at: -1 as const }];

  return (
    <div className="space-y-4">
      <div className="animate-reveal">
        <DisplayHeading>{t.messages.title}</DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">{t.messages.subtitle}</p>
      </div>

      <div
        className="animate-reveal hu-stream-chat block w-full overflow-hidden rounded-2xl border border-berry/5 bg-white/80 shadow-sm backdrop-blur-md"
        style={{ animationDelay: "60ms", height: "calc(100vh - 180px)", minHeight: "500px" }}
      >
        <Chat client={client} theme="str-chat__theme-light">
          {/* Deep-link handler: when /dashboard/messages?to=<id> is
              opened (from "Scrivi all'operatore" on /checkout/success),
              create-or-find the 1:1 channel between the current user
              and the target, set it active, and strip the param so
              refreshing the page doesn't loop the create call. */}
          {targetUserId && (
            <AutoOpenChannel
              targetUserId={targetUserId}
              onDone={() => router.replace("/dashboard/messages")}
            />
          )}
          <ResponsivePanes
            filters={filters}
            sort={sort}
            emptyLabel={t.messages.noConversations}
          />
        </Chat>
      </div>
    </div>
  );
}

// Mobile-friendly two-pane layout. On viewports < lg we show ONE pane at a
// time: the channel list by default, the active channel once one is
// selected (with a back button to return to the list). On lg+ both panes
// are side-by-side as before.
//
// Must live inside <Chat> because useChatContext only returns the active
// channel when called from within the chat provider.
function ResponsivePanes({
  filters,
  sort,
  emptyLabel,
}: {
  filters: Parameters<typeof ChannelList>[0]["filters"];
  sort: Parameters<typeof ChannelList>[0]["sort"];
  emptyLabel: string;
}) {
  const { channel, setActiveChannel } = useChatContext();
  const hasActive = Boolean(channel);

  return (
    <div className="flex h-full">
      {/* Channel list pane. On mobile: full width when no channel active,
          hidden otherwise. On desktop: fixed 320px column always visible. */}
      <div
        className={`${
          hasActive ? "hidden lg:block" : "flex w-full flex-col lg:block"
        } lg:w-[320px] lg:flex-shrink-0 border-r border-berry/5 overflow-y-auto bg-white/40`}
      >
        {/* "Start new chat" affordance — without it, users had no way
            to begin a conversation with another operator from this
            screen. Links to the browse page where the next chat can
            be opened from any therapist's profile. */}
        <Link
          href="/dashboard/therapists"
          className="mx-3 mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-berry/25 bg-white/60 px-3 py-2 text-xs font-semibold text-berry transition-colors hover:border-berry/50 hover:bg-berry-subtle/40"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuova conversazione
        </Link>
        <ChannelList
          filters={filters}
          sort={sort}
          showChannelSearch
          EmptyStateIndicator={() => (
            <div className="p-6 text-center">
              <MessageCircle className="mx-auto h-8 w-8 text-berry-muted/40" strokeWidth={1} />
              <p className="mt-2 text-xs text-charcoal-muted">{emptyLabel}</p>
            </div>
          )}
        />
      </div>

      {/* Active channel pane. On mobile: full width when a channel is
          active, hidden otherwise. On desktop: always visible flex-1. */}
      <div
        className={`${
          hasActive ? "flex w-full" : "hidden lg:block"
        } min-w-0 flex-1`}
      >
        <Channel>
          <Window>
            {/* Mobile-only back button row. lg:hidden so it disappears on
                desktop where both panes are visible side-by-side. */}
            <div className="flex items-center border-b border-berry/5 bg-white/60 px-3 py-2 lg:hidden">
              <button
                type="button"
                onClick={() => setActiveChannel?.(undefined)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-berry hover:bg-berry-subtle/50"
                aria-label="Torna alla lista conversazioni"
              >
                <ArrowLeft className="h-4 w-4" />
                Conversazioni
              </button>
            </div>
            <CustomChannelHeader />
            <MessageList />
            <MessageInput />
          </Window>
          <Thread />
        </Channel>
      </div>
    </div>
  );
}

// Custom chat header. Replaces Stream Chat's default `ChannelHeader`,
// which showed a generic "2 membri, 1 online" line for 1:1 DMs and had
// no booking CTA. We render:
//   - other member's avatar + display name
//   - presence (green dot + "Online" / muted dot + "Offline")
//   - a "Prenota sessione" CTA linking to the operator's public profile
//     (the chat → booking conversion path is the highest-value flow on
//     this page and was missing)
function CustomChannelHeader() {
  const { channel } = useChannelStateContext();
  const { client } = useChatContext();

  const otherUser = useMemo(() => {
    const members = channel?.state?.members ?? {};
    const other = Object.values(members).find(
      (m) => m.user?.id && m.user.id !== client.userID,
    );
    return other?.user ?? null;
  }, [channel, client.userID]);

  if (!otherUser) {
    // Channel still loading or no other member yet — render a minimal
    // header so the layout doesn't jump.
    return (
      <div className="flex h-[60px] items-center border-b border-berry/5 bg-white/85 px-4" />
    );
  }

  const isOnline = Boolean(otherUser.online);
  const name = otherUser.name || "Operatore";

  return (
    <div className="flex items-center gap-3 border-b border-berry/5 bg-white/85 px-4 py-3 backdrop-blur-md">
      <div className="relative h-10 w-10 flex-shrink-0">
        {otherUser.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={otherUser.image as string}
            alt={name}
            className="h-10 w-10 rounded-full object-cover ring-2 ring-white"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-berry-subtle to-gold/30 text-sm font-bold text-berry-dark ring-2 ring-white">
            {name[0]?.toUpperCase()}
          </div>
        )}
        {isOnline && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-success"
            aria-label="Online"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-charcoal">{name}</p>
        <p className="text-xs text-charcoal-muted">
          {isOnline ? "Online" : "Offline"}
        </p>
      </div>
      <Link
        href={`/dashboard/therapists/${otherUser.id}#prenota`}
        className="inline-flex items-center gap-1.5 rounded-full bg-berry px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-berry/20 transition-all hover:bg-berry-dark hover:shadow-md"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Prenota
      </Link>
    </div>
  );
}

// Deep-link helper: when the user lands on /dashboard/messages?to=<id>
// (typically from "Scrivi all'operatore" on /checkout/success), this
// component runs once Stream Chat has connected and:
//   1. Builds a deterministic channel ID from the two user UUIDs
//      (sorted, so client→therapist and therapist→client resolve to
//      the same channel)
//   2. Calls channel.create() — Stream's create is idempotent, returns
//      the existing channel if one with the same ID already exists
//   3. Calls watch() to subscribe (required before setActiveChannel)
//   4. Sets the channel as active in the chat UI
//   5. Calls onDone() so the parent can clear the URL param (avoids
//      re-running the create on every re-render or refresh)
function AutoOpenChannel({
  targetUserId,
  onDone,
}: {
  targetUserId: string;
  onDone: () => void;
}) {
  const { client, setActiveChannel } = useChatContext();

  useEffect(() => {
    if (!client?.userID) return;

    let cancelled = false;
    async function open() {
      try {
        // Stream channel IDs have a 64-char limit. UUID-based IDs
        // would blow past that, so we hash the sorted pair into a
        // short stable id. We use the first 8 chars of each UUID
        // joined with a separator — enough entropy for a marketplace
        // of 1k users without collisions, and human-debuggable.
        const a = client.userID!;
        const b = targetUserId;
        const [x, y] = [a, b].sort();
        const channelId = `dm-${x.slice(0, 8)}-${y.slice(0, 8)}`;

        const channel = client.channel("messaging", channelId, {
          members: [a, b],
        } as Record<string, unknown>);
        await channel.watch();
        if (cancelled) return;
        setActiveChannel?.(channel);
      } catch (err) {
        console.warn("[messages] AutoOpenChannel failed:", err);
      } finally {
        if (!cancelled) onDone();
      }
    }
    void open();
    return () => {
      cancelled = true;
    };
  }, [client, client?.userID, onDone, setActiveChannel, targetUserId]);

  return null;
}
