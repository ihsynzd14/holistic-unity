"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChannelPreviewMessenger,
  useChatContext,
  type ChannelAvatarProps,
  type ChannelPreviewUIComponentProps,
} from "stream-chat-react";
import { createClient } from "@/lib/supabase/client";
import { SafeAvatar, renderableAvatarUrl } from "./SafeAvatar";

/**
 * Operator avatar resolver for the Messaggi screen.
 *
 * Why this exists: Stream Chat stores an operator's avatar from whatever
 * their OWN app's `connectUser` set as `image`. That value comes from
 * `users.photo_url`, but the web profile-photo upload historically wrote
 * only `therapist_profiles.photo_url`, so the two drift: an operator can
 * have a perfectly good profile photo (rendered fine on "Trova operatore")
 * yet show nothing but initials in chat until they next reconnect. The
 * client has no control over when the other party reconnects.
 *
 * This provider closes that gap entirely client-side: for every operator
 * the user is chatting with, it looks up the canonical photo from
 * `therapist_profiles_public` — the exact same RLS-safe, visibility-filtered
 * view the "Trova operatore" list reads — and feeds it into the chat avatar
 * surfaces (header, channel-list preview, message sender avatar) whenever
 * Stream has no usable image. Because the view only exposes approved +
 * bookable operators' public columns, requesting arbitrary ids can never
 * leak a private photo, and the resolved id IS the Stream member id (it's
 * the `?to=<therapist_id>` value the channel was created with).
 *
 * Lookups are batched (one query per render burst) and cached for the life
 * of the page; a `null` entry means "looked up, no usable photo" so we never
 * refetch a known miss.
 */

type AvatarMap = Record<string, string | null>;

type OperatorAvatarContextValue = {
  request: (id: string) => void;
  photos: AvatarMap;
};

const OperatorAvatarContext = createContext<OperatorAvatarContextValue>({
  request: () => {},
  photos: {},
});

export function OperatorAvatarProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<AvatarMap>({});
  // Mirror of `photos` in a ref so `request`/`flush` can read the latest
  // known set synchronously without being re-created on every state change.
  const photosRef = useRef<AvatarMap>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    flushTimer.current = null;
    const ids = Array.from(pendingRef.current).filter(
      (id) => !(id in photosRef.current) && !inFlightRef.current.has(id),
    );
    pendingRef.current.clear();
    if (ids.length === 0) return;
    ids.forEach((id) => inFlightRef.current.add(id));

    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("therapist_profiles_public")
        .select("id, photo_url")
        .in("id", ids);

      // Default every requested id to a miss, then fill in the hits. This
      // pins known-misses to `null` so we don't re-query operators (or
      // non-operators like admins) that simply have no public photo.
      const next: AvatarMap = {};
      for (const id of ids) next[id] = null;
      for (const row of (data ?? []) as Array<{ id: string; photo_url: string | null }>) {
        next[row.id] = renderableAvatarUrl(row.photo_url) ?? null;
      }

      photosRef.current = { ...photosRef.current, ...next };
      setPhotos((prev) => ({ ...prev, ...next }));
    } catch {
      // Best-effort: leave the ids unresolved so a later mount can retry.
      // The avatar simply stays on its Stream value / initials fallback.
    } finally {
      ids.forEach((id) => inFlightRef.current.delete(id));
    }
  }, []);

  const request = useCallback(
    (id: string) => {
      if (
        !id ||
        id in photosRef.current ||
        pendingRef.current.has(id) ||
        inFlightRef.current.has(id)
      ) {
        return;
      }
      pendingRef.current.add(id);
      if (!flushTimer.current) {
        flushTimer.current = setTimeout(() => void flush(), 50);
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  const value = useMemo(() => ({ request, photos }), [request, photos]);

  return (
    <OperatorAvatarContext.Provider value={value}>
      {children}
    </OperatorAvatarContext.Provider>
  );
}

/**
 * Returns the canonical operator photo for `id` (CSP-safe, or `undefined`
 * when there's no usable one / not yet loaded). Registering the id triggers
 * a batched lookup; the component re-renders with the url once it resolves.
 */
export function useOperatorAvatar(id?: string | null): string | undefined {
  const { request, photos } = useContext(OperatorAvatarContext);
  useEffect(() => {
    if (id) request(id);
  }, [id, request]);
  return id ? photos[id] ?? undefined : undefined;
}

/** First channel member that isn't the current user (1:1 channels only). */
function useOtherMemberId(
  channel: ChannelPreviewUIComponentProps["channel"],
): string | undefined {
  const { client } = useChatContext();
  const members = channel?.state?.members ?? {};
  // Only resolve for direct (1:1) channels — group avatars keep Stream's
  // stock multi-avatar composition via SafeAvatar/ChannelAvatar.
  if (Object.keys(members).length !== 2) return undefined;
  return Object.values(members).find(
    (m) => m.user?.id && m.user.id !== client.userID,
  )?.user?.id;
}

/**
 * ChannelList preview that backfills the operator's avatar from
 * `therapist_profiles_public` when Stream has none. Identical to Stream's
 * stock messenger preview in every other respect (unread badge, last
 * message, timestamp, active state, click handling).
 */
export function OperatorChannelPreview(props: ChannelPreviewUIComponentProps) {
  const resolved = useOperatorAvatar(useOtherMemberId(props.channel));

  const AvatarWithResolved = useCallback(
    (avatarProps: ChannelAvatarProps) => (
      <SafeAvatar {...avatarProps} image={resolved ?? avatarProps.image} />
    ),
    [resolved],
  );

  return <ChannelPreviewMessenger {...props} Avatar={AvatarWithResolved} />;
}

/**
 * Avatar for the message list / sender slots that backfills an operator's
 * photo by their user id when Stream's stored image is missing or blocked.
 * Delegates the actual render (host-gate + initials fallback) to SafeAvatar.
 */
export function OperatorMessageAvatar(props: ChannelAvatarProps) {
  const resolved = useOperatorAvatar(props.user?.id);
  return <SafeAvatar {...props} image={resolved ?? props.image} />;
}
