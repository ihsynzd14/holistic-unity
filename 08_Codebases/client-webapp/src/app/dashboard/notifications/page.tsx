"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import {
  BellOff, Calendar, MessageCircle, Video, Star, CreditCard,
  CheckCircle, XCircle, AlertTriangle, ArrowRightLeft, Megaphone,
  Shield, Check,
} from "lucide-react";

type AppNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  booking_id: string | null;
  conversation_id: string | null;
  therapist_id: string | null;
  client_id: string | null;
  is_read: boolean;
  created_at: string;
};

const typeConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  booking_confirmed: { icon: CheckCircle, color: "text-success", bg: "bg-success/10" },
  booking_declined: { icon: XCircle, color: "text-error", bg: "bg-error/10" },
  booking_request: { icon: Calendar, color: "text-berry", bg: "bg-berry/10" },
  booking_cancelled: { icon: XCircle, color: "text-error", bg: "bg-error/10" },
  session_reminder: { icon: Video, color: "text-info", bg: "bg-info/10" },
  new_message: { icon: MessageCircle, color: "text-berry", bg: "bg-berry/10" },
  video_session_starting: { icon: Video, color: "text-success", bg: "bg-success/10" },
  review_received: { icon: Star, color: "text-gold", bg: "bg-gold/10" },
  payment_processed: { icon: CreditCard, color: "text-success", bg: "bg-success/10" },
  refund_issued: { icon: CreditCard, color: "text-warning", bg: "bg-warning/10" },
  profile_approved: { icon: Shield, color: "text-success", bg: "bg-success/10" },
  profile_changes_requested: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10" },
  reschedule_requested: { icon: ArrowRightLeft, color: "text-info", bg: "bg-info/10" },
  reschedule_approved: { icon: CheckCircle, color: "text-success", bg: "bg-success/10" },
  reschedule_declined: { icon: XCircle, color: "text-error", bg: "bg-error/10" },
  promotional: { icon: Megaphone, color: "text-berry", bg: "bg-berry/10" },
};

export default function NotificationsPage() {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [referenceNow, setReferenceNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      let query = supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter === "unread") {
        query = query.eq("is_read", false);
      }

      const { data } = await query;
      if (cancelled) return;

      setNotifications(data || []);
      setLoading(false);
    }

    void loadNotifications();

    return () => {
      cancelled = true;
    };
  }, [filter]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setReferenceNow(Date.now());
    }, 60000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function markAsRead(id: string) {
    const supabase = createClient();
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
  }

  async function markAllRead() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  function timeAgo(dateStr: string): string {
    const diff = referenceNow - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t.notifications.timeAgo.justNow;
    if (mins < 60) return `${mins} ${t.notifications.timeAgo.minutesAgo}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${t.notifications.timeAgo.hoursAgo}`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ${t.notifications.timeAgo.daysAgo}`;
    return new Date(dateStr).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

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
    <div className="space-y-6">
      <div className="animate-reveal flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal">{t.notifications.title}</h1>
          <p className="mt-1 text-sm text-charcoal-muted">
            {unreadCount > 0 ? `${unreadCount} ${unreadCount === 1 ? t.notifications.unreadOne : t.notifications.unreadMany}` : t.notifications.allRead}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 rounded-full border border-berry/20 px-4 py-2 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
            >
              <Check className="h-3.5 w-3.5" />
              {t.notifications.markAllRead}
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="animate-reveal flex gap-2" style={{ animationDelay: "40ms" }}>
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
            filter === "all"
              ? "bg-berry text-white"
              : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
          }`}
        >
          {t.notifications.all}
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
            filter === "unread"
              ? "bg-berry text-white"
              : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
          }`}
        >
          {t.notifications.unread}
          {unreadCount > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
              filter === "unread" ? "bg-white/20 text-white" : "bg-berry text-white"
            }`}>
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Notifications list */}
      {notifications.length === 0 ? (
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/50 p-12 text-center" style={{ animationDelay: "80ms" }}>
          <BellOff className="mx-auto h-12 w-12 text-berry-muted/40" strokeWidth={1} />
          <p className="mt-4 font-medium text-charcoal-muted">
            {filter === "unread" ? t.notifications.noUnreadNotifications : t.notifications.noNotifications}
          </p>
          <p className="mt-1 text-sm text-charcoal-muted/70">
            {filter === "unread" ? t.notifications.noUnreadNotificationsDesc : t.notifications.noNotificationsDesc}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif, i) => {
            const config = typeConfig[notif.type] || typeConfig.promotional;
            const Icon = config.icon;

            return (
              <div
                key={notif.id}
                onClick={() => !notif.is_read && markAsRead(notif.id)}
                className={`animate-reveal flex items-start gap-3 rounded-2xl border p-4 transition-all cursor-pointer hover:shadow-sm ${
                  notif.is_read
                    ? "border-berry/5 bg-white/50"
                    : "border-berry/10 bg-white/80 shadow-sm"
                }`}
                style={{ animationDelay: `${80 + i * 30}ms` }}
              >
                {/* Icon */}
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${config.bg}`}>
                  <Icon className={`h-4 w-4 ${config.color}`} strokeWidth={1.5} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-semibold ${notif.is_read ? "text-charcoal-light" : "text-charcoal"}`}>
                      {notif.title}
                    </p>
                    {!notif.is_read && (
                      <span className="h-2 w-2 rounded-full bg-berry flex-shrink-0" />
                    )}
                  </div>
                  <p className={`mt-0.5 text-xs ${notif.is_read ? "text-charcoal-muted/70" : "text-charcoal-muted"}`}>
                    {notif.body}
                  </p>
                </div>

                {/* Time */}
                <span className="flex-shrink-0 text-[10px] font-medium text-charcoal-muted">
                  {timeAgo(notif.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
