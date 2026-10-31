/**
 * Test-only in-memory workflow model. It cannot contact Supabase, RunPod or APIs,
 * and mock plans are never imported by application code.
 */
export type MockResponse = {
  id: string;
  request_id: string;
  revision: string;
  response_kind: "change_request" | "selection";
  response_status: "changes_requested" | "selection_submitted";
  plan_a_id: string;
  plan_b_id: string;
  selected_proposal_id: string | null;
};

type MockProposal = {
  id: string;
  request_id: string;
  revision: string;
  plan_key: "A" | "B";
  status: "Awaiting Customer" | "Pending Business Approval";
  mock?: true;
};

type MockAction = {
  response_id: string;
  request_id: string;
  source_revision: string;
  action_kind: "revision" | "selection_confirmation";
  next_revision: string | null;
  status: "queued" | "business_review" | "confirmed";
  started_by: string;
  started_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmation_message: string;
};

export class MockResponseWorkflow {
  readonly proposals: MockProposal[] = [];
  readonly actions = new Map<string, MockAction>();
  readonly responses = new Map<string, MockResponse>();
  private readonly requestLocks = new Map<string, Promise<void>>();

  constructor(public readonly staffUserId: string | null = "mock-staff") {}

  addApprovedPair(requestId: string, revision: string) {
    this.proposals.push(
      { id: `${requestId}-${revision}-A`, request_id: requestId, revision, plan_key: "A", status: "Awaiting Customer" },
      { id: `${requestId}-${revision}-B`, request_id: requestId, revision, plan_key: "B", status: "Awaiting Customer" },
    );
  }

  addChangeRequest(id: string, requestId: string, revision: string) {
    const response: MockResponse = {
      id, request_id: requestId, revision, response_kind: "change_request",
      response_status: "changes_requested", plan_a_id: `${requestId}-${revision}-A`,
      plan_b_id: `${requestId}-${revision}-B`, selected_proposal_id: null,
    };
    this.responses.set(id, response);
    return response;
  }

  addSelection(id: string, requestId: string, revision: string, plan: "A" | "B" = "A") {
    const response: MockResponse = {
      id, request_id: requestId, revision, response_kind: "selection",
      response_status: "selection_submitted", plan_a_id: `${requestId}-${revision}-A`,
      plan_b_id: `${requestId}-${revision}-B`,
      selected_proposal_id: `${requestId}-${revision}-${plan}`,
    };
    this.responses.set(id, response);
    return response;
  }

  readonly rpc = async (name: string, args: Record<string, unknown>) => {
    const responseId = String(args.p_response_id ?? "");
    const response = this.responses.get(responseId);
    if (!this.staffUserId) return { data: null, error: { code: "42501", message: "staff required" } };
    if (!response) return { data: null, error: { code: "42501", message: "response unavailable" } };
    return this.withRequestLock(response.request_id, () => {
      if (name === "eventflow_start_customer_revision") return this.startRevision(response);
      if (name === "eventflow_confirm_customer_selection") {
        return this.confirmSelection(response, String(args.p_confirmation_message ?? ""));
      }
      return { data: null, error: { code: "42883", message: "unknown rpc" } };
    });
  };

  /** Test-only mock generation: stores only in this in-memory fixture. */
  async mockGenerateQueuedRevision(responseId: string) {
    const action = this.actions.get(responseId);
    if (!action || action.action_kind !== "revision" || action.status !== "queued" || !action.next_revision) {
      throw new Error("Only a queued mock revision can generate.");
    }
    const revision = action.next_revision;
    for (const plan of ["A", "B"] as const) {
      this.proposals.push({
        id: `${action.request_id}-${revision}-${plan}`,
        request_id: action.request_id,
        revision,
        plan_key: plan,
        status: "Pending Business Approval",
        mock: true,
      });
    }
    const next = { ...action, status: "business_review" as const };
    this.actions.set(responseId, next);
    return this.proposals.filter(row => row.request_id === action.request_id && row.revision === revision);
  }

  private async withRequestLock<T>(requestId: string, work: () => T) {
    const previous = this.requestLocks.get(requestId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.requestLocks.set(requestId, previous.then(() => current));
    await previous;
    try { return work(); }
    finally { release(); }
  }

  private startRevision(response: MockResponse) {
    const existing = this.actions.get(response.id);
    if (existing) {
      if (existing.action_kind === "revision") return { data: existing, error: null };
      return { data: null, error: { code: "23505", message: "different action exists" } };
    }
    if (response.response_kind !== "change_request") {
      return { data: null, error: { code: "42501", message: "change request required" } };
    }
    const requestPlans = this.proposals.filter(row => row.request_id === response.request_id);
    const latest = requestPlans.reduce((max, row) => BigInt(row.revision) > max ? BigInt(row.revision) : max, 0n);
    if (latest !== BigInt(response.revision)) {
      return { data: null, error: { code: "22023", message: "stale response" } };
    }
    const pair = requestPlans.filter(row => row.revision === response.revision);
    if (pair.length !== 2 || pair.some(row => row.status !== "Awaiting Customer")
      || !pair.some(row => row.id === response.plan_a_id && row.plan_key === "A")
      || !pair.some(row => row.id === response.plan_b_id && row.plan_key === "B")) {
      return { data: null, error: { code: "42501", message: "approved pair required" } };
    }
    const action: MockAction = {
      response_id: response.id, request_id: response.request_id, source_revision: response.revision,
      action_kind: "revision", next_revision: String(latest + 1n), status: "queued",
      started_by: this.staffUserId!, started_at: new Date().toISOString(),
      confirmed_by: null, confirmed_at: null, confirmation_message: "",
    };
    this.actions.set(response.id, action);
    return { data: action, error: null };
  }

  private confirmSelection(response: MockResponse, message: string) {
    const existing = this.actions.get(response.id);
    if (existing) {
      if (existing.action_kind === "selection_confirmation" && existing.confirmation_message === message) {
        return { data: existing, error: null };
      }
      return { data: null, error: { code: "23505", message: "different action exists" } };
    }
    if (response.response_kind !== "selection" || !response.selected_proposal_id
      || ![response.plan_a_id, response.plan_b_id].includes(response.selected_proposal_id)) {
      return { data: null, error: { code: "42501", message: "selection required" } };
    }
    const requestPlans = this.proposals.filter(row => row.request_id === response.request_id);
    const latest = requestPlans.reduce((max, row) => BigInt(row.revision) > max ? BigInt(row.revision) : max, 0n);
    if (latest !== BigInt(response.revision)) {
      return { data: null, error: { code: "22023", message: "stale response" } };
    }
    const now = new Date().toISOString();
    const action: MockAction = {
      response_id: response.id, request_id: response.request_id, source_revision: response.revision,
      action_kind: "selection_confirmation", next_revision: null, status: "confirmed",
      started_by: this.staffUserId!, started_at: now, confirmed_by: this.staffUserId,
      confirmed_at: now, confirmation_message: message,
    };
    this.actions.set(response.id, action);
    return { data: action, error: null };
  }
}
