import { z } from "zod";
import { CustomerRequestRowSchema, mapSavedRequestToProposalInput, type CustomerRequestRow } from "./customerSupabase";
import { GeneratedProposalSchema, ProposalRequestSchema, type GeneratedProposal, type ProposalRequest } from "./proposalGenerator";

const RevisionActionSchema = z.object({
  response_id: z.string().uuid(),
  request_id: z.string().uuid(),
  source_revision: z.string().regex(/^[1-9][0-9]{0,31}$/),
  action_kind: z.literal("revision"),
  next_revision: z.string().regex(/^[1-9][0-9]{0,31}$/),
  status: z.enum(["queued", "generating", "business_review", "released"]),
  generation_token: z.string().uuid().nullable().optional(),
  generation_error_code: z.enum([
    "AI_GENERATION_FAILED", "PROPOSAL_VALIDATION_FAILED", "RUNPOD_FAILURE",
  ]).nullable().optional(),
}).passthrough();

const CustomerResponseSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  revision: z.string().regex(/^[1-9][0-9]{0,31}$/),
  customer_id: z.string().uuid(),
  plan_a_id: z.string().uuid(),
  plan_b_id: z.string().uuid(),
  response_kind: z.literal("change_request"),
  response_status: z.literal("changes_requested"),
  feedback: z.string().min(1).max(4000),
}).strict();

const ProposalRowSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  revision: z.string(),
  plan_key: z.enum(["A", "B"]),
  status: z.string().min(1),
  recommendation: z.string().nullable(),
  plan_content: z.unknown(),
}).strict();

const PairReceiptSchema = z.object({
  request_id: z.string().uuid(),
  revision: z.string().regex(/^[1-9][0-9]{0,31}$/),
  persistence: z.enum(["created", "existing"]),
  workflow_state: z.literal("business_review"),
}).strict();

export type RevisionAction = z.infer<typeof RevisionActionSchema>;
export type RevisionContext = {
  action: RevisionAction;
  request: CustomerRequestRow;
  input: ProposalRequest;
  responseFeedback: string;
  previousProposal: GeneratedProposal;
};
export type RevisionReceipt = z.infer<typeof PairReceiptSchema>;
export type RevisionGenerationFailure =
  | "AI_GENERATION_FAILED"
  | "PROPOSAL_VALIDATION_FAILED"
  | "RUNPOD_FAILURE";

export class CustomerRevisionError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
  }
}

export interface CustomerRevisionGenerationRepository {
  startRevision(accessToken: string, responseId: string): Promise<RevisionAction>;
  claimGeneration(responseId: string): Promise<RevisionAction>;
  loadContext(action: RevisionAction): Promise<RevisionContext>;
  findPair(requestId: string, revision: string): Promise<RevisionReceipt | null>;
  storePair(action: RevisionAction, proposal: GeneratedProposal): Promise<RevisionReceipt>;
  markFailed(action: RevisionAction, errorCode: RevisionGenerationFailure): Promise<void>;
}

type FetchLike = typeof fetch;

function oneRow(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value;
}

function previousPlanContext(proposal: GeneratedProposal): string {
  const plans = proposal.plans.map(plan => ({
    id: plan.id,
    title: plan.title,
    concept: plan.concept.slice(0, 300),
    theme: plan.theme.slice(0, 100),
    venue: { name: plan.venue.name.slice(0, 100), setup: plan.venue.setup.slice(0, 180) },
    catering: plan.catering.slice(0, 180),
    timeline: plan.timeline.slice(0, 4).map(item => ({
      time: item.time.slice(0, 40), activity: item.activity.slice(0, 100),
    })),
    services: plan.services.slice(0, 8).map(service => service.slice(0, 80)),
    costs: plan.costBreakdown.slice(0, 7).map(line => ({
      item: line.item.slice(0, 80), amountMYR: line.amountMYR,
    })),
    totalEstimatedMYR: plan.totalEstimatedMYR,
  }));
  return JSON.stringify({ recommendation: proposal.recommendation.slice(0, 300), plans });
}

