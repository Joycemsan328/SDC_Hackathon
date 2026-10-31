import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SUBMISSION_MVP } from "@/lib/submissionMvp";
import SubmissionPairReview from "./SubmissionPairReview";
import { asSelection, workflowRpc, type WorkflowRevision, type PlanSelection } from "@/lib/businessWorkflow";
export type { PlanSelection };
export type ReviewDecision = "approved" | "changes_requested";
export type ReviewResult = { error?: string };
export function selectionErrorMessage(error: { code?: string; message: string }) {
  return ["42P01","PGRST205","PGRST202","42883"].includes(error.code || "")
    ? "The Business-first migration is not installed. Live decisions are unavailable." : error.message;
}
export async function persistReview(selection: PlanSelection, decision: ReviewDecision, message: string): Promise<PlanSelection> {
  if (decision !== "approved") throw new Error("Customer changes create a new revision; Business confirms only the final selection.");
  const row = await workflowRpc("eventflow_confirm_selection", {
    p_request_id: selection.request_id, p_revision: Number(selection.revision),
    p_proposal_id: selection.proposal_id, p_selected_at: selection.selected_at, p_message: message.trim(),
  });
  const confirmed = asSelection(row);
  if (!confirmed || row.state !== "confirmed") throw new Error("Final confirmation could not be verified.");
  return confirmed;
}
type DraftPlan = {
  id: string; plan_key: string; plan_content: {
    title?: string; concept?: string; costBreakdown?: { item: string; description: string; amountMYR: number }[];
    totalEstimatedMYR?: number;
  };
};
export default function SavedPlanReview(props: {
  requestId?: string; revision?: string; selection?: PlanSelection;
  onReview: (decision: ReviewDecision, message: string) => Promise<ReviewResult>;
}) {
  return SUBMISSION_MVP
    ? <SubmissionPairReview requestId={props.requestId ?? props.selection?.request_id} revision={props.revision ?? props.selection?.revision} />
    : <BusinessFirstSavedPlanReview {...props} />;
}
function BusinessFirstSavedPlanReview({ requestId, revision, selection }: {
  requestId?: string; revision?: string; selection?: PlanSelection;
  onReview: (decision: ReviewDecision, message: string) => Promise<ReviewResult>;
}) {
  const [row, setRow] = useState<WorkflowRevision | null>(null);
  const [plans, setPlans] = useState<DraftPlan[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const lock = useRef(false);
  const id = requestId ?? selection?.request_id;
  useEffect(() => {
    let active = true;
    setRow(null); setPlans([]); setReviewed(false); setError("");
    if (!id) return;
    void (async () => {
      try {
        const result = await supabase.from("eventflow_proposal_revisions").select("*")
          .eq("request_id", id).order("revision", { ascending: false }).limit(1).maybeSingle();
        if (result.error) throw new Error(selectionErrorMessage(result.error));
        if (!active) return;
        const current = result.data as WorkflowRevision | null;
        setRow(current);
        if ((current?.plan_a_id && current.plan_b_id) || (!current && revision && /^[1-9][0-9]*$/.test(revision))) {
          const query = supabase.from("proposals").select("id,plan_key,plan_content");
          const pair = current
            ? await query.in("id", [current.plan_a_id!,current.plan_b_id!])
            : await query.eq("request_id",id).eq("revision",revision!);
          if (pair.error) throw new Error(pair.error.message);
          if (pair.data?.length !== 2 || new Set(pair.data.map(plan => plan.plan_key)).size !== 2) {
            throw new Error("The complete A/B pair could not be verified. Release is disabled.");
          }
          if (active) setPlans(pair.data as DraftPlan[]);
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Workflow could not be loaded."); }
    })();
    return () => { active=false; };
  }, [id,revision,version]);
  const act = async () => {
    if (!row || lock.current) return;
    lock.current=true; setBusy(true); setError("");
    try {
      if (row.state === "business_review") {
        if (!reviewed || plans.length !== 2) throw new Error("Review both plans and confirm the checklist first.");
        await workflowRpc("eventflow_release_pair", { p_request_id: row.request_id,p_revision: row.revision });
      } else if (row.state === "selected") {
        await workflowRpc("eventflow_confirm_selection", {
          p_request_id: row.request_id,p_revision: row.revision,p_proposal_id: row.selected_proposal_id,
          p_selected_at: row.selected_at,p_message: message.trim(),
        });
      }
      setVersion(value => value+1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The decision could not be saved."); }
    finally { lock.current=false; setBusy(false); }
  };
  const adopt = async () => {
    if (!id || !revision || plans.length!==2 || lock.current) return;
    lock.current=true; setBusy(true); setError("");
    try {
      await workflowRpc("eventflow_adopt_legacy_pair", {
        p_request_id:id,p_revision:Number(revision),
        p_plan_a_id:plans.find(plan=>plan.plan_key==="A")?.id,
        p_plan_b_id:plans.find(plan=>plan.plan_key==="B")?.id,
      });
      setVersion(value=>value+1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Existing pair could not be registered."); }
    finally { lock.current=false;setBusy(false); }
  };
  return <section className="space-y-3 text-xs text-[#74677b]" data-testid="saved-plan-review">
    {error && <p role="alert" className="text-[#a34e58]">{error}</p>}
    {!row && !error && <><p>No managed revision is available. Registering an existing pair preserves its content and requires Business review before release.</p>
      {plans.length===2 && <button disabled={busy} onClick={()=>void adopt()}
        className="rounded-xl border border-[#e7dfe9] px-4 py-3 font-semibold disabled:opacity-50" data-testid="button-adopt-existing-pair">
        Register existing pair for Business review
      </button>}</>}
    {row && <>
      <p className="font-semibold">Revision {row.revision} · {row.state.replaceAll("_"," ")}</p>
      {row.change_message && <p className="whitespace-pre-wrap rounded-xl bg-[#f7f2fa] p-3">Customer changes: {row.change_message}</p>}
      {row.state === "business_review" && <>
        <p>Both plans are private to Business until you release this pair.</p>
        {plans.map(plan => <details key={plan.id} className="rounded-xl border border-[#e7dfe9] p-3">
          <summary className="cursor-pointer font-semibold">Plan {plan.plan_key}: {plan.plan_content?.title} · RM {Number(plan.plan_content?.totalEstimatedMYR ?? 0).toLocaleString()}</summary>
          <p className="mt-2">{plan.plan_content?.concept}</p>
          <ul className="mt-2 space-y-2">{plan.plan_content?.costBreakdown?.map((item,index) =>
            <li key={index}>{item.item}: {item.description} — RM {Number(item.amountMYR).toLocaleString()}</li>)}</ul>
        </details>)}
        <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed both Plan A and Plan B and approve releasing both to the customer.</label>
        <button disabled={busy || !reviewed || plans.length!==2 || !!error} onClick={() => void act()}
          className="rounded-xl bg-[#bb7d99] px-4 py-3 font-bold text-white disabled:opacity-50" data-testid="button-release-pair">
          {busy ? "Saving…" : "Release both plans to Customer"}
        </button>
      </>}
      {row.state === "released" && <p>Both plans released. Awaiting the customer's selection or change request.</p>}
      {row.state === "selected" && <>
        <p>Customer selected Plan {row.selected_proposal_id===row.plan_a_id ? "A" : "B"}. Confirm this exact selection to finish.</p>
        <textarea value={message} onChange={event=>setMessage(event.target.value)} maxLength={4000}
          className="w-full rounded-xl border p-3" placeholder="Optional confirmation message" aria-label="Confirmation message" />
        <button disabled={busy} onClick={()=>void act()} className="rounded-xl bg-[#bb7d99] px-4 py-3 font-bold text-white disabled:opacity-50"
          data-testid="button-confirm-selection">{busy ? "Saving…" : "Confirm final customer selection"}</button>
      </>}
      {row.state === "confirmed" && <p role="status">Final selection confirmed. {row.business_message}</p>}
      {["queued","generating"].includes(row.state) && <p>The next revision is waiting for generation. It must be reviewed and released again.</p>}
    </>}
  </section>;
}
