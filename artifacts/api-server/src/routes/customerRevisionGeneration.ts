import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  GenerateBusinessCustomerRevisionBody,
  GenerateBusinessCustomerRevisionResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import {
  CustomerRevisionError,
  composeRevisionRequest,
  customerRevisionGenerationRepository,
  type CustomerRevisionGenerationRepository,
  type RevisionAction,
  type RevisionGenerationFailure,
} from "../services/customerRevisionGeneration";
import { generationQuota, type GenerationQuota, type QuotaEntry } from "../services/generationQuota";
import { isSupportedEventLocation } from "../services/customerSupabase";
import {
  ProposalGenerationError,
  proposalGenerator,
  validateSubmissionProposal,
  type GeneratedProposal,
} from "../services/proposalGenerator";
import { SubmissionError } from "../services/submissionProposals";

type Generator = Pick<typeof proposalGenerator, "generate">;

export function createCustomerRevisionGenerationRouter(deps: {
  env?: NodeJS.ProcessEnv;
  repository?: CustomerRevisionGenerationRepository | null;
  quota?: GenerationQuota | null;
  generator?: Generator;
} = {}): IRouter {
  const router = Router();
  const env = deps.env ?? process.env;
  const repository = deps.repository === undefined ? customerRevisionGenerationRepository(env) : deps.repository;
  const quota = deps.quota === undefined ? generationQuota(env) : deps.quota;
  const generator = deps.generator ?? proposalGenerator;
  const inFlight = new Map<string, Promise<ReturnType<typeof GenerateBusinessCustomerRevisionResponse.parse>>>();

  router.post("/business/revisions/generate", async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const bearer = req.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!bearer) {
      res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in with an approved Business account." });
      return;
    }
    const body = GenerateBusinessCustomerRevisionBody.safeParse(req.body);
    if (!body.success || Object.keys(req.body ?? {}).some(key => key !== "responseId")) {
      res.status(400).json({ code: "INVALID_REQUEST", error: "Only a saved Customer Change Request ID is accepted." });
      return;
    }
    if (env.EVENTFLOW_MVP_INSERT_VERIFIED !== "true"
      || env.EVENTFLOW_LIVE_GENERATION_ENABLED !== "true"
      || env.EVENTFLOW_REVISION_GENERATION_ENABLED !== "true") {
      res.status(503).json({
        code: "REVISION_GENERATION_NOT_ENABLED",
        error: "Revised AI proposal generation is not enabled. No RunPod call was made.",
      });
      return;
    }
    if (!repository || !quota) {
      res.status(503).json({
        code: !repository ? "REVISION_DATABASE_NOT_CONFIGURED" : "QUOTA_NOT_CONFIGURED",
        error: "Revision generation is not configured safely. No RunPod call was made.",
      });
      return;
    }

    try {
      // This authenticated RPC is the authorization boundary: its existing
      // approved-staff predicate must succeed before privileged server reads.
      const queued = await repository.startRevision(bearer, body.data.responseId);
      if (queued.status === "business_review" || queued.status === "released") {
        const existing = await repository.findPair(queued.request_id, queued.next_revision);
        if (!existing) throw new CustomerRevisionError("REVISION_PAIR_INCOMPLETE", 409, "The revision state has no verified A/B pair.");
        res.json(GenerateBusinessCustomerRevisionResponse.parse({
          requestId: existing.request_id,
          revision: existing.revision,
          persistence: "existing",
          workflowState: "business_review",
        }));
        return;
      }
      if (queued.generation_error_code) {
        throw new CustomerRevisionError(
          "GENERATION_ALREADY_ATTEMPTED",
          409,
          "This revision's AI attempt already failed or is uncertain. It will not be automatically regenerated.",
        );
      }

      // Validate all source data and build the full revision prompt before the
      // atomic claim or quota reservation, so preflight failures cost no attempt.
      const sourceContext = await repository.loadContext(queued);
      const revisionInput = composeRevisionRequest(sourceContext);
      if (!isSupportedEventLocation(revisionInput.location)) {
        throw new CustomerRevisionError(
          "UNSUPPORTED_EVENT_LOCATION",
          422,
          "EventFlow AI currently supports event planning in Kuala Lumpur and Selangor only.",
        );
      }
      if (revisionInput.budgetMYR < 1) {
        throw new CustomerRevisionError("BUDGET_BELOW_MINIMUM", 422, "The saved event budget must be at least RM1.");
      }

      const action = await repository.claimGeneration(body.data.responseId);
      if (action.response_id !== queued.response_id || action.request_id !== queued.request_id
        || action.source_revision !== queued.source_revision || action.next_revision !== queued.next_revision) {
        throw new CustomerRevisionError("REVISION_CLAIM_MISMATCH", 409, "The revision changed during preparation. No new AI job was started.");
      }
      if (action.status === "business_review" || action.status === "released") {
        const existing = await repository.findPair(action.request_id, action.next_revision);
        if (!existing) throw new CustomerRevisionError("REVISION_PAIR_INCOMPLETE", 409, "The revision state has no verified A/B pair.");
        res.json(GenerateBusinessCustomerRevisionResponse.parse({
          requestId: existing.request_id,
          revision: existing.revision,
          persistence: "existing",
          workflowState: "business_review",
        }));
        return;
      }
      if (action.generation_error_code) {
        throw new CustomerRevisionError(
          "GENERATION_ALREADY_ATTEMPTED",
          409,
          "This revision's AI attempt already failed or is uncertain. It will not be automatically regenerated.",
        );
      }
      if (action.status !== "generating" || !action.generation_token || !action.next_revision) {
        throw new CustomerRevisionError("REVISION_CLAIM_INVALID", 503, "The database did not provide a safe revision generation claim.");
      }

      let work = inFlight.get(action.generation_token);
      if (!work) {
        work = generateAndPersist({
          action,
          revisionInput,
          sourceContext,
          repository,
          quota,
          generator,
        });
        inFlight.set(action.generation_token, work);
        void work.finally(() => {
          if (inFlight.get(action.generation_token!) === work) inFlight.delete(action.generation_token!);
        }).catch(() => {});
      }
      res.json(GenerateBusinessCustomerRevisionResponse.parse(await work));
    } catch (error) {
      if (error instanceof CustomerRevisionError || error instanceof SubmissionError || error instanceof ProposalGenerationError) {
        logger.warn({ code: error.code }, "Customer revision generation stopped safely");
        res.status(error.statusCode).json({ code: error.code, error: error.message });
        return;
      }
      logger.error({ code: "CUSTOMER_REVISION_GENERATION_FAILED" }, "Customer revision generation failed");
      res.status(503).json({
        code: "CUSTOMER_REVISION_GENERATION_FAILED",
        error: "The revised proposal could not be verified or saved. Check Business proposals before retrying.",
      });
    }
  });
  return router;
}

