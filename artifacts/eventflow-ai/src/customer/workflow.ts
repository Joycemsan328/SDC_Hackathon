import { supabase } from "@/lib/supabase";

export type PlanSelection = {
  request_id: string; customer_id: string; proposal_id: string; plan_key: "A" | "B";
  revision: string; decision: "pending" | "approved" | "changes_requested";
  message: string; selected_at: string; reviewed_at: string | null;
};

export function workflowErrorMessage(error: { code?: string; message: string }): string {
  if (["42P01", "PGRST205", "PGRST202", "42883"].includes(error.code || "")) {
    return "Persistent plan selection is unavailable until the owner approves and applies scripts/sql/eventflow-mvp-workflow.sql. No browser-only selection has been saved.";
  }
  return error.message;
}

export async function savePlanSelection(requestId: string, proposalId: string): Promise<PlanSelection> {
  const { data, error } = await supabase.rpc("eventflow_select_plan", {
    p_request_id: requestId, p_proposal_id: proposalId,
  });
  if (error) throw new Error(workflowErrorMessage(error));
  if (!data || data.request_id !== requestId || data.proposal_id !== proposalId
    || !["pending", "approved", "changes_requested"].includes(data.decision)) {
    throw new Error("The saved selection could not be verified. Reload before trying again.");
  }
  return data as PlanSelection;
}
