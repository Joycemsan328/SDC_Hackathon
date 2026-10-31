import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RedisGenerationQuota, generationQuota, type GenerationIdentity } from "../src/services/generationQuota";
import { DEMO_QUOTA_KEY, EXTEND_QUOTA_TO_50_ONCE, EXTEND_QUOTA_TO_35_ONCE, RESERVE_GENERATION } from "../src/services/generationQuotaScripts";
import { mockQuotaRedis } from "./helpers/quotaRedis";

function identity(): GenerationIdentity { return { requestId: randomUUID(), customerId: randomUUID(), fingerprint: "a".repeat(64) }; }
test("quota Lua sources retain the prior 35 cap and gate 50 on all three extension markers", () => {
  assert.match(EXTEND_QUOTA_TO_35_ONCE, /'limit', '35'/);
  assert.match(EXTEND_QUOTA_TO_50_ONCE, /'limit', '50'/);
  assert.match(EXTEND_QUOTA_TO_50_ONCE, /extension_15_applied/);
  assert.match(EXTEND_QUOTA_TO_50_ONCE, /extension_20_to_35_applied/);
  assert.match(EXTEND_QUOTA_TO_50_ONCE, /extension_35_to_50_applied/);
  assert.match(EXTEND_QUOTA_TO_50_ONCE, /redis\.call\('TTL', KEYS\[1\]\) ~= -1/);
  assert.match(RESERVE_GENERATION, /local usedRaw = redis\.call\('HGET', KEYS\[1\], 'used'\)/);
  assert.match(RESERVE_GENERATION, /limit ~= '50'/);
  assert.match(RESERVE_GENERATION, /extension_15_applied/);
  assert.match(RESERVE_GENERATION, /extension_20_to_35_applied/);
  assert.match(RESERVE_GENERATION, /extension_35_to_50_applied/);
});

function fixture() {
  const redis = mockQuotaRedis();
  const service = () => new RedisGenerationQuota("https://quota-test.upstash.io", "fake-server-secret", redis.fetcher);
  return { redis, service };
}
async function createValid35Ledger(
  quota: RedisGenerationQuota,
  service: () => RedisGenerationQuota,
  hashes: Map<string, Map<string, string>>,
) {
  await quota.initializeOnce();
  const hash = hashes.get(DEMO_QUOTA_KEY)!;
  for (let i = 0; i < 5; i++) await service().reserve(identity());
  hash.set("limit", "20");
  hash.set("extension_15_applied", "1");
  hash.set("extension_15_applied_at", "2026-01-01T00:00:00.000Z");
  for (let i = 0; i < 9; i++) await service().reserve(identity());
  assert.equal(await quota.extendToThirtyFiveOnce(), "extended");
  return hash;
}
test("quota fails closed before explicit initialization; initialization never resets used slots", async () => {
  const { redis, service } = fixture(); const quota = service();
  await assert.rejects(quota.reserve(identity()), { code: "QUOTA_NOT_INITIALIZED" });
  assert.equal(redis.hashes.size, 0);
  assert.equal(await quota.initializeOnce(), "initialized");
  await quota.reserve(identity());
  assert.equal(await quota.initializeOnce(), "existing");
  assert.equal(redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});
test("many simulated production instances share exactly five atomic slots", async () => {
  const { redis, service } = fixture();
  await service().initializeOnce();
  const attempts = await Promise.allSettled(Array.from({ length: 30 }, () => service().reserve(identity())));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 5);
  assert.equal(redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "5");
  for (const result of attempts) if (result.status === "rejected") assert.equal(result.reason.code, "DEMO_BUDGET_EXHAUSTED");
});
test("same request across instances/restarts obtains one attempt only", async () => {
  const { redis, service } = fixture(); const input = identity();
  await service().initializeOnce();
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => service().reserve(input)));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  await assert.rejects(service().reserve(input), { code: "GENERATION_IN_PROGRESS" });
  assert.equal(redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});
