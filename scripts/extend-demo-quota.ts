import { generationQuota } from "../artifacts/api-server/src/services/generationQuota";

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--approve-35-total-attempts") {
    throw new Error("Explicit owner action required: --approve-35-total-attempts. No quota operation was performed.");
  }
  if (process.env.EVENTFLOW_LIVE_GENERATION_ENABLED === "true" || process.env.EVENTFLOW_MVP_INSERT_VERIFIED === "true") {
    throw new Error("Keep both generation activation flags disabled while extending the budget.");
  }
  const quota = generationQuota(process.env);
  if (!quota) throw new Error("Configure the existing server-only Redis REST credentials first.");
  const result = await quota.extendToThirtyFiveOnce();
  process.stdout.write(result === "extended"
    ? "Limit increased from 20 to 35 once. Previously consumed attempts and all request history are unchanged. Generation remains disabled.\n"
    : "The 20-to-35 extension was already applied. No additional capacity was added.\n");
}

main().catch(error => {
  process.stderr.write(`${error.code || error.message || "Quota extension failed"}\n`);
  process.exitCode = 1;
});
