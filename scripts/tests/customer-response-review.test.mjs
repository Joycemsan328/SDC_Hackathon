// Isolated preparation tests. Reference contract + SQL source guards ONLY.
// Never imports app code, credentials, database clients, fetch, or RunPod.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../sql/eventflow-customer-responses.sql", import.meta.url), "utf8");

class ReferenceContract {
  responses = new Map();
  operations = new Map();
  locks = new Map();
  async submit(actor, request, pair, input) {
    const previous = this.locks.get(request.id) ?? Promise.resolve();
    let unlock;
    const gate = new Promise(resolve => { unlock = resolve; });
    this.locks.set(request.id, previous.then(() => gate));
    await previous;
    try {
      if (!actor || actor.role !== "customer" || actor.approved !== true
        || request.owner !== actor.id) throw new Error("unauthorized");
      const feedback = (input.feedback ?? "").trim();
      if (!input.operation || !/^[1-9][0-9]*$/.test(input.revision)
        || input.revision.length > 32) throw new Error("invalid");
      if (!["selection", "change_request"].includes(input.kind)
        || (input.feedback ?? "").length > 4000
        || (input.kind === "selection" && (!input.plan || feedback))
        || (input.kind === "change_request" && (input.plan || !feedback))) throw new Error("invalid");
      const key = `${request.id}:${input.revision}`;
      const existing = this.responses.get(key);
      if (existing) {
        if (existing.kind === input.kind && existing.plan === (input.plan ?? null)
          && existing.feedback === feedback) return existing;
        throw new Error("conflict");
      }
      const operation = `${actor.id}:${input.operation}`;
      if (this.operations.has(operation)) throw new Error("operation reused");
      if (pair.length !== 2 || pair.map(p => p.key).sort().join() !== "A,B"
        || pair.some(p => p.request !== request.id || p.revision !== input.revision
          || p.status !== "Awaiting Customer" || !p.content)
        || input.revision !== request.latest) throw new Error("unreleased");
      if (input.kind === "selection" && !pair.some(p => p.id === input.plan)) throw new Error("foreign plan");
      const response = Object.freeze({
        id: `response-${this.responses.size + 1}`, request: request.id,
        customer: actor.id, revision: input.revision, kind: input.kind,
        status: input.kind === "selection" ? "confirmed" : "changes_requested",
        plan: input.plan ?? null, feedback, timestamp: "server-time",
      });
      this.responses.set(key, response);
      this.operations.set(operation, response);
      return response;
    } finally { unlock(); }
  }
  read(actor) {
    if (!actor?.approved) return [];
    const staff = actor.role === "admin" || (actor.role === "staff" && actor.account === "business");
    return [...this.responses.values()].filter(r => staff || (actor.role === "customer" && r.customer === actor.id));
  }
}
const customer = { id: "owner", role: "customer", approved: true };
const request = { id: "request", owner: "owner", latest: "1" };
const pair = ["A", "B"].map(key => ({ id: key, key, request: request.id,
  revision: "1", status: "Awaiting Customer", content: { totalEstimatedMYR: key === "A" ? 9500 : 16000 } }));
const selection = (patch = {}) => ({ revision: "1", kind: "selection", plan: "A", operation: "operation", ...patch });

