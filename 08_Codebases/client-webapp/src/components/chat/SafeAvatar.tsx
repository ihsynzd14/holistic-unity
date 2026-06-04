"use client";

import { useEffect, useState } from "react";
import { ChannelAvatar, type ChannelAvatarProps } from "stream-chat-react";

/**
 * Drop-in replacement for Stream Chat's default avatar that never leaves a
 * broken-image icon on screen.
 *
 * WHY THIS EXISTS:
 *   The other party in a conversation is an operator (therapist). Those
 *   without an uploaded `photo_url` historically had a `ui-avatars.com`
 *   URL stored as their Stream avatar. This app's CSP `img-src` (see
 *   src/lib/security/csp.ts) does not allow that host, so it is blocked
 *   and renders as a torn-photo placeholder. Stream's stock Avatar has an
 *   onError fallback, yet a CSP-blocked / 404 URL can still flash the
 *   broken icon before it settles.
 *
 *   This component renders the initials fallback the instant the image
 *   fails (or is absent), reusing Stream's own CSS classes so the existing
 *   globals.css theming applies unchanged. Group channels keep Stream's
 *   stock multi-avatar layout.
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
  const showImage = Boolean(image) && !failed;
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
      {showImage ? (
        <img
          alt={initial}
          className="str-chat__avatar-image"
          data-testid="avatar-img"
          onError={() => setFailed(true)}
          src={image ?? undefined}
        />
      ) : (
        <div className="str-chat__avatar-fallback" data-testid="avatar-fallback">
          {initial}
        </div>
      )}
    </div>
  );
}
