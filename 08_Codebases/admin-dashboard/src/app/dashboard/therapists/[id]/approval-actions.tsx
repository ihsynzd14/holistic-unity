"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ApprovalActions({ therapistId, currentStatus, isVerified }: {
  therapistId: string; currentStatus: string; isVerified: boolean;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const router = useRouter();

  async function handleAction(action: "approve" | "reject") {
    setLoading(action);
    try {
      const res = await fetch(`/api/therapists/${therapistId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: action === "reject" ? feedback : undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Error: ${data.error || "Unknown error"}`);
        return;
      }
      router.refresh();
    } catch { alert("Network error. Please try again."); }
    finally { setLoading(null); }
  }

  return (
    <div className="mt-6 border-t border-berry/5 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {currentStatus !== "approved" && (
          <button onClick={() => handleAction("approve")} disabled={loading !== null}
            className="inline-flex items-center gap-2 rounded-full bg-berry px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-berry/20 transition-all duration-200 hover:bg-berry-dark hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50">
            {loading === "approve" ? <Spinner /> : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
            Approve Therapist
          </button>
        )}
        {currentStatus !== "changes_requested" && currentStatus !== "draft" && (
          <button onClick={() => setShowRejectForm(!showRejectForm)} disabled={loading !== null}
            className="inline-flex items-center gap-2 rounded-full border-2 border-berry/20 bg-transparent px-6 py-2.5 text-sm font-semibold text-berry transition-all duration-200 hover:bg-berry-subtle/30 disabled:opacity-50">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
            Request Changes
          </button>
        )}
        {currentStatus === "approved" && (
          <>
            <button onClick={() => { if (confirm("Revoke this therapist's approval?")) handleAction("reject"); }} disabled={loading !== null}
              className="inline-flex items-center gap-2 rounded-full border-2 border-error/20 px-6 py-2.5 text-sm font-semibold text-error transition-all duration-200 hover:bg-error-light disabled:opacity-50">
              Revoke Approval
            </button>
            <span className="flex items-center gap-1.5 text-sm font-medium text-success">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
              Approved &mdash; accepting bookings
            </span>
          </>
        )}
      </div>

      {showRejectForm && (
        <div className="mt-4 rounded-2xl border border-gold/20 bg-warning-light/50 p-5">
          <label className="block text-sm font-semibold text-charcoal">Feedback for the therapist</label>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)}
            placeholder="What needs to be updated..." rows={3}
            className="mt-2 w-full rounded-[14px] border border-berry/10 bg-white px-4 py-3 text-sm outline-none transition-all focus:border-berry focus:ring-2 focus:ring-berry/10"
          />
          <div className="mt-3 flex gap-2">
            <button onClick={() => handleAction("reject")} disabled={loading !== null || !feedback.trim()}
              className="rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-berry-dark disabled:opacity-50">
              {loading === "reject" ? <Spinner /> : "Send Feedback"}
            </button>
            <button onClick={() => { setShowRejectForm(false); setFeedback(""); }}
              className="rounded-full border border-berry/10 px-5 py-2 text-sm text-charcoal-muted transition-all hover:bg-cream-dark">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>;
}