test("reference contract: approved owner confirms an existing approved plan without altering quotations", async () => {
  const store = new ReferenceContract(), before = JSON.stringify(pair);
  const response = await store.submit(customer, request, pair, selection());
  assert.equal(response.status, "confirmed");
  assert.equal(response.plan, "A");
  assert.equal(JSON.stringify(pair), before);
});
test("reference contract: unrelated, unapproved, anonymous and Business submitters are denied", async () => {
  for (const actor of [null, { ...customer, id: "other" }, { ...customer, approved: false },
    { ...customer, role: "staff", account: "business" }]) {
    const store = new ReferenceContract();
    await assert.rejects(store.submit(actor, request, pair, selection()), /unauthorized/);
    assert.equal(store.responses.size, 0);
  }
});
test("reference contract: pending, NULL-status, missing, duplicate or foreign plans are rejected", async () => {
  for (const rows of [pair.slice(0, 1), [pair[0], pair[0]],
    [pair[0], { ...pair[1], status: "Pending Business Approval" }],
    [pair[0], { ...pair[1], status: null }],
    [pair[0], { ...pair[1], request: "other" }]]) {
    await assert.rejects(new ReferenceContract().submit(customer, request, rows, selection()), /unreleased/);
  }
  await assert.rejects(new ReferenceContract().submit(customer, request, pair, selection({ plan: "foreign" })), /foreign plan/);
});
test("reference contract: retry returns original ID/time, including after approval state changes", async () => {
  const store = new ReferenceContract();
  const first = await store.submit(customer, request, pair, selection());
  const retry = await store.submit(customer, request, [], selection({ operation: "new-operation" }));
  assert.equal(first, retry);
  assert.equal(store.responses.size, 1);
});
test("reference contract: concurrent conflicting confirmations yield one response", async () => {
  const store = new ReferenceContract();
  const results = await Promise.allSettled([
    store.submit(customer, request, pair, selection()),
    store.submit(customer, request, pair, selection({ plan: "B", operation: "second" })),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(results.find(r => r.status === "rejected").reason.message, /conflict/);
  assert.equal(store.responses.size, 1);
});
test("reference contract: concurrent identical requests return the same response", async () => {
  const store = new ReferenceContract();
  const [a, b] = await Promise.all([
    store.submit(customer, request, pair, selection()),
    store.submit(customer, request, pair, selection()),
  ]);
  assert.equal(a, b);
});
test("reference contract: selection and change-request race cannot both succeed", async () => {
  const store = new ReferenceContract();
  const results = await Promise.allSettled([
    store.submit(customer, request, pair, selection()),
    store.submit(customer, request, pair, selection({
      kind: "change_request", plan: null, feedback: "Reduce guest count", operation: "change-operation",
    })),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(store.responses.size, 1);
});
test("reference contract: authorized feedback is saved without AI; invalid/foreign feedback is rejected", async () => {
  const change = selection({ kind: "change_request", plan: null, feedback: " Reduce catering costs " });
  const store = new ReferenceContract();
  const saved = await store.submit(customer, request, pair, change);
  assert.equal(saved.feedback, "Reduce catering costs");
  assert.equal(saved.status, "changes_requested");
  await assert.rejects(new ReferenceContract().submit({ ...customer, id: "other" }, request, pair, change), /unauthorized/);
  for (const feedback of [" ", "x".repeat(4001)]) {
    await assert.rejects(new ReferenceContract().submit(customer, request, pair, { ...change, feedback }), /invalid/);
  }
  await assert.rejects(store.submit(customer, request, pair, selection()), /conflict/);
});
test("reference contract: Business reads responses; unrelated Customers and revoked staff cannot", async () => {
  const store = new ReferenceContract();
  await store.submit(customer, request, pair, selection());
  assert.equal(store.read(customer).length, 1);
  assert.equal(store.read({ ...customer, id: "other" }).length, 0);
  assert.equal(store.read({ id: "staff", role: "staff", account: "business", approved: true }).length, 1);
  assert.equal(store.read({ id: "admin", role: "admin", approved: true }).length, 1);
  assert.equal(store.read({ id: "staff", role: "staff", account: "business", approved: false }).length, 0);
});
test("reference contract: stale revisions and reused operation IDs cannot produce a second response", async () => {
  const store = new ReferenceContract();
  await assert.rejects(store.submit(customer, { ...request, latest: "2" }, pair, selection()), /unreleased/);
  await store.submit(customer, request, pair, selection());
  const other = { ...request, id: "second" };
  await assert.rejects(store.submit(customer, other, pair.map(p => ({ ...p, request: "second" })), selection()), /operation reused/);
});
test("SQL source: transaction and owner-review STOP gate; no existing-table mutations", () => {
  const executable = sql.replace(/--[^\n]*/g, "");
  assert.match(executable, /begin;\s*set local eventflow\.customer_response_catalog_reviewed = 'no';/);
  assert.match(executable, /is distinct from 'yes'/);
  assert.match(executable, /commit;\s*$/);
  assert.doesNotMatch(executable, /(?:update|insert into|delete from|alter table)\s+public\.(requests|proposals|profiles|events)\b/i);
  assert.doesNotMatch(executable, /(?:runpod|http_post|accept_proposal|approve_ai_proposal_pair|eventflow_select_plan)/i);
});
test("SQL source: request lock precedes saved response check and insert; NULL statuses fail closed", () => {
  const lock = sql.indexOf("where r.id=p_request_id and r.customer_id=v_customer for update");
  assert.ok(lock > 0 && lock < sql.indexOf("select * into v_existing"));
  assert.ok(sql.indexOf("select * into v_existing") < sql.indexOf("insert into public.eventflow_customer_responses("));
  assert.match(sql, /p\.status is distinct from 'Awaiting Customer'/);
  assert.match(sql, /unique\(request_id,revision\)/);
  assert.match(sql, /unique\(customer_id,idempotency_key\)/);
});
test("SQL source: no direct client writes; definer path and RPC ACL are explicit", () => {
  const executable = sql.replace(/--[^\n]*/g, "");
  assert.match(executable, /enable row level security/);
  assert.match(executable, /revoke all on public\.eventflow_customer_responses from public,anon,authenticated/);
  assert.match(executable, /grant select on public\.eventflow_customer_responses to authenticated/);
  assert.doesNotMatch(executable, /grant\s+(?:insert|update|delete|all)\s+on public\.eventflow_customer_responses to authenticated/i);
  assert.match(executable, /security definer set search_path='' set row_security=off/);
  assert.match(executable, /revoke all on function public\.eventflow_submit_customer_response/);
  assert.match(executable, /grant execute on function public\.eventflow_submit_customer_response/);
  assert.doesNotMatch(executable, /create policy[^;]*\bfor (?:insert|update|delete)/i);
});
test("owner preflight source contains SELECT statements only; no RPC invocation or migration", () => {
  const preflight = readFileSync(new URL("../sql/eventflow-customer-responses-preflight.sql", import.meta.url), "utf8");
  const statements = preflight.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
  assert.ok(statements.length >= 10);
  for (const statement of statements) assert.match(statement, /^select\b/i);
  assert.doesNotMatch(preflight, /\bselect\s+public\.(?:accept_proposal|approve_ai_proposal_pair|eventflow_submit_customer_response)\s*\(/i);
});
