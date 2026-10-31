import assert from "node:assert/strict";
import { EXTEND_QUOTA_TO_35_ONCE, EXTEND_QUOTA_TO_50_ONCE, INITIALIZE_QUOTA, RESERVE_GENERATION, TRANSITION_GENERATION } from "../../src/services/generationQuotaScripts";

/** Atomic in-memory Redis REST simulation; never contacts a provider. */
export function mockQuotaRedis() {
  const hashes = new Map<string, Map<string, string>>();
  const state = { unavailable: false, loseNextReply: false, expiring: false, commands: 0 };
  const fetcher: typeof fetch = async (_input, init) => {
    state.commands++;
    if (state.unavailable) throw new Error("Simulated store outage");
    const [command, script, count, key, field, payload] = JSON.parse(String(init?.body)) as string[];
    assert.equal(command, "EVAL"); assert.equal(count, "1");
    let hash = hashes.get(key!);
    let result: string[];
    if (script === INITIALIZE_QUOTA) {
      if (hash) result = ["EXISTS"];
      else { hashes.set(key!, new Map([["schema", "1"], ["limit", "5"], ["used", "0"]])); result = ["INITIALIZED"]; }
    } else if (!hash) result = ["UNINITIALIZED"];
    else if (script === EXTEND_QUOTA_TO_35_ONCE) {
      const used = Number(hash.get("used"));
      const limit = hash.get("limit");
      const extension15 = hash.get("extension_15_applied");
      const extension15At = hash.get("extension_15_applied_at");
      const extension20To35 = hash.get("extension_20_to_35_applied");
      const extension20To35At = hash.get("extension_20_to_35_applied_at");
      const historyFields = [...hash.keys()].filter(field =>
        field.startsWith("request:") || field.startsWith("revision:"));
      const validHistoryField = (field: string) => {
        const id = field.startsWith("request:") ? field.slice(8)
          : field.startsWith("revision:") ? field.slice(9) : "";
        const compact = id.replaceAll("-", "");
        return id.length === 36 && compact.length === 32 && /^[\da-f]+$/i.test(compact)
          && [8, 13, 18, 23].every(index => id[index] === "-");
      };
      const validEntry = (raw: string | undefined) => {
        try {
          const entry = JSON.parse(raw ?? "") as Record<string, unknown>;
          const allowed = new Set(["customerId", "token", "fingerprint", "createdAt", "state", "proposal"]);
          const isUuid = (value: unknown) => typeof value === "string"
            && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
          const keys = Object.keys(entry);
          return keys.length >= 5 && keys.length <= 6 && keys.every(key => allowed.has(key))
            && isUuid(entry.customerId) && isUuid(entry.token)
            && typeof entry.fingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.fingerprint)
            && typeof entry.createdAt === "string" && entry.createdAt.length > 0
            && ["reserved", "ready", "saved", "failed"].includes(String(entry.state))
            && (!["ready", "saved"].includes(String(entry.state))
              || (typeof entry.proposal === "object" && entry.proposal !== null && !Array.isArray(entry.proposal)));
        } catch { return false; }
      };
      const knownFields = new Set([
        "schema", "limit", "used", "extension_15_applied", "extension_15_applied_at",
        "extension_20_to_35_applied", "extension_20_to_35_applied_at",
      ]);
      const unknownFields = [...hash.keys()].filter(field =>
        !knownFields.has(field) && !validHistoryField(field));
      if (state.expiring || hash.get("schema") !== "1" || !hash.has("used") || !Number.isInteger(used) || used < 0 || used > 35) result = ["CORRUPT"];
      else if (hash.has("extension_10_applied")) result = ["CONFLICT"];
      else if (limit === "35" && extension15 === "1" && extension15At && extension15At !== ""
        && extension20To35 === "1" && extension20To35At && extension20To35At !== "" && used >= 5) {
        if (unknownFields.length > 0 || historyFields.length !== used || hash.size !== used + 7) result = ["CORRUPT"];
        else result = ["ALREADY_APPLIED"];
      }
      else if (limit !== "20" || extension15 !== "1" || !extension15At || extension15At === "" || extension20To35 !== undefined
        || extension20To35At !== undefined || used < 5 || used > 20) result = ["CONFLICT"];
      else if (unknownFields.length > 0 || historyFields.length !== used
        || historyFields.some(field => !validEntry(hash.get(field)))) result = ["CORRUPT"];
      else if (hash.size !== used + 5) result = ["CORRUPT"];
      else {
        hash.set("limit", "35"); hash.set("extension_20_to_35_applied", "1");
        hash.set("extension_20_to_35_applied_at", field!); result = ["EXTENDED"];
      }
    } else if (script === EXTEND_QUOTA_TO_50_ONCE) {
      const used = Number(hash.get("used"));
      const limit = hash.get("limit");
      const marker15 = hash.get("extension_15_applied");
      const marker15At = hash.get("extension_15_applied_at");
      const marker20To35 = hash.get("extension_20_to_35_applied");
      const marker20To35At = hash.get("extension_20_to_35_applied_at");
      const marker35To50 = hash.get("extension_35_to_50_applied");
      const marker35To50At = hash.get("extension_35_to_50_applied_at");
      const historyFields = [...hash.keys()].filter(key => key.startsWith("request:") || key.startsWith("revision:"));
      const validUuid = (id: unknown) => typeof id === "string"
        && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);
      const validHistoryField = (field: string) => {
        const id = field.startsWith("request:") ? field.slice(8)
          : field.startsWith("revision:") ? field.slice(9) : "";
        return validUuid(id);
      };
      const validEntry = (raw: string | undefined) => {
        try {
          const entry = JSON.parse(raw ?? "") as Record<string, unknown>;
          const allowed = new Set(["customerId", "token", "fingerprint", "createdAt", "state", "proposal"]);
          const keys = Object.keys(entry);
          return keys.length >= 5 && keys.length <= 6 && keys.every(key => allowed.has(key))
            && validUuid(entry.customerId) && validUuid(entry.token)
            && typeof entry.fingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.fingerprint)
            && typeof entry.createdAt === "string" && entry.createdAt.length > 0
            && ["reserved", "ready", "saved", "failed"].includes(String(entry.state))
            && (!["ready", "saved"].includes(String(entry.state))
              || (typeof entry.proposal === "object" && entry.proposal !== null && !Array.isArray(entry.proposal)));
        } catch { return false; }
      };
      const knownFields = new Set([
        "schema", "limit", "used", "extension_15_applied", "extension_15_applied_at",
        "extension_20_to_35_applied", "extension_20_to_35_applied_at",
        "extension_35_to_50_applied", "extension_35_to_50_applied_at",
      ]);
      const unknownFields = [...hash.keys()].filter(key =>
        !knownFields.has(key) && !validHistoryField(key));
      const commonMarkersValid = marker15 === "1" && Boolean(marker15At)
        && marker20To35 === "1" && Boolean(marker20To35At)
        && !hash.has("extension_10_applied");
      const historyValid = historyFields.length === used
        && historyFields.every(field => validHistoryField(field) && validEntry(hash.get(field)));
      const alreadyApplied = limit === "50" && marker35To50 === "1" && Boolean(marker35To50At);
      const eligible = limit === "35" && marker35To50 === undefined && marker35To50At === undefined && used <= 35;
      if (state.expiring || hash.get("schema") !== "1" || !hash.has("used") || hash.get("used") !== String(used)
          || !Number.isInteger(used) || used < 5 || used > 50) result = ["CORRUPT"];
      else if (!commonMarkersValid || (!alreadyApplied && !eligible)) result = ["CONFLICT"];
      else if (unknownFields.length > 0 || !historyValid) result = ["CORRUPT"];
      else if (alreadyApplied) {
        result = hash.size === used + 9 ? ["ALREADY_APPLIED"] : ["CORRUPT"];
      } else if (hash.size !== used + 7) result = ["CORRUPT"];
      else {
        hash.set("limit", "50");
        hash.set("extension_35_to_50_applied", "1");
        hash.set("extension_35_to_50_applied_at", field!);
        result = ["EXTENDED"];
      }
    }
    else if (script === RESERVE_GENERATION) {
      const used = Number(hash.get("used"));
      const limit = hash.get("limit");
      const historyFields = [...hash.keys()].filter(key => key.startsWith("request:") || key.startsWith("revision:"));
      const validUuid = (value: unknown) => typeof value === "string"
        && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
      const validEntry = (raw: string | undefined) => {
        try {
          const entry = JSON.parse(raw ?? "") as Record<string, unknown>;
          const keys = Object.keys(entry);
          return keys.length >= 5 && keys.length <= 6
            && keys.every(key => ["customerId", "token", "fingerprint", "createdAt", "state", "proposal"].includes(key))
            && validUuid(entry.customerId) && validUuid(entry.token)
            && typeof entry.fingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.fingerprint)
            && typeof entry.createdAt === "string" && entry.createdAt.length > 0
            && ["reserved", "ready", "saved", "failed"].includes(String(entry.state))
            && (!["ready", "saved"].includes(String(entry.state))
              || (typeof entry.proposal === "object" && entry.proposal !== null && !Array.isArray(entry.proposal)));
        } catch { return false; }
      };
      if (hash.get("schema") !== "1" || !["5", "20", "35", "50"].includes(limit!) || !hash.has("used") || !Number.isInteger(used) || used < 0 || used > Number(limit)
        || (limit === "20" && (hash.get("extension_15_applied") !== "1" || hash.has("extension_10_applied") || used < 5))
        || (limit === "35" && (hash.get("extension_15_applied") !== "1" || !hash.get("extension_15_applied_at")
          || hash.get("extension_15_applied_at") === "" || hash.get("extension_20_to_35_applied") !== "1"
          || !hash.get("extension_20_to_35_applied_at") || hash.get("extension_20_to_35_applied_at") === ""
          || hash.has("extension_10_applied") || used < 5))
        || (limit === "50" && (hash.get("extension_15_applied") !== "1" || !hash.get("extension_15_applied_at")
          || hash.get("extension_15_applied_at") === "" || hash.get("extension_20_to_35_applied") !== "1"
          || !hash.get("extension_20_to_35_applied_at") || hash.get("extension_20_to_35_applied_at") === ""
          || hash.get("extension_35_to_50_applied") !== "1" || !hash.get("extension_35_to_50_applied_at")
          || hash.get("extension_35_to_50_applied_at") === "" || hash.has("extension_10_applied") || used < 5
          || hash.get("used") !== String(used) || state.expiring || hash.size !== used + 9 || historyFields.length !== used
          || historyFields.some(historyField => !validEntry(hash.get(historyField)))))) result = ["CORRUPT"];
      else if (hash.has(field!)) result = ["EXISTING", hash.get(field!)!];
      else if (used >= Number(limit)) result = ["EXHAUSTED"];
      else { hash.set("used", String(used + 1)); hash.set(field!, payload!); result = ["RESERVED", payload!]; }
    } else {
      assert.equal(script, TRANSITION_GENERATION);
      const old = hash.get(field!);
      if (!old) result = ["CONFLICT"];
      else {
        const previous = JSON.parse(old); const next = JSON.parse(payload!);
        const matches = previous.token === next.token && previous.customerId === next.customerId && previous.fingerprint === next.fingerprint;
        const allowed = (previous.state === "reserved" && ["ready", "failed"].includes(next.state))
          || (previous.state === "ready" && ["saved", "failed"].includes(next.state));
        if (matches && previous.state === "saved" && next.state === "saved") result = ["OK"];
        else if (!matches || !allowed) result = ["CONFLICT"];
        else { hash.set(field!, payload!); result = ["OK"]; }
      }
    }
    // No awaits above: each simulated EVAL is one indivisible operation.
    if (state.loseNextReply) { state.loseNextReply = false; throw new Error("Acknowledgement lost after commit"); }
    return Response.json({ result });
  };
  return { hashes, state, fetcher };
}
