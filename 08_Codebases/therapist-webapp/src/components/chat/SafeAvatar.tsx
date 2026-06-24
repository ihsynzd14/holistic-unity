"use client";

import { useEffect, useState } from "react";
import { ChannelAvatar, type ChannelAvatarProps } from "stream-chat-react";

/**
 * Returns the avatar URL ONLY if our CSP `img-src` (see
 * src/lib/security/csp.ts) would actually allow the browser to load it —
 * same-origin, data/blob, Supabase Storage, or Stream's own CDN.
 *
 * Anything else (notably the legacy `ui-avatars.com` fallback URL still
 * cached on some Stream user records) returns `undefined`, so callers render
 * the initials placeholder WITHOUT ever creating an `<img>` element pointing
 * at a blocked host. This is the crucial bit: an `onError` handler does NOT
 * prevent the request — the browser still fires it, CSP still blocks it, and
 * the console still logs a violation. Not emitting the element at all is the
 * only way to keep the console clean.
 */
export function renderableAvatarUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/") || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return undefined;
    const allowed =
      hostname.endsWith(".supabase.co") ||
      hostname.endsWith(".stream-io-cdn.com");
    return allowed ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Drop-in replacement for Stream Chat's default avatar that never leaves a
 * broken-image icon on screen AND never triggers a CSP-blocked request.
 * Group channels keep Stream's stock multi-avatar layout.
 */
export function SafeAvatar(props: ChannelAvatarProps) {
  const { className, groupChannelDisplayInfo, image, name, onClick, onMouseOver } =
    props;
  const [failed, setFailed] = useState(false);

  // Reset the error flag when the source changes (e.g. the user reconnects
  // with a freshly uploaded photo) so a now-valid image gets another chance.
  useEffect(() => setFailed(false), [image]);

  // Group channels: keep Stream's stock multi-avatar composition.
  if (groupChannelDisplayInfo?.length) {
    return <ChannelAvatar {...props} />;
  }

  const initial = (name?.trim()?.[0] || "?").toUpperCase();
  // Gate on host: only render an <img> for URLs CSP permits. A blocked host
  // (ui-avatars.com) collapses to initials with no doomed network request.
  const safeImage = failed ? undefined : renderableAvatarUrl(image);
  const rootClass = ["str-chat__avatar str-chat__message-sender-avatar", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClass}
      data-testid="avatar"
      onClick={onClick}
      onMouseOver={onMouseOver}
      role="button"
      title={name}
    >
      {safeImage ? (
        <img
          alt={initial}
          className="str-chat__avatar-image"
          data-testid="avatar-img"
          onError={() => setFailed(true)}
          src={safeImage}
        />
      ) : (
        <div className="str-chat__avatar-fallback" data-testid="avatar-fallback">
          {initial}
        </div>
      )}
    </div>
  );
}
