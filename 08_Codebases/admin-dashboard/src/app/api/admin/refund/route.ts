import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { logAdminAction } from "@/lib/auth/audit";
import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * POST /api/admin/refund
 * Triggers a refund for a transaction via the request-refund Edge Function.
 * Body: { transactionId: string, amount?: number } (amount is optional for partial refund)
 */
export async function POST(request: NextRequest) {
  // Defense-in-depth: ADMIN_EMAILS env whitelist AND users.is_admin DB flag.
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = await request.json();
  const { transactionId, amount } = body;

  if (!transactionId) {
    return NextResponse.json(
      { error: "transactionId is required" },
      { status: 400 }
    );
  }

  // Look up transaction to get booking_id for the Edge Function
  const admin = createAdminClient();
  const { data: transaction, error: txError } = await admin
    .from("transactions")
    .select("id, booking_id, amount, status, stripe_payment_intent_id")
    .eq("id", transactionId)
    .single();

  if (txError || !transaction) {
    return NextResponse.json(
      { error: "Transaction not found" },
      { status: 404 }
    );
  }

  if (transaction.status === "refunded") {
    return NextResponse.json(
      { error: "Transaction already refunded" },
      { status: 400 }
    );
  }

  // Call the request-refund Edge Function. The Edge Function expects
  // `transaction_id` (snake_case) and treats it as the BOOKING ID (a
  // legacy iOS naming quirk preserved server-side). Earlier this route
  // sent `transactionId` (camelCase) with the transaction's DB id —
  // the Edge Function read `undefined` for `transaction_id`, returned
  // 400, and every admin refund silently failed. Fix: use the correct
  // field name AND pass the booking_id we just looked up.
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/request-refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_id: transaction.booking_id,
        ...(amount ? { amount } : {}),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Refund failed" },
        { status: res.status }
      );
    }

    // Audit trail — admin-initiated refunds touch real money, so the
    // who/when/how-much must be persisted. Best-effort, non-blocking.
    await logAdminAction({
      request,
      adminUserId: auth.user.id,
      adminEmail: auth.user.email,
      action: "transaction.refund",
      targetTable: "transactions",
      targetId: transactionId,
      details: {
        booking_id: transaction.booking_id,
        amount: amount ?? transaction.amount,
        partial: amount !== undefined,
      },
    });

    return NextResponse.json({ success: true, refund: data });
  } catch (err) {
    console.error("Admin refund error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
