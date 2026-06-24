"use client";

import { useState } from "react";

export function RefundButton({
  transactionId,
  status,
  amount,
}: {
  transactionId: string;
  status: string;
  amount: number;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const isRefundable =
    status === "completed" || status === "processing";

  if (!isRefundable) return null;

  async function handleRefund() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      if (res.ok) {
        setResult("success");
        setShowConfirm(false);
        // Reload the page after a short delay to reflect changes
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const data = await res.json();
        console.error("Refund failed:", data.error);
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setLoading(false);
    }
  }

  if (result === "success") {
    return (
      <span className="text-xs font-medium text-success">
        Refunded
      </span>
    );
  }

  if (showConfirm) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleRefund}
          disabled={loading}
          className="rounded-lg bg-error/90 px-2 py-1 text-[10px] font-semibold text-white hover:bg-error transition-colors disabled:opacity-50"
        >
          {loading ? "..." : `Refund`}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="rounded-lg border border-berry/10 px-2 py-1 text-[10px] font-medium text-charcoal-muted hover:bg-cream-dark transition-colors"
        >
          Cancel
        </button>
        {result === "error" && (
          <span className="text-[10px] text-error">Failed</span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="rounded-lg border border-error/20 px-2 py-1 text-[10px] font-medium text-error hover:bg-error-light transition-colors"
    >
      Refund
    </button>
  );
}
