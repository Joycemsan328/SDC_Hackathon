import { supabase } from "./supabase";
import type { PlanKey, ProposalPlanContent } from "@/business/proposalEditorModel";

// Temporary submission path. No missing workflow objects or booking mutations.
export const SUBMISSION_MVP = true;
export async function approveSubmissionPair(requestId?: string, revision?: string) {
  if (!requestId || !revision) throw new Error("The saved request and revision are required.");
  const { data, error } = await supabase.rpc("approve_ai_proposal_pair", {
    p_request_id: requestId, p_revision: revision,
  });
  if (error) throw new Error(error.message);
  if (data !== 2) throw new Error("Both-plan approval could not be verified. Reload before retrying.");
  window.dispatchEvent(new Event("eventflow-workflow-updated"));
}

export async function savePendingAIProposal(
  requestId: string,
  revision: string,
  planKey: PlanKey,
  planContent: ProposalPlanContent,
) {
  if (!requestId || !/^[1-9][0-9]{0,31}$/.test(revision)) {
    throw new Error("A saved request and numeric proposal revision are required.");
  }
  const { data, error } = await supabase.rpc("eventflow_update_pending_ai_proposal", {
    p_request_id: requestId,
    p_revision: revision,
    p_plan_key: planKey,
    p_plan_content: planContent,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) {
    throw new Error("The database did not confirm the proposal update.");
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eventflow-workflow-updated"));
}
