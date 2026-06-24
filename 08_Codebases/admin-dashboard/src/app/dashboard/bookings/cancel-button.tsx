"use client";

import { useState } from "react";

export function CancelBookingButton({
  bookingId,
  status,
}: {
  bookingId: string;
  status: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Only allow cancelling active bookings
  const isCancellable =
    status === "pending" || status === "confirmed" || status === "reschedule_pending";

  if (!isCancellable) return null;

  async function handleCancel() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cancel-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      if (res.ok) {
        setResult("success");
        setShowConfirm(false);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setLoading(false);
    }
  }

  if (result === "success") {
    return <span className="text-xs font-medium text-charcoal-muted">Cancelled</span>;
  }

  if (showConfirm) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleCancel}
          disabled={loading}
          className="rounded-lg bg-error/90 px-2 py-1 text-[10px] font-semibold text-white hover:bg-error transition-colors disabled:opacity-50"
        >
          {loading ? "..." : "Confirm"}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="rounded-lg border border-berry/10 px-2 py-1 text-[10px] font-medium text-charcoal-muted hover:bg-cream-dark transition-colors"
        >
          No
        </button>
        {result === "error" && <span className="text-[10px] text-error">Failed</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="rounded-lg border border-error/20 px-2 py-1 text-[10px] font-medium text-error hover:bg-error-light transition-colors"
    >
      Cancel
    </button>
  );
}
