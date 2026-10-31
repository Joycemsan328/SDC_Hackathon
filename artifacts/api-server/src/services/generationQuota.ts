import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GeneratedProposalSchema, type GeneratedProposal } from "./proposalGenerator";
import { SubmissionError } from "./submissionProposals";
import { DEMO_QUOTA_KEY, EXTEND_QUOTA_TO_35_ONCE, INITIALIZE_QUOTA, RESERVE_GENERATION, TRANSITION_GENERATION } from "./generationQuotaScripts";

const EntrySchema = z.object({
  customerId: z.string().uuid(), token: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(), state: z.enum(["reserved", "ready", "saved", "failed"]),
  proposal: GeneratedProposalSchema.optional(),
}).strict().superRefine((entry, context) => {
  if ((entry.state === "ready" || entry.state === "saved") && !entry.proposal) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Missing cached result" });
  }
});
export type QuotaEntry = z.infer<typeof EntrySchema>;
export type GenerationIdentity = {
  requestId: string;
  customerId: string;
  fingerprint: string;
  /** Stable DB-issued revision token; absent for the original one-attempt request path. */
  reservationId?: string;
};
export type GenerationReservation = { fresh: boolean; entry: QuotaEntry };
export interface GenerationQuota {
  reserve(identity: GenerationIdentity): Promise<GenerationReservation>;
  cache(identity: GenerationIdentity, entry: QuotaEntry, proposal: GeneratedProposal): Promise<QuotaEntry>;
  saved(identity: GenerationIdentity, entry: QuotaEntry): Promise<void>;
  failed(identity: GenerationIdentity, entry: QuotaEntry): Promise<void>;
}
function unavailable(): SubmissionError {
  return new SubmissionError("QUOTA_UNAVAILABLE", 503, "Your request is saved. AI usage state could not be verified. Any reserved attempt remains consumed; no additional paid job will be submitted automatically. Check My Events before retrying.");
}
export class RedisGenerationQuota implements GenerationQuota {
  constructor(private url: string, private token: string, private fetcher: typeof fetch = fetch, private key = DEMO_QUOTA_KEY) {}

