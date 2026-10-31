export type CustomerResponseActionKind = "revision" | "selection_confirmation";
export type CustomerResponseActionStatus =
  | "queued"
  | "generating"
  | "business_review"
  | "released"
  | "confirmed";

export type CustomerResponseAction = {
  response_id: string;
  request_id: string;
  source_revision: string;
  action_kind: CustomerResponseActionKind;
  next_revision: string | null;
  status: CustomerResponseActionStatus;
  started_by: string;
  started_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmation_message: string;
  generation_error_code?: string | null;
};

type RpcError = { code?: string; message?: string } | null;
export type ResponseWorkflowRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCustomerResponseAction(value: unknown): CustomerResponseAction {
  if (Array.isArray(value)) value = value.length === 1 ? value[0] : null;
  if (!isRecord(value)
    || typeof value.response_id !== "string"
    || typeof value.request_id !== "string"
    || typeof value.source_revision !== "string"
    || !/^[1-9][0-9]{0,31}$/.test(value.source_revision)
    || (value.action_kind !== "revision" && value.action_kind !== "selection_confirmation")
    || !(value.next_revision === null || typeof value.next_revision === "string")
    || !["queued", "generating", "business_review", "released", "confirmed"].includes(String(value.status))
    || typeof value.started_by !== "string"
    || typeof value.started_at !== "string"
    || !Number.isFinite(Date.parse(value.started_at))
    || !(value.confirmed_by === null || typeof value.confirmed_by === "string")
    || !(value.confirmed_at === null || typeof value.confirmed_at === "string")
    || typeof value.confirmation_message !== "string"
    || (value.generation_error_code !== undefined && value.generation_error_code !== null
      && !["AI_GENERATION_FAILED", "PROPOSAL_VALIDATION_FAILED", "RUNPOD_FAILURE"].includes(String(value.generation_error_code)))) {
    throw new Error("The saved Business response action could not be verified.");
  }

  const action = value as CustomerResponseAction;
  if (action.action_kind === "revision") {
    if (!action.next_revision || !/^[1-9][0-9]{0,31}$/.test(action.next_revision)
      || BigInt(action.next_revision) <= BigInt(action.source_revision)
      || action.status === "confirmed"
      || action.confirmed_by !== null
      || action.confirmed_at !== null) {
      throw new Error("The saved revision action has inconsistent state.");
    }
  } else if (action.next_revision !== null || action.status !== "confirmed"
    || !action.confirmed_by || !action.confirmed_at
    || !Number.isFinite(Date.parse(action.confirmed_at))) {
    throw new Error("The saved selection confirmation has inconsistent state.");
  }
  return action;
}

async function invokeAction(
  rpc: ResponseWorkflowRpc,
  functionName: string,
  args: Record<string, unknown>,
  expected: { responseId: string; requestId: string; kind: CustomerResponseActionKind },
): Promise<CustomerResponseAction> {
  const { data, error } = await rpc(functionName, args);
  if (error) {
    if (error.code === "42501") throw new Error("Only approved Business staff can perform this action.");
    if (error.code === "23505" || error.code === "P0001") {
      throw new Error(error.message || "The response changed or this action was already recorded. Refresh and try again.");
    }
    if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
      throw new Error("Business response actions are unavailable until the reviewed database migration is installed.");
    }
    throw new Error(error.message || "The Business response action could not be saved.");
  }
  const action = parseCustomerResponseAction(data);
  if (action.response_id !== expected.responseId
    || action.request_id !== expected.requestId
    || action.action_kind !== expected.kind) {
    throw new Error("The saved Business action did not match this Customer response.");
  }
  return action;
}

export function startCustomerRevision(
  rpc: ResponseWorkflowRpc,
  input: { requestId: string; responseId: string },
): Promise<CustomerResponseAction> {
  return invokeAction(rpc, "eventflow_start_customer_revision", {
    p_response_id: input.responseId,
  }, { responseId: input.responseId, requestId: input.requestId, kind: "revision" });
}

export function confirmCustomerSelection(
  rpc: ResponseWorkflowRpc,
  input: { requestId: string; responseId: string; message: string },
): Promise<CustomerResponseAction> {
  return invokeAction(rpc, "eventflow_confirm_customer_selection", {
    p_response_id: input.responseId,
    p_confirmation_message: input.message.trim(),
  }, { responseId: input.responseId, requestId: input.requestId, kind: "selection_confirmation" });
}

export async function generateCustomerRevision(
  accessToken: string,
  input: { requestId: string; responseId: string },
  fetcher: typeof fetch = fetch,
): Promise<{ requestId: string; revision: string }> {
  const response = await fetcher("/api/business/revisions/generate", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ responseId: input.responseId }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(isRecord(body) && typeof body.error === "string"
      ? body.error : "Revised proposals could not be verified. Refresh before retrying.");
  }
  if (!isRecord(body) || body.requestId !== input.requestId
    || typeof body.revision !== "string" || !/^[1-9][0-9]{0,31}$/.test(body.revision)
    || body.workflowState !== "business_review"
    || (body.persistence !== "created" && body.persistence !== "existing")) {
    throw new Error("The saved revised proposal result could not be verified.");
  }
  return { requestId: body.requestId, revision: body.revision };
}
