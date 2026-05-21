/**
 * Runtime input validation for Edge Functions using Zod.
 *
 * Rationale: Edge Functions receive JSON from iOS + webapp clients.
 * Without schema validation, a malformed or hostile payload can:
 *   - throw unexpected exceptions in handler code
 *   - pass through to Stripe / Postgres with bad types (causing 500s)
 *   - trigger prototype pollution / ReDoS on unguarded string fields
 *
 * Pattern: each function imports a narrow schema from this file and
 * calls `parseJson(req, Schema)` at the top of the handler. On failure
 * returns 400 with the structured error issues.
 */

import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

// ── Common primitives ───────────────────────────────────────────────

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime();
const positiveInt = z.number().int().positive();
const currency = z
  .string()
  .length(3)
  .regex(/^[a-z]{3}$/i, "3-letter ISO currency code")
  .transform((s) => s.toLowerCase());

// ── Edge function schemas ───────────────────────────────────────────

/** create-booking-with-payment */
export const BookingPaymentSchema = z.object({
  booking_id: uuid,
  therapist_id: uuid,
  service_id: uuid,
  service_name: z.string().min(1).max(200),
  duration: positiveInt.max(600), // minutes, sanity upper bound
  price: z.number().min(0.5).max(999999.99),
  scheduled_at: isoDateTime,
  timezone: z.string().min(1).max(64),
  video_room_id: z.string().min(1).max(128).nullable().optional(),
  promo_code: z.string().max(64).nullable().optional(),
  discount: z.number().min(0).max(0.95).nullable().optional(),
  pack_booking_id: uuid.nullable().optional(),
  currency: currency.optional(),
  idempotency_key: z.string().min(1).max(128).optional(),
});

/** livekit-token */
export const LivekitTokenSchema = z.object({
  roomName: z.string().min(1).max(128).regex(
    /^[a-zA-Z0-9_\-]+$/,
    "roomName must be alphanumeric + -_"
  ),
  participantName: z.string().min(1).max(100),
});

/** request-refund */
export const RefundSchema = z.object({
  transaction_id: uuid.optional(),
  booking_id: uuid.optional(),
  reason: z.string().max(500).optional(),
}).refine(
  (d) => d.transaction_id || d.booking_id,
  { message: "transaction_id or booking_id is required" }
);

/** detach-payment-method */
// The iOS client sends the DB row ID (UUID), not the Stripe pm_xxx id.
// The function looks up the row and dereferences `stripe_payment_method_id`
// internally, which is why ownership can be verified atomically.
export const DetachPaymentMethodSchema = z.object({
  payment_method_row_id: uuid,
});

// ── Helper ──────────────────────────────────────────────────────────

/**
 * Parse JSON body against a Zod schema. On failure returns a 400
 * response ready to return from the handler.
 */
export async function parseJson<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
  corsHeaders: Record<string, string>
): Promise<
  | { success: true; data: z.infer<T>; response?: never }
  | { success: false; response: Response; data?: never }
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      success: false,
      response: new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: "Validation failed",
          issues: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      ),
    };
  }

  return { success: true, data: result.data };
}
