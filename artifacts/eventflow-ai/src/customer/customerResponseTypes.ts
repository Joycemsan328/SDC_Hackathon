export type CustomerResponseKind = "selection" | "change_request";
export type CustomerResponseRecord = {
  id: string;
  request_id: string;
  revision: string;
  customer_id: string;
  plan_a_id: string;
  plan_b_id: string;
  response_kind: CustomerResponseKind;
  response_status: "selection_submitted" | "changes_requested";
  selected_proposal_id: string | null;
  feedback: string;
  idempotency_key: string;
  responded_at: string;
};

export type SubmitCustomerResponseInput = {
  requestId: string;
  revision: string;
  kind: CustomerResponseKind;
  selectedProposalId?: string;
  feedback?: string;
  idempotencyKey?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCustomerResponse(value: unknown): CustomerResponseRecord {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.request_id !== "string"
    || typeof value.revision !== "string"
    || typeof value.customer_id !== "string"
    || typeof value.plan_a_id !== "string"
    || typeof value.plan_b_id !== "string"
    || value.plan_a_id === value.plan_b_id
    || (value.response_kind !== "selection" && value.response_kind !== "change_request")
    || (value.response_status !== "selection_submitted" && value.response_status !== "changes_requested")
    || !(value.selected_proposal_id === null || typeof value.selected_proposal_id === "string")
    || typeof value.feedback !== "string"
    || typeof value.idempotency_key !== "string"
    || typeof value.responded_at !== "string"
    || !Number.isFinite(Date.parse(value.responded_at))) {
    throw new Error("The saved customer response could not be verified.");
  }

  const selectionIsValid = value.response_kind === "selection"
    && value.response_status === "selection_submitted"
    && (value.selected_proposal_id === value.plan_a_id || value.selected_proposal_id === value.plan_b_id)
    && value.feedback === "";
  const changeRequestIsValid = value.response_kind === "change_request"
    && value.response_status === "changes_requested"
    && value.selected_proposal_id === null
    && value.feedback.trim().length > 0;
  if (!selectionIsValid && !changeRequestIsValid) {
    throw new Error("The saved customer response has an inconsistent status.");
  }
  return value as CustomerResponseRecord;
}

export function parseCustomerResponseRows(value: unknown): CustomerResponseRecord[] {
  if (!Array.isArray(value)) throw new Error("Saved customer responses returned an unexpected format.");
  return value.map(parseCustomerResponse);
}

export function assertCustomerResponseMatches(
  response: CustomerResponseRecord,
  input: SubmitCustomerResponseInput,
  customerId: string,
): void {
  if (response.request_id !== input.requestId
    || response.revision !== input.revision
    || response.customer_id !== customerId
    || response.response_kind !== input.kind
    || (input.kind === "selection" && response.selected_proposal_id !== input.selectedProposalId)
    || (input.kind === "change_request" && response.feedback !== input.feedback?.trim())) {
    throw new Error("The response saved by Supabase did not match this request. Refresh before retrying.");
  }
}
