import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /dashboard/integrations/fattureincloud
 *
 * Admin-only. Shows the current FIC connection state and provides
 * the Connect button. Hits `/api/integrations/fattureincloud/connect`
 * which kicks off the OAuth flow; when the callback finishes it
 * redirects back here with `?connected=1`.
 */
export default async function FattureInCloudIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The admin-dashboard layout already enforces admin auth via MFA
  // (verifiedFactors + aal2). No role check needed here — anyone who
  // got past the layout is authorised for admin pages.

  // Read the single-row credentials table directly via service role.
  const admin = createAdminClient();
  const { data: creds } = await admin
    .from("fattureincloud_credentials")
    .select("company_id, scope, expires_at, connected_at, connected_by")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const isConfigured =
    Boolean(process.env.FATTUREINCLOUD_CLIENT_ID) &&
    Boolean(process.env.FATTUREINCLOUD_CLIENT_SECRET);

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-charcoal-muted hover:underline"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-charcoal">
          FattureInCloud
        </h1>
        <p className="mt-1 text-sm text-charcoal-muted">
          Connessione OAuth della piattaforma con FattureInCloud per la
          generazione automatica delle fatture mensili ai terapisti.
        </p>
      </div>

      {params?.connected === "1" && (
        <div className="rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          ✓ Connessione completata.
        </div>
      )}
      {params?.error && (
        <div className="rounded-2xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          Errore: {params.error}
        </div>
      )}

      {!isConfigured && (
        <div className="rounded-2xl border border-warning/30 bg-warning-light px-4 py-3 text-sm">
          <p className="font-semibold">Integrazione non ancora configurata</p>
          <p className="mt-1 text-charcoal-light">
            Le env vars{" "}
            <code className="rounded bg-white/60 px-1">
              FATTUREINCLOUD_CLIENT_ID
            </code>{" "}
            e{" "}
            <code className="rounded bg-white/60 px-1">
              FATTUREINCLOUD_CLIENT_SECRET
            </code>{" "}
            non sono settate. Registra una OAuth app su{" "}
            <a
              className="underline"
              href="https://api-v2.fattureincloud.it/oauth/authorize"
              target="_blank"
              rel="noopener noreferrer"
            >
              FattureInCloud Developer
            </a>{" "}
            e aggiungile in Vercel + .env.local.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-berry/10 bg-white/80 p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-charcoal-muted">
          Stato connessione
        </h2>
        {creds ? (
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-muted">Stato</dt>
              <dd className="font-semibold text-success">● Connesso</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-muted">FIC Company ID</dt>
              <dd className="font-mono text-charcoal">{creds.company_id}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-muted">Scope</dt>
              <dd className="text-charcoal text-right text-xs">
                {creds.scope}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-muted">Token scade</dt>
              <dd className="text-charcoal">
                {new Date(creds.expires_at).toLocaleString("it-IT")}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-charcoal-muted">Connesso il</dt>
              <dd className="text-charcoal">
                {new Date(creds.connected_at).toLocaleString("it-IT")}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-charcoal-muted">
            ● Non ancora connesso.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-berry/10 bg-white/80 p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-charcoal-muted">
          Azioni
        </h2>
        <p className="mt-2 text-sm text-charcoal-light">
          Cliccando il pulsante seguente verrai reindirizzato a FattureInCloud
          per autorizzare l&apos;accesso. Una volta tornato qui, la piattaforma
          potrà emettere fatture mensili ai terapisti automaticamente.
        </p>
        <div className="mt-4 flex gap-3">
          {isConfigured ? (
            <a
              href="/api/integrations/fattureincloud/connect"
              className="inline-flex items-center justify-center rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-berry-dark"
            >
              {creds ? "Riconnetti FattureInCloud" : "Connetti FattureInCloud"}
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center justify-center rounded-full bg-berry/40 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Connetti FattureInCloud
            </span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-berry/5 bg-cream-dark/30 p-4 text-xs text-charcoal-muted">
        <p className="font-semibold text-charcoal-light">Cron schedule</p>
        <ul className="mt-2 space-y-1">
          <li>
            <code>/api/cron/monthly-invoices</code> — 1° del mese 03:00 UTC.
            Emette fatture commissione per il mese precedente.
          </li>
          <li>
            <code>/api/cron/daily-credit-notes</code> — ogni giorno 04:00 UTC.
            Emette note di credito per i refund post-fattura.
          </li>
          <li>
            <code>/api/cron/billing-reminders</code> — ogni lunedì 09:00 UTC.
            Manda email ai terapisti con dati incompleti (throttle 7gg).
          </li>
        </ul>
      </div>

      <Link
        href="/dashboard/integrations/fattureincloud/incomplete"
        className="block rounded-2xl border border-berry/10 bg-white/70 p-4 text-sm text-charcoal hover:bg-berry-subtle/30 transition-colors"
      >
        <span className="font-semibold">Stato fatturazione terapisti →</span>
        <span className="block mt-0.5 text-xs text-charcoal-muted">
          Pre-flight check: chi è pronto per il prossimo cron, chi va contattato.
        </span>
      </Link>
    </div>
  );
}
