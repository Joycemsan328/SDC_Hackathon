import { randomUUID } from "node:crypto";
import { GeneratedProposalSchema, type GeneratedProposal } from "./proposalGenerator";
import type { CustomerRequestRow } from "./customerSupabase";

export class SubmissionError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); }
}
export type SubmissionReceipt = {
  requestId: string; revision: number; persistence: "created" | "existing";
  workflowState: "business_review" | "released";
};
export interface SubmissionRepository {
  find(requestId: string): Promise<SubmissionReceipt | null>;
  preflight(): Promise<void>;
  insert(request: CustomerRequestRow, proposal: GeneratedProposal): Promise<SubmissionReceipt>;
}
const columns = [
  "id", "request_id", "customer_name", "event_name", "event_date", "event_type",
  "budget", "event_time", "venue_id", "event_end_time", "revision",
  "recommendation", "status", "plan_key", "plan_content",
];
export class SubmissionProposalRepository implements SubmissionRepository {
  constructor(private url: string, private key: string, private fetcher: typeof fetch = fetch) {}
  private async call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.key);
    if (!this.key.startsWith("sb_secret_")) headers.set("authorization", `Bearer ${this.key}`);
    headers.set("accept", "application/json");
    try {
      return await this.fetcher(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, {
        ...init, headers, signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new SubmissionError("SUPABASE_UNAVAILABLE", 503, "Supabase could not be reached. No automatic generation retry was made.");
    }
  }
  async preflight() {
    const response = await this.call("");
    if (!response.ok) throw new SubmissionError("SCHEMA_CHECK_FAILED", 503, "The backend could not inspect the proposal insert requirements. No RunPod call was made.");
    const schema = await response.json() as {
      definitions?: Record<string, { properties?: Record<string, { default?: unknown; enum?: unknown[] }>; required?: string[] }>;
    };
    const table = schema.definitions?.proposals;
    if (!table?.properties || columns.some(column => !Object.hasOwn(table.properties!, column))) {
      throw new SubmissionError("SCHEMA_CHECK_FAILED", 503, "The existing proposal columns do not match the submission insert. No RunPod call was made.");
    }
    if (table.required?.some(column => !columns.includes(column) && table.properties?.[column]?.default === undefined)) {
      throw new SubmissionError("SCHEMA_CHECK_FAILED", 503, "An additional required proposal field needs review. No RunPod call was made.");
    }
    const statuses = table.properties.status?.enum;
    if (statuses && !statuses.includes("Pending Business Approval")) {
      throw new SubmissionError("SCHEMA_CHECK_FAILED", 503, "The pending Business status is incompatible. No RunPod call was made.");
    }
  }
  async find(requestId: string): Promise<SubmissionReceipt | null> {
    const query = new URLSearchParams({
      request_id: `eq.${requestId}`, select: "id,request_id,revision,plan_key,status", limit: "100",
    });
    const response = await this.call(`proposals?${query}`);
    if (!response.ok) throw new SubmissionError("PROPOSAL_LOOKUP_FAILED", 503, "Existing proposals could not be verified. No RunPod call was made.");
    const rows = await response.json() as Array<{ id: string; request_id: string; revision: string; plan_key: string; status: string }>;
    if (!Array.isArray(rows)) throw new SubmissionError("PROPOSAL_LOOKUP_FAILED", 503, "Invalid proposal lookup response.");
    if (!rows.length) return null;
    // Submission mode never creates revisions over any existing proposal records.
    if (rows.length !== 2 || new Set(rows.map(row => row.plan_key)).size !== 2 ||
        !rows.every(row => row.request_id === requestId && ["A", "B"].includes(row.plan_key) &&
          row.revision === rows[0].revision && /^[1-9][0-9]*$/.test(row.revision)) ||
        !Number.isSafeInteger(Number(rows[0].revision))) {
      throw new SubmissionError("EXISTING_PROPOSALS_NEED_REVIEW", 409, "Existing proposals were preserved. This request is not an unambiguous A/B pair; generation was not started.");
    }
    const released = rows.every(row => ["Awaiting Customer", "Accepted", "Declined"].includes(row.status));
    return { requestId, revision: Number(rows[0].revision), persistence: "existing", workflowState: released ? "released" : "business_review" };
  }
  async insert(request: CustomerRequestRow, input: GeneratedProposal): Promise<SubmissionReceipt> {
    const proposal = GeneratedProposalSchema.parse(input);
    const existing = await this.find(request.id);
    if (existing) return existing;
    const rows = proposal.plans.map(plan => ({
      id: randomUUID(), request_id: request.id, revision: "1", plan_key: plan.id,
      customer_name: request.customer_name, event_name: request.event_name,
      event_date: request.event_date, event_type: request.event_type, budget: request.budget,
      event_time: request.event_time, venue_id: request.venue_id, event_end_time: request.event_end_time,
      recommendation: proposal.recommendation, status: "Pending Business Approval", plan_content: plan,
    }));
    // One PostgREST bulk INSERT is transactional. Never upsert or overwrite.
    // The verified existing unique (request_id, revision, plan_key) index is the
    // cross-process duplicate guard; the route also coalesces same-process calls.
    const response = await this.call("proposals", {
      method: "POST", headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
    if (response.status === 409) {
      const saved = await this.find(request.id);
      if (saved) return saved;
    }
    if (!response.ok) throw new SubmissionError("PROPOSAL_SAVE_FAILED", 503, "Generated plans could not be saved safely. Reload before retrying; existing records were not overwritten.");
    return { requestId: request.id, revision: 1, persistence: "created", workflowState: "business_review" };
  }
}
export function submissionRepository(env: NodeJS.ProcessEnv): SubmissionRepository | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return url?.startsWith("https://") && key ? new SubmissionProposalRepository(url, key) : null;
}
