"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { StreamChat } from "stream-chat";
import {
  Chat,
  Channel,
  ChannelHeader,
  ChannelList,
  MessageList,
  MessageInput,
  Thread,
  Window,
} from "stream-chat-react";
import "stream-chat-react/dist/css/v2/index.css";
import { MessageCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayHeading } from "@/components/ui/DisplayHeading";
import { SafeAvatar } from "@/components/chat/SafeAvatar";

const STREAM_API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY || "";

export default function MessagesPage() {
  const { t } = useI18n();
  const [client, setClient] = useState<StreamChat | null>(null);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let chatClient: StreamChat | null = null;

    async function init() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError(t.dashboard.notAuthenticated);
          setLoading(false);
          return;
        }

        // Pull display_name + photo_url so Stream Chat shows the real
        // therapist avatar in conversations (was using a generic
        // initials fallback before). Mirrors the client-webapp.
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
            setError(tokenData.error || t.dashboard.tokenError);
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

        // The chat avatar is stored from users.photo_url, but the web profile
        // photo upload historically wrote only therapist_profiles.photo_url —
        // so the two could drift and an operator with a profile photo could
        // still show no chat avatar. Fall back to the therapist profile photo
        // (via the self-scoped my_therapist_profile view) when the users row
        // has none, so the avatar self-heals on the next connect with no
        // manual backfill. The upload now writes both tables going forward.
        let avatarUrl = userData?.photo_url ?? undefined;
        if (!avatarUrl) {
          const { data: profilePhoto } = await supabase
            .from("my_therapist_profile")
            .select("photo_url")
            .eq("id", user.id)
            .single();
          avatarUrl = profilePhoto?.photo_url ?? undefined;
        }

        chatClient = StreamChat.getInstance(STREAM_API_KEY);
        try {
          // Only store a real uploaded photo (CSP allows *.supabase.co). When
          // there's none we leave `image` unset and let Stream render its
          // native berry initials. SafeAvatar is the belt-and-braces.
          await chatClient.connectUser(
            {
              id: user.id,
              name: userData?.display_name || user.email || t.dashboard.therapist,
              image: avatarUrl,
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
        setError(err instanceof Error ? err.message : t.dashboard.connectionError);
      } finally {
        setLoading(false);
      }
    }

    init();

    return () => {
      if (chatClient) chatClient.disconnectUser();
    };
  }, []);

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
        className="animate-reveal hu-stream-chat overflow-hidden rounded-2xl border border-berry/5 bg-white/80 shadow-sm backdrop-blur-md"
        style={{ animationDelay: "60ms", height: "calc(100vh - 180px)", minHeight: "500px" }}
      >
        <Chat client={client} theme="str-chat__theme-light">
          <div className="flex h-full">
            <div className="w-[320px] border-r border-berry/5 overflow-y-auto bg-white/40">
              <ChannelList
                filters={filters}
                sort={sort}
                showChannelSearch
                Avatar={SafeAvatar}
                EmptyStateIndicator={() => (
                  <div className="p-6 text-center">
                    <MessageCircle className="mx-auto h-8 w-8 text-berry-muted/40" strokeWidth={1} />
                    <p className="mt-2 text-xs text-charcoal-muted">{t.messages.noConversations}</p>
                  </div>
                )}
              />
            </div>
            <div className="flex-1">
              <Channel Avatar={SafeAvatar}>
                <Window>
                  <ChannelHeader Avatar={SafeAvatar} />
                  <MessageList />
                  <MessageInput />
                </Window>
                <Thread />
              </Channel>
            </div>
          </div>
        </Chat>
      </div>
    </div>
  );
}