  private async evaluate(script: string, args: string[] = []): Promise<string[]> {
    try {
      const response = await this.fetcher(this.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(["EVAL", script, "1", this.key, ...args]),
      });
      if (!response.ok) throw unavailable();
      const body = await response.json() as { result?: unknown; error?: unknown };
      if (body.error || !Array.isArray(body.result) || !body.result.every(item => typeof item === "string")) throw unavailable();
      const result = body.result as string[];
      if (result[0] === "UNINITIALIZED") throw new SubmissionError("QUOTA_NOT_INITIALIZED", 503, "Your request is saved. The shared demo AI budget is missing or not initialized. Generation cannot safely continue; no additional job will be submitted.");
      if (result[0] === "CORRUPT") throw unavailable();
      return result;
    } catch (error) {
      if (error instanceof SubmissionError) throw error;
      throw unavailable(); // Never log credentials, REST URL, or provider response.
    }
  }

  /** Owner-only CLI operation, never called automatically or exposed by HTTP. */
  async initializeOnce(): Promise<"initialized" | "existing"> {
    const result = await this.evaluate(INITIALIZE_QUOTA);
    if (result[0] === "INITIALIZED") return "initialized";
    if (result[0] === "EXISTS") return "existing";
    throw unavailable();
  }

  /** Operator-only one-time 20 -> 35 increase; never invoked by an HTTP route. */
  async extendToThirtyFiveOnce(): Promise<"extended" | "already-applied"> {
    const result = await this.evaluate(EXTEND_QUOTA_TO_35_ONCE, [new Date().toISOString()]);
    if (result[0] === "EXTENDED") return "extended";
    if (result[0] === "ALREADY_APPLIED") return "already-applied";
    throw new SubmissionError("QUOTA_EXTENSION_REFUSED", 409, "The ledger must be the valid 20-attempt ledger with its previous extension and matching attempt history. Nothing was reset or overwritten.");
  }

  async reserve(identity: GenerationIdentity): Promise<GenerationReservation> {
    z.string().uuid().parse(identity.requestId);
    const reservationField = this.reservationField(identity);
    const entry = EntrySchema.parse({
      customerId: identity.customerId, token: randomUUID(), fingerprint: identity.fingerprint,
      createdAt: new Date().toISOString(), state: "reserved",
    });
    const result = await this.evaluate(RESERVE_GENERATION, [reservationField, JSON.stringify(entry)]);
    if (result[0] === "EXHAUSTED") throw new SubmissionError("DEMO_BUDGET_EXHAUSTED", 429, "Your request is saved. The approved finite AI budget is exhausted. No new RunPod job was started.");
    if (!["RESERVED", "EXISTING"].includes(result[0]!) || !result[1]) throw unavailable();
    let raw: unknown;
    try { raw = JSON.parse(result[1]); } catch { throw unavailable(); }
    const parsed = EntrySchema.safeParse(raw);
    if (!parsed.success || parsed.data.customerId !== identity.customerId || parsed.data.fingerprint !== identity.fingerprint) {
      throw new SubmissionError("GENERATION_RESERVATION_MISMATCH", 409, "This saved request already has a different generation reservation. No new job was started.");
    }
    if (result[0] === "RESERVED" && (parsed.data.token !== entry.token || parsed.data.state !== "reserved")) throw unavailable();
    if (result[0] === "EXISTING" && parsed.data.state !== "ready") {
      const active = parsed.data.state === "reserved";
      throw new SubmissionError(active ? "GENERATION_IN_PROGRESS" : "GENERATION_ALREADY_ATTEMPTED", 409,
        active ? "This request already has an AI generation reservation. No second job will be started. Check My Events for completed plans; if none appear, contact the planning team."
          : "This request has already used its one AI attempt. No automatic paid retry is allowed. Contact the planning team.");
    }
    return { fresh: result[0] === "RESERVED", entry: parsed.data };
  }

  private async transition(identity: GenerationIdentity, entry: QuotaEntry, next: QuotaEntry) {
    const checked = EntrySchema.parse(next);
    const result = await this.evaluate(TRANSITION_GENERATION, [this.reservationField(identity), JSON.stringify(checked)]);
    if (result[0] !== "OK") throw new SubmissionError("GENERATION_STATE_CONFLICT", 409, "The AI attempt could not be safely reconciled. No additional job will be started.");
    return checked;
  }
  private reservationField(identity: GenerationIdentity) {
    if (identity.reservationId === undefined) return `request:${identity.requestId}`;
    if (!identity.reservationId.startsWith("revision:")
      || !z.string().uuid().safeParse(identity.reservationId.slice("revision:".length)).success) {
      throw new SubmissionError("GENERATION_RESERVATION_INVALID", 400, "The AI generation idempotency key is invalid.");
    }
    return identity.reservationId;
  }
  cache(identity: GenerationIdentity, entry: QuotaEntry, proposal: GeneratedProposal) {
    return this.transition(identity, entry, { ...entry, state: "ready", proposal: GeneratedProposalSchema.parse(proposal) });
  }
  async saved(identity: GenerationIdentity, entry: QuotaEntry) {
    await this.transition(identity, entry, { ...entry, state: "saved" });
  }
  async failed(identity: GenerationIdentity, entry: QuotaEntry) {
    await this.transition(identity, entry, { ...entry, state: "failed" });
  }
}

export function generationQuota(env: NodeJS.ProcessEnv): RedisGenerationQuota | null {
  const url = env.EVENTFLOW_QUOTA_REDIS_REST_URL;
  const token = env.EVENTFLOW_QUOTA_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    // Server configuration only; reject embedded credentials and redirect targets.
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".upstash.io") || parsed.port ||
        parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) return null;
    return new RedisGenerationQuota(parsed.origin, token);
  } catch { return null; }
}
