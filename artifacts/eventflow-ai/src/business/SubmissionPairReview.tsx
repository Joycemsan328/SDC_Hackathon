import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { approveSubmissionPair } from "@/lib/submissionMvp";
import ProposalEditor from "./ProposalEditor";
import type { PlanKey } from "./proposalEditorModel";

type Plan = {
  id: string; plan_key: string; status: string; plan_content: {
    title?: string; concept?: string; totalEstimatedMYR?: number;
    costBreakdown?: { item: string; description: string; amountMYR: number }[];
  } | null;
};
export default function SubmissionPairReview({ requestId, revision }: { requestId?: string; revision?: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [editingPlanKey, setEditingPlanKey] = useState<PlanKey | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setPlans([]); setError(""); setReviewed(false);
    if (!requestId || !revision) { setError("The saved request and revision are missing."); return; }
    void (async () => {
      const { data, error } = await supabase.from("proposals").select("id,plan_key,status,plan_content")
        .eq("request_id", requestId).eq("revision", revision);
      if (!active) return;
      if (error) { setError(error.message); return; }
      if (data?.length !== 2 || !["A","B"].every(key => data.some(row => row.plan_key === key && row.plan_content))) {
        setError("The complete A/B pair could not be verified. No approval was made."); return;
      }
      setPlans(data as Plan[]);
    })().catch(() => { if (active) setError("The saved pair could not be reached."); });
    return () => { active = false; };
  }, [requestId, revision, version]);
  const pending = plans.length === 2 && plans.every(plan => plan.status === "Pending Business Approval");
  const approve = async () => {
    if (!reviewed || !pending || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await approveSubmissionPair(requestId, revision); setVersion(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Approval failed."); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="space-y-3 text-xs text-[#74677b]" data-testid="submission-pair-review">
    {error && <p role="alert">{error}</p>}
     {plans.map(plan => <details key={plan.id} className="rounded-xl border border-[#e7dfe9] p-3">
       <summary className="cursor-pointer font-semibold">Plan {plan.plan_key}: {plan.plan_content?.title} · RM {Number(plan.plan_content?.totalEstimatedMYR ?? 0).toLocaleString()}</summary>
       <p className="mt-2">{plan.plan_content?.concept}</p>
       <ul className="mt-2 space-y-2">{plan.plan_content?.costBreakdown?.map((item, index) =>
         <li key={index}>{item.item}: {item.description} — RM {Number(item.amountMYR).toLocaleString()}</li>)}</ul>
       {pending && editingPlanKey === plan.plan_key
         ? <ProposalEditor
             requestId={requestId!}
             revision={revision!}
             planKey={plan.plan_key as PlanKey}
             planContent={plan.plan_content}
             onCancel={() => setEditingPlanKey(null)}
             onSaved={() => { setEditingPlanKey(null); setReviewed(false); setVersion(value => value + 1); }}
           />
         : pending && <button type="button" disabled={busy || editingPlanKey !== null} onClick={() => setEditingPlanKey(plan.plan_key as PlanKey)}
             className="mt-3 rounded-lg border border-[#e7dfe9] px-3 py-2 text-[10px] font-semibold text-[#775b82] disabled:opacity-50"
             data-testid={`button-edit-plan-${plan.plan_key}`}>Edit Plan {plan.plan_key}</button>}
     </details>)}
    {pending ? <>
      <label className="flex gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed both Plan A and Plan B.</label>
       <button disabled={!reviewed || busy || editingPlanKey !== null || !!error} onClick={() => void approve()}
        className="rounded-xl bg-[#bb7d99] px-4 py-3 font-bold text-white disabled:opacity-50" data-testid="button-approve-submission-pair">
        {busy ? "Approving…" : "Approve both plans for Customer"}
      </button>
    </> : plans.length === 2 && <p role="status">Pair status: {plans.map(plan => `Plan ${plan.plan_key}: ${plan.status}`).join(" · ")}</p>}
    <p>Both plans must be approved before the Customer can respond to this revision.</p>
  </section>;
}