test("DB-issued revision tokens consume the same finite budget without replacing initial request history", async () => {
  const { redis, service } = fixture(); const original = identity();
  await service().initializeOnce();
  const initial = await service().reserve(original);
  await service().failed(original, initial.entry);
  const initialHistory = redis.hashes.get(DEMO_QUOTA_KEY)!.get(`request:${original.requestId}`);
  const revision2 = { ...original, reservationId: `revision:${randomUUID()}`, fingerprint: "b".repeat(64) };
  const revision3 = { ...original, reservationId: `revision:${randomUUID()}`, fingerprint: "c".repeat(64) };
  const repeated = await Promise.allSettled(Array.from({ length: 20 }, () => service().reserve(revision2)));
  assert.equal(repeated.filter(result => result.status === "fulfilled").length, 1);
  await service().reserve(revision3);
  assert.equal(redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "3");
  assert.equal(redis.hashes.get(DEMO_QUOTA_KEY)!.get(`request:${original.requestId}`), initialHistory);
  await assert.rejects(service().reserve(original), { code: "GENERATION_ALREADY_ATTEMPTED" });
  await assert.rejects(service().reserve({ ...original, reservationId: `request:${randomUUID()}` }), { code: "GENERATION_RESERVATION_INVALID" });
});
test("one-time extension preserves a 14-used ledger and atomically raises a valid 20-attempt cap to 35", async () => {
  const { redis, service } = fixture();
  const quota = service();
  await assert.rejects(quota.extendToThirtyFiveOnce(), { code: "QUOTA_NOT_INITIALIZED" });
  await quota.initializeOnce();
  await assert.rejects(quota.extendToThirtyFiveOnce(), { code: "QUOTA_EXTENSION_REFUSED" });

  const original = identity();
  const { entry } = await quota.reserve(original);
  await quota.failed(original, entry);
  for (let i = 0; i < 4; i++) await service().reserve(identity());
  const hash = redis.hashes.get(DEMO_QUOTA_KEY)!;
  hash.set("limit", "20");
  hash.set("extension_15_applied", "1");
  hash.set("extension_15_applied_at", "2026-01-01T00:00:00.000Z");
  for (let i = 0; i < 9; i++) await service().reserve(identity());
  assert.equal(hash.get("used"), "14");
  const history = [...hash].filter(([key]) => key.startsWith("request:") || key.startsWith("revision:"));

  const extensions = await Promise.all(Array.from({ length: 20 }, () => service().extendToThirtyFiveOnce()));
  assert.equal(extensions.filter(result => result === "extended").length, 1);
  assert.equal(extensions.filter(result => result === "already-applied").length, 19);
  assert.equal(hash.get("used"), "14");
  assert.equal(hash.get("limit"), "35");
  assert.equal(Number(hash.get("limit")) - Number(hash.get("used")), 21);
  assert.equal(hash.get("extension_15_applied"), "1");
  assert.equal(hash.get("extension_20_to_35_applied"), "1");
  assert.deepEqual([...hash].filter(([key]) => key.startsWith("request:") || key.startsWith("revision:")), history);
  await assert.rejects(service().reserve(original), { code: "GENERATION_ALREADY_ATTEMPTED" });

  const attempts = await Promise.allSettled(Array.from({ length: 30 }, () => service().reserve(identity())));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 21);
  for (const result of attempts) if (result.status === "rejected") assert.equal(result.reason.code, "DEMO_BUDGET_EXHAUSTED");
  assert.equal(hash.get("used"), "35");
  assert.deepEqual([...hash].filter(([key]) => key.startsWith("request:") || key.startsWith("revision:")).slice(0, history.length), history);
  assert.equal(await quota.extendToThirtyFiveOnce(), "already-applied");
  assert.equal(await quota.initializeOnce(), "existing");
  assert.equal(hash.get("used"), "35");
  await assert.rejects(service().reserve(identity()), { code: "DEMO_BUDGET_EXHAUSTED" });
});

test("quota extension rejects incomplete, unexpected, or mismatched 20-attempt ledgers without changing them", async () => {
  for (const mutation of [
    (hash: Map<string, string>) => hash.set("limit", "19"),
    (hash: Map<string, string>) => hash.delete("extension_15_applied_at"),
    (hash: Map<string, string>) => hash.set("unexpected_field", "unexpected"),
    (hash: Map<string, string>) => hash.set("used", "6"),
    (hash: Map<string, string>) => hash.set("extension_20_to_35_applied", "1"),
    (hash: Map<string, string>) => hash.set([...hash.keys()].find(key => key.startsWith("request:"))!, "not-json"),
  ]) {
    const { redis, service } = fixture();
    const quota = service();
    await quota.initializeOnce();
    for (let i = 0; i < 5; i++) await quota.reserve(identity());
    const hash = redis.hashes.get(DEMO_QUOTA_KEY)!;
    hash.set("limit", "20");
    hash.set("extension_15_applied", "1");
    hash.set("extension_15_applied_at", "2026-01-01T00:00:00.000Z");
    mutation(hash);
    const before = [...hash];
    await assert.rejects(quota.extendToThirtyFiveOnce());
    assert.deepEqual([...hash], before, "rejected ledger state must remain byte-for-byte unchanged");
  }
});

