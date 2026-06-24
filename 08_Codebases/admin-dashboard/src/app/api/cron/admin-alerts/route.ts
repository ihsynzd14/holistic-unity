import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /api/cron/admin-alerts
 *
 * Notifies the platform admin about two events that are written by
 * direct client-side inserts (so there is no server code path to hook):
 *
 *   A1 — a therapist entered `pending_review` (needs approval)
 *   A2 — a user submitted a `report` (needs moderation)
 *
 * Strategy: scan for rows where `admin_notified_at IS NULL`, send the
 * admin a Brevo email (template 15 / 16), then stamp the column so each
 * event is alerted exactly once. `admin_notified_at` is backfilled to
 * `now()` for all pre-existing rows by the migration, so the first run
 * only alerts on genuinely new events.
 *
 * Best-effort: a failed send leaves `admin_notified_at` NULL so the next
 * run retries. Auth: same `CRON_SECRET` bearer as the other crons.
 * Exposed as both GET and POST so it fires regardless of how the cron
 * runner invokes it.
 */

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL || "support@holisticunity.app";

// Cap per run so a backlog can't fan out into hundreds of emails in one
// invocation — the remainder is picked up on the next run.
const MAX_PER_RUN = 25;

const TPL_ADMIN_NEW_THERAPIST = 15;
const TPL_ADMIN_NEW_REPORT = 16;

interface PendingTherapistRow {
  id: string;
  display_name: string | null;
  city: string | null;
}

interface ReportRow {
  id: string;
  reported_type: string;
  reported_id: string;
  reason: string;
}

async function sendAdminEmail(
  template_id: number,
  params: Record<string, string>,
  tags: string[],
): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-brevo-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ template_id, email: ADMIN_EMAIL, params, tags }),
    });
    return res.ok;
  } catch (e) {
    console.error("[admin-alerts] send failed", template_id, e);
    return false;
  }
}

async function handler(req: NextRequest) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let therapistsNotified = 0;
  let reportsNotified = 0;

  // ── A1: therapists awaiting review ────────────────────────────────
  const { data: pending } = await admin
    .from("therapist_profiles")
    .select("id, display_name, city")
    .eq("approval_status", "pending_review")
    .is("admin_notified_at", null)
    .order("updated_at", { ascending: true })
    .limit(MAX_PER_RUN);

  for (const t of ((pending ?? []) as unknown as PendingTherapistRow[])) {
    // The auth email is the therapist's contact address (separate from
    // any billing_email); best-effort, the alert is still useful without it.
    let email = "";
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(t.id);
      email = authUser?.user?.email ?? "";
    } catch {
      /* non-fatal */
    }

    const ok = await sendAdminEmail(
      TPL_ADMIN_NEW_THERAPIST,
      {
        therapist_name: t.display_name ?? "(senza nome)",
        therapist_email: email || "(non disponibile)",
        city: t.city ?? "(non indicata)",
        therapist_id: t.id,
      },
      ["admin_alert", "new_therapist"],
    );
    if (!ok) continue; // leave admin_notified_at NULL → retry next run

    await admin
      .from("therapist_profiles")
      .update({ admin_notified_at: new Date().toISOString() })
      .eq("id", t.id);
    therapistsNotified++;
  }

  // ── A2: new reports ───────────────────────────────────────────────
  const { data: reports } = await admin
    .from("reports")
    .select("id, reported_type, reported_id, reason")
    .is("admin_notified_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  for (const r of ((reports ?? []) as unknown as ReportRow[])) {
    const ok = await sendAdminEmail(
      TPL_ADMIN_NEW_REPORT,
      {
        reported_type: r.reported_type,
        reason: r.reason,
        reported_id: r.reported_id,
        report_id: r.id,
      },
      ["admin_alert", "new_report"],
    );
    if (!ok) continue;

    await admin
      .from("reports")
      .update({ admin_notified_at: new Date().toISOString() })
      .eq("id", r.id);
    reportsNotified++;
  }

  return NextResponse.json({
    ok: true,
    therapists_notified: therapistsNotified,
    reports_notified: reportsNotified,
  });
}

export async function POST(req: NextRequest) {
  return handler(req);
}

export async function GET(req: NextRequest) {
  return handler(req);
}
