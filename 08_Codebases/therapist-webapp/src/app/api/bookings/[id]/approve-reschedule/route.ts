import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/approve-reschedule
 *
 * Therapist approves a client-proposed reschedule. The booking is in
 * `reschedule_pending` with a `proposed_scheduled_at` set by the
 * client; this route flips it back to `confirmed` with the new time.
 *
 * Replaces the previous client-side direct-DB update which had no:
 *   - server-side validation of the proposed time
 *   - conflict check against the therapist's other bookings
 *   - reschedule_count enforcement (max 3)
 *   - audit / notification side effects
 *
 * Server-side checks:
 *   1. Auth: must be the booking's therapist
 *   2. State: must be `reschedule_pending` with a proposed time set
 *   3. Cap: refuse if `reschedule_count >= 3` (prevent abuse)
 *   4. Future time: proposed_scheduled_at must be >= 1h from now
 *   5. Atomic optimistic-locked UPDATE
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
    key: "therapist-approve-reschedule",
    max: 30,
    windowSec: 3600,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, scheduled_at, proposed_scheduled_at, reschedule_count, service_name, reschedule_proposed_by")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }
  if (booking.status !== "reschedule_pending" || !booking.proposed_scheduled_at) {
    return NextResponse.json(
      { error: "Nessuna proposta di riprogrammazione attiva" },
      { status: 409 },
    );
  }
  // The route's docstring contract: this endpoint approves a CLIENT-
  // proposed reschedule. If the proposal came from the therapist, they
  // must wait for the client's response on
  // /api/bookings/[id]/reschedule/respond — not auto-approve their own
  // proposal (which would bypass the client review window entirely and
  // burn `reschedule_count` without consent).
  if (booking.reschedule_proposed_by !== "client") {
    return NextResponse.json(
      {
        error:
          "Solo il cliente può approvare questa proposta. Aspetta la sua risposta entro 24h.",
      },
      { status: 409 },
    );
  }
  if ((booking.reschedule_count ?? 0) >= 3) {
    return NextResponse.json(
      { error: "Numero massimo di riprogrammazioni raggiunto (3)" },
      { status: 409 },
    );
  }

  const proposedDate = new Date(booking.proposed_scheduled_at);
  const minLeadHours = 1;
  if (proposedDate.getTime() - Date.now() < minLeadHours * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "Il nuovo orario deve essere almeno 1 ora nel futuro" },
      { status: 400 },
    );
  }

  // The bookings_overlap_guard DB trigger will reject the UPDATE if
  // proposed_scheduled_at conflicts with another active booking for
  // the same therapist. We don't pre-check here — let the trigger be
  // the single source of truth so two concurrent approvals can't both
  // think they've found free slots.
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
      scheduled_at: booking.proposed_scheduled_at,
      proposed_scheduled_at: null,
      reschedule_proposed_by: null,
      reschedule_proposed_at: null,
      reschedule_count: (booking.reschedule_count ?? 0) + 1,
    })
    .eq("id", bookingId)
    .eq("status", "reschedule_pending")
    .select("id, scheduled_at")
    .maybeSingle();

  if (updateErr) {
    // Most likely cause: bookings_overlap_guard trigger rejected the
    // new time. Surface as 409.
    const msg = updateErr.message || "";
    if (msg.toLowerCase().includes("overlap") || msg.toLowerCase().includes("conflict")) {
      return NextResponse.json(
        { error: "Il nuovo orario è in conflitto con un'altra sessione. Proponi un orario diverso." },
        { status: 409 },
      );
    }
    console.error("[booking/approve-reschedule] update failed:", updateErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Lo stato della prenotazione è cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  // In-app notification + email to the client. Best-effort, awaited
  // so the serverless function doesn't terminate before the writes.
  // The pre-existing insert here was passing a `metadata` column that
  // doesn't exist on the notifications table — silently failing. Now
  // we use the canonical columns and also queue the Brevo email.
  await notifyClientOfRescheduleApproved(admin, {
    bookingId: booking.id,
    clientId: booking.client_id,
    therapistId: booking.therapist_id,
    newScheduledAt: updated.scheduled_at,
    serviceName: booking.service_name ?? null,
  });

  return NextResponse.json({
    success: true,
    new_scheduled_at: updated.scheduled_at,
  });
}

async function notifyClientOfRescheduleApproved(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    bookingId: string;
    clientId: string;
    therapistId: string;
    newScheduledAt: string;
    serviceName: string | null;
  },
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const TPL_RESCHEDULE_RESPONDED = 27;

  const { data: therapistRow } = await admin
    .from("therapist_profiles")
    .select("display_name")
    .eq("id", args.therapistId)
    .maybeSingle();
  const therapistName = therapistRow?.display_name ?? "L'operatore";

  const d = new Date(args.newScheduledAt);
  const TZ = "Europe/Rome";
  const sessionDateStr = d.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });
  const sessionTimeStr = d.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });

  await Promise.allSettled([
    admin.from("notifications").insert({
      user_id: args.clientId,
      type: "reschedule_approved",
      title: "Nuovo orario approvato",
      body: `${therapistName} ha approvato la tua proposta per "${args.serviceName ?? "la sessione"}": ${sessionDateStr} ${sessionTimeStr}.`,
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
        template_id: TPL_RESCHEDULE_RESPONDED,
        user_id: args.clientId,
        params: {
          therapist_name: therapistName,
          service_name: args.serviceName ?? "Sessione",
          action: "approvata",
          new_session_date: sessionDateStr,
          new_session_time: sessionTimeStr,
          booking_id: args.bookingId,
        },
        tags: ["reschedule_approved"],
      }),
    }).catch((err) => {
      console.warn("[approve-reschedule] brevo send failed (non-blocking):", err);
    }),
  ]);
}