test("quota extension refuses an expiring ledger", async () => {
  const { redis, service } = fixture();
  const quota = service();
  await quota.initializeOnce();
  for (let i = 0; i < 5; i++) await quota.reserve(identity());
  const hash = redis.hashes.get(DEMO_QUOTA_KEY)!;
  hash.set("limit", "20");
  hash.set("extension_15_applied", "1");
  hash.set("extension_15_applied_at", "2026-01-01T00:00:00.000Z");
  const before = [...hash];
  redis.state.expiring = true;
  await assert.rejects(quota.extendToThirtyFiveOnce(), { code: "QUOTA_UNAVAILABLE" });
  assert.deepEqual([...hash], before);
});

test("one-time 35-to-50 extension is atomic, idempotent, and preserves used count and history", async () => {
  const { redis, service } = fixture();
  const quota = service();
  const hash = await createValid35Ledger(quota, service, redis.hashes);
  assert.equal(hash.get("used"), "14");
  const historyBefore = [...hash].filter(([field]) => field.startsWith("request:") || field.startsWith("revision:"));

  const results = await Promise.all(Array.from({ length: 20 }, () => service().extendToFiftyOnce()));
  assert.equal(results.filter(result => result === "extended").length, 1);
  assert.equal(results.filter(result => result === "already-applied").length, 19);
  assert.equal(hash.get("limit"), "50");
  assert.equal(hash.get("used"), "14");
  assert.equal(hash.get("extension_15_applied"), "1");
  assert.ok(hash.get("extension_15_applied_at"));
  assert.equal(hash.get("extension_20_to_35_applied"), "1");
  assert.ok(hash.get("extension_20_to_35_applied_at"));
  assert.equal(hash.get("extension_35_to_50_applied"), "1");
  assert.ok(hash.get("extension_35_to_50_applied_at"));
  assert.deepEqual(
    [...hash].filter(([field]) => field.startsWith("request:") || field.startsWith("revision:")),
    historyBefore,
  );

  const attempts = await Promise.allSettled(Array.from({ length: 40 }, () => service().reserve(identity())));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 36);
  for (const attempt of attempts) if (attempt.status === "rejected") {
    assert.equal(attempt.reason.code, "DEMO_BUDGET_EXHAUSTED");
  }
  assert.equal(hash.get("used"), "50");
  assert.deepEqual(
    [...hash].filter(([field]) => field.startsWith("request:") || field.startsWith("revision:")).slice(0, historyBefore.length),
    historyBefore,
  );
  await assert.rejects(service().reserve(identity()), { code: "DEMO_BUDGET_EXHAUSTED" });
  assert.equal(hash.get("used"), "50");
  assert.equal(redis.state.expiring, false, "the extension must not add expiry");
});

test("35-to-50 extension rejects corrupt, mismatched, or unexpected ledgers without mutation", async () => {
  const mutations: Array<(hash: Map<string, string>) => void> = [
    hash => hash.set("schema", "2"),
    hash => hash.set("used", "13"),
    hash => hash.set("used", "14.0"),
    hash => hash.set("extension_15_applied_at", ""),
    hash => hash.delete("extension_20_to_35_applied"),
    hash => hash.set("extension_35_to_50_applied", "1"),
    hash => hash.delete([...hash.keys()].find(field => field.startsWith("request:"))!),
    hash => hash.set([...hash.keys()].find(field => field.startsWith("request:"))!, "not-json"),
    hash => hash.set("unexpected-ledger-field", "unexpected"),
  ];
  for (const mutate of mutations) {
    const { redis, service } = fixture();
    const quota = service();
    const hash = await createValid35Ledger(quota, service, redis.hashes);
    mutate(hash);
    const before = [...hash];
    await assert.rejects(quota.extendToFiftyOnce());
    assert.deepEqual([...hash], before, "rejected extension must not modify any ledger field");
  }

  const { redis, service } = fixture();
  const hash = await createValid35Ledger(service(), service, redis.hashes);
  const before = [...hash];
  redis.state.expiring = true;
  await assert.rejects(service().extendToFiftyOnce());
  assert.deepEqual([...hash], before, "an expiring ledger must remain unchanged");
});

