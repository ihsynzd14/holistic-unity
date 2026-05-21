"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { Video, Calendar } from "lucide-react";
import { getJoinWindow } from "@/lib/booking/join-window";

type SessionRow = {
  id: string;
  scheduled_at: string;
  service_name: string | null;
  duration: number | null;
  video_room_id: string | null;
  status: string;
  therapist: { display_name: string | null } | null;
};

export default function ClientSessionsPage() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [referenceDate] = useState(() => new Date());

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("bookings")
        // FK targets therapist_profiles, not users — see note in
        // dashboard/bookings/page.tsx for the full context.
        .select(
          "id, scheduled_at, service_name, duration, video_room_id, status, therapist:therapist_profiles!bookings_therapist_id_fkey(display_name)"
        )
        .eq("client_id", user.id)
        .in("status", ["confirmed", "in_progress"])
        .gte("scheduled_at", nowIso)
        .order("scheduled_at", { ascending: true });
      setSessions((data as unknown as SessionRow[]) || []);
      setLoading(false);
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-berry" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="animate-reveal">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal">
          {t.clientSessions.title}
        </h1>
        <p className="mt-1 text-sm text-charcoal-muted">{t.clientSessions.subtitle}</p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-berry/5 bg-white/60 p-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-berry-muted/40" strokeWidth={1} />
          <p className="mt-4 text-sm text-charcoal-muted">{t.clientSessions.empty}</p>
          <Link
            href="/dashboard/therapists"
            className="mt-4 inline-block rounded-full bg-berry px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-berry-dark transition-all"
          >
            {t.clientSessions.findTherapist}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s, i) => {
            const date = new Date(s.scheduled_at);
            const isToday = date.toDateString() === referenceDate.toDateString();
            // Single source of truth for the join window: opens 15 min
            // before scheduled_at and stays open for 3 hours total. See
            // src/lib/booking/join-window.ts.
            const window = getJoinWindow(date, referenceDate);
            const canJoin = window.state === "open" && s.video_room_id !== null;
            const therapistName = s.therapist?.display_name || t.clientSessions.therapist;

            return (
              <div
                key={s.id}
                className="animate-reveal flex items-center gap-4 rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                style={{ animationDelay: `${40 + i * 40}ms` }}
              >
                <div
                  className={`flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl ${
                    isToday ? "bg-berry text-white" : "bg-berry-subtle text-berry"
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase">
                    {isToday
                      ? t.clientSessions.today
                      : date.toLocaleDateString("it-IT", { month: "short" })}
                  </span>
                  <span className="text-lg font-bold leading-none">
                    {isToday
                      ? date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
                      : date.getDate()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-charcoal truncate">{therapistName}</p>
                  <p className="text-xs text-charcoal-muted truncate">
                    {s.service_name || t.clientSessions.session} &middot; {s.duration ?? 60} min
                    {!isToday && (
                      <>
                        {" · "}
                        {date.toLocaleDateString("it-IT", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                        {` ${t.clientSessions.at} `}
                        {date.toLocaleTimeString("it-IT", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </>
                    )}
                  </p>
                </div>

                {canJoin ? (
                  // target="_blank" — keep this sessions list open
                  // behind the call tab. See dashboard/page.tsx for
                  // the rationale + the matching post-session fallback.
                  <Link
                    href={`/call/${s.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full bg-success px-4 py-2 text-xs font-semibold text-white shadow-md shadow-success/20 hover:bg-success/90 transition-all"
                  >
                    <Video className="h-3.5 w-3.5" />
                    {t.clientSessions.join}
                  </Link>
                ) : window.state === "too_early" ? (
                  <span className="text-[11px] text-charcoal-muted">
                    {window.minutesUntilOpen > 60
                      ? `${Math.round(window.minutesUntilOpen / 60)}${t.clientSessions.hoursToGo}`
                      : `${window.minutesUntilOpen}${t.clientSessions.minutesToGo}`}
                  </span>
                ) : (
                  // window.state === "closed" — session is over and the
                  // 3h re-entry window has elapsed. Cron job will mark
                  // the booking completed shortly; until then show
                  // nothing rather than a stale "Entra".
                  <span className="text-[11px] text-charcoal-muted">—</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
