import { Router, type IRouter } from "express";
import { ProposalGenerationError, ProposalRequestSchema, proposalGenerator } from "../services/proposalGenerator";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/proposals/generate", async (req, res) => {
  const parsed = ProposalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "The event requirements are invalid.", code: "INVALID_REQUEST" });
  }

  try {
    const proposal = await proposalGenerator.generate(parsed.data);
    return res.json({ proposal });
  } catch (error) {
    const safeError = error instanceof ProposalGenerationError
      ? error
      : new ProposalGenerationError("PROPOSAL_GENERATION_FAILED", "Proposal generation failed.");
    logger.warn({ code: safeError.code }, "Customer proposal generation failed");
    return res.status(safeError.statusCode).json({ error: safeError.message, code: safeError.code });
  }
});

export default router;