export function composeRevisionRequest(context: Pick<RevisionContext, "input" | "responseFeedback" | "previousProposal" | "action">): ProposalRequest {
  const requirements = [
    "REVISION INSTRUCTIONS: The original request is the baseline. Carry forward adjustments already present in the previous approved plans, unless the latest Customer feedback changes them. Apply explicit non-budget changes such as guest count from that feedback. Preserve the original required services. Use the original saved budget as planning guidance, not a hard ceiling; aim to fit where realistic, but preserve honest itemized estimates and disclose any overage rather than changing prices or omitting requested services. Never increase or replace the saved budget.",
    "ORIGINAL CUSTOMER REQUIREMENTS (baseline and saved budget):",
    context.input.requirements,
    `CUSTOMER CHANGE REQUEST FOR REVISION ${context.action.next_revision}:`,
    context.responseFeedback,
    "PREVIOUS BUSINESS-APPROVED PLAN A/B (reference for continuity; revise in response to the feedback):",
    previousPlanContext(context.previousProposal),
  ].join("\n\n");
  if (requirements.length > 8_000) {
    throw new CustomerRevisionError(
      "REVISION_CONTEXT_TOO_LARGE",
      422,
      "The saved requirements, change request, and previous plans are too long to send safely. No AI attempt was reserved.",
    );
  }
  return ProposalRequestSchema.parse({ ...context.input, requirements });
}

