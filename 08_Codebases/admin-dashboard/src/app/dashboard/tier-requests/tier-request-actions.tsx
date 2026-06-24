"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  therapistId: string;
};

/**
 * Two-button row: Approve / Reject. Calls the admin API route and
 * refreshes the server component (the queue) on success so the row
 * disappears from the pending list.
 */
export default function TierRequestActions({ therapistId }: Props) {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const router = useRouter();

  async function handle(action: "approve" | "reject") {
    setLoading(action);
    try {
      const res = await fetch(`/api/admin/tier-requests/${therapistId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error || res.statusText}`);
        return;
      }
      router.refresh();
    } catch {
      alert("Network error. Try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => handle("approve")}
        disabled={loading !== null}
        className="inline-flex items-center gap-1.5 rounded-full bg-berry px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-berry-dark active:scale-[0.97] disabled:opacity-50"
      >
        {loading === "approve" ? "Approving..." : "Approve"}
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm("Reject this tier request? The therapist will see it was not approved and can resubmit.")) {
            handle("reject");
          }
        }}
        disabled={loading !== null}
        className="inline-flex items-center gap-1.5 rounded-full border-2 border-error/20 px-4 py-1.5 text-xs font-semibold text-error transition-all hover:bg-error-light disabled:opacity-50"
      >
        {loading === "reject" ? "Rejecting..." : "Reject"}
      </button>
    </div>
  );
}
