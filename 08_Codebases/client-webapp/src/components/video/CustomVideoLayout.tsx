"use client";

import {
  GridLayout,
  ParticipantTile,
  FocusLayout,
  FocusLayoutContainer,
  CarouselLayout,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useState, useCallback } from "react";

interface CustomVideoLayoutProps {
  onEndSession: () => void;
}

export default function CustomVideoLayout({ onEndSession }: CustomVideoLayoutProps) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const { localParticipant } = useLocalParticipant();
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const screenShareTracks = tracks.filter(
    (t) => t.source === Track.Source.ScreenShare
  );
  const cameraTracks = tracks.filter(
    (t) => t.source === Track.Source.Camera
  );

  // Manual toggles — no auto-prompt on mount
  const toggleMic = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(!isMicOn);
    setIsMicOn(!isMicOn);
  }, [localParticipant, isMicOn]);

  const toggleCam = useCallback(async () => {
    await localParticipant.setCameraEnabled(!isCamOn);
    setIsCamOn(!isCamOn);
  }, [localParticipant, isCamOn]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (isScreenSharing) {
        await localParticipant.setScreenShareEnabled(false);
        setIsScreenSharing(false);
      } else {
        await localParticipant.setScreenShareEnabled(true);
        setIsScreenSharing(true);
      }
    } catch {
      // User cancelled the screen share picker
      setIsScreenSharing(false);
    }
  }, [localParticipant, isScreenSharing]);

  return (
    <div className="relative h-full w-full">
      {/* Video area — fills all space except the control bar */}
      <div className="absolute inset-0 bottom-[72px] overflow-hidden bg-black">
        {screenShareTracks.length > 0 ? (
          <FocusLayoutContainer className="h-full">
            <CarouselLayout tracks={cameraTracks} style={{ width: "200px" }}>
              <ParticipantTile />
            </CarouselLayout>
            <FocusLayout trackRef={screenShareTracks[0]} className="flex-1" />
          </FocusLayoutContainer>
        ) : (
          <GridLayout tracks={cameraTracks} className="h-full">
            <ParticipantTile />
          </GridLayout>
        )}
        <RoomAudioRenderer />
      </div>

      {/* ─── Control Bar — ALWAYS visible, fixed at bottom ─── */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 bg-[#1a1a2e] px-6 border-t border-white/10"
           style={{ height: "72px" }}>

        {/* Mic */}
        <button
          onClick={toggleMic}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
            isMicOn
              ? "bg-white/10 text-white hover:bg-white/20"
              : "bg-red-500 text-white hover:bg-red-600"
          }`}
          title={isMicOn ? "Mute microphone" : "Unmute microphone"}
        >
          {isMicOn ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5.29"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          )}
        </button>

        {/* Camera */}
        <button
          onClick={toggleCam}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
            isCamOn
              ? "bg-white/10 text-white hover:bg-white/20"
              : "bg-red-500 text-white hover:bg-red-600"
          }`}
          title={isCamOn ? "Turn off camera" : "Turn on camera"}
        >
          {isCamOn ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/></svg>
          )}
        </button>

        {/* Screen Share */}
        <button
          onClick={toggleScreenShare}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
            isScreenSharing
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-white/10 text-white hover:bg-white/20"
          }`}
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          {isScreenSharing ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/><line x1="17" x2="22" y1="8" y2="3"/><line x1="17" x2="22" y1="3" y2="8"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/><polyline points="17 8 22 3 22 8"/></svg>
          )}
        </button>

        {/* Separator */}
        <div className="mx-1 h-8 w-px bg-white/20" />

        {/* End Session */}
        <button
          onClick={onEndSession}
          className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-6 text-sm font-semibold text-white transition-all hover:bg-red-700 active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4Z"/><line x1="22" x2="16" y1="2" y2="8"/><line x1="16" x2="22" y1="2" y2="8"/></svg>
          End Session
        </button>
      </div>
    </div>
  );
}
