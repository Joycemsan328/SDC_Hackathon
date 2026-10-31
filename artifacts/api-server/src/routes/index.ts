import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runpodTestRouter from "./runpodTest";
import proposalsRouter from "./proposals";
import persistedProposalsRouter from "./persistedProposals";
import { createCustomerRevisionGenerationRouter } from "./customerRevisionGeneration";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runpodTestRouter);
router.use(proposalsRouter);
router.use(persistedProposalsRouter);
router.use(createCustomerRevisionGenerationRouter());

export default router;
