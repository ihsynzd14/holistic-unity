"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { LiveKitRoom } from "@livekit/components-react";
import { createClient } from "@/lib/supabase/client";
import CustomVideoLayout from "@/components/video/CustomVideoLayout";
import "@livekit/components-styles";

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://holistic-unity-7cj033ty.livekit.cloud";

interface BookingInfo {
  id: string;
  client_name: string;
  service_name: string;
  duration: number;
  scheduled_at: string;
  video_room_id: string | null;
  status: string;
}

export default function CallPage() {
  const { bookingId } = useParams<{ bookingId: string }>();

  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [callEnded, setCallEnded] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Pre-flight check state. 'checking' while we probe camera/mic
  // permissions; 'denied' when the user (or their OS / browser
  // settings) blocked access; 'not_found' when no devices are
  // available; 'ok' when we can proceed to token fetch + LiveKit.
  const [permission, setPermission] = useState<
    "checking" | "ok" | "denied" | "not_found" | "other_error"
  >("checking");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Warn before closing tab during active call
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (token && !callEnded) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [token, callEnded]);

  // Session timer
  useEffect(() => {
    if (token && !callEnded) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [token, callEnded]);

  // Pre-flight probe: does this browser actually have camera + mic
  // access? Runs before we ever request a LiveKit token so:
  //   (a) we don't burn a token mint if the user is on a phone with
  //       no mic or hasn't granted permissions yet,
  //   (b) the failure UX is specific ("abilita la fotocamera" vs
  //       "nessun dispositivo trovato") instead of LiveKit's generic
  //       "connection failed" after 5s of spinner.
  // We immediately stop the probe's MediaStream so LiveKit can
  // re-acquire its own tracks cleanly — leaving the tracks open
  // would lock the camera's indicator on until the tab is closed.
  async function probeMediaPermissions(): Promise<
    "ok" | "denied" | "not_found" | "other_error"
  > {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return "not_found";
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      stream.getTracks().forEach((t) => t.stop());
      return "ok";
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") return "denied";
      if (name === "NotFoundError" || name === "OverconstrainedError")
        return "not_found";
      return "other_error";
    }
  }

  // Initialize: probe perms → fetch booking, get token, connect
  const initialize = useCallback(async () => {
    setLoading(true);
    setError("");
    setDisconnected(false);

    // STEP 1 — media permission probe. On failure short-circuit here;
    // the UI will render the appropriate "enable camera" or
    // "no device" screen.
    const permResult = await probeMediaPermissions();
    setPermission(permResult);
    if (permResult !== "ok") {
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not authenticated. Please log in.");
        setLoading(false);
        return;
      }

      // Fetch booking with client name
      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .select("id, scheduled_at, service_name, duration, video_room_id, status, client_id")
        .eq("id", bookingId)
        .single();

      if (bookingError || !bookingData) {
        setError("Session not found.");
        setLoading(false);
        return;
      }

      // Peer-read via the user_display_info view: the view exposes
      // only safe columns (id, display_name, photo_url, role, city,
      // country) so a compromised client can never pull out their
      // peer's phone_number / birth_date / fcm_token.
      const { data: clientData } = await supabase
        .from("user_display_info")
        .select("display_name")
        .eq("id", bookingData.client_id)
        .single();

      const info: BookingInfo = {
        ...bookingData,
        client_name: clientData?.display_name || "Client",
      };
      setBooking(info);

      const room =
        bookingData.video_room_id ||
        `hu-${bookingData.id.replace(/-/g, "").slice(0, 16)}`;

      // LiveKit identity = the *current viewer's* display_name, NOT the
      // therapist's. The variable name `therapistData` was misleading
      // (kept for API compatibility below). For the client viewing the
      // call this is the client's name; for the therapist it would be
      // the therapist's. Either way, the local participant identity is
      // who the OTHER side will see in the call roster.
      const { data: therapistData } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", user.id)
        .single();

      // Request LiveKit token
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: room,
          participantName: therapistData?.display_name || "Therapist",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not connect to video session.");
        setLoading(false);
        return;
      }

      setToken(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Explicit end: client clicks "End Session". The status flip is done
  // server-side via /api/bookings/[id]/complete which validates
  // ownership + state machine. A direct supabase.update from the client
  // would let any authenticated user mark any booking as completed if
  // they knew its UUID — short-circuiting the payout escrow window.
  async function handleEndSession() {
    try {
      await fetch(`/api/bookings/${bookingId}/complete`, { method: "POST" });
    } catch {
      // Even if the status update fails, end the local UI session — the
      // therapist can fix the status from their dashboard later.
    }
    setCallEnded(true);
    setToken("");
    if (timerRef.current) clearInterval(timerRef.current);
  }

  // Automatic disconnect: network issue, NOT explicit end.
  // Does NOT mark booking as completed — shows reconnect prompt.
  function handleDisconnected() {
    if (!callEnded) {
      setDisconnected(true);
      setToken("");
    }
  }

  // Reconnect after unexpected disconnect
  async function handleReconnect() {
    setElapsedSeconds(0);
    await initialize();
  }

  // Exit the post-session / error screen.
  //
  // Why two-step (close → fallback redirect): `window.close()` is only
  // honoured by browsers for tabs the script itself opened (via
  // `window.open`). When this page is reached by a normal anchor click
  // with `target="_blank" rel="noopener noreferrer"` (our current join
  // flow), the noopener relation severs `window.opener` and the close
  // call silently no-ops — which is exactly the "stuck on Session
  // Complete with no way out" bug we used to ship.
  //
  // We try close anyway because some browsers (and same-tab edge cases
  // we may add later) DO allow it; if the tab is still alive 150ms
  // later we navigate to the dashboard so the user is never stranded.
  // The 150ms grace is short enough not to feel laggy and long enough
  // for a successful close to tear the document down before the
  // redirect fires.
  function exitCall() {
    window.close();
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 150);
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  // ─── Pre-flight: permissions denied / no device ────────────────
  if (!loading && permission === "denied") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-2xl bg-white/10 p-8 text-center backdrop-blur-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/20">
            <span className="text-3xl">🎥</span>
          </div>
          <h2 className="text-lg font-semibold">
            Abilita fotocamera e microfono
          </h2>
          <p className="mt-2 text-sm text-white/70 leading-relaxed">
            Per partecipare alla sessione, il browser ha bisogno
            dell&apos;accesso alla fotocamera e al microfono. Abbiamo
            provato a richiederlo ma è stato bloccato.
          </p>
          <div className="mt-5 rounded-xl bg-white/5 p-4 text-left text-xs text-white/60 space-y-1.5">
            <p className="font-semibold text-white/80">Come abilitare:</p>
            <p>
              <strong className="text-white/80">Chrome / Edge:</strong> clicca
              l&apos;icona del lucchetto nella barra degli indirizzi → Sito
              web → Fotocamera/Microfono → Consenti.
            </p>
            <p>
              <strong className="text-white/80">Safari:</strong> Menu Safari
              → Impostazioni per questo sito web → Fotocamera/Microfono →
              Consenti.
            </p>
            <p>
              <strong className="text-white/80">Firefox:</strong> clicca
              l&apos;icona della fotocamera barrata a sinistra
              dell&apos;URL → rimuovi il blocco.
            </p>
          </div>
          <button
            onClick={() => {
              setPermission("checking");
              void initialize();
            }}
            className="mt-6 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-berry-dark"
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  if (!loading && permission === "not_found") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-2xl bg-white/10 p-8 text-center backdrop-blur-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error/20">
            <span className="text-3xl">📷</span>
          </div>
          <h2 className="text-lg font-semibold">Nessuna fotocamera rilevata</h2>
          <p className="mt-2 text-sm text-white/70">
            Il tuo dispositivo non ha una fotocamera o un microfono
            disponibili. Puoi riprovare collegando un dispositivo, oppure
            partecipare da un altro dispositivo.
          </p>
          <button
            onClick={() => {
              setPermission("checking");
              void initialize();
            }}
            className="mt-6 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-berry-dark"
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  if (!loading && permission === "other_error") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-2xl bg-white/10 p-8 text-center backdrop-blur-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/20">
            <span className="text-3xl">⚠</span>
          </div>
          <h2 className="text-lg font-semibold">
            Impossibile accedere a fotocamera/microfono
          </h2>
          <p className="mt-2 text-sm text-white/70">
            Si è verificato un errore inatteso. Riprova; se il problema
            persiste, apri la sessione da un altro browser o dispositivo.
          </p>
          <button
            onClick={() => {
              setPermission("checking");
              void initialize();
            }}
            className="mt-6 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-berry-dark"
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  // ─── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <svg
            className="mx-auto h-10 w-10 animate-spin text-berry-light"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="mt-4 text-sm text-white/60">Connecting to session...</p>
        </div>
      </div>
    );
  }

  // ─── Error ─────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm rounded-2xl bg-white/10 p-8 text-center backdrop-blur-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error/20">
            <span className="text-2xl">!</span>
          </div>
          <h2 className="text-lg font-semibold">Errore di connessione</h2>
          <p className="mt-2 text-sm text-white/60">{error}</p>
          <button
            onClick={exitCall}
            className="mt-6 rounded-full bg-berry px-6 py-2.5 text-sm font-medium transition-all hover:bg-berry-dark"
          >
            Torna alla home
          </button>
        </div>
      </div>
    );
  }

  // ─── Call ended (post-session) ─────────────────────────────────
  if (callEnded) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm rounded-2xl bg-white/10 p-8 text-center backdrop-blur-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
            <span className="text-3xl">&#10003;</span>
          </div>
          <h2 className="text-xl font-semibold">Sessione completata</h2>
          <p className="mt-2 text-sm text-white/60">
            Sessione con {booking?.client_name} — {formatTime(elapsedSeconds)}
          </p>
          <button
            onClick={exitCall}
            className="mt-6 rounded-full bg-berry px-6 py-2.5 text-sm font-medium transition-all hover:bg-berry-dark"
          >
            Chiudi
          </button>
        </div>
      </div>
    );
  }

  // ─── Disconnected unexpectedly — reconnect prompt ──────────────
  if (disconnected) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm rounded-2xl bg-white/10 p-8 text-center backdrop-blur-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/20">
            <span className="text-2xl">&#8635;</span>
          </div>
          <h2 className="text-lg font-semibold">Connection Lost</h2>
          <p className="mt-2 text-sm text-white/60">
            The video session was disconnected. The session is still active.
          </p>
          <div className="mt-6 flex gap-3 justify-center">
            <button
              onClick={handleReconnect}
              className="rounded-full bg-berry px-6 py-2.5 text-sm font-medium transition-all hover:bg-berry-dark"
            >
              Reconnect
            </button>
            <button
              onClick={handleEndSession}
              className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-medium text-white/70 transition-all hover:bg-white/10"
            >
              End Session
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Active call ───────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-charcoal/80 px-4 py-2 backdrop-blur-sm border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-success/15 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-semibold text-success">LIVE</span>
          </div>
          <div>
            <span className="text-sm font-medium">{booking?.client_name}</span>
            <span className="ml-2 text-xs text-white/40">{booking?.service_name}</span>
          </div>
        </div>
        <div className="font-mono text-sm text-white/50">{formatTime(elapsedSeconds)}</div>
      </div>

      {/* Video area */}
      <div className="flex-1">
        <LiveKitRoom
          serverUrl={LIVEKIT_URL}
          token={token}
          connect={true}
          video={true}
          audio={true}
          onDisconnected={handleDisconnected}
          style={{ height: "100%" }}
        >
          <CustomVideoLayout onEndSession={handleEndSession} />
        </LiveKitRoom>
      </div>
    </div>
  );
}
