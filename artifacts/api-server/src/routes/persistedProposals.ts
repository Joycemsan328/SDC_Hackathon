import { Router, type IRouter } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { CustomerDataAccessError, mapSavedRequestToProposalInput, SupabaseCustomerRequestGateway, type CustomerRequestGateway, type CustomerRequestRow } from "../services/customerSupabase";
import { createCustomerProposalRepository, createSupabaseAdminProposalRepository, INITIAL_PROPOSAL_REVISION, mapProposalMetadata, ProposalPersistenceError, type ProposalMetadataMapper, type ProposalPairRepository } from "../services/proposalPersistence";
import { ProposalGenerationError, GeneratedProposalSchema, ProposalRequestSchema, proposalGenerator, type ProposalRequest } from "../services/proposalGenerator";

const BodySchema = z.object({ requestId: z.string().uuid() }).strict();
type Generator = Pick<typeof proposalGenerator, "generate">;

type RouterDependencies = {
  env?: NodeJS.ProcessEnv;
  customers?: CustomerRequestGateway;
  generator?: Generator;
  repository?: ProposalPairRepository | null;
  lookupRepository?: Pick<ProposalPairRepository, "findExisting"> | null;
  requestInputMapper?: ((request: CustomerRequestRow) => ProposalRequest) | null;
  metadataMapper?: ProposalMetadataMapper | null;
};

export function createPersistedProposalRouter(dependencies: RouterDependencies = {}): IRouter {
  const router: IRouter = Router();
  const env = dependencies.env ?? process.env;
  const customers = dependencies.customers ?? new SupabaseCustomerRequestGateway(env);
  const generator = dependencies.generator ?? proposalGenerator;
  const metadataMapper = dependencies.metadataMapper ?? mapProposalMetadata;
  const requestInputMapper = dependencies.requestInputMapper ?? mapSavedRequestToProposalInput;
  const enabled = env["EVENTFLOW_AI_PERSISTENCE_ENABLED"] === "true"
    && metadataMapper !== null && requestInputMapper !== null;
  const repository = dependencies.repository === undefined
    ? (enabled ? createSupabaseAdminProposalRepository(env) : null)
    : dependencies.repository;
  const lookupRepository = dependencies.lookupRepository ?? repository;
  const customerConfigured = !!((env["SUPABASE_URL"] || env["VITE_SUPABASE_URL"])
    && (env["SUPABASE_PUBLISHABLE_KEY"] || env["VITE_SUPABASE_PUBLISHABLE_KEY"]));
  const inFlight = new Map<string, Promise<unknown>>();

  router.post("/proposals/generate-persisted", async (req, res) => {
    if ((!customerConfigured && (!enabled || !repository || !lookupRepository)) || !metadataMapper) {
      return res.status(503).json({ error: "Proposal persistence is not enabled until its database mapping is verified.", code: "PERSISTENCE_NOT_CONFIGURED" });
    }
    const authorization = req.get("authorization");
    const bearer = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!bearer) return res.status(401).json({ error: "A valid customer session is required.", code: "AUTHENTICATION_REQUIRED" });
    const body = BodySchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "A valid saved request ID is required.", code: "INVALID_REQUEST" });
    const activeRepository = repository ?? createCustomerProposalRepository(env, bearer);
    const activeLookup = lookupRepository ?? activeRepository;
    if (!activeRepository || !activeLookup) return res.status(503).json({ error: "Supabase persistence is not configured.", code: "PERSISTENCE_NOT_CONFIGURED" });

    try {
      const owned = await customers.loadOwnedRequest(bearer, body.data.requestId);
      if (!owned) return res.status(404).json({ error: "Saved event request was not found.", code: "REQUEST_NOT_FOUND" });
      if (owned.customerId !== owned.request.customer_id || owned.request.id !== body.data.requestId) {
        return res.status(403).json({ error: "This event request does not belong to the signed-in customer.", code: "REQUEST_OWNERSHIP_MISMATCH" });
      }
      const existing = await activeLookup.findExisting({ requestId: owned.request.id, revision: INITIAL_PROPOSAL_REVISION });
      if (existing) {
        return res.json({ requestId: existing.request_id, revision: existing.revision, persistence: existing.status, proposals: existing.proposals });
      }
      const key = `${owned.customerId}:${owned.request.id}`;
      let work = inFlight.get(key);
      if (!work) {
        work = (async () => {
          const proposalInput = ProposalRequestSchema.parse(requestInputMapper(owned.request));
          // The authenticated RPC validates migration/permissions and acquires
          // a cross-process lease BEFORE any paid RunPod request.
          await activeRepository.claimGeneration?.(owned.request.id);
          const generated = GeneratedProposalSchema.parse(await generator.generate(proposalInput));
          const metadata = metadataMapper(owned.request, generated);
          if (!Number.isSafeInteger(metadata.revision) || metadata.revision < 1) {
            throw new ProposalPersistenceError("PERSISTENCE_MAPPING_INVALID", 503, "Proposal revision mapping is not configured safely.");
          }
          return activeRepository.persist({
            customerId: owned.customerId, requestId: owned.request.id,
            revision: metadata.revision, recommendation: metadata.recommendation,
            proposalFields: metadata.fields, proposal: generated,
          });
        })();
        inFlight.set(key, work);
      }
      let persisted;
      try { persisted = await work as Awaited<ReturnType<ProposalPairRepository["persist"]>>; }
      finally { if (inFlight.get(key) === work) inFlight.delete(key); }
      // Only return content read back from the persistence function, never unsaved AI output.
      return res.json({ requestId: persisted.request_id, revision: persisted.revision, persistence: persisted.status, proposals: persisted.proposals });
    } catch (error) {
      if (error instanceof CustomerDataAccessError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      if (error instanceof ProposalGenerationError || error instanceof ProposalPersistenceError) {
        logger.warn({ code: error.code }, "Persisted proposal generation failed");
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      // Includes mapper and unexpected validation failures; do not emit exception text.
      logger.error({ code: "PERSISTED_PROPOSAL_FAILED" }, "Persisted proposal generation failed");
      return res.status(503).json({ error: "Proposals could not be generated and saved safely.", code: "PERSISTED_PROPOSAL_FAILED" });
    }
  });
  return router;
}

export default createPersistedProposalRouter();
