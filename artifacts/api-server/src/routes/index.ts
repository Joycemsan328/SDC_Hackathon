import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runpodTestRouter from "./runpodTest";
import proposalsRouter from "./proposals";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runpodTestRouter);
router.use(proposalsRouter);

export default router;
