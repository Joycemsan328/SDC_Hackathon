import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import { test } from "node:test";
import { createSubmissionGenerationRouter } from "../src/routes/submissionGeneration";
import { SubmissionProposalRepository, type SubmissionRepository } from "../src/services/submissionProposals";
import { mapSavedRequestToProposalInput, type CustomerRequestRow } from "../src/services/customerSupabase";
import type { GeneratedProposal } from "../src/services/proposalGenerator";
import { RedisGenerationQuota, type GenerationQuota } from "../src/services/generationQuota";
import { mockQuotaRedis } from "./helpers/quotaRedis";
import { DEMO_QUOTA_KEY, INITIALIZE_QUOTA } from "../src/services/generationQuotaScripts";
import { SubmissionError } from "../src/services/submissionProposals";
import { createHash, randomUUID } from "node:crypto";

// Injected mocks only. No Supabase writes, real accounts, or RunPod calls.
const customerId = "56beec8f-5031-44e9-b60c-576c1584042a";
const requestId = "45386295-f36c-4ef6-8f4c-ae9304128015";
const request: CustomerRequestRow = {
  id: requestId, customer_id: customerId, customer_name: "Mock customer",
  email: null, phone: null, event_name: "Mock dinner", event_type: "Birthday",
  event_date: "2027-04-15", event_time: null, guests: 20, budget: 1000,
  services: ["Catering"], notes: "Location: Bangsar, Kuala Lumpur\n\nOriginal requirements",
  status: "New", created_at: null, venue_id: null, event_end_time: null,
};
const plan = {
  id: "A" as const, title: "Mock garden supper", concept: "A relaxed outdoor meal around one shared table.", theme: "Garden",
  timeline: [
    { time: "5pm", activity: "Set up one shared dining table" },
    { time: "6pm", activity: "Welcome guests with background music" },
    { time: "7pm", activity: "Serve a set-menu dinner" },
  ], venue: { name: "Suggested garden venue type", setup: "Simple outdoor dining layout." },
  catering: "Set-menu dinner for 20 guests.", services: ["Catering", "Simple styling", "Background music"],
  costBreakdown: [
    { item: "Dinner", description: "Set-menu food allowance for 20", amountMYR: 60 },
    { item: "Styling", description: "Simple table details", amountMYR: 15 },
    { item: "Sound", description: "Background speaker allowance", amountMYR: 10 },
    { item: "Venue", description: "Unconfirmed garden venue estimate", amountMYR: 15 },
  ],
  totalEstimatedMYR: 100, assumptions: ["Guest count remains 20."],
  unconfirmedCosts: ["Venue price and availability require confirmation."],
};
const planB: GeneratedProposal["plans"][number] = {
  id: "B", title: "Mock indoor lounge", concept: "A social indoor dinner with a separate seating and activity zone.", theme: "Warm garden",
  timeline: [
    { time: "4pm", activity: "Arrange separate lounge seating" },
    { time: "5pm", activity: "Welcome guests with acoustic music" },
    { time: "6pm", activity: "Serve a family-style dinner" },
    { time: "8pm", activity: "Open the dessert and conversation lounge" },
  ], venue: { name: "Suggested indoor venue type", setup: "Dining tables with a separate lounge zone." },
  catering: "Family-style dinner for 20 guests.", services: ["Catering", "Lounge seating", "Acoustic music"],
  costBreakdown: [
    { item: "Dinner", description: "Family-style food allowance for 20", amountMYR: 50 },
    { item: "Lounge", description: "Separate lounge furniture estimate", amountMYR: 20 },
    { item: "Music", description: "Acoustic performer estimate", amountMYR: 15 },
    { item: "Venue", description: "Unconfirmed indoor venue estimate", amountMYR: 15 },
  ],
  totalEstimatedMYR: 100, assumptions: ["The venue can provide a separate lounge area."],
  unconfirmedCosts: ["Venue and performer price and availability require confirmation."],
};
const proposal: GeneratedProposal = {
  recommendation: "Mock recommendation comparing a garden dinner and an indoor lounge experience.",
  plans: [plan, planB],
};
const receipt = { requestId, revision: 1, persistence: "created" as const, workflowState: "business_review" as const };
function fixture(ledger = mockQuotaRedis()) {
  // Initialize the simulated hash synchronously; no real Redis is contacted.
  void ledger.fetcher("https://mock.invalid", { body: JSON.stringify(["EVAL", INITIALIZE_QUOTA, "1", "eventflow:submission-demo:quota"]) });
  const calls = { generated: 0, inserted: 0, preflight: 0 };
  const quota = new RedisGenerationQuota("https://quota-test.upstash.io", "fake", ledger.fetcher) as GenerationQuota | null;
  const repository: SubmissionRepository = {
    find: async () => null,
    preflight: async () => { calls.preflight++; },
    insert: async (saved, pair) => {
      assert.equal(saved.id, requestId); assert.equal(pair.plans[1].id, "B");
      calls.inserted++; return receipt;
    },
  };
  return {
    env: { EVENTFLOW_MVP_INSERT_VERIFIED: "true", EVENTFLOW_LIVE_GENERATION_ENABLED: "true" },
    customers: { loadOwnedRequest: async () => ({ customerId, request }) },
    generator: { generate: async () => { calls.generated++; await new Promise(resolve => setTimeout(resolve, 15)); return proposal; } },
    repository, calls, ledger,
    quota,
  };
}
async function withServer(deps: Parameters<typeof createSubmissionGenerationRouter>[0], run: (post: (body?: unknown, token?: string) => Promise<Response>) => Promise<void>) {
  const app = express(); app.use(express.json()); app.use("/api", createSubmissionGenerationRouter(deps));
  const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await run((body = { requestId }, token = "mock-customer") => fetch(`http://127.0.0.1:${address.port}/api/proposals/generate-persisted`, {
      method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
test("submission mock E2E: verified request -> mock AI -> pair persistence -> metadata only", async () => {
  const f = fixture();
  await withServer(f, async post => {
    const response = await post(); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), receipt);
    assert.deepEqual(f.calls, { generated: 1, inserted: 1, preflight: 1 });
  });
});
test("submission rejects unauthenticated calls and arbitrary browser plan content", async () => {
  const f = fixture();
  await withServer(f, async post => {
    assert.equal((await post({ requestId }, "")).status, 401);
    assert.equal((await post({ requestId, plans: proposal.plans })).status, 400);
    assert.equal(f.calls.generated, 0);
  });
});
test("submission returns existing drafts without regenerating or requiring live approval", async () => {
  const f = fixture(); f.env = {} as typeof f.env;
  f.repository.find = async () => ({ ...receipt, persistence: "existing" });
  await withServer(f, async post => {
    const response = await post(); assert.equal(response.status, 200);
    assert.equal((await response.json()).persistence, "existing");
    assert.equal(f.calls.generated, 0); assert.equal(f.calls.inserted, 0);
  });
});
test("submission live safety gates and missing credentials prevent inference", async () => {
  const f = fixture(); f.env = {} as typeof f.env;
  await withServer(f, async post => {
    const response = await post(); assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "LIVE_GENERATION_NOT_APPROVED");
  });
  await withServer({ ...f, repository: null }, async post => {
    assert.equal((await post()).status, 503);
  });
  assert.equal(f.calls.generated, 0);
});
test("submission schema preflight failure prevents inference", async () => {
  const f = fixture(); f.repository.preflight = async () => { throw new Error("mock schema mismatch"); };
  await withServer(f, async post => { assert.equal((await post()).status, 503); });
  assert.equal(f.calls.generated, 0); assert.equal(f.calls.inserted, 0);
});
test("saved budgets below RM1 are rejected before quota reservation", async () => {
  const f = fixture();
  f.customers.loadOwnedRequest = async () => ({ customerId, request: { ...request, budget: 0.99 } });
  await withServer(f, async post => {
    const response = await post();
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "BUDGET_BELOW_MINIMUM");
  });
  assert.equal(f.calls.preflight, 0);
  assert.equal(f.calls.generated, 0);
  assert.equal(f.calls.inserted, 0);
  assert.equal(f.ledger.state.commands, 1, "only the fixture initialization ran; no reservation occurred");
  assert.equal(f.ledger.hashes.get(DEMO_QUOTA_KEY)?.get("used"), "0");
});
test("unsupported saved locations are rejected before quota reservation or AI generation", async () => {
  const f = fixture();
  f.customers.loadOwnedRequest = async () => ({
    customerId,
    request: { ...request, notes: "Location: George Town, Penang\n\nOriginal requirements" },
  });
  await withServer(f, async post => {
    const response = await post();
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      code: "UNSUPPORTED_EVENT_LOCATION",
      error: "EventFlow AI currently supports event planning in Kuala Lumpur and Selangor only.",
    });
  });
  assert.equal(f.calls.preflight, 0);
  assert.equal(f.calls.generated, 0);
  assert.equal(f.calls.inserted, 0);
  assert.equal(f.ledger.state.commands, 1, "only fixture initialization ran; no quota reservation occurred");
  assert.equal(f.ledger.hashes.get(DEMO_QUOTA_KEY)?.get("used"), "0");
});
test("submission coalesces concurrent retries into one mock AI call and insert", async () => {
  const f = fixture();
  await withServer(f, async post => {
    const responses = await Promise.all([post(), post()]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
  });
  assert.equal(f.calls.generated, 1); assert.equal(f.calls.inserted, 1);
});
test("submission rejects malformed generated price items before any insert", async () => {
  const f = fixture();
  f.generator.generate = async () => ({
    ...proposal,
    plans: [
      { ...plan, costBreakdown: [{ ...plan.costBreakdown[0]!, amountMYR: -1 }, ...plan.costBreakdown.slice(1)] },
      proposal.plans[1],
    ],
  });
  await withServer(f, async post => { assert.equal((await post()).status, 422); });
  assert.equal(f.calls.inserted, 0);
});
test("submission saves valid over-budget Plan A/B estimates and preserves the saved Customer budget", async () => {
  const f = fixture();
  let persistedPlans: GeneratedProposal["plans"] | undefined;
  f.repository.insert = async (saved, pair) => {
    assert.equal(saved.budget, request.budget);
    persistedPlans = structuredClone(pair.plans);
    f.calls.inserted++;
    return receipt;
  };
  f.generator.generate = async () => {
    f.calls.generated++;
    return {
      ...proposal,
      plans: [
        { ...plan, costBreakdown: [{ ...plan.costBreakdown[0]!, amountMYR: 1_200 }, ...plan.costBreakdown.slice(1)] },
        proposal.plans[1],
      ],
    };
  };
  await withServer(f, async post => {
    const first = await post();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), receipt);
    const retry = await post();
    assert.equal(retry.status, 409);
    assert.equal((await retry.json()).code, "GENERATION_ALREADY_ATTEMPTED");
  });
  assert.equal(f.calls.generated, 1);
  assert.equal(f.calls.inserted, 1);
  assert.ok(persistedPlans);
  assert.ok(persistedPlans[0]!.totalEstimatedMYR > request.budget);
  assert.equal(persistedPlans[0]!.totalEstimatedMYR,
    persistedPlans[0]!.costBreakdown.reduce((sum, line) => sum + line.amountMYR, 0));
  assert.equal(request.budget, 1_000);
  assert.equal(f.ledger.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});
