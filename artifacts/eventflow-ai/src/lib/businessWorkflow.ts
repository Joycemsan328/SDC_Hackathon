import { supabase } from "./supabase";

export type WorkflowRevision = {
  request_id: string; customer_id: string; revision: number;
  state: "queued" | "generating" | "business_review" | "released" | "selected" | "confirmed" | "changes_requested";
  plan_a_id: string | null; plan_b_id: string | null; selected_proposal_id: string | null;
  change_message: string; business_message: string; released_at: string | null;
  selected_at: string | null; confirmed_at: string | null;
};
export type PlanSelection = {
  request_id: string; customer_id: string; proposal_id: string; plan_key: "A" | "B";
  revision: string; decision: "pending" | "approved" | "changes_requested";
  message: string; selected_at: string; reviewed_at: string | null;
};
export function asSelection(row: WorkflowRevision): PlanSelection | null {
  if (!row.selected_proposal_id || !row.selected_at) return null;
  return { request_id: row.request_id, customer_id: row.customer_id, proposal_id: row.selected_proposal_id,
    plan_key: row.selected_proposal_id === row.plan_a_id ? "A" : "B", revision: String(row.revision),
    decision: row.state === "confirmed" ? "approved" : row.state === "changes_requested" ? "changes_requested" : "pending",
    message: row.business_message, selected_at: row.selected_at, reviewed_at: row.confirmed_at };
}
export function workflowChanged() {
  window.dispatchEvent(new Event("eventflow-workflow-updated"));
}
export async function workflowRpc(name: string, args: Record<string, unknown>): Promise<WorkflowRevision> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(["42P01", "PGRST205", "PGRST202", "42883"].includes(error.code)
    ? "The Business-first workflow is not installed. No demo decision was saved."
    : error.message);
  if (!data || typeof data.request_id !== "string" || !Number.isInteger(data.revision) || typeof data.state !== "string") {
    throw new Error("The saved workflow result could not be verified. Refresh before retrying.");
  }
  workflowChanged();
  return data as WorkflowRevision;
}
