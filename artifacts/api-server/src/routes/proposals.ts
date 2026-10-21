import { createHash } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { ProposalGenerationError, ProposalRequestSchema, proposalGenerator, type GeneratedProposal } from "../services/proposalGenerator";
import { logger } from "../lib/logger";

const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const MAX_IDEMPOTENCY_ENTRIES = 100;
type CachedGeneration = { bodyHash: string; expiresAt: number; result: Promise<GeneratedProposal> };
type Generator = Pick<typeof proposalGenerator, "generate">;

function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress?.toLowerCase();
  return address === "::1" || address === "127.0.0.1" || address?.startsWith("::ffff:127.") === true;
}

export function createProposalRouter(generator: Generator = proposalGenerator, env: NodeJS.ProcessEnv = process.env): IRouter {
  const router: IRouter = Router();
  const generations = new Map<string, CachedGeneration>();

  router.post("/dev/proposals/generate", async (req, res) => {
    if (env["NODE_ENV"] !== "development" || env["RUNPOD_DEV_TEST_ENABLED"] !== "true") {
      return res.status(404).json({ error: "Not found." });
    }
    if (!isLoopbackRequest(req)) {
      return res.status(403).json({ error: "This development endpoint is available only from localhost." });
    }

    const parsed = ProposalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "The event requirements are invalid.", code: "INVALID_REQUEST" });
    }

    const idempotencyKey = req.get("idempotency-key");
    if (!idempotencyKey || !/^[a-zA-Z0-9_-]{1,128}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: "A valid Idempotency-Key is required.", code: "INVALID_IDEMPOTENCY_KEY" });
    }

    const now = Date.now();
    for (const [key, value] of generations) if (value.expiresAt <= now) generations.delete(key);
    const bodyHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
    const cached = generations.get(idempotencyKey);
    if (cached && cached.bodyHash !== bodyHash) {
      return res.status(409).json({ error: "This request ID was already used with different requirements.", code: "IDEMPOTENCY_CONFLICT" });
    }

    let generation = cached?.result;
    if (!generation) {
      generation = generator.generate(parsed.data);
      generations.set(idempotencyKey, { bodyHash, expiresAt: now + IDEMPOTENCY_TTL_MS, result: generation });
      while (generations.size > MAX_IDEMPOTENCY_ENTRIES) {
        const oldestKey = generations.keys().next().value;
        if (oldestKey === undefined) break;
        generations.delete(oldestKey);
      }
    }

    try {
      const proposal = await generation;
      return res.json({ proposal });
    } catch (error) {
      generations.delete(idempotencyKey);
      const safeError = error instanceof ProposalGenerationError
        ? error
        : new ProposalGenerationError("PROPOSAL_GENERATION_FAILED", "Proposal generation failed.");
      logger.warn({ code: safeError.code }, "Development proposal generation failed");
      return res.status(safeError.statusCode).json({ error: safeError.message, code: safeError.code });
    }
  });
  return router;
}

export default createProposalRouter();
