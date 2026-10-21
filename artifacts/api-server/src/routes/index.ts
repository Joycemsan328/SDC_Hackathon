import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runpodTestRouter from "./runpodTest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runpodTestRouter);

export default router;
