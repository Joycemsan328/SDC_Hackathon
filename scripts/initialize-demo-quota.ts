import { generationQuota } from "../artifacts/api-server/src/services/generationQuota";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--initialize-five-new-jobs") {
    throw new Error("Explicit owner action required: --initialize-five-new-jobs");
  }
  if (process.env.EVENTFLOW_LIVE_GENERATION_ENABLED === "true") {
    throw new Error("Keep live generation disabled while initializing the budget.");
  }
  const quota = generationQuota(process.env);
  if (!quota) throw new Error("Configure the server-only Redis REST URL and read/write token first.");
  const result = await quota.initializeOnce();
  process.stdout.write(result === "initialized"
    ? "Initialized five new jobs. Live generation remains disabled.\n"
    : "A quota ledger already exists. Nothing reset, refunded, or overwritten.\n");
}
main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
