import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRateLimit } from "@/lib/auth/rateLimit";

/**
 * POST /api/reviews
 * Body: { bookingId: string, rating: 1..5, text?: string }
 *
 * Server-mediated review insert. Replaces the previous client-side
 * `supabase.from("reviews").insert(...)` from ReviewModal which:
 *   - trusted client-supplied `client_name` / `client_photo_url`
 *     (anyone could pose as another user's name on a public review)
 *   - had no rate limit
 *   - had no length sanitization
 *   - relied entirely on the DB trigger `validate_review_booking`
 *     for booking ownership/state checks
 *
 * Server-side checks:
 *   1. Auth: must be logged in.
 *   2. Authorisation: caller must be the booking's `client_id`.
 *   3. State machine: booking must be `completed` (cannot review a
 *      session that hasn't happened).
 *   4. Therapist match: prevent inserting a review for a different
 *      therapist than the one on the booking.
 *   5. Rating range: integer 1..5.
 *   6. Text length: max 1000 chars (matches the client-side textarea cap;
 *      longer = abuse, defensive cap at server level).
 *   7. Idempotency: a UNIQUE constraint on (booking_id, client_id)
 *      already prevents double-submit at DB level. We surface 409 with
 *      a clean error so the UI can show "already reviewed".
 *   8. Display name + photo are looked up SERVER-SIDE from `users`,
 *      never trusted from the client.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Rate limit: 10 review submissions per hour. The DB UNIQUE on
  // (booking_id, client_id) already prevents double-submit per
  // booking; this layer mitigates a malicious user trying to brute-
  // force submit reviews across many bookings (e.g. to spam ratings
  // for a competitor).
  const rl = await withRateLimit(request, {
    key: "reviews-create",
    max: 10,
    windowSec: 3600,
    userId: user.id,
  });
  if (rl.response) return rl.response;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const b = body as {
    bookingId?: unknown;
    rating?: unknown;
    text?: unknown;
  };

  const bookingId = typeof b.bookingId === "string" ? b.bookingId : "";
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    return NextResponse.json({ error: "bookingId non valido" }, { status: 400 });
  }
  const ratingNum =
    typeof b.rating === "number" && Number.isInteger(b.rating)
      ? b.rating
      : NaN;
  if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return NextResponse.json(
      { error: "rating deve essere un intero da 1 a 5" },
      { status: 400 },
    );
  }
  const text =
    typeof b.text === "string" && b.text.trim().length > 0
      ? b.text.trim().slice(0, 1000)
      : null;

  const admin = createAdminClient();

  // Booking lookup + ownership + state checks. Service-role bypass of
  // RLS — the user's auth.uid() match is enforced explicitly below.
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .select("id, client_id, therapist_id, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (bErr || !booking) {
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }
  if (booking.client_id !== user.id) {
    // Don't leak existence — same shape as not-found.
    return NextResponse.json({ error: "Prenotazione non trovata" }, { status: 404 });
  }
  if (booking.status !== "completed") {
    return NextResponse.json(
      { error: "Puoi recensire solo sessioni completate" },
      { status: 409 },
    );
  }

  // Server-side resolution of display_name + photo. Client cannot spoof.
  const { data: u } = await admin
    .from("users")
    .select("display_name, photo_url")
    .eq("id", user.id)
    .maybeSingle();

  const { error: insertErr } = await admin.from("reviews").insert({
    booking_id: booking.id,
    client_id: user.id,
    therapist_id: booking.therapist_id,
    client_name: (u?.display_name ?? "").slice(0, 80) || "Cliente",
    client_photo_url: u?.photo_url ?? null,
    rating: ratingNum,
    text,
  });

  if (insertErr) {
    // 23505 = unique violation on (booking_id, client_id) → already reviewed.
    if (insertErr.code === "23505") {
      return NextResponse.json(
        { error: "Hai già pubblicato una recensione per questa sessione" },
        { status: 409 },
      );
    }
    console.error("[api/reviews] insert failed:", insertErr);
    return NextResponse.json(
      { error: "Pubblicazione fallita. Riprova." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
