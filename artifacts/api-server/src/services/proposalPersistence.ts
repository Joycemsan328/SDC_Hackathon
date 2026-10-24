import { z } from "zod";
import { randomUUID } from "node:crypto";
import { GeneratedProposalSchema, type GeneratedProposal } from "./proposalGenerator";
import { CustomerRequestRowSchema, type CustomerRequestRow } from "./customerSupabase";

const PersistedPlanSchema = z.object({
  plan_key: z.enum(["A", "B"]),
  proposal_id: z.string().uuid(),
  status: z.string().min(1),
  recommendation: z.string().nullable().transform((value) => value || "No recommendation provided."),
  plan_content: z.unknown(),
}).strict();
const PersistedLookupRowSchema = PersistedPlanSchema.omit({ proposal_id: true }).extend({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  revision: z.union([z.string(), z.number()]).transform(String),
}).strict();

const PersistedPairSchema = z.object({
  request_id: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["created", "existing"]),
  proposals: z.array(PersistedPlanSchema).length(2),
}).strict().superRefine((pair, context) => {
  if (new Set(pair.proposals.map((plan) => plan.plan_key)).size !== 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Persisted response must contain Plan A and Plan B." });
  }
});

export const INITIAL_PROPOSAL_REVISION = 1;
export type ProposalMetadataFields = {
  customer_name: string | null;
  event_name: string | null;
  event_date: string | null;
  event_type: string | null;
  budget: number | null;
  event_time: string | null;
  venue_id: string | null;
  event_end_time: string | null;
};
export type ProposalMetadata = {
  revision: number;
  recommendation: string;
  fields: ProposalMetadataFields;
};
export type ProposalMetadataMapper = (request: CustomerRequestRow, proposal: GeneratedProposal) => ProposalMetadata;

/** Maps only verified request fields and validated AI output into confirmed live columns. */
export function mapProposalMetadata(requestInput: CustomerRequestRow, proposalInput: GeneratedProposal): ProposalMetadata {
  const requestResult = CustomerRequestRowSchema.safeParse(requestInput);
  const proposalResult = GeneratedProposalSchema.safeParse(proposalInput);
  if (!requestResult.success || !proposalResult.success) {
    throw new ProposalPersistenceError("INVALID_METADATA_SOURCE", 422, "Verified request and validated proposal data are required.");
  }
  const request = requestResult.data;
  const budget = request.budget === null ? null : Number(request.budget);
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
    throw new ProposalPersistenceError("INVALID_REQUEST_BUDGET", 422, "The saved request budget is invalid.");
  }
  return {
    revision: INITIAL_PROPOSAL_REVISION,
    recommendation: proposalResult.data.recommendation,
    fields: {
      customer_name: request.customer_name,
      event_name: request.event_name,
      event_date: request.event_date,
      event_type: request.event_type,
      budget,
      event_time: request.event_time,
      venue_id: request.venue_id,
      event_end_time: request.event_end_time,
    },
  };
}

export class ProposalPersistenceError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); }
}

export interface ProposalPairRepository {
  claimGeneration? (requestId: string): Promise<void>;
  findExisting(input: { requestId: string; revision: number }): Promise<z.infer<typeof PersistedPairSchema> | null>;
  persist(input: {
    customerId: string;
    requestId: string;
    revision: number;
    recommendation: string;
    proposalFields: Record<string, unknown>;
    proposal: GeneratedProposal;
  }): Promise<z.infer<typeof PersistedPairSchema>>;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Server-only Supabase Data API client. Never share this key/client with browser code. */
export class SupabaseAdminProposalPairRepository implements ProposalPairRepository {
  private readonly baseUrl: string;
  private readonly secretKey: string;

  constructor(
    baseUrl: string,
    secretKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly customerToken?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.secretKey = secretKey;
  }

  private readonly generationToken = randomUUID();

  async claimGeneration(requestId: string) {
    if (!this.customerToken) return; // Legacy admin repository keeps its existing contract.
    const response = await this.fetchImpl(`${this.baseUrl}/rest/v1/rpc/eventflow_claim_generation`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ p_request_id: requestId, p_token: this.generationToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response?.ok) {
      throw new ProposalPersistenceError("WORKFLOW_NOT_READY", 503,
        "The Supabase workflow migration is not ready or generation permission was denied. Your event is saved. No RunPod call was made; ask the owner to approve/apply scripts/sql/eventflow-mvp-workflow.sql.");
    }
    if (await response.json().catch(() => false) !== true) {
      throw new ProposalPersistenceError("GENERATION_IN_PROGRESS", 409,
        "Generation is already running for this event. Reload saved proposals shortly. After an interrupted attempt, the safety lease expires within 10 minutes.");
    }
  }

