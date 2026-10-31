import { generationQuota } from "../artifacts/api-server/src/services/generationQuota";

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--approve-50-total-attempts") {
    throw new Error("Explicit owner action required: --approve-50-total-attempts. No quota operation was performed.");
  }
  if (process.env.EVENTFLOW_LIVE_GENERATION_ENABLED !== "false"
      || process.env.EVENTFLOW_MVP_INSERT_VERIFIED !== "false") {
    throw new Error("Both generation activation flags must be explicitly set to false before extending the budget.");
  }
  const quota = generationQuota(process.env);
  if (!quota) throw new Error("Configure the existing server-only Redis REST credentials first.");
  const result = await quota.extendToFiftyOnce();
  process.stdout.write(result === "extended"
    ? "Limit increased from 35 to 50 once. Previously consumed attempts and all request history are unchanged. Generation remains disabled.\n"
    : "The 35-to-50 extension was already applied. No additional capacity was added.\n");
}

main().catch(error => {
  process.stderr.write(`${error.code || error.message || "Quota extension failed"}\n`);
  process.exitCode = 1;
});
