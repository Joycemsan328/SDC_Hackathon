import { supabase } from "@/lib/supabase";
import {
  assertCustomerResponseMatches,
  parseCustomerResponse,
  parseCustomerResponseRows,
  type CustomerResponseRecord,
  type SubmitCustomerResponseInput,
} from "./customerResponseTypes";

export {
  parseCustomerResponse,
  parseCustomerResponseRows,
  type CustomerResponseRecord,
  type CustomerResponseKind,
  type SubmitCustomerResponseInput,
} from "./customerResponseTypes";

// Enabled after the additive migration and production access review.
export const CUSTOMER_RESPONSE_WORKFLOW_ENABLED = true;

export async function submitCustomerResponse(
  input: SubmitCustomerResponseInput,
  customerId: string,
): Promise<CustomerResponseRecord> {
  if (!CUSTOMER_RESPONSE_WORKFLOW_ENABLED) {
    throw new Error("Customer responses are unavailable until the database workflow is approved.");
  }
  const idempotencyKey = input.idempotencyKey ?? globalThis.crypto.randomUUID();
  const { data, error } = await supabase.rpc("eventflow_submit_customer_response", {
    p_request_id: input.requestId,
    p_revision: input.revision,
    p_kind: input.kind,
    p_selected_proposal_id: input.kind === "selection" ? input.selectedProposalId ?? null : null,
    p_feedback: input.kind === "change_request" ? input.feedback?.trim() ?? "" : "",
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    if (error.code === "42501") throw new Error("Your account is not authorized to respond, or both plans are not currently approved.");
    if (error.code === "23505") throw new Error("A response is already recorded for this revision. Refresh the event to see it.");
    throw new Error(error.message || "Your response could not be saved.");
  }

  const result = Array.isArray(data)
    ? data.length === 1 ? data[0] : null
    : data;
  const response = parseCustomerResponse(result);
  assertCustomerResponseMatches(response, input, customerId);
  return response;
}
