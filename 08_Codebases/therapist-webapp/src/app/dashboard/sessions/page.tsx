"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  ControlBar,
  useTracks,
  useRoomContext,
  useParticipants,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, RoomEvent } from "livekit-client";
import { Video, MonitorUp, Users, Wifi, WifiOff, AlertTriangle, CheckCircle, ArrowLeft } from "lucide-react";
import { getJoinWindow } from "@/lib/booking/join-window";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

// LiveKit Cloud URL from iOS app config
const LIVEKIT_URL = "wss://holistic-unity-7cj033ty.livekit.cloud";

type SessionBooking = {
  id: string;
  scheduled_at: string;
  service_name: string;
  duration: number;
  video_room_id: string | null;
  status: string;
  client_name: string;
};

export default function SessionsPage() {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<SessionBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<SessionBooking | null>(null);
  const [token, setToken] = useState("");
  const [roomName, setRoomName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [preCallChecks, setPreCallChecks] = useState({ camera: false, mic: false, network: false, checked: false });

  // Fetch upcoming + still-joinable sessions.
  //
  // The lower time bound MUST cover sessions that are still inside the
  // LiveKit join window even if they started before midnight. The token
  // route (`/api/livekit/token`) allows joining 15 min before
  // `scheduled_at` and up to ~3 hours after `scheduled_at + duration`
  // (matching `livekit-token/index.ts:76` and `09-video-call.md`'s
  // invariants). Using `startOfDay` as the lower bound silently hid
  // late-night sessions from the dashboard right when the therapist
  // most needs them — e.g. a 23:00 session that drops at 23:55 leaves
  // the therapist staring at an empty list at 00:05 even though the
  // room is still joinable until ~03:00.
  //
  // We back off 6 hours to comfortably cover the longest realistic
  // session (90 min) plus the 3 h grace, with a small buffer for clock
  // skew. Status filter must include `reschedule_pending` because the
  // join window is still open during a pending reschedule (per
  // `09-video-call.md` preconditions).
  const fetchSessions = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const lowerBound = new Date();
    lowerBound.setHours(lowerBound.getHours() - 6);
    const endOfTomorrow = new Date();
    endOfTomorrow.setHours(0, 0, 0, 0);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
    const from = lowerBound.toISOString();
    const to = endOfTomorrow.toISOString();

    const { data } = await supabase
      .from("bookings")
      .select("id, scheduled_at, service_name, duration, video_room_id, status, client_id")
      .eq("therapist_id", user.id)
      .in("status", [
        "confirmed",
        "in_progress",
        "reschedule_pending",
        "completed",
      ])
      .gte("scheduled_at", from)
      .lte("scheduled_at", to)
      .order("scheduled_at", { ascending: true });

    if (data && data.length > 0) {
      // Fetch client names via user_display_info view — no email or
      // phone needed here, so the stricter view is enough.
      const clientIds = [...new Set(data.map(b => b.client_id))];
      const { data: clients } = await supabase
        .from("user_display_info")
        .select("id, display_name")
        .in("id", clientIds);

      const clientMap = new Map((clients || []).map(c => [c.id, c.display_name]));

      setSessions(data.map(b => ({
        ...b,
        client_name: clientMap.get(b.client_id) || t.sessions.defaultClient,
      })));
    } else {
      setSessions([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Pre-call permission checks
  async function runPreCallChecks() {
    const results = { camera: false, mic: false, network: false, checked: true };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      results.camera = true;
      results.mic = true;
      stream.getTracks().forEach(t => t.stop());
    } catch {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        results.mic = true;
        audioStream.getTracks().forEach(t => t.stop());
      } catch { /* mic failed */ }
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        results.camera = true;
        videoStream.getTracks().forEach(t => t.stop());
      } catch { /* camera failed */ }
    }

    results.network = navigator.onLine;
    setPreCallChecks(results);
    return results;
  }

  // Join session — opens the video call in a dedicated browser tab.
  // This prevents the call from dropping when navigating the dashboard.
  async function joinSession(session: SessionBooking) {
    setConnecting(true);
    setConnectionError("");

    // Run pre-call checks before opening the tab
    const checks = await runPreCallChecks();
    if (!checks.mic) {
      setConnectionError(t.sessions.micNotAvailable);
      setConnecting(false);
      return;
    }
    if (!checks.network) {
      setConnectionError(t.sessions.noInternet);
      setConnecting(false);
      return;
    }

    try {
      // Server-mediated state transition. Direct supabase.from('bookings')
      // .update was removed — it had no auth check beyond RLS, no rate
      // limit, no optimistic lock (a `completed` row could be flipped
      // back to `in_progress`), and no audit. /api/bookings/[id]/start
      // does all four.
      const res = await fetch(`/api/bookings/${session.id}/start`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConnectionError(data?.error || t.sessions.connectionError);
        setConnecting(false);
        return;
      }

      // Open the dedicated call page in a new tab
      window.open(`/call/${session.id}`, "_blank");

      // Refresh the session list to show updated status
      await fetchSessions();
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : t.sessions.connectionError);
    } finally {
      setConnecting(false);
    }
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  // Video calls now open in a dedicated tab (/call/[bookingId]).
  // The sessions page is always a list — no inline video rendering.

  // ─── Session list / pre-call ────────────────────────────────────
  return (
    <div className="space-y-8">
      <div className="animate-reveal">
        <DisplayHeading>{t.sessions.title}</DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">
          {t.sessions.subtitleFull}
        </p>
      </div>

      {/* Features highlight */}
      <div className="animate-reveal grid grid-cols-1 gap-4 sm:grid-cols-3" style={{ animationDelay: "40ms" }}>
        {[
          { icon: Video, label: t.sessions.videoHD, desc: t.sessions.videoHDDesc },
          { icon: MonitorUp, label: t.sessions.screenShareLabel, desc: t.sessions.screenShareDesc },
          { icon: Users, label: t.sessions.secureSessions, desc: t.sessions.secureSessionsDesc },
        ].map((f) => (
          <div key={f.label} className="rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
            <div className="rounded-xl bg-berry-subtle p-2.5 w-fit">
              <f.icon className="h-5 w-5 text-berry" strokeWidth={1.5} />
            </div>
            <p className="mt-3 text-sm font-semibold text-charcoal">{f.label}</p>
            <p className="mt-0.5 text-xs text-charcoal-muted">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Pre-call check results */}
      {preCallChecks.checked && (
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm" style={{ animationDelay: "80ms" }}>
          <p className="text-sm font-semibold text-charcoal mb-3">{t.sessions.preCallChecks}</p>
          <div className="flex flex-wrap gap-4">
            {[
              { ok: preCallChecks.camera, label: t.sessions.camera },
              { ok: preCallChecks.mic, label: t.sessions.microphone },
              { ok: preCallChecks.network, label: t.sessions.network },
            ].map((c) => (
              <div key={c.label} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                c.ok ? "bg-success-light text-success" : "bg-error-light text-error"
              }`}>
                {c.ok ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {c.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {connectionError && (
        <div className="animate-reveal rounded-2xl border border-error/20 bg-error-light p-4">
          <p className="text-sm font-medium text-error">{connectionError}</p>
        </div>
      )}

      {/* Sessions list */}
      {sessions.length === 0 ? (
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/50 p-12 text-center" style={{ animationDelay: "120ms" }}>
          <Video className="mx-auto h-12 w-12 text-berry-muted/40" strokeWidth={1} />
          <p className="mt-4 font-medium text-charcoal-muted">{t.sessions.noSessions}</p>
          <p className="mt-1 text-sm text-charcoal-muted/70">{t.sessions.noSessionsDesc}</p>
          <button
            onClick={runPreCallChecks}
            className="mt-4 rounded-full border border-berry/20 px-4 py-2 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
          >
            {t.sessions.testDevices}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session, i) => {
            const date = new Date(session.scheduled_at);
            const now = new Date();
            // Single source of truth for the join window: opens 15 min
            // before scheduled_at and stays open for 3 hours total. This
            // intentionally replaces the old "any time on the session's
            // day" check, which let the therapist click "Start" at 8am
            // for an evening appointment. See
            // src/lib/booking/join-window.ts.
            const window = getJoinWindow(date, now);
            const isStartable =
              session.status === "confirmed" ||
              session.status === "in_progress" ||
              session.status === "reschedule_pending";
            // Completed sessions get the same 3h re-entry window as the
            // helper provides — covers accidental disconnects and the
            // therapist marking the session done a few minutes early.
            const isCompletedWithinGrace =
              session.status === "completed" && window.state === "open";
            const canJoin =
              (isStartable && window.state === "open") || isCompletedWithinGrace;
            const isLive = session.status === "in_progress";
            const isRejoinable = isCompletedWithinGrace;

            return (
              <div
                key={session.id}
                className="animate-reveal flex items-center gap-4 rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
                style={{ animationDelay: `${120 + i * 40}ms` }}
              >
                {/* Time badge */}
                <div className={`flex h-16 w-16 flex-shrink-0 flex-col items-center justify-center rounded-xl ${
                  isLive ? "bg-success text-white" : isRejoinable ? "bg-warning text-white" : canJoin ? "bg-berry text-white" : "bg-berry-subtle text-berry"
                }`}>
                  {isLive && <span className="h-2 w-2 rounded-full bg-white animate-pulse mb-1" />}
                  <span className="text-lg font-bold leading-none">
                    {date.toLocaleTimeString(locale === "it" ? "it-IT" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}
                  </span>
                  <span className="text-[10px] mt-0.5 opacity-80">{session.duration} {t.sessions.minutes}</span>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-charcoal">{session.client_name}</p>
                  <p className="text-xs text-charcoal-muted mt-0.5">
                    {session.service_name} &middot;{" "}
                    {date.toLocaleDateString(locale === "it" ? "it-IT" : "en-US", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" })}
                  </p>
                </div>

                {/* Action */}
                {(canJoin || isLive) ? (
                  <button
                    onClick={() => joinSession(session)}
                    disabled={connecting}
                    className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50 ${
                      isLive
                        ? "bg-success shadow-success/25 hover:bg-success/90"
                        : "bg-berry shadow-berry/20 hover:bg-berry-dark"
                    }`}
                  >
                    {connecting ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <Video className="h-4 w-4" />
                    )}
                    {isLive ? t.sessions.reconnect : isRejoinable ? "Rejoin Session" : t.sessions.startSession}
                  </button>
                ) : (
                  <span className="text-xs text-charcoal-muted">
                    {t.sessions.availableBefore}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