export class SupabaseCustomerRevisionGenerationRepository implements CustomerRevisionGenerationRepository {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly publishableKey: string,
    private readonly secretKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("Supabase must be configured with a credential-free HTTPS URL.");
    }
    this.baseUrl = parsed.origin;
  }

  async startRevision(accessToken: string, responseId: string): Promise<RevisionAction> {
    const result = await this.fetchJson(
      "/rest/v1/rpc/eventflow_start_customer_revision",
      {
        method: "POST",
        headers: this.headers(this.publishableKey, accessToken, true),
        body: JSON.stringify({ p_response_id: responseId }),
      },
      "CUSTOMER_RESPONSE_WORKFLOW_NOT_READY",
    );
    const parsed = RevisionActionSchema.safeParse(oneRow(result));
    if (!parsed.success || parsed.data.response_id !== responseId) {
      throw new CustomerRevisionError("REVISION_ACTION_INVALID", 503, "The Business revision action could not be verified.");
    }
    return parsed.data;
  }

  async claimGeneration(responseId: string): Promise<RevisionAction> {
    const result = await this.adminRpc("eventflow_claim_customer_revision_generation", {
      p_response_id: responseId,
    });
    const parsed = RevisionActionSchema.safeParse(oneRow(result));
    if (!parsed.success || parsed.data.response_id !== responseId) {
      throw new CustomerRevisionError("REVISION_GENERATION_MIGRATION_NOT_READY", 503, "The revision-generation migration is not installed or its result could not be verified.");
    }
    return parsed.data;
  }

  async loadContext(action: RevisionAction): Promise<RevisionContext> {
    const [requestRows, responseRows, proposalRows] = await Promise.all([
      this.getRows("requests", new URLSearchParams({
        select: "id,customer_id,customer_name,email,phone,event_name,event_type,event_date,event_time,guests,budget,services,notes,status,created_at,venue_id,event_end_time",
        id: `eq.${action.request_id}`,
        limit: "2",
      })),
      this.getRows("eventflow_customer_responses", new URLSearchParams({
        select: "id,request_id,revision,customer_id,plan_a_id,plan_b_id,response_kind,response_status,feedback",
        id: `eq.${action.response_id}`,
        limit: "2",
      })),
      this.getRows("proposals", new URLSearchParams({
        select: "id,request_id,revision,plan_key,status,recommendation,plan_content",
        request_id: `eq.${action.request_id}`,
        revision: `eq.${action.source_revision}`,
        plan_key: "in.(A,B)",
        order: "plan_key.asc",
        limit: "3",
      })),
    ]);
    if (requestRows.length !== 1 || responseRows.length !== 1 || proposalRows.length !== 2) {
      throw new CustomerRevisionError("REVISION_SOURCE_INCOMPLETE", 409, "The saved request, Change Request, or previous A/B pair could not be verified. No generation was started.");
    }
    const requestResult = CustomerRequestRowSchema.safeParse(requestRows[0]);
    const responseResult = CustomerResponseSchema.safeParse(responseRows[0]);
    const plansResult = z.array(ProposalRowSchema).length(2).safeParse(proposalRows);
    if (!requestResult.success || !responseResult.success || !plansResult.success) {
      throw new CustomerRevisionError("REVISION_SOURCE_INVALID", 409, "The saved revision data needs Business review before generation.");
    }
    const request = requestResult.data;
    const response = responseResult.data;
    if (request.id !== action.request_id
      || request.customer_id !== response.customer_id
      || response.id !== action.response_id
      || response.request_id !== action.request_id
      || response.revision !== action.source_revision
      || response.response_kind !== "change_request"
      || action.action_kind !== "revision"
      || !action.next_revision
      || plansResult.data.some(row => row.request_id !== action.request_id
        || row.revision !== action.source_revision
        || row.status !== "Awaiting Customer")) {
      throw new CustomerRevisionError("REVISION_SOURCE_MISMATCH", 409, "The saved Business-approved source pair does not match this Change Request.");
    }
    const planA = plansResult.data.find(row => row.plan_key === "A");
    const planB = plansResult.data.find(row => row.plan_key === "B");
    if (!planA || !planB || planA.id !== response.plan_a_id || planB.id !== response.plan_b_id
      || !planA.recommendation || planA.recommendation !== planB.recommendation) {
      throw new CustomerRevisionError("REVISION_SOURCE_PAIR_INVALID", 409, "The exact approved Plan A/B source pair could not be verified.");
    }
    const previousResult = GeneratedProposalSchema.safeParse({
      recommendation: planA.recommendation,
      plans: [planA.plan_content, planB.plan_content],
    });
    if (!previousResult.success) {
      throw new CustomerRevisionError("REVISION_SOURCE_CONTENT_INVALID", 409, "The previous proposal details could not be verified for revision context.");
    }
    let input: ProposalRequest;
    try {
      input = mapSavedRequestToProposalInput(request);
    } catch {
      throw new CustomerRevisionError("REVISION_REQUEST_INVALID", 422, "The original saved request is incomplete or has an unsupported location.");
    }
    return {
      action,
      request,
      input,
      responseFeedback: response.feedback,
      previousProposal: previousResult.data,
    };
  }

  async findPair(requestId: string, revision: string): Promise<RevisionReceipt | null> {
    const rows = await this.getRows("proposals", new URLSearchParams({
      select: "id,request_id,revision,plan_key,status,plan_content",
      request_id: `eq.${requestId}`,
      revision: `eq.${revision}`,
      plan_key: "in.(A,B)",
      order: "plan_key.asc",
      limit: "3",
    }));
    if (rows.length === 0) return null;
    const parsed = z.array(z.object({
      id: z.string().uuid(),
      request_id: z.string().uuid(),
      revision: z.string(),
      plan_key: z.enum(["A", "B"]),
      status: z.string().min(1),
      plan_content: z.unknown(),
    }).strict()).length(2).safeParse(rows);
    if (!parsed.success || new Set(parsed.data.map(row => row.plan_key)).size !== 2
      || parsed.data.some(row => row.request_id !== requestId || row.revision !== revision)) {
      throw new CustomerRevisionError("REVISION_PAIR_INCOMPLETE", 409, "A partial or conflicting pair exists for this revision; no proposal was overwritten.");
    }
    return { request_id: requestId, revision, persistence: "existing", workflow_state: "business_review" };
  }

  async storePair(action: RevisionAction, proposal: GeneratedProposal): Promise<RevisionReceipt> {
    if (!action.generation_token || !action.next_revision) {
      throw new CustomerRevisionError("REVISION_GENERATION_TOKEN_MISSING", 503, "The database-issued revision token is missing.");
    }
    const result = await this.adminRpc("eventflow_store_customer_revision_pair", {
      p_response_id: action.response_id,
      p_generation_token: action.generation_token,
      p_recommendation: proposal.recommendation,
      p_plans: proposal.plans,
    });
    const parsed = PairReceiptSchema.safeParse(result);
    if (!parsed.success || parsed.data.request_id !== action.request_id || parsed.data.revision !== action.next_revision) {
      throw new CustomerRevisionError("REVISION_PERSISTENCE_UNVERIFIED", 503, "The saved revised pair could not be verified. Check Business proposals before retrying.");
    }
    return parsed.data;
  }

  async markFailed(action: RevisionAction, errorCode: RevisionGenerationFailure): Promise<void> {
    if (!action.generation_token) return;
    await this.adminRpc("eventflow_fail_customer_revision_generation", {
      p_response_id: action.response_id,
      p_generation_token: action.generation_token,
      p_error_code: errorCode,
    });
  }

  private async getRows(table: string, query: URLSearchParams): Promise<unknown[]> {
    const result = await this.fetchJson(`/rest/v1/${table}?${query}`, {
      method: "GET",
      headers: this.headers(this.secretKey, undefined, false),
    }, "REVISION_DATABASE_UNAVAILABLE");
    if (!Array.isArray(result)) throw new CustomerRevisionError("REVISION_DATABASE_RESPONSE_INVALID", 503, "Saved revision data could not be verified.");
    return result;
  }

  private async adminRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    return this.fetchJson(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: this.headers(this.secretKey, undefined, false),
      body: JSON.stringify(body),
    }, "REVISION_DATABASE_UNAVAILABLE");
  }

  private headers(key: string, accessToken: string | undefined, publicCall: boolean): Headers {
    const headers = new Headers({
      apikey: key,
      accept: "application/json",
      "content-type": "application/json",
    });
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    else if (!publicCall && !key.startsWith("sb_secret_")) headers.set("authorization", `Bearer ${key}`);
    return headers;
  }

  private async fetchJson(path: string, init: RequestInit, missingCode: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CustomerRevisionError("REVISION_DATABASE_UNAVAILABLE", 503, "Supabase could not be reached. No automatic AI retry was made.");
    }
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const code = z.object({ code: z.string().optional() }).safeParse(body);
      const providerCode = code.success ? code.data.code : undefined;
      if (["PGRST202", "PGRST205", "42P01", "42883"].includes(providerCode ?? "")) {
        throw new CustomerRevisionError(missingCode, 503, "The Customer Response revision-generation migration is not installed.");
      }
      if (providerCode === "42501" || response.status === 401 || response.status === 403) {
        throw new CustomerRevisionError("BUSINESS_AUTHORIZATION_REQUIRED", 403, "Only approved Business staff can generate revised proposals.");
      }
      if (response.status === 409 || providerCode === "23505") {
        throw new CustomerRevisionError("REVISION_STATE_CONFLICT", 409, "This revision is already running or its source data changed. Refresh before retrying.");
      }
      throw new CustomerRevisionError("REVISION_DATABASE_OPERATION_FAILED", 503, "The revision could not be verified or saved safely.");
    }
    return body;
  }
}

export function customerRevisionGenerationRepository(env: NodeJS.ProcessEnv): SupabaseCustomerRevisionGenerationRepository | null {
  const baseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !publishableKey || !secretKey) return null;
  try {
    return new SupabaseCustomerRevisionGenerationRepository(baseUrl, publishableKey, secretKey);
  } catch {
    return null;
  }
}

