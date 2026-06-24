import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveTaxMode,
  type BillingProfile,
} from "@/lib/integrations/fattureincloud/tax-mode";

/**
 * POST /api/cron/billing-reminders
 *
 * Runs weekly (Vercel cron). For each approved therapist with
 * incomplete billing data, sends a reminder email via the
 * `send-brevo-email` Edge Function. Throttled by
 * `last_billing_reminder_at` so we don't spam — minimum 7 days between
 * reminders per therapist.
 *
 * The cron is best-effort: a failed send is logged and the next run
 * will retry. The `last_billing_reminder_at` is bumped only on a
 * successful send.
 */

const REMINDER_THROTTLE_DAYS = 7;
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface TherapistRow {
  id: string;
  display_name: string | null;
  country: string | null;
  p_iva: string | null;
  codice_fiscale: string | null;
  codice_destinatario: string | null;
  pec_email: string | null;
  regime_forfettario: boolean | null;
  vat_number: string | null;
  vat_validated_at: string | null;
  tax_id_foreign: string | null;
  billing_email: string | null;
  billing_address: BillingProfile["billing_address"];
  last_billing_reminder_at: string | null;
}

const REASON_TEXT: Record<string, string> = {
  missing_country: "il paese di residenza fiscale",
  missing_address: "l'indirizzo legale completo",
  missing_sdi_or_pec: "il codice destinatario SDI o l'indirizzo PEC",
  missing_codice_fiscale: "il codice fiscale",
  incomplete_billing: "alcuni dati di fatturazione",
};

export async function POST(req: NextRequest) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Only target therapists who could realistically receive bookings.
  const { data: therapists } = await admin
    .from("therapist_profiles")
    .select(
      "id, display_name, country, p_iva, codice_fiscale, codice_destinatario, pec_email, " +
      "regime_forfettario, vat_number, vat_validated_at, tax_id_foreign, billing_email, " +
      "billing_address, last_billing_reminder_at",
    )
    .eq("approval_status", "approved")
    .eq("is_approved", true)
    .eq("stripe_account_status", "active");

  const rows = (therapists ?? []) as unknown as TherapistRow[];
  const cutoff = Date.now() - REMINDER_THROTTLE_DAYS * 24 * 60 * 60 * 1000;
  const sent: Array<{ therapist_id: string; reason: string }> = [];
  const skipped: Array<{ therapist_id: string; why: string }> = [];

  for (const t of rows) {
    const profile: BillingProfile = {
      country: t.country,
      p_iva: t.p_iva,
      codice_fiscale: t.codice_fiscale,
      codice_destinatario: t.codice_destinatario,
      pec_email: t.pec_email,
      regime_forfettario: t.regime_forfettario,
      vat_number: t.vat_number,
      vat_validated_at: t.vat_validated_at,
      tax_id_foreign: t.tax_id_foreign,
      billing_address: t.billing_address,
    };
    const resolved = resolveTaxMode(profile);
    if (resolved.mode !== "INCOMPLETE") {
      continue;
    }

    if (t.last_billing_reminder_at) {
      const last = new Date(t.last_billing_reminder_at).getTime();
      if (last > cutoff) {
        skipped.push({ therapist_id: t.id, why: "throttled" });
        continue;
      }
    }

    // Pull the auth email — that's the one we send platform messages
    // to, separate from billing_email.
    const { data: authUser } = await admin.auth.admin.getUserById(t.id);
    const email = authUser?.user?.email;
    if (!email) {
      skipped.push({ therapist_id: t.id, why: "no_auth_email" });
      continue;
    }

    const reasonText = REASON_TEXT[resolved.reason ?? ""] ?? "i dati di fatturazione";
    try {
      const send = await fetch(`${SUPABASE_URL}/functions/v1/send-brevo-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: email,
          subject: "Completa i dati di fatturazione su Holistic Unity",
          html: buildReminderHtml(t.display_name ?? "", reasonText),
        }),
      });
      if (!send.ok) {
        skipped.push({ therapist_id: t.id, why: `brevo_${send.status}` });
        continue;
      }
      await admin
        .from("therapist_profiles")
        .update({ last_billing_reminder_at: new Date().toISOString() })
        .eq("id", t.id);
      sent.push({ therapist_id: t.id, reason: resolved.reason ?? "incomplete" });
    } catch (e) {
      console.error("[billing-reminders] send failed", t.id, e);
      skipped.push({
        therapist_id: t.id,
        why: e instanceof Error ? e.message.slice(0, 100) : "unknown",
      });
    }
  }

  return NextResponse.json({ ok: true, sent: sent.length, skipped: skipped.length, sent_list: sent, skipped_list: skipped });
}

function buildReminderHtml(name: string, reasonText: string): string {
  const greeting = name ? `Ciao ${name},` : "Ciao,";
  return `
    <!doctype html>
    <html lang="it"><body style="font-family:Inter,Arial,sans-serif;color:#2D2D2D;line-height:1.6">
      <div style="max-width:520px;margin:0 auto;padding:24px">
        <h1 style="font-family:Georgia,serif;color:#7B2252;font-size:22px;margin:0 0 16px">
          Completa i tuoi dati di fatturazione
        </h1>
        <p>${greeting}</p>
        <p>
          Per emettere correttamente la fattura mensile della commissione di
          intermediazione, ci servono ancora ${reasonText}.
        </p>
        <p>
          Senza questi dati la prossima fattura del 1° del mese non potrà essere
          emessa, e il tuo storico fiscale resterà incompleto.
        </p>
        <p style="margin:24px 0">
          <a href="https://therapistportal.holisticunity.app/dashboard/billing"
             style="background:#7B2252;color:#fff;padding:12px 20px;border-radius:24px;text-decoration:none;font-weight:600">
            Aggiorna i dati
          </a>
        </p>
        <p style="color:#6B6B6B;font-size:13px">
          Hai bisogno di aiuto? Rispondi a questa email o scrivi a support@holisticunity.app.
        </p>
      </div>
    </body></html>
  `;
}
