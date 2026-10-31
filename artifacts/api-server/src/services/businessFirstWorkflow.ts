import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GeneratedProposalSchema, ProposalRequestSchema, type GeneratedProposal, type ProposalRequest } from "./proposalGenerator";
import { mapSavedRequestToProposalInput, type CustomerRequestRow } from "./customerSupabase";

const ClaimSchema = z.object({
  state: z.enum(["claimed", "in_progress", "exists"]),
  revision: z.number().int().positive(),
  workflowState: z.string(),
  changeMessage: z.string().max(8000).optional(),
});
export const GenerationReceiptSchema = z.object({
  requestId: z.string().uuid(),
  revision: z.number().int().positive(),
  persistence: z.enum(["created", "existing"]),
  workflowState: z.enum(["business_review", "released", "selected", "confirmed", "changes_requested"]),
}).strict();
export class BusinessWorkflowError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); }
}
export interface BusinessWorkflowRepository {
  prepare(customerId: string, requestId: string, token: string): Promise<z.infer<typeof ClaimSchema>>;
  store(customerId: string, requestId: string, revision: number, token: string, proposal: GeneratedProposal): Promise<z.infer<typeof GenerationReceiptSchema>>;
}
type FetchLike = typeof fetch;
export class SupabaseBusinessWorkflowRepository implements BusinessWorkflowRepository {
  constructor(private readonly url: string, private readonly key: string, private readonly fetchImpl: FetchLike = fetch) {}
  private async rpc(name: string, body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url.replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
        method: "POST",
        // Secret API keys are gateway-authenticated. Legacy service-role JWTs
        // additionally use Authorization; never forward the customer's bearer.
        headers: { apikey: this.key, ...(this.key.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${this.key}` }),
          "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new BusinessWorkflowError("WORKFLOW_UNAVAILABLE", 503, "Supabase could not be reached. Your request is saved; no draft was released.");
    }
    const result = await response.json().catch(() => null) as { code?: string } | null;
    if (!response.ok) {
      // Retain only an allowlisted error code, never response text, tokens or payload.
      const missing = ["PGRST202", "PGRST205", "42883", "42P01"].includes(result?.code ?? "");
      throw new BusinessWorkflowError(missing ? "WORKFLOW_NOT_READY" : "WORKFLOW_OPERATION_FAILED", 503,
        missing ? "The Business-first migration is not installed. Your event is saved. No RunPod call was made at the preparation step."
          : "The workflow operation was denied or conflicted with database rules. Your request is saved; nothing was released.");
    }
    return result;
  }
  async prepare(customerId: string, requestId: string, token: string) {
    return ClaimSchema.parse(await this.rpc("eventflow_prepare_generation", {
      p_customer_id: customerId, p_request_id: requestId, p_token: token,
    }));
  }
  async store(customerId: string, requestId: string, revision: number, token: string, proposal: GeneratedProposal) {
    return GenerationReceiptSchema.parse(await this.rpc("eventflow_store_generated_pair", {
      p_customer_id: customerId, p_request_id: requestId, p_revision: revision, p_token: token,
      p_recommendation: proposal.recommendation, p_plans: proposal.plans,
    }));
  }
}
export function businessWorkflowRepository(env: NodeJS.ProcessEnv): BusinessWorkflowRepository | null {
  const url = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (env.EVENTFLOW_BUSINESS_FIRST_ENABLED !== "true" || !url?.startsWith("https://") || !key) return null;
  return new SupabaseBusinessWorkflowRepository(url, key);
}
export async function generateBusinessRevision(input: {
  customerId: string; request: CustomerRequestRow; repository: BusinessWorkflowRepository;
  generator: { generate(input: ProposalRequest): Promise<GeneratedProposal> };
}) {
  // Validate saved inputs before acquiring a lease. Customer JSON is never a plan.
  const base = mapSavedRequestToProposalInput(input.request);
  const token = randomUUID();
  const claim = ClaimSchema.parse(await input.repository.prepare(input.customerId, input.request.id, token));
  if (claim.state === "in_progress") throw new BusinessWorkflowError("GENERATION_IN_PROGRESS", 409,
    "Generation is already in progress. Retry after the existing attempt completes; interrupted leases expire after 10 minutes.");
  if (claim.state === "exists") return GenerationReceiptSchema.parse({
    requestId: input.request.id, revision: claim.revision, persistence: "existing", workflowState: claim.workflowState,
  });
  const request = ProposalRequestSchema.parse({ ...base, requirements: [base.requirements,
    ...(claim.changeMessage ? [`Customer changes for revision ${claim.revision}: ${claim.changeMessage}`] : []),
  ].join("\n\n") });
  const proposal = GeneratedProposalSchema.parse(await input.generator.generate(request));
  const receipt = GenerationReceiptSchema.parse(await input.repository.store(
    input.customerId, input.request.id, claim.revision, token, proposal));
  if (receipt.requestId !== input.request.id || receipt.revision !== claim.revision) {
    throw new BusinessWorkflowError("INVALID_WORKFLOW_RECEIPT", 503, "Saved revision identity could not be verified.");
  }
  return receipt;
}