  async findExisting(input: { requestId: string; revision: number }) {
    const url = new URL(`${this.baseUrl}/rest/v1/proposals`);
    url.searchParams.set("select", "request_id,revision,plan_key,id,status,recommendation,plan_content");
    url.searchParams.set("request_id", `eq.${input.requestId}`);
    url.searchParams.set("revision", `eq.${input.revision}`);
    url.searchParams.set("plan_key", "in.(A,B)");
    const response = await this.fetchImpl(url, { method: "GET", headers: this.headers() }).catch(() => null);
    if (!response?.ok) throw new ProposalPersistenceError("PROPOSAL_LOOKUP_FAILED", 503, "Saved proposals could not be checked safely.");
    const body = await response.json().catch(() => null) as unknown;
    const rows = z.array(PersistedLookupRowSchema).safeParse(body);
    if (!rows.success) throw new ProposalPersistenceError("INVALID_PERSISTED_CONTENT", 503, "Saved proposal content could not be verified.");
    if (rows.data.length === 0) return null;
    if (rows.data.length !== 2 || new Set(rows.data.map((row) => row.plan_key)).size !== 2
      || rows.data.some((row) => row.request_id !== input.requestId || row.revision !== String(input.revision))) {
      throw new ProposalPersistenceError("INCOMPLETE_PERSISTED_PAIR", 503, "Saved proposals are incomplete and need review.");
    }
    return this.validatePair({
      request_id: input.requestId,
      revision: input.revision,
      status: "existing",
      proposals: rows.data.map(({ request_id: _requestId, revision: _revision, id, ...plan }) => ({ ...plan, proposal_id: id })),
    });
  }

  async persist(input: Parameters<ProposalPairRepository["persist"]>[0]) {
    try {
      const rpcName = this.customerToken ? "eventflow_persist_proposal_pair" : "persist_runpod_ai_proposal_pair";
      const response = await this.fetchImpl(`${this.baseUrl}/rest/v1/rpc/${rpcName}`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          p_customer_id: input.customerId,
          p_request_id: input.requestId,
          p_revision: input.revision,
          p_recommendation: input.recommendation,
          p_proposal_fields: input.proposalFields,
          p_plans: input.proposal.plans,
          ...(this.customerToken ? { p_generation_token: this.generationToken } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      if (!response?.ok) {
        // An RPC can commit while its response is lost, or a concurrent retry can win.
        // Read back the canonical pair; never return this request's unsaved AI output.
        const existing = await this.findExisting(input);
        if (existing) return existing;
        throw new ProposalPersistenceError("PROPOSAL_PERSISTENCE_FAILED", 503, "Proposals could not be saved safely.");
      }
      const body = await response.json().catch(() => null) as unknown;
      return this.validatePair(body, input);
    } catch (error) {
      if (error instanceof ProposalPersistenceError) throw error;
      throw new ProposalPersistenceError("PROPOSAL_PERSISTENCE_FAILED", 503, "Proposals could not be saved safely.");
    }
  }

  private headers(): Record<string, string> {
    return { apikey: this.secretKey, authorization: `Bearer ${this.customerToken || this.secretKey}`, accept: "application/json" };
  }

  private validatePair(input: unknown, expected?: { requestId: string; revision: number }) {
    const pair = PersistedPairSchema.safeParse(input);
    if (!pair.success
      || (expected && (pair.data.request_id !== expected.requestId || pair.data.revision !== expected.revision))) {
      throw new ProposalPersistenceError("INVALID_PERSISTENCE_RESPONSE", 503, "Saved proposals could not be verified.");
    }
    // Legacy saved pairs can omit optional narrative fields. Validate identity
    // and prices here; never regenerate a valid existing pair just for enrichment.
    const contentIsValid = pair.data.proposals.every((row) => {
      const content = z.object({
        id: z.literal(row.plan_key), title: z.string(),
        costBreakdown: z.array(z.object({ item: z.string(), description: z.string(), amountMYR: z.coerce.number().finite().nonnegative() })),
        totalEstimatedMYR: z.coerce.number().finite().nonnegative(),
      }).safeParse(row.plan_content);
      return content.success;
    });
    if (!contentIsValid) throw new ProposalPersistenceError("INVALID_PERSISTED_CONTENT", 503, "Saved proposal content could not be verified.");
    return pair.data;
  }
}

export function createCustomerProposalRepository(env: NodeJS.ProcessEnv, accessToken: string, fetchImpl?: FetchLike) {
  const url = env["SUPABASE_URL"]?.trim() || env["VITE_SUPABASE_URL"]?.trim();
  const key = env["SUPABASE_PUBLISHABLE_KEY"]?.trim() || env["VITE_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !key || !/^https:\/\//.test(url)) return null;
  return new SupabaseAdminProposalPairRepository(url, key, fetchImpl, accessToken);
}

export function createSupabaseAdminProposalRepository(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike) {
  const baseUrl = env["SUPABASE_URL"]?.trim();
  const secretKey = env["SUPABASE_SECRET_KEY"]?.trim() || env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!baseUrl || !secretKey) return null;
  try {
    const parsed = new URL(baseUrl);
    const isLocalHttp = parsed.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLocalHttp) return null;
    return new SupabaseAdminProposalPairRepository(baseUrl, secretKey, fetchImpl);
  } catch {
    return null;
  }
}