test("submission persists evidence-backed canonical services without changing generated prices", async () => {
  const f = fixture();
  f.customers.loadOwnedRequest = async () => ({
    customerId, request: { ...request, services: ["Catering", "Equipment"] },
  });
  const generated = structuredClone(proposal);
  generated.plans.forEach(plan => { plan.costBreakdown[2]!.description = "PA system and microphones"; });
  f.generator.generate = async () => { f.calls.generated++; return generated; };
  f.repository.insert = async (_saved, pair) => {
    for (const [index, plan] of pair.plans.entries()) {
      assert.ok(plan.services.includes("Equipment"));
      assert.ok(plan.services.includes("Catering"));
      assert.deepEqual(plan.costBreakdown, generated.plans[index]!.costBreakdown);
      assert.equal(plan.totalEstimatedMYR, 100);
    }
    f.calls.inserted++;
    return receipt;
  };
  await withServer(f, async post => { assert.equal((await post()).status, 200); });
  assert.equal(f.calls.generated, 1);
  assert.equal(f.calls.inserted, 1);
  assert.equal(f.ledger.hashes.get(DEMO_QUOTA_KEY)?.get("used"), "1");
});
test("genuinely missing service consumes only the original attempt and never triggers a paid retry", async () => {
  const f = fixture();
  f.customers.loadOwnedRequest = async () => ({
    customerId, request: { ...request, services: ["Photography"] },
  });
  await withServer(f, async post => {
    const first = await post();
    assert.equal(first.status, 422);
    assert.equal((await first.json()).code, "REQUESTED_SERVICE_MISSING");
    const repeat = await post();
    assert.equal(repeat.status, 409);
    assert.equal((await repeat.json()).code, "GENERATION_ALREADY_ATTEMPTED");
  });
  assert.equal(f.calls.generated, 1);
  assert.equal(f.calls.inserted, 0);
  assert.equal(f.ledger.hashes.get(DEMO_QUOTA_KEY)?.get("used"), "1");
});
test("invalid cached proposals are marked failed without another attempt or inference", async () => {
  const f = fixture();
  const input = mapSavedRequestToProposalInput(request);
  const identity = {
    requestId,
    customerId,
    fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  };
  const reservation = await f.quota!.reserve(identity);
  assert.equal(reservation.fresh, true);
  const invalidCachedProposal: GeneratedProposal = {
    ...proposal,
    plans: [{ ...plan, services: ["Catering"] }, proposal.plans[1]],
  };
  await f.quota!.cache(identity, reservation.entry, invalidCachedProposal);
  assert.equal(f.ledger.hashes.get(DEMO_QUOTA_KEY)?.get("used"), "1");

  await withServer(f, async post => {
    const first = await post();
    assert.equal(first.status, 422);
    assert.equal((await first.json()).code, "CACHED_PROPOSAL_INVALID");
    const repeat = await post();
    assert.equal(repeat.status, 409);
    assert.equal((await repeat.json()).code, "GENERATION_ALREADY_ATTEMPTED");
  });

  assert.equal(f.calls.generated, 0);
  assert.equal(f.calls.inserted, 0);
  assert.equal(f.ledger.hashes.get(DEMO_QUOTA_KEY)?.get("used"), "1", "invalid cache handling must not increment or refund quota");
  const stored = JSON.parse(f.ledger.hashes.get(DEMO_QUOTA_KEY)!.get(`request:${requestId}`)!);
  assert.equal(stored.state, "failed");
});
test("even enabled live flags cannot bypass a missing or unavailable shared quota", async () => {
  const f = fixture(); f.quota = null;
  await withServer(f, async post => {
    const response = await post(); assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "QUOTA_NOT_CONFIGURED");
  });
  const outage = fixture(); outage.ledger.state.unavailable = true;
  await withServer(outage, async post => { assert.equal((await post()).status, 503); });
  assert.equal(f.calls.generated + outage.calls.generated, 0);
});
test("independent router instances cannot start two paid jobs for one request", async () => {
  const a = fixture(); const b = fixture(a.ledger);
  await withServer(a, async postA => withServer(b, async postB => {
    const responses = await Promise.all([postA(), postB()]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  }));
  assert.equal(a.calls.generated + b.calls.generated, 1);
  assert.equal(a.calls.inserted + b.calls.inserted, 1);
});
test("server restart after generation failure never submits the same request again", async () => {
  const a = fixture();
  a.generator.generate = async () => { a.calls.generated++; throw new Error("mock provider failure"); };
  await withServer(a, async post => { assert.equal((await post()).status, 503); });
  const b = fixture(a.ledger);
  await withServer(b, async post => {
    const response = await post(); assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "GENERATION_ALREADY_ATTEMPTED");
  });
  assert.equal(a.calls.generated, 1); assert.equal(b.calls.generated, 0);
});
test("cached generated pair recovers after Supabase failure without another AI job", async () => {
  const a = fixture();
  a.repository.insert = async () => { a.calls.inserted++; throw new SubmissionError("PROPOSAL_SAVE_FAILED", 503, "mock persistence failure"); };
  await withServer(a, async post => { assert.equal((await post()).status, 503); });
  const b = fixture(a.ledger);
  await withServer(b, async post => { assert.equal((await post()).status, 200); });
  assert.equal(a.calls.generated, 1); assert.equal(b.calls.generated, 0);
  assert.equal(b.calls.inserted, 1);
});
test("lost cached-result acknowledgement recovers across routers without another job", async () => {
  const a = fixture();
  a.generator.generate = async () => { a.calls.generated++; a.ledger.state.loseNextReply = true; return proposal; };
  await withServer(a, async post => {
    const response = await post(); assert.equal(response.status, 503);
    const body = await response.json(); assert.equal(body.code, "QUOTA_UNAVAILABLE");
    assert.ok(body.error.includes("no additional paid job"));
  });
  const b = fixture(a.ledger);
  await withServer(b, async post => { assert.equal((await post()).status, 200); });
  assert.equal(a.calls.generated, 1); assert.equal(b.calls.generated, 0);
  assert.equal(b.calls.inserted, 1);
});
test("concurrent distinct requests across routers cannot exceed the five-job demo cap", async () => {
  const a = fixture(); const b = fixture(a.ledger);
  for (const f of [a, b]) {
    f.customers.loadOwnedRequest = async (_token?: string, id?: string) => ({ customerId, request: { ...request, id: id! } });
    f.repository.insert = async saved => { f.calls.inserted++; return { ...receipt, requestId: saved.id }; };
  }
  await withServer(a, async postA => withServer(b, async postB => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? postA : postB)({ requestId: randomUUID() })));
    assert.equal(responses.filter(response => response.status === 200).length, 5);
    assert.equal(responses.filter(response => response.status === 429).length, 7);
  }));
  assert.equal(a.calls.generated + b.calls.generated, 5);
});
test("ownership rejection occurs before shared quota reservation", async () => {
  const f = fixture(); const before = f.ledger.state.commands;
  f.customers.loadOwnedRequest = async () => ({ customerId: randomUUID(), request });
  await withServer(f, async post => { assert.equal((await post()).status, 404); });
  assert.equal(f.ledger.state.commands, before);
  assert.equal(f.calls.generated, 0);
});
test("repository uses one atomic INSERT with pending A/B, never upsert or customer bearer", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    if (init?.method === "POST") return new Response(null, { status: 201 });
    return Response.json([]);
  };
  const repository = new SubmissionProposalRepository("https://mock.invalid", "sb_secret_mock_only", fetcher);
  assert.deepEqual(await repository.insert(request, proposal), receipt);
  const insert = calls.find(call => call.init.method === "POST")!;
  const rows = JSON.parse(String(insert.init.body));
  assert.equal(rows.length, 2); assert.deepEqual(rows.map((row: { plan_key: string }) => row.plan_key), ["A", "B"]);
  assert.ok(rows.every((row: { status: string }) => row.status === "Pending Business Approval"));
  assert.equal(new Headers(insert.init.headers).get("authorization"), null);
  assert.equal(new Headers(insert.init.headers).get("prefer"), "return=minimal");
  assert.ok(!insert.url.includes("on_conflict"));
});
test("repository refuses partial existing data rather than overwriting", async () => {
  const repository = new SubmissionProposalRepository("https://mock.invalid", "mock", async () => Response.json([
    { id: "mock-a", request_id: requestId, revision: "1", plan_key: "A", status: "Pending Business Approval" },
  ]));
  await assert.rejects(repository.insert(request, proposal), /preserved/);
});
test("repository unique-conflict recovery returns existing pair without overwrite", async () => {
  let reads = 0; let inserts = 0;
  const repository = new SubmissionProposalRepository("https://mock.invalid", "mock", async (_url, init) => {
    if (init?.method === "POST") { inserts++; return new Response(null, { status: 409 }); }
    reads++;
    return Response.json(reads === 1 ? [] : ["A", "B"].map(key => ({
      id: `mock-${key}`, request_id: requestId, revision: "1", plan_key: key, status: "Awaiting Customer",
    })));
  });
  assert.equal((await repository.insert(request, proposal)).workflowState, "released");
  assert.equal(inserts, 1);
});
test("repository schema preflight rejects missing columns or extra required fields", async () => {
  const bad = new SubmissionProposalRepository("https://mock.invalid", "mock", async () => Response.json({ definitions: { proposals: { properties: {} } } }));
  await assert.rejects(bad.preflight(), /columns/);
});
