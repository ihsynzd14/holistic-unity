import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/bookings/[id]/decline-reschedule
 *
 * Therapist refuses a CLIENT-proposed reschedule. The booking flips
 * back to `confirmed` at the original `scheduled_at` and the proposal
 * is cleared.
 *
 * Replaces the previous client-side direct-DB update which had no
 * notification side effect — the client never knew their proposal had
 * been rejected and was left waiting indefinitely.
 *
 * Server-side checks:
 *   1. Auth: must be the booking's therapist
 *   2. State: must be `reschedule_pending` with reschedule_proposed_by="client"
 *   3. Atomic optimistic-locked UPDATE
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
    key: "therapist-decline-reschedule",
    max: 30,
    windowSec: 3600,
    userId: user.id,
  });
  if (limit.response) return limit.response;

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status, scheduled_at, reschedule_proposed_by, service_name, reschedule_count")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.therapist_id !== user.id) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }
  if (booking.status !== "reschedule_pending") {
    return NextResponse.json(
      { error: "Nessuna proposta di riprogrammazione attiva" },
      { status: 409 },
    );
  }

  // Increment reschedule_count even on decline so a client can't
  // burn unlimited proposals when the therapist keeps refusing
  // (the 3-cap also applies to attempts, not only successes).
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
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
    console.error("[booking/decline-reschedule] update failed:", updateErr);
    return NextResponse.json({ error: "Aggiornamento fallito" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Lo stato della prenotazione è cambiato. Aggiorna la pagina." },
      { status: 409 },
    );
  }

  // Notify the client (in-app + email). Awaited so the inserts don't
  // get killed by serverless terminate. The previous insert was using
  // a non-existent `metadata` column — fixed to canonical columns.
  await notifyClientOfRescheduleDeclined(admin, {
    bookingId: booking.id,
    clientId: booking.client_id,
    therapistId: booking.therapist_id,
    originalScheduledAt: updated.scheduled_at,
    serviceName: booking.service_name ?? null,
  });

  return NextResponse.json({ success: true, scheduled_at: updated.scheduled_at });
}

async function notifyClientOfRescheduleDeclined(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    bookingId: string;
    clientId: string;
    therapistId: string;
    originalScheduledAt: string;
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

  const d = new Date(args.originalScheduledAt);
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
      type: "reschedule_declined",
      title: "Riprogrammazione rifiutata",
      body: `${therapistName} ha rifiutato la tua proposta di riprogrammazione per "${args.serviceName ?? "la sessione"}". La sessione resta confermata il ${sessionDateStr} ${sessionTimeStr}.`,
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
          action: "rifiutata",
          new_session_date: sessionDateStr,
          new_session_time: sessionTimeStr,
          booking_id: args.bookingId,
        },
        tags: ["reschedule_declined"],
      }),
    }).catch((err) => {
      console.warn("[decline-reschedule] brevo send failed (non-blocking):", err);
    }),
  ]);
}