async function generateAndPersist(input: {
  action: RevisionAction;
  revisionInput: ReturnType<typeof composeRevisionRequest>;
  sourceContext: Awaited<ReturnType<CustomerRevisionGenerationRepository["loadContext"]>>;
  repository: CustomerRevisionGenerationRepository;
  quota: GenerationQuota;
  generator: Generator;
}) {
  const { action, revisionInput, sourceContext, repository, quota, generator } = input;
  const reservationId = `revision:${action.generation_token}`;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    requestId: action.request_id,
    responseId: action.response_id,
    revision: action.next_revision,
    sourceRevision: action.source_revision,
    customerId: sourceContext.request.customer_id,
    request: revisionInput,
    previousProposal: sourceContext.previousProposal,
  })).digest("hex");
  const identity = {
    requestId: action.request_id,
    customerId: sourceContext.request.customer_id,
    fingerprint,
    reservationId,
  };
  const reservation = await quota.reserve(identity);
  let entry = reservation.entry;
  let proposal: GeneratedProposal;

  if (reservation.fresh) {
    try {
      proposal = validateSubmissionProposal(
        await generator.generate(revisionInput, { qualityProfile: "submission" }),
        revisionInput,
      );
    } catch (error) {
      const failureCode = error instanceof ProposalGenerationError
        ? (error.code.startsWith("RUNPOD") ? "RUNPOD_FAILURE" : "PROPOSAL_VALIDATION_FAILED")
        : "AI_GENERATION_FAILED";
      await failConsumedAttempt(quota, repository, identity, entry, action, failureCode);
      if (error instanceof ProposalGenerationError) throw error;
      throw new CustomerRevisionError(
        "AI_GENERATION_FAILED",
        503,
        "The revision generation attempt failed. It remains consumed and will not be automatically retried.",
      );
    }
    entry = await quota.cache(identity, entry, proposal);
  } else {
    try {
      proposal = validateSubmissionProposal(entry.proposal, revisionInput);
    } catch {
      const failureCode: RevisionGenerationFailure = "PROPOSAL_VALIDATION_FAILED";
      await failConsumedAttempt(quota, repository, identity, entry, action, failureCode);
      throw new CustomerRevisionError(
        "CACHED_REVISION_INVALID",
        409,
        "The previously generated revision did not pass current validation. Its attempt remains consumed; no new RunPod job was started.",
      );
    }
  }

  const receipt = await repository.storePair(action, proposal);
  await quota.saved(identity, entry).catch(() => {
    logger.warn({ code: "REVISION_QUOTA_SAVE_ACK_UNAVAILABLE" }, "Saved revision pair remains authoritative");
  });
  return GenerateBusinessCustomerRevisionResponse.parse({
    requestId: receipt.request_id,
    revision: receipt.revision,
    persistence: receipt.persistence,
    workflowState: receipt.workflow_state,
  });
}

async function failConsumedAttempt(
  quota: GenerationQuota,
  repository: CustomerRevisionGenerationRepository,
  identity: Parameters<GenerationQuota["failed"]>[0],
  entry: QuotaEntry,
  action: RevisionAction,
  failureCode: RevisionGenerationFailure,
) {
  await quota.failed(identity, entry).catch(() => {
    logger.warn({ code: "REVISION_QUOTA_FAILURE_ACK_UNAVAILABLE" }, "The reserved revision attempt remains consumed");
  });
  await repository.markFailed(action, failureCode).catch(() => {
    logger.warn({ code: "REVISION_FAILURE_STATE_ACK_UNAVAILABLE" }, "The revision requires state reconciliation");
  });
}