test("50-limit reservations fail closed unless all three extension histories and matching entries are valid", async () => {
  const mutations: Array<(hash: Map<string, string>) => void> = [
    hash => hash.delete("extension_15_applied_at"),
    hash => hash.set("extension_20_to_35_applied_at", ""),
    hash => hash.delete("extension_35_to_50_applied"),
    hash => hash.set("used", "14.0"),
    hash => hash.delete([...hash.keys()].find(field => field.startsWith("request:"))!),
    hash => hash.set([...hash.keys()].find(field => field.startsWith("request:"))!, "not-json"),
    hash => hash.set("unrecognized-field", "value"),
  ];
  for (const mutate of mutations) {
    const { redis, service } = fixture();
    const quota = service();
    const hash = await createValid35Ledger(quota, service, redis.hashes);
    await quota.extendToFiftyOnce();
    mutate(hash);
    const before = [...hash];
    await assert.rejects(service().reserve(identity()), { code: "QUOTA_UNAVAILABLE" });
    assert.deepEqual([...hash], before, "invalid 50-limit ledger must not consume or modify quota");
  }
});

test("unapproved and unlimited quota values fail closed", async () => {
  const { redis, service } = fixture();
  await service().initializeOnce();
  const hash = redis.hashes.get(DEMO_QUOTA_KEY)!;
  hash.set("limit", "15");
  await assert.rejects(service().reserve(identity()), { code: "QUOTA_UNAVAILABLE" });
  hash.set("extension_10_applied", "1");
  await assert.rejects(service().reserve(identity()), { code: "QUOTA_UNAVAILABLE" });
  hash.set("used", "5");
  for (const limit of ["0", "-1", "999999", "unlimited", "15.1", "15"]) {
    hash.set("limit", limit);
    await assert.rejects(service().reserve(identity()), { code: "QUOTA_UNAVAILABLE" });
    assert.equal(hash.get("used"), "5");
  }
  hash.set("limit", "5");
  await assert.rejects(service().extendToThirtyFiveOnce(), { code: "QUOTA_EXTENSION_REFUSED" });
  assert.equal(hash.get("limit"), "5", "Unexpected previous-extension markers must not be overwritten");
  hash.delete("extension_10_applied");
  hash.delete("limit");
  hash.set("limit", "5");
  hash.set("used", "5");
  await assert.rejects(service().extendToThirtyFiveOnce(), { code: "QUOTA_EXTENSION_REFUSED" });
  assert.equal(hash.get("limit"), "5", "Unexpected/missing request history must be rejected without extending");
  hash.set("limit", "35");
  await assert.rejects(service().reserve(identity()), { code: "QUOTA_UNAVAILABLE" });
  assert.equal(hash.get("used"), "5", "A 35-limit ledger without the exact extension markers must fail closed");
});
test("failed/uncertain attempts are not refunded, expired, or reclaimed", async () => {
  const { redis, service } = fixture(); const quota = service(); const input = identity();
  await quota.initializeOnce();
  const { entry } = await quota.reserve(input);
  await quota.failed(input, entry);
  await assert.rejects(service().reserve(input), { code: "GENERATION_ALREADY_ATTEMPTED" });
  assert.equal(redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
  const uncertain = identity(); redis.state.loseNextReply = true;
  await assert.rejects(quota.reserve(uncertain), { code: "QUOTA_UNAVAILABLE" });
  await assert.rejects(service().reserve(uncertain), { code: "GENERATION_IN_PROGRESS" });
  assert.equal(redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "2");
});
test("store outage, missing ledger, corruption and reservation mismatch all fail closed", async () => {
  const { redis, service } = fixture(); const quota = service(); const input = identity();
  await quota.initializeOnce(); await quota.reserve(input);
  await assert.rejects(quota.reserve({ ...input, customerId: randomUUID() }), { code: "GENERATION_RESERVATION_MISMATCH" });
  await assert.rejects(quota.reserve({ ...input, fingerprint: "b".repeat(64) }), { code: "GENERATION_RESERVATION_MISMATCH" });
  redis.state.unavailable = true;
  await assert.rejects(quota.reserve(identity()), { code: "QUOTA_UNAVAILABLE" });
  redis.state.unavailable = false; redis.hashes.get(DEMO_QUOTA_KEY)!.set("used", "-1");
  await assert.rejects(quota.reserve(identity()), { code: "QUOTA_UNAVAILABLE" });
  redis.hashes.clear();
  await assert.rejects(quota.reserve(identity()), { code: "QUOTA_NOT_INITIALIZED" });
});
test("Redis provider credentials/errors stay server-side and redirects are not followed", async () => {
  let inspected = false;
  const quota = new RedisGenerationQuota("https://quota-test.upstash.io", "fake-secret-do-not-leak", async (_url, init) => {
    inspected = true;
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fake-secret-do-not-leak");
    return Response.json({ error: "fake-secret-do-not-leak" });
  });
  await assert.rejects(quota.reserve(identity()), error => {
    assert.ok(error instanceof Error); assert.ok(!error.message.includes("fake-secret")); return true;
  });
  assert.equal(inspected, true);
  assert.equal(generationQuota({}), null);
  assert.equal(generationQuota({ EVENTFLOW_QUOTA_REDIS_REST_URL: "http://localhost", EVENTFLOW_QUOTA_REDIS_REST_TOKEN: "fake" }), null);
  assert.equal(generationQuota({ EVENTFLOW_QUOTA_REDIS_REST_URL: "https://quota-test.upstash.io@evil.invalid", EVENTFLOW_QUOTA_REDIS_REST_TOKEN: "fake" }), null);
});
test("operator initialization refuses implicit execution without touching a store", () => {
  const script = fileURLToPath(new URL("../../../scripts/initialize-demo-quota.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    env: { ...process.env, EVENTFLOW_QUOTA_REDIS_REST_URL: "", EVENTFLOW_QUOTA_REDIS_REST_TOKEN: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Explicit owner action required/);
});
test("quota extension CLI requires explicit approval and disabled generation flags", () => {
  const script = fileURLToPath(new URL("../../../scripts/extend-demo-quota.ts", import.meta.url));
  const env = { ...process.env, EVENTFLOW_QUOTA_REDIS_REST_URL: "", EVENTFLOW_QUOTA_REDIS_REST_TOKEN: "" };
  const implicit = spawnSync(process.execPath, ["--import", "tsx", script], { env, encoding: "utf8" });
  assert.equal(implicit.status, 1);
  assert.match(implicit.stderr, /Explicit owner action required/);
  for (const flag of ["EVENTFLOW_LIVE_GENERATION_ENABLED", "EVENTFLOW_MVP_INSERT_VERIFIED"]) {
    const active = spawnSync(process.execPath, ["--import", "tsx", script, "--approve-35-total-attempts"], {
      env: { ...env, [flag]: "true" }, encoding: "utf8",
    });
    assert.equal(active.status, 1);
    assert.match(active.stderr, /Keep both generation activation flags disabled/);
  }
});
test("50-attempt quota extension CLI requires explicit approval and both flags explicitly false", () => {
  const script = fileURLToPath(new URL("../../../scripts/extend-demo-quota-to-50.ts", import.meta.url));
  const env = {
    ...process.env,
    EVENTFLOW_QUOTA_REDIS_REST_URL: "",
    EVENTFLOW_QUOTA_REDIS_REST_TOKEN: "",
    EVENTFLOW_LIVE_GENERATION_ENABLED: "",
    EVENTFLOW_MVP_INSERT_VERIFIED: "",
  };
  const implicit = spawnSync(process.execPath, ["--import", "tsx", script], { env, encoding: "utf8" });
  assert.equal(implicit.status, 1);
  assert.match(implicit.stderr, /Explicit owner action required/);

  for (const overrides of [
    { EVENTFLOW_LIVE_GENERATION_ENABLED: "true" },
    { EVENTFLOW_MVP_INSERT_VERIFIED: "true" },
  ]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, "--approve-50-total-attempts"], {
      env: { ...env, EVENTFLOW_LIVE_GENERATION_ENABLED: "false", EVENTFLOW_MVP_INSERT_VERIFIED: "false", ...overrides },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be explicitly set to false/);
  }
  const approvedButOffline = spawnSync(process.execPath, ["--import", "tsx", script, "--approve-50-total-attempts"], {
    env: { ...env, EVENTFLOW_LIVE_GENERATION_ENABLED: "false", EVENTFLOW_MVP_INSERT_VERIFIED: "false" },
    encoding: "utf8",
  });
  assert.equal(approvedButOffline.status, 1);
  assert.match(approvedButOffline.stderr, /server-only Redis REST credentials/);
});
test("real-store self-test refuses missing credentials before any network operation", () => {
  const script = fileURLToPath(new URL("../../../scripts/verify-demo-quota.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", script, "--redis-only-no-inference"], {
    env: { ...process.env, EVENTFLOW_QUOTA_REDIS_REST_URL: "", EVENTFLOW_QUOTA_REDIS_REST_TOKEN: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no inference was performed/);
});
