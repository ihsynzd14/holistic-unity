import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchExternalCalendarBusy,
  type CalendarIntegration,
} from "@/lib/calendar/tokens";

/**
 * GET /api/therapists/[id]/freebusy?start=ISO&end=ISO
 *
 * Returns the busy intervals for a given therapist within a window, so
 * the booking slot picker on the client side can compute genuinely-free
 * slots without seeing other clients' personal data.
 *
 * Why this exists: bookings are RLS-restricted so each client only sees
 * THEIR OWN bookings — meaning the slot picker on the therapist detail
 * page would always show every slot as free, even when another client
 * has already taken it. Two clients could then race the same slot, both
 * pay, and end up double-booked.
 *
 * Privacy: returns only `{ scheduled_at, duration }` — never client_id,
 * service name, price, etc. The therapist's calendar density is leaked
 * (necessary for slot computation) but no PII.
 *
 * Auth: requires any logged-in user (the slot picker is auth-gated).
 * Anti-abuse: window capped to 60 days; therapist must be approved.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id: therapistId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(therapistId)) {
    return NextResponse.json({ error: "Invalid therapist id" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  // Default window: now → +21 days (matches the slot picker's window).
  const now = Date.now();
  const startMs = startParam ? new Date(startParam).getTime() : now;
  const endMs = endParam
    ? new Date(endParam).getTime()
    : now + 21 * 24 * 60 * 60 * 1000;

  if (isNaN(startMs) || isNaN(endMs)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (endMs - startMs > 60 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "Window too large" }, { status: 400 });
  }
  if (endMs <= startMs) {
    return NextResponse.json({ error: "End must be after start" }, { status: 400 });
  }

  // Verify the therapist is fully bookable — same predicates as
  // applyClientVisibilityFilters. Querying freebusy on a not-yet-bookable
  // therapist would leak their calendar density even though clients
  // can't actually book them.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("therapist_profiles")
    .select("id")
    .eq("id", therapistId)
    .eq("approval_status", "approved")
    .eq("is_approved", true)
    .eq("stripe_account_status", "active")
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "Therapist not available" }, { status: 404 });
  }

  // Fetch the busy intervals using service-role (bypasses RLS).
  // Filter to live statuses only — cancelled/no_show slots are free again.
  const { data: bookings, error } = await admin
    .from("bookings")
    .select("scheduled_at, duration, status")
    .eq("therapist_id", therapistId)
    .in("status", [
      "pending",
      "pending_payment",
      "confirmed",
      "in_progress",
      "reschedule_pending",
    ])
    .gte("scheduled_at", new Date(startMs).toISOString())
    .lte("scheduled_at", new Date(endMs).toISOString());

  if (error) {
    console.error("[freebusy] query failed:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // Platform bookings — already a busy interval list.
  //
  // We DON'T return the booking's REAL status to the client. The slot
  // picker only cares whether a slot is busy; exposing internal states
  // like `reschedule_pending` or `pending_payment` to any authenticated
  // user would leak the therapist's operational state (e.g. could be
  // used to fingerprint when other clients are mid-checkout). The DB
  // query already filtered to LIVE_STATUSES, so every row here is a
  // hard conflict — we tag them with the synthetic status `"confirmed"`
  // which the client's `LIVE_STATUSES` set includes (so slots get
  // blocked correctly) but exposes no information.
  const platformBusy = (bookings ?? []).map((b) => ({
    scheduled_at: b.scheduled_at,
    duration: b.duration,
    status: "confirmed",
  }));

  // External calendar busy — Google / Microsoft. The therapist may have
  // connected one (or, in the future, multiple) external calendar(s);
  // we merge those busy intervals so a meeting on their personal
  // calendar blocks the slot the same way a platform booking would.
  // Failure here is non-fatal: we still return platform busy.
  let externalBusy: Array<{
    scheduled_at: string;
    duration: number;
    status: string;
  }> = [];
  try {
    const { data: integrations } = await admin
      .from("therapist_calendar_integrations")
      .select(
        "id, therapist_id, provider, access_token, refresh_token, token_expires_at, calendar_id",
      )
      .eq("therapist_id", therapistId);

    if (integrations && integrations.length > 0) {
      const results = await Promise.all(
        (integrations as CalendarIntegration[]).map((it) =>
          fetchExternalCalendarBusy(
            it,
            admin,
            new Date(startMs).toISOString(),
            new Date(endMs).toISOString(),
          ),
        ),
      );
      externalBusy = results.flat();
    }
  } catch (e) {
    console.error("[freebusy] external calendar fetch failed:", e);
  }

  const busy = [...platformBusy, ...externalBusy];

  // Return with a short cache to soften the load if a user clicks
  // around services. Keep it private (per-user JWT-bound).
  return NextResponse.json(
    { busy },
    {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    },
  );
}
