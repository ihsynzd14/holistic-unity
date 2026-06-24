import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/reschedule
 * Body: {
 *   proposed_scheduled_at: string  (ISO timestamp, must be >= 24h from now),
 *   reason?: string                (optional context for the client)
 * }
 *
 * Therapist proposes a new datetime for an upcoming session. The
 * booking transitions to `reschedule_pending` until the client accepts
 * (status -> `confirmed` with new scheduled_at) or rejects (status ->
 * `cancelled` with full refund). After 24h without client response, a
 * pg_cron job auto-cancels with full refund.
 *
 * Why two-step (propose + accept) instead of unilateral move?
 *   The client paid for a specific time slot; moving it without consent
 *   would be a contract change. Two-step keeps the client in control.
 *
 * Constraints checked:
 *   - Therapist owns the booking
 *   - Booking is in `confirmed` (can't reschedule a not-yet-paid booking)
 *   - New time is in the future (>= 1h from now — generous, allows quick
 *     "shift the same hour" reschedule when the original was today)
 *   - reschedule_count < 3 (anti-abuse: max 3 reschedules per booking)
 *   - The therapist's reliability isn't already blocked (rate < 20%)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: bookingId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const limit = await withRateLimit(request, {
    key: "therapist-reschedule",
    max: 20,
    windowSec: 3600,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const body = await request.json().catch(() => ({}));
  const proposedAtRaw = body?.proposed_scheduled_at;
  if (!proposedAtRaw || typeof proposedAtRaw !== "string") {
    return NextResponse.json(
      { error: "Indica il nuovo orario proposto" },
      { status: 400 },
    );
  }
  const proposedAt = new Date(proposedAtRaw);
  if (isNaN(proposedAt.getTime())) {
    return NextResponse.json({ error: "Orario non valido" }, { status: 400 });
  }
  if (proposedAt.getTime() - Date.now() < 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "Il nuovo orario deve essere almeno 1 ora nel futuro" },
      { status: 400 },
    );
  }

  const reason = typeof body?.reason === "string"
    ? body.reason.trim().slice(0, 500)
    : "";

  const admin = createAdminClient();

  // Reliability gate (same logic as cancel — keep platform protected
  // even if the therapist tries to back-door via reschedule)
  const { data: reliabilityRows } = await admin
    .rpc("get_therapist_reliability", { p_therapist_id: user.id });
  const reliability = reliabilityRows?.[0];
  if (reliability && (reliability.reliability_tier === "high" || reliability.reliability_tier === "critical")) {
    return NextResponse.json(
      {
        error:
          "Hai superato la soglia di affidabilit\u00e0. Per riprogrammare contatta il supporto.",
      },
      { status: 403 },
    );
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, scheduled_at, reschedule_count, stripe_payment_intent_id, service_name")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }

  if (booking.status !== "confirmed") {
    return NextResponse.json(
      { error: "Puoi riprogrammare solo prenotazioni confermate" },
      { status: 409 },
    );
  }

  if ((booking.reschedule_count ?? 0) >= 3) {
    return NextResponse.json(
      {
        error:
          "Questa sessione \u00e8 gi\u00e0 stata riprogrammata 3 volte. Cancella e prendi un nuovo appuntamento.",
      },
      { status: 409 },
    );
  }

  // Atomic transition: confirmed -> reschedule_pending with proposed time
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "reschedule_pending",
      proposed_scheduled_at: proposedAt.toISOString(),
      reschedule_proposed_by: "therapist",
      reschedule_proposed_at: new Date().toISOString(),
      cancellation_reason: reason || null,
    })
    .eq("id", booking.id)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: "Aggiornamento fallito o stato gi\u00e0 cambiato" },
      { status: 409 },
    );
  }

  // Notify the client (in-app + email). Best-effort, but MUST be
  // awaited — fire-and-forget would be killed when the serverless
  // function terminates after the response is sent. Internal
  // Promise.allSettled means a Brevo outage can't fail this route.
  await notifyClientOfRescheduleProposed(admin, {
    bookingId: booking.id,
    clientId: booking.client_id,
    therapistId: booking.therapist_id,
    oldScheduledAt: booking.scheduled_at,
    proposedScheduledAt: proposedAt.toISOString(),
    serviceName: booking.service_name ?? null,
    reason: reason || null,
  });

  return NextResponse.json({
    success: true,
    proposed_scheduled_at: proposedAt.toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
}

/**
 * Inserts an in-app notification for the client and queues a Brevo
 * email (template 11 — RESCHEDULE_PROPOSED). The Brevo template is
 * not yet configured, so the email send will fail silently inside
 * Promise.allSettled — keep it queued anyway so once the template
 * is added in Brevo, no code change is needed.
 */
async function notifyClientOfRescheduleProposed(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    bookingId: string;
    clientId: string;
    therapistId: string;
    oldScheduledAt: string;
    proposedScheduledAt: string;
    serviceName: string | null;
    reason: string | null;
  },
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const TPL_RESCHEDULE_PROPOSED = 26;

  const { data: therapistRow } = await admin
    .from("therapist_profiles")
    .select("display_name")
    .eq("id", args.therapistId)
    .maybeSingle();
  const therapistName = therapistRow?.display_name ?? "L'operatore";

  const oldDate = new Date(args.oldScheduledAt);
  const newDate = new Date(args.proposedScheduledAt);
  const TZ = "Europe/Rome";
  const fmt = (d: Date) => ({
    date: d.toLocaleDateString("it-IT", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: TZ,
    }),
    time: d.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TZ,
    }),
  });
  const oldFmt = fmt(oldDate);
  const newFmt = fmt(newDate);

  await Promise.allSettled([
    admin.from("notifications").insert({
      user_id: args.clientId,
      type: "reschedule_pending",
      title: "Riprogrammazione richiesta",
      body: `${therapistName} ha proposto di spostare "${args.serviceName ?? "la sessione"}" da ${oldFmt.date} ${oldFmt.time} a ${newFmt.date} ${newFmt.time}. Hai 24h per accettare o rifiutare.`,
      booking_id: args.bookingId,
      therapist_id: args.therapistId,
    }),
    fetch(`${supabaseUrl}/functions/v1/send-brevo-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: TPL_RESCHEDULE_PROPOSED,
        user_id: args.clientId,
        params: {
          therapist_name: therapistName,
          service_name: args.serviceName ?? "Sessione",
          old_session_date: oldFmt.date,
          old_session_time: oldFmt.time,
          new_session_date: newFmt.date,
          new_session_time: newFmt.time,
          reason: args.reason ?? "",
          booking_id: args.bookingId,
        },
        tags: ["reschedule_proposed"],
      }),
    }).catch((err) => {
      console.warn("[reschedule] brevo send failed (non-blocking):", err);
    }),
  ]);
}
