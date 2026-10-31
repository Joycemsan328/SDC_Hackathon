import { Router, type IRouter, type Request } from "express";
import { ProposalGenerationError, proposalGenerator } from "../services/proposalGenerator";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const TEST_COOLDOWN_MS = 60_000;
let lastTestAt = 0;
let testInProgress = false;

function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress?.toLowerCase();
  return address === "::1" || address === "127.0.0.1" || address?.startsWith("::ffff:127.") === true;
}

router.post("/dev/runpod-test", async (req, res) => {
  if (process.env["NODE_ENV"] !== "development" || process.env["RUNPOD_DEV_TEST_ENABLED"] !== "true") {
    return res.status(404).json({ error: "Not found." });
  }
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: "This development check is available only from localhost." });

  const now = Date.now();
  if (testInProgress) return res.status(409).json({ error: "A Runpod test is already running." });
  if (now - lastTestAt < TEST_COOLDOWN_MS) return res.status(429).json({ error: "Please wait before running the Runpod check again." });

  testInProgress = true;
  lastTestAt = now;
  try {
    const proposal = await proposalGenerator.generate({
      eventName: "EventFlow development smoke test",
      eventType: "Birthday dinner",
      eventDate: "2027-04-15",
      location: "Kuala Lumpur, Malaysia",
      guestCount: 24,
      budgetMYR: 8_000,
      theme: "Warm garden dinner",
      selectedServices: ["Catering", "Venue styling"],
      requirements: "Create two distinct sample event plans for a development smoke test. Do not include personal data.",
    });
    return res.json({ status: "ok", model: "Qwen/Qwen3-8B", proposal });
  } catch (error) {
    const safeError = error instanceof ProposalGenerationError
      ? error
      : new ProposalGenerationError("PROPOSAL_GENERATION_FAILED", "Proposal generation failed.");
    logger.warn({ code: safeError.code }, "Development Runpod proposal test failed");
    return res.status(safeError.statusCode).json({ error: safeError.message, code: safeError.code });
  } finally {
    testInProgress = false;
  }
});

export default router;
