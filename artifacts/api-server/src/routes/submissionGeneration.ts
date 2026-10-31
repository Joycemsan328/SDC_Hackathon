import { Router } from "express";
import { createHash } from "node:crypto";
import { GeneratePersistedProposalPairBody, GeneratePersistedProposalPairResponse } from "@workspace/api-zod";
import { CustomerDataAccessError, isSupportedEventLocation, mapSavedRequestToProposalInput, SupabaseCustomerRequestGateway, type CustomerRequestGateway } from "../services/customerSupabase";
import { GeneratedProposalSchema, ProposalGenerationError, proposalGenerator, validateSubmissionProposal } from "../services/proposalGenerator";
import { SubmissionError, submissionRepository, type SubmissionRepository, type SubmissionReceipt } from "../services/submissionProposals";
import { logger } from "../lib/logger";
import { generationQuota, type GenerationQuota } from "../services/generationQuota";

export function createSubmissionGenerationRouter(deps: {
  env?: NodeJS.ProcessEnv; repository?: SubmissionRepository | null;
  customers?: CustomerRequestGateway; generator?: Pick<typeof proposalGenerator, "generate">;
  quota?: GenerationQuota | null;
} = {}) {
  const router = Router();
  const env = deps.env ?? process.env;
  const customers = deps.customers ?? new SupabaseCustomerRequestGateway(env);
  const inFlight = new Map<string, Promise<SubmissionReceipt>>();
  router.post("/proposals/generate-persisted", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const bearer = req.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!bearer) { res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in as an approved customer." }); return; }
    const body = GeneratePersistedProposalPairBody.safeParse(req.body);
    if (!body.success || Object.keys(req.body ?? {}).some(key => key !== "requestId")) {
      res.status(400).json({ code: "INVALID_REQUEST", error: "Only a saved request ID is accepted." }); return;
    }
    try {
      const owned = await customers.loadOwnedRequest(bearer, body.data.requestId);
      if (!owned || owned.request.id !== body.data.requestId || owned.request.customer_id !== owned.customerId) {
        res.status(404).json({ code: "REQUEST_NOT_FOUND", error: "Your saved request could not be verified." }); return;
      }
      const repository = deps.repository === undefined ? submissionRepository(env) : deps.repository;
      if (!repository) throw new SubmissionError("BACKEND_CREDENTIAL_REQUIRED", 503, "Your request is saved. A backend Supabase credential is required to save AI plans securely. No RunPod call was made.");
      const key = `${owned.customerId}:${owned.request.id}`;
      let work = inFlight.get(key);
      if (!work) {
        work = (async () => {
          const existing = await repository.find(owned.request.id);
          if (existing) return existing;
          const input = mapSavedRequestToProposalInput(owned.request);
           if (!isSupportedEventLocation(input.location)) {
             throw new CustomerDataAccessError(
               "UNSUPPORTED_EVENT_LOCATION",
               422,
               "EventFlow AI currently supports event planning in Kuala Lumpur and Selangor only.",
             );
           }
           if (input.budgetMYR < 1) {
             throw new SubmissionError("BUDGET_BELOW_MINIMUM", 422, "Saved event budgets must be at least RM1. Your request was not reserved for AI generation.");
           }
          await repository.preflight();
          // Activation is separate from initialization; neither bypasses quota.
          if (env.EVENTFLOW_MVP_INSERT_VERIFIED !== "true" || env.EVENTFLOW_LIVE_GENERATION_ENABLED !== "true") {
            throw new SubmissionError("LIVE_GENERATION_NOT_APPROVED", 503, "Your request is saved. New automatic AI generation is not enabled for this demo yet. No RunPod call was made. Existing approved plans remain available in My Events.");
          }
          const quota = deps.quota === undefined ? generationQuota(env) : deps.quota;
          if (!quota) throw new SubmissionError("QUOTA_NOT_CONFIGURED", 503, "Your request is saved. Shared AI cost protection is not configured, so no RunPod job was started.");
          const identity = {
            requestId: owned.request.id, customerId: owned.customerId,
            fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
          };
          const reservation = await quota.reserve(identity);
          let entry = reservation.entry;
          if (reservation.fresh) {
            let generated;
            try {
              generated = validateSubmissionProposal(
                await (deps.generator ?? proposalGenerator).generate(input, { qualityProfile: "submission" }),
                input,
              );
            } catch (error) {
              await quota.failed(identity, entry).catch(() => logger.warn({ code: "QUOTA_FAILURE_RECORD_UNAVAILABLE" }, "AI attempt stays consumed"));
              if (error instanceof ProposalGenerationError) {
                throw new SubmissionError(error.code, error.statusCode, `${error.message} This request's one AI attempt is consumed; no automatic paid retry will be made.`);
              }
              throw new SubmissionError("GENERATION_ATTEMPT_FAILED", 503, "The AI attempt failed validation. Your request is saved, and no further paid attempt will be made for this request.");
            }
            // If acknowledgement is lost, keep the reservation consumed. A later
            // call may recover a ready result, but must never resubmit inference.
            entry = await quota.cache(identity, entry, generated);
          }
           // Cached results can predate this deployment's quality rules. Revalidate
           // them against the saved request before any Supabase insert as well.
           let proposal;
           try {
             proposal = validateSubmissionProposal(entry.proposal, input);
           } catch {
             // Preserve the already-consumed attempt, but stop a bad ready cache
             // from being revalidated forever or reused for a Supabase insert.
             await quota.failed(identity, entry).catch(() => logger.warn(
               { code: "QUOTA_CACHED_FAILURE_RECORD_UNAVAILABLE" },
               "Invalid cached proposal remains consumed; no retry will be started",
             ));
             throw new SubmissionError(
               "CACHED_PROPOSAL_INVALID",
               422,
               "The saved AI result did not pass current checks. Its existing attempt remains consumed; no new AI job will be started.",
             );
           }
          const saved = await repository.insert(owned.request, proposal);
          // Supabase is authoritative once saved. Failure to mark the ledger must
          // not turn a successful save into a frontend retry/failure.
          await quota.saved(identity, entry).catch(() => logger.warn({ code: "QUOTA_SAVED_RECORD_UNAVAILABLE" }, "Saved proposal pair preserved"));
          return saved;
        })();
        inFlight.set(key, work);
        void work.finally(() => { if (inFlight.get(key) === work) inFlight.delete(key); }).catch(() => {});
      }
      res.json(GeneratePersistedProposalPairResponse.parse(await work));
    } catch (error) {
      if (error instanceof SubmissionError || error instanceof CustomerDataAccessError || error instanceof ProposalGenerationError) {
        logger.warn({ code: error.code }, "Submission generation stopped safely");
        res.status(error.statusCode).json({ code: error.code, error: error.message }); return;
      }
      logger.error({ code: "SUBMISSION_GENERATION_FAILED" }, "Submission generation failed");
      res.status(503).json({ code: "SUBMISSION_GENERATION_FAILED", error: "Plans could not be verified or saved. Reload before retrying." });
    }
  });
  return router;
}
