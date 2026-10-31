import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { fileURLToPath } from "node:url";
import { serveProductionWeb } from "./services/productionWeb";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
if (process.env.NODE_ENV === "development") app.use("/api-development", router);

if (process.env.NODE_ENV === "production") {
  // src/app.ts and bundled dist/index.mjs are both one level below api-server.
  serveProductionWeb(app, fileURLToPath(new URL("../../eventflow-ai/dist/public/", import.meta.url)));
}

export default app;
