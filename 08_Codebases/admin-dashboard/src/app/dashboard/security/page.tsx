"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getMfaStatus } from "@/lib/auth/mfa";
import { ShieldCheck, AlertTriangle, Monitor } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

type LoginEvent = {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  app: string | null;
  is_new_device: boolean;
  created_at: string;
};

/**
 * Admin security settings.
 *
 * For admins MFA is MANDATORY — there's no "disable" button. This page
 * shows the current MFA status and lets the admin re-enroll a different
 * device (which means: enroll new factor, then unenroll the old one
 * via Supabase API directly — out of scope for v1, just show status).
 */
export default function AdminSecurityPage() {
  const [loading, setLoading] = useState(true);
  const [enrolled, setEnrolled] = useState(false);
  const [factorCreatedAt, setFactorCreatedAt] = useState<string | null>(null);
  const [aal, setAal] = useState<"aal1" | "aal2">("aal1");
  const [recentLogins, setRecentLogins] = useState<LoginEvent[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const status = await getMfaStatus(supabase);
      setEnrolled(status.enrolled);
      setAal(status.aal);

      // Get the verified factor's creation date for display
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = (factors?.totp ?? []).find((f) => f.status === "verified");
      setFactorCreatedAt(verified?.created_at ?? null);

      // Recent logins (RLS limits to current user)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("login_events")
          .select("id, ip_address, user_agent, app, is_new_device, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);
        setRecentLogins((data as LoginEvent[]) ?? []);
      }

      setLoading(false);
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <DisplayHeading>
          Sicurezza
        </DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">
          Gestione autenticazione a due fattori per il tuo account admin.
        </p>
      </div>

      <Card>
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${
              enrolled ? "bg-success/10 text-success" : "bg-error/10 text-error"
            }`}
          >
            {enrolled ? (
              <ShieldCheck className="h-6 w-6" strokeWidth={1.5} />
            ) : (
              <AlertTriangle className="h-6 w-6" strokeWidth={1.5} />
            )}
          </div>
          <div className="flex-1">
            <p className="font-[family-name:var(--font-display)] text-lg font-bold text-charcoal">
              Autenticazione a due fattori
            </p>
            <p className="mt-1 text-sm text-charcoal-light">
              {enrolled
                ? "Attiva — il tuo account richiede un codice TOTP a ogni login."
                : "Non attiva — REQUIRED per gli admin. Verrai reindirizzato per attivarla."}
            </p>
            {enrolled && factorCreatedAt && (
              <p className="mt-2 text-xs text-charcoal-muted">
                Configurata il{" "}
                {new Date(factorCreatedAt).toLocaleDateString("it-IT", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · Sessione corrente: <code className="rounded bg-cream-dark/30 px-1.5 py-0.5 text-[11px]">{aal}</code>
              </p>
            )}
          </div>
        </div>

        {!enrolled && (
          <Link
            href="/enroll-mfa"
            className="mt-5 inline-flex rounded-full bg-berry px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-berry/15 hover:bg-berry-dark transition-all"
          >
            Attiva ora
          </Link>
        )}
      </Card>

      <div className="rounded-2xl border border-info/15 bg-info-light/30 p-5">
        <p className="text-sm font-semibold text-charcoal">Per cambiare app autenticatrice o dispositivo</p>
        <p className="mt-1 text-xs text-charcoal-light">
          Per ora: contatta il team tecnico (necessario reset via service-role). Una funzione self-service
          arriverà nella prossima iterazione.
        </p>
      </div>

      {/* Recent logins — forensic trail. RLS limits the read to the
          current admin's own events. */}
      <Card>
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-charcoal-muted" strokeWidth={1.5} />
          <p className="text-xs font-bold uppercase tracking-wider text-charcoal-muted">
            Accessi recenti
          </p>
        </div>
        <p className="mt-1 text-xs text-charcoal-muted">
          Ultimi 10 accessi al tuo account. Se vedi qualcosa di sospetto, cambia subito la password e
          rigenera il TOTP.
        </p>

        {recentLogins.length === 0 ? (
          <p className="mt-4 text-xs text-charcoal-muted/60">Nessun login registrato finora.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {recentLogins.map((ev) => {
              const date = new Date(ev.created_at);
              return (
                <div
                  key={ev.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-berry/5 bg-cream-dark/20 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-charcoal">
                      {date.toLocaleString("it-IT", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="mt-0.5 truncate text-charcoal-muted" title={ev.user_agent ?? ""}>
                      {shortenUa(ev.user_agent)} · {ev.app ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <code className="rounded bg-charcoal/5 px-1.5 py-0.5 font-mono text-[10px] text-charcoal-muted">
                      {ev.ip_address ?? "—"}
                    </code>
                    {ev.is_new_device && (
                      <span className="rounded-full bg-warning-light px-2 py-0.5 text-[10px] font-semibold uppercase text-gold-dark">
                        Nuovo dispositivo
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Strip noise from a User-Agent and keep just the meaningful bits. */
function shortenUa(ua: string | null): string {
  if (!ua) return "Unknown";
  // Try to extract the platform + browser name in a friendly way
  const isMac = /Macintosh|Mac OS X/.test(ua);
  const isWin = /Windows/.test(ua);
  const isLinux = /Linux/.test(ua) && !/Android/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isIos = /iPhone|iPad|iPod/.test(ua);
  let platform = "Unknown";
  if (isMac) platform = "macOS";
  else if (isIos) platform = "iOS";
  else if (isAndroid) platform = "Android";
  else if (isWin) platform = "Windows";
  else if (isLinux) platform = "Linux";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  return `${browser} · ${platform}`;
}
