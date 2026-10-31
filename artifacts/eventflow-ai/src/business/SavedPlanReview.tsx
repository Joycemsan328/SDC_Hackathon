import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type PlanSelection = {
  request_id: string; customer_id: string; proposal_id: string; plan_key: "A" | "B";
  revision: string; decision: "pending" | "approved" | "changes_requested";
  message: string; selected_at: string; reviewed_at: string | null;
};
export type ReviewDecision = "approved" | "changes_requested";
export type ReviewResult = { error?: string };
export function selectionErrorMessage(error: { code?: string; message: string }) {
  return ["42P01", "PGRST205", "PGRST202", "42883"].includes(error.code || "")
    ? "Persistent plan review needs the approved Supabase migration: scripts/sql/eventflow-mvp-workflow.sql. Browser demo choices are not used."
    : error.message;
}
export async function persistReview(selection: PlanSelection, decision: ReviewDecision, message: string): Promise<PlanSelection> {
  const { data, error } = await supabase.rpc("eventflow_review_plan", {
    p_request_id: selection.request_id, p_proposal_id: selection.proposal_id,
    p_selected_at: selection.selected_at, p_decision: decision, p_message: message.trim(),
  });
  if (error) throw new Error(selectionErrorMessage(error));
  if (!data || data.request_id !== selection.request_id || data.proposal_id !== selection.proposal_id || data.decision !== decision) {
    throw new Error("The saved decision could not be verified. Refresh before reviewing again.");
  }
  return data as PlanSelection;
}

export default function SavedPlanReview({ selection, onReview }: {
  selection?: PlanSelection;
  onReview: (decision: ReviewDecision, message: string) => Promise<ReviewResult>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const lock = useRef(false);
  if (!selection) return <p className="text-xs text-[#74677b]">Only the customer’s persistently selected plan can be reviewed. The other plan will not be approved.</p>;
  const review = async (decision: ReviewDecision) => {
    if (lock.current) return;
    if (decision === "changes_requested" && !message.trim()) { setError("Include a message explaining the requested changes."); return; }
    lock.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const result = await onReview(decision, message);
      if (result.error) setError(result.error);
      else { setMessage(""); setFeedback("Decision saved to Supabase. The customer can now see it."); }
    } catch { setError("The decision could not be saved. Check your connection and retry."); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="space-y-3" data-testid="saved-plan-review">
    <p className="text-xs font-semibold text-[#64806b]">Customer-selected Plan {selection.plan_key} · saved to Supabase</p>
    {selection.decision !== "pending" ? <div role="status" className="rounded-xl bg-[#f3edf6] p-3 text-xs text-[#74677b]">
      <strong>{selection.decision === "approved" ? "Approved" : "Changes requested"}</strong>
      {selection.message && <p className="mt-2 whitespace-pre-wrap" data-testid="text-review-message">{selection.message}</p>}
    </div> : <>
      <label className="block text-xs text-[#74677b]">Message to customer (required for Request Changes)
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} disabled={busy}
          rows={3} className="mt-2 w-full rounded-xl border border-[#e7dfe9] bg-white p-3 text-sm"
          data-testid="textarea-business-review-message" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void review("approved")} className="rounded-xl bg-[#bb7d99] px-4 py-3 text-xs font-bold text-white disabled:opacity-50" data-testid="button-approve-selected-plan">{busy ? "Saving…" : `Approve Plan ${selection.plan_key}`}</button>
        <button disabled={busy} onClick={() => void review("changes_requested")} className="rounded-xl border border-[#e7dfe9] bg-white px-4 py-3 text-xs font-bold text-[#74677b] disabled:opacity-50" data-testid="button-request-plan-changes">Request Changes</button>
      </div>
    </>}
    {error && <p role="alert" className="text-xs text-[#a34e58]">{error}</p>}
    {feedback && <p role="status" className="text-xs text-[#64806b]">{feedback}</p>}
  </section>;
}
