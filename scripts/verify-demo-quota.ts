import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generationQuota, RedisGenerationQuota, type GenerationIdentity } from "../artifacts/api-server/src/services/generationQuota";
import { DEMO_QUOTA_KEY } from "../artifacts/api-server/src/services/generationQuotaScripts";
import { GeneratedProposalSchema } from "../artifacts/api-server/src/services/proposalGenerator";

// Real Redis/Lua verification with synthetic data only. No Supabase or RunPod I/O.
async function main() {
  if (process.argv.slice(2).join(" ") !== "--redis-only-no-inference") throw new Error("Use --redis-only-no-inference");
  if (!generationQuota(process.env)) throw new Error("Configure the server-only Redis REST URL/token first.");
  const url = new URL(process.env.EVENTFLOW_QUOTA_REDIS_REST_URL!).origin;
  const token = process.env.EVENTFLOW_QUOTA_REDIS_REST_TOKEN!;
  const key = `${DEMO_QUOTA_KEY}:selftest:${randomUUID()}`;
  const service = () => new RedisGenerationQuota(url, token, fetch, key);
  const customerId = randomUUID();
  const identity = (): GenerationIdentity => ({ requestId: randomUUID(), customerId, fingerprint: "a".repeat(64) });
  const original = identity();
  try {
    await assert.rejects(service().reserve(original), { code: "QUOTA_NOT_INITIALIZED" });
    assert.equal(await service().initializeOnce(), "initialized");
    const same = await Promise.allSettled(Array.from({ length: 20 }, () => service().reserve(original)));
    const winners = same.filter(result => result.status === "fulfilled");
    assert.equal(winners.length, 1, "Exactly one server may claim the same request");
    for (const result of same) if (result.status === "rejected") assert.equal(result.reason.code, "GENERATION_IN_PROGRESS");
    assert.equal(winners[0]!.status, "fulfilled");
    if (winners[0]!.status !== "fulfilled") throw new Error("No winner");
    await service().failed(original, winners[0]!.value.entry);
    await assert.rejects(service().reserve(original), { code: "GENERATION_ALREADY_ATTEMPTED" });
    const inputs = Array.from({ length: 12 }, identity);
    const distinct = await Promise.allSettled(inputs.map(input => service().reserve(input)));
    assert.equal(distinct.filter(result => result.status === "fulfilled").length, 4, "Consumed failed job must not be refunded");
    for (const result of distinct) if (result.status === "rejected") assert.equal(result.reason.code, "DEMO_BUDGET_EXHAUSTED");
    const index = distinct.findIndex(result => result.status === "fulfilled");
    const reserved = distinct[index]!;
    if (reserved.status !== "fulfilled") throw new Error("No reserved request");
    const plan = {
      id: "A", title: "Quota self-test", concept: "Synthetic", theme: "Synthetic",
      timeline: [{ time: "6pm", activity: "Synthetic" }], venue: { name: "Synthetic", setup: "Synthetic" },
      catering: "Synthetic", services: ["Synthetic"], costBreakdown: [{ item: "Synthetic", description: "Synthetic", amountMYR: 1 }],
      totalEstimatedMYR: 1, assumptions: ["Synthetic"], unconfirmedCosts: [],
    };
    const proposal = GeneratedProposalSchema.parse({ recommendation: "Synthetic", plans: [plan, { ...plan, id: "B" }] });
    const ready = await service().cache(inputs[index]!, reserved.value.entry, proposal);
    const recovered = await service().reserve(inputs[index]!);
    assert.equal(recovered.fresh, false);
    assert.deepEqual(recovered.entry.proposal, proposal);
    await service().saved(inputs[index]!, ready);
    await assert.rejects(service().reserve(inputs[index]!), { code: "GENERATION_ALREADY_ATTEMPTED" });
    assert.equal(await service().initializeOnce(), "existing");
    await assert.rejects(service().reserve(identity()), { code: "DEMO_BUDGET_EXHAUSTED" });
    // Build a synthetic 20-limit state at the reported 14-used count.
    await command(["HSET", key, "limit", "20", "extension_15_applied", "1", "extension_15_applied_at", new Date().toISOString()]);
    const additionalToFourteen = await Promise.allSettled(Array.from({ length: 9 }, () => service().reserve(identity())));
    assert.equal(additionalToFourteen.filter(result => result.status === "fulfilled").length, 9);
    assert.equal(await command(["HGET", key, "used"]), "14");
    const historyBefore = await snapshotHistory();
    const extensions = await Promise.all(Array.from({ length: 15 }, () => service().extendToThirtyFiveOnce()));
    assert.equal(extensions.filter(result => result === "extended").length, 1);
    assert.equal(extensions.filter(result => result === "already-applied").length, 14);
    assert.equal(await command(["HGET", key, "used"]), "14", "Extension cannot refund prior consumption");
    assert.equal(await command(["HGET", key, "limit"]), "35");
    assert.equal(await command(["HGET", key, "extension_15_applied"]), "1");
    assert.equal(await command(["HGET", key, "extension_20_to_35_applied"]), "1");
    assert.deepEqual(await snapshotHistory(), historyBefore, "Extension must preserve every reservation entry");
    await assert.rejects(service().reserve(original), { code: "GENERATION_ALREADY_ATTEMPTED" });
    const additional = await Promise.allSettled(Array.from({ length: 30 }, () => service().reserve(identity())));
    assert.equal(additional.filter(result => result.status === "fulfilled").length, 21);
    for (const result of additional) if (result.status === "rejected") assert.equal(result.reason.code, "DEMO_BUDGET_EXHAUSTED");
    assert.equal(await command(["HGET", key, "used"]), "35");
    assert.equal(await service().extendToThirtyFiveOnce(), "already-applied");
    assert.equal(await service().initializeOnce(), "existing");
    await assert.rejects(service().reserve(identity()), { code: "DEMO_BUDGET_EXHAUSTED" });
    const ttl = await command(["PTTL", key]);
    assert.equal(ttl, -1, "Quota must have no expiry");
    process.stdout.write("PASS: isolated real Redis atomic claims, five-slot initialization, synthetic 20-limit ledger at 14 used, one-time 20-to-35 extension, 21 remaining reservations, preserved failures/history, idempotency, no reset, and no expiry. No inference or Supabase calls. Production ledger untouched.\n");
  } finally {
    // Delete ONLY this isolated synthetic test ledger, never the production ledger.
    assert.ok(key.startsWith(`${DEMO_QUOTA_KEY}:selftest:`));
    await command(["DEL", key]);
  }
  async function command(body: string[]) {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Redis verification request failed");
    const result = await response.json() as { result?: unknown; error?: unknown };
    if (result.error) throw new Error("Redis verification command failed");
    return result.result;
  }
  async function snapshotHistory(): Promise<Array<[string, unknown]>> {
    const fields = await command(["HKEYS", key]) as string[];
    const historyFields = fields.filter(field => field.startsWith("request:") || field.startsWith("revision:")).sort();
    return Promise.all(historyFields.map(async field => [field, await command(["HGET", key, field])] as [string, unknown]));
  }
}
main().catch(error => {
  process.stderr.write(`FAIL: ${error.code || error.name || "QUOTA_TEST_FAILED"}; no inference was performed.\n`);
  process.exitCode = 1;
});
