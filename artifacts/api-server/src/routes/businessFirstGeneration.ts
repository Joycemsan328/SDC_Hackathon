import { Router, type IRouter } from "express";
import { GeneratePersistedProposalPairBody, GeneratePersistedProposalPairResponse } from "@workspace/api-zod";
import { SupabaseCustomerRequestGateway, CustomerDataAccessError, type CustomerRequestGateway } from "../services/customerSupabase";
import { proposalGenerator, ProposalGenerationError } from "../services/proposalGenerator";
import { businessWorkflowRepository, generateBusinessRevision, BusinessWorkflowError, type BusinessWorkflowRepository } from "../services/businessFirstWorkflow";
import { logger } from "../lib/logger";

export function createBusinessFirstGenerationRouter(deps: {
  env?: NodeJS.ProcessEnv; repository?: BusinessWorkflowRepository | null;
  customers?: CustomerRequestGateway; generator?: Pick<typeof proposalGenerator, "generate">;
} = {}): IRouter {
  const router = Router();
  const env = deps.env ?? process.env;
  const customers = deps.customers ?? new SupabaseCustomerRequestGateway(env);
  router.post("/proposals/generate-persisted", async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const bearer = req.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!bearer) { res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in as an approved customer." }); return; }
    const body = GeneratePersistedProposalPairBody.safeParse(req.body);
    if (!body.success || Object.keys(req.body ?? {}).some(key => key !== "requestId")) {
      res.status(400).json({ code: "INVALID_REQUEST", error: "Only a saved request ID is accepted; plan content is server-owned." }); return;
    }
    const repository = deps.repository === undefined ? businessWorkflowRepository(env) : deps.repository;
    if (!repository) {
      res.status(503).json({ code: "WORKFLOW_NOT_READY", error: "Business-first generation is not activated. Your event is saved. No RunPod call was made." }); return;
    }
    try {
      const owned = await customers.loadOwnedRequest(bearer, body.data.requestId);
      if (!owned) { res.status(404).json({ code: "REQUEST_NOT_FOUND", error: "Your saved request was not found." }); return; }
      if (owned.customerId !== owned.request.customer_id || owned.request.id !== body.data.requestId) {
        res.status(403).json({ code: "REQUEST_OWNERSHIP_MISMATCH", error: "Request ownership could not be verified." }); return;
      }
      const receipt = await generateBusinessRevision({
        customerId: owned.customerId, request: owned.request, repository, generator: deps.generator ?? proposalGenerator,
      });
      res.json(GeneratePersistedProposalPairResponse.parse(receipt));
    } catch (error) {
      if (error instanceof CustomerDataAccessError || error instanceof BusinessWorkflowError || error instanceof ProposalGenerationError) {
        logger.warn({ code: error.code }, "Business-first generation stopped");
        res.status(error.statusCode).json({ code: error.code, error: error.message }); return;
      }
      logger.error({ code: "INVALID_WORKFLOW_RESPONSE" }, "Business-first generation stopped");
      res.status(503).json({ code: "INVALID_WORKFLOW_RESPONSE", error: "The revision could not be verified. Reload before retrying." });
    }
  });
  return router;
}
