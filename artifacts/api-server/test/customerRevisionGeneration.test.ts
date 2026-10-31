import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import { test } from "node:test";
import { createCustomerRevisionGenerationRouter } from "../src/routes/customerRevisionGeneration";
import {
  CustomerRevisionError,
  SupabaseCustomerRevisionGenerationRepository,
  composeRevisionRequest,
  type CustomerRevisionGenerationRepository,
  type RevisionAction,
} from "../src/services/customerRevisionGeneration";
import { mapSavedRequestToProposalInput, type CustomerRequestRow } from "../src/services/customerSupabase";
import { RedisGenerationQuota } from "../src/services/generationQuota";
import { DEMO_QUOTA_KEY } from "../src/services/generationQuotaScripts";
import { ProposalGenerationError, type GeneratedProposal, type ProposalRequest } from "../src/services/proposalGenerator";
import { mockQuotaRedis } from "./helpers/quotaRedis";

// Only injected mocks and local HTTP. Never connects to Supabase, Redis, or RunPod.
const customerId = "56beec8f-5031-44e9-b60c-576c1584042a";
const requestId = "45386295-f36c-4ef6-8f4c-ae9304128015";
const responseId = "86670ca3-81db-4f75-8a1b-08f4eb484107";
const request: CustomerRequestRow = {
  id: requestId, customer_id: customerId, customer_name: "Synthetic customer",
  email: null, phone: null, event_name: "Synthetic dinner", event_type: "Birthday",
  event_date: "2027-04-15", event_time: null, guests: 20, budget: 1000,
  services: ["Catering"], notes: "Location: Bangsar, Kuala Lumpur\n\nOriginal dinner requirements",
  status: "New", created_at: null, venue_id: null, event_end_time: null,
};
const previousProposal: GeneratedProposal = {
  recommendation: "Compare a relaxed garden meal with an indoor social lounge.",
  plans: [
    {
      id: "A", title: "Garden supper", concept: "A relaxed garden meal at one shared table.",
      theme: "Garden", venue: { name: "Garden venue type", setup: "One outdoor table with simple flower details." },
      catering: "Set-menu dinner for 20 guests.", services: ["Catering", "Simple styling", "Background music"],
      timeline: [
        { time: "5pm", activity: "Arrange one long outdoor dining table" },
        { time: "6pm", activity: "Welcome guests with soft recorded music" },
        { time: "7pm", activity: "Serve plated set-menu food" },
      ],
      costBreakdown: [
        { item: "Dinner", description: "Food allowance", amountMYR: 200 },
        { item: "Styling", description: "Simple table details", amountMYR: 50 },
        { item: "Sound", description: "Speaker allowance", amountMYR: 50 },
        { item: "Venue", description: "Unconfirmed outdoor venue estimate", amountMYR: 100 },
      ],
      totalEstimatedMYR: 400, assumptions: ["Guest count is 20."],
      unconfirmedCosts: ["Venue availability and estimate need confirmation."],
    },
    {
      id: "B", title: "Indoor lounge", concept: "An indoor social dinner with separate lounge and activity zones.",
      theme: "Warm evening", venue: { name: "Indoor lounge venue type", setup: "Round dining tables and a separate lounge seating area." },
      catering: "Family-style shared dinner for 20 guests.", services: ["Catering", "Lounge seating", "Acoustic music"],
      timeline: [
        { time: "4pm", activity: "Build a separate lounge seating area" },
        { time: "5pm", activity: "Welcome guests with an acoustic performance" },
        { time: "6pm", activity: "Serve family-style dishes and open a dessert corner" },
      ],
      costBreakdown: [
        { item: "Dinner", description: "Shared food allowance", amountMYR: 200 },
        { item: "Lounge", description: "Furniture allowance", amountMYR: 100 },
        { item: "Music", description: "Acoustic performance estimate", amountMYR: 100 },
        { item: "Venue", description: "Unconfirmed indoor venue estimate", amountMYR: 100 },
      ],
      totalEstimatedMYR: 500, assumptions: ["The venue provides a separate lounge."],
      unconfirmedCosts: ["Venue and performer rates require confirmation."],
    },
  ],
};
const generated = structuredClone(previousProposal);
generated.plans[0].catering = "Set-menu dinner for 40 guests within the unchanged budget.";
generated.plans[1].catering = "Family-style shared dinner for 40 guests within the unchanged budget.";

async function fixture(redis = mockQuotaRedis()) {
  const quota = new RedisGenerationQuota("https://mock.upstash.io", "FAKE", redis.fetcher);
  await quota.initializeOnce();
  const action: RevisionAction = {
    response_id: responseId, request_id: requestId, source_revision: "1",
    action_kind: "revision", next_revision: "2", status: "queued",
    generation_token: null, generation_error_code: null,
  };
  const calls = {
    generated: 0, stored: 0, claimed: 0,
    input: null as ProposalRequest | null,
    failStoreOnce: false,
    records: previousProposal.plans.map(plan => ({ revision: "1", status: "Awaiting Customer", plan: structuredClone(plan) })),
  };
  const repository: CustomerRevisionGenerationRepository = {
    startRevision: async (token, id) => {
      if (token !== "approved-staff") throw new CustomerRevisionError("BUSINESS_AUTHORIZATION_REQUIRED", 403, "Approved Business staff required.");
      assert.equal(id, action.response_id);
      return { ...action };
    },
    claimGeneration: async () => {
      calls.claimed++;
      if (action.status === "queued") {
        action.status = "generating";
        action.generation_token = randomUUID();
      }
      return { ...action };
    },
    loadContext: async current => ({
      action: current, request: structuredClone(request), input: mapSavedRequestToProposalInput(request),
      responseFeedback: "change to 40 guests", previousProposal: structuredClone(previousProposal),
    }),
    findPair: async (_id, revision) => calls.records.filter(row => row.revision === revision).length === 2
      ? { request_id: requestId, revision, persistence: "existing", workflow_state: "business_review" } : null,
    storePair: async (current, proposal) => {
      calls.stored++;
      if (calls.failStoreOnce) { calls.failStoreOnce = false; throw new CustomerRevisionError("SAVE_UNAVAILABLE", 503, "Synthetic persistence outage"); }
      assert.equal(current.generation_token, action.generation_token);
      if (!calls.records.some(row => row.revision === current.next_revision)) {
        calls.records.push(...proposal.plans.map(plan => ({
          revision: current.next_revision, status: "Pending Business Approval", plan: structuredClone(plan),
        })));
      }
      action.status = "business_review";
      return { request_id: requestId, revision: current.next_revision, persistence: "created", workflow_state: "business_review" };
    },
    markFailed: async (_current, errorCode) => { action.generation_error_code = errorCode; },
  };
  const generator = {
    generate: async (input: ProposalRequest, options?: { qualityProfile?: "submission" }) => {
      calls.generated++; calls.input = input;
      assert.equal(options?.qualityProfile, "submission");
      await new Promise(resolve => setTimeout(resolve, 20));
      return structuredClone(generated);
    },
  };
  return {
    env: {
      EVENTFLOW_MVP_INSERT_VERIFIED: "true",
      EVENTFLOW_LIVE_GENERATION_ENABLED: "true",
      EVENTFLOW_REVISION_GENERATION_ENABLED: "true",
    },
    repository, quota, generator, action, calls, redis,
  };
}

async function withServer(
  deps: Parameters<typeof createCustomerRevisionGenerationRouter>[0],
  run: (post: (token?: string, body?: unknown) => Promise<Response>) => Promise<void>,
) {
  const app = express(); app.use(express.json()); app.use("/api", createCustomerRevisionGenerationRouter(deps));
  const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await run((token = "approved-staff", body = { responseId }) => fetch(
      `http://127.0.0.1:${address.port}/api/business/revisions/generate`,
      {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      },
    ));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("revision mock E2E preserves source history, original budget, feedback and pending Business approval", async () => {
  const f = await fixture();
  const original = structuredClone(f.calls.records);
  await withServer(f, async post => {
    const response = await post();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { requestId, revision: "2", persistence: "created", workflowState: "business_review" });
    assert.equal(f.calls.generated, 1);
    assert.equal(f.calls.input?.budgetMYR, request.budget);
    assert.match(f.calls.input!.requirements, /Original dinner requirements/);
    assert.match(f.calls.input!.requirements, /change to 40 guests/);
    assert.match(f.calls.input!.requirements, /Garden supper/);
    assert.match(f.calls.input!.requirements, /budget as planning guidance, not a hard ceiling/);
    assert.doesNotMatch(f.calls.input!.requirements, /hard maximum/);
    assert.deepEqual(f.calls.records.slice(0, 2), original);
    assert.ok(f.calls.records.slice(2).every(row => row.revision === "2" && row.status === "Pending Business Approval"));
    assert.equal((await post()).status, 200);
    assert.equal(f.calls.generated, 1, "repeated click reads existing pair without inference");
    assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
  });
});

test("Business authorization, exact activation flags and browser-content rejection fail before inference", async () => {
  const f = await fixture();
  await withServer(f, async post => {
    assert.equal((await post("")).status, 401);
    assert.equal((await post("customer")).status, 403);
    assert.equal((await post("approved-staff", { responseId, plans: generated.plans })).status, 400);
  });
  for (const flag of ["EVENTFLOW_MVP_INSERT_VERIFIED", "EVENTFLOW_LIVE_GENERATION_ENABLED", "EVENTFLOW_REVISION_GENERATION_ENABLED"]) {
    await withServer({ ...f, env: { ...f.env, [flag]: "TRUE" } }, async post => {
      assert.equal((await post()).status, 503);
    });
  }
  assert.equal(f.calls.generated, 0);
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "0");
});

test("revision saves honest over-budget A/B estimates while retaining the original budget", async () => {
  const f = await fixture();
  const overBudget = structuredClone(generated);
  overBudget.plans[0].costBreakdown[0]!.amountMYR = 1_200;
  overBudget.plans[1].costBreakdown[0]!.amountMYR = 1_300;
  f.generator.generate = async (input, options) => {
    f.calls.generated++;
    f.calls.input = input;
    assert.equal(options?.qualityProfile, "submission");
    return overBudget;
  };
  await withServer(f, async post => {
    const response = await post();
    assert.equal(response.status, 200);
    for (const row of f.calls.records.slice(2)) {
      assert.ok(row.plan.totalEstimatedMYR > request.budget);
      assert.equal(row.plan.totalEstimatedMYR,
        row.plan.costBreakdown.reduce((sum, line) => sum + line.amountMYR, 0));
    }
    assert.equal(f.calls.input?.budgetMYR, request.budget);
  });
  assert.equal(f.calls.generated, 1);
  assert.equal(f.calls.stored, 1);
  assert.equal(f.calls.records.slice(0, 2).length, 2, "Original proposals remain unchanged");
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});

test("concurrent API instances share one revision token and one atomic paid reservation", async () => {
  const f = await fixture();
  await withServer(f, async postA => withServer(f, async postB => {
    const responses = await Promise.all([postA(), postB(), postA(), postB()]);
    assert.ok(responses.every(response => [200, 409].includes(response.status)));
    assert.ok(responses.some(response => response.status === 200));
    assert.equal(f.calls.generated, 1);
    assert.equal(f.calls.records.filter(row => row.revision === "2").length, 2);
    assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
  }));
});

test("later Customer feedback progresses to another text revision without replacing earlier pairs or attempts", async () => {
  const first = await fixture();
  await withServer(first, async post => assert.equal((await post()).status, 200));
  const previousRecords = structuredClone(first.calls.records);
  const second = await fixture(first.redis);
  second.action.response_id = randomUUID();
  second.action.source_revision = "2";
  second.action.next_revision = "3";
  second.calls.records.splice(0, second.calls.records.length, ...structuredClone(previousRecords));
  await withServer(second, async post => {
    const response = await post("approved-staff", { responseId: second.action.response_id });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, "3");
  });
  assert.deepEqual(second.calls.records.slice(0, 4), previousRecords);
  assert.equal(second.calls.records.filter(row => row.revision === "3").length, 2);
  assert.notEqual(first.action.generation_token, second.action.generation_token);
  assert.equal(first.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "2");
});

test("missing shared quota or exhausted overall budget never calls AI", async () => {
  const f = await fixture();
  await withServer({ ...f, quota: null }, async post => assert.equal((await post()).status, 503));
  for (let i = 0; i < 5; i++) {
    await f.quota.reserve({ requestId: randomUUID(), customerId, fingerprint: "a".repeat(64) });
  }
  await withServer(f, async post => assert.equal((await post()).status, 429));
  assert.equal(f.calls.generated, 0);
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "5");
});

test("RunPod failure consumes one attempt, preserves history and cannot trigger a paid retry", async () => {
  const f = await fixture();
  f.generator.generate = async () => {
    f.calls.generated++;
    throw new ProposalGenerationError("RUNPOD_HTTP_ERROR", "Synthetic RunPod HTTP failure", 502);
  };
  await withServer(f, async post => {
    assert.equal((await post()).status, 502);
    assert.equal((await post()).status, 409);
  });
  assert.equal(f.calls.generated, 1);
  assert.equal(f.action.generation_error_code, "RUNPOD_FAILURE");
  assert.equal(f.calls.records.length, 2);
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});

test("persistence retry recovers the ready AI cache without another inference or attempt", async () => {
  const f = await fixture(); f.calls.failStoreOnce = true;
  await withServer(f, async post => {
    assert.equal((await post()).status, 503);
    assert.equal((await post()).status, 200);
  });
  assert.equal(f.calls.generated, 1);
  assert.equal(f.calls.stored, 2);
  assert.equal(f.calls.records.length, 4);
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});

test("invalid ready cache is quarantined without regeneration or quota reset", async () => {
  const f = await fixture(); f.calls.failStoreOnce = true;
  await withServer(f, async post => {
    assert.equal((await post()).status, 503);
    const hash = f.redis.hashes.get(DEMO_QUOTA_KEY)!;
    const key = [...hash.keys()].find(key => key.startsWith("revision:"))!;
    const entry = JSON.parse(hash.get(key)!);
    entry.proposal.plans[0].services = ["Simple styling"];
    entry.proposal.plans[0].catering = "No catering service is included.";
    entry.proposal.plans[0].timeline[2].activity = "Guests mingle near the garden entrance.";
    entry.proposal.plans[0].costBreakdown[0] = {
      item: "Venue", description: "Outdoor venue estimate", amountMYR: 200,
    };
    hash.set(key, JSON.stringify(entry));
    const response = await post();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "CACHED_REVISION_INVALID");
  });
  assert.equal(f.calls.generated, 1);
  assert.equal(f.calls.records.length, 2);
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});

test("source/preflight and context-size errors reserve no AI attempt", async () => {
  const f = await fixture();
  f.repository.loadContext = async () => { throw new CustomerRevisionError("SOURCE_INVALID", 409, "Synthetic source mismatch"); };
  await withServer(f, async post => assert.equal((await post()).status, 409));
  assert.equal(f.calls.claimed, 0);
  assert.equal(f.calls.generated, 0);
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "0");
  assert.throws(() => composeRevisionRequest({
    action: f.action, input: { ...mapSavedRequestToProposalInput(request), requirements: "x".repeat(8000) },
    responseFeedback: "change to 40 guests", previousProposal,
  }), { code: "REVISION_CONTEXT_TOO_LARGE" });
});

test("lost quota reservation acknowledgement never resubmits inference", async () => {
  const f = await fixture(); f.redis.state.loseNextReply = true;
  await withServer(f, async post => {
    assert.equal((await post()).status, 503);
    assert.equal((await post()).status, 409);
  });
  assert.equal(f.calls.generated, 0);
  assert.equal(f.calls.records.length, 2);
  assert.equal(f.redis.hashes.get(DEMO_QUOTA_KEY)!.get("used"), "1");
});

test("Supabase authorization uses the Business bearer, while server RPC credentials never leave backend", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const f = await fixture();
  const repository = new SupabaseCustomerRevisionGenerationRepository(
    "https://example.supabase.co", "fake-publishable", "sb_secret_FAKE",
    async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return Response.json(f.action);
    },
  );
  await repository.startRevision("fake-business-bearer", responseId);
  await repository.claimGeneration(responseId);
  assert.equal(calls[0]!.headers.get("apikey"), "fake-publishable");
  assert.equal(calls[0]!.headers.get("authorization"), "Bearer fake-business-bearer");
  assert.equal(calls[1]!.headers.get("apikey"), "sb_secret_FAKE");
  assert.equal(calls[1]!.headers.get("authorization"), null);
  const denied = new SupabaseCustomerRevisionGenerationRepository(
    "https://example.supabase.co", "fake-publishable", "sb_secret_FAKE",
    async () => Response.json({ code: "42501", message: "RAW PRIVATE DETAILS" }, { status: 403 }),
  );
  await assert.rejects(denied.startRevision("customer", responseId), error => {
    assert.ok(error instanceof CustomerRevisionError);
    assert.equal(error.statusCode, 403);
    assert.ok(!error.message.includes("RAW PRIVATE"));
    return true;
  });
});

test("review migration is additive, service-only, append-only for proposals, and uses text revision/approval states", () => {
  const sql = readFileSync(new URL("../../../scripts/sql/eventflow-customer-revision-generation.sql", import.meta.url), "utf8");
  assert.match(sql, /customer_revision_generation_reviewed = 'no'/);
  assert.match(sql, /eventflow_store_customer_revision_pair[\s\S]*to service_role/);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /'Pending Business Approval'/);
  assert.match(sql, /v_action\.next_revision/);
  assert.match(sql, /for update/);
  assert.match(sql, /generation_token=coalesce\(generation_token,gen_random_uuid\(\)\)/);
  assert.match(sql, /v_request\.budget<1/);
  assert.match(sql, /round\(v_sum,2\)<>round\(v_total,2\)/);
  assert.doesNotMatch(sql, /round\(v_total,2\)\s*>\s*round\(v_request\.budget::numeric,2\)/);
  assert.doesNotMatch(sql, /\b(update|delete from|truncate)\s+public\.(proposals|requests|eventflow_customer_responses)\b/i);
  assert.doesNotMatch(sql, /create or replace function public\.approve_ai_proposal_pair/i);
  assert.match(sql, /notify pgrst,'reload schema';\s*commit;/);
  const approval = readFileSync(new URL("../../eventflow-ai/src/lib/submissionMvp.ts", import.meta.url), "utf8");
  assert.match(approval, /p_request_id: requestId, p_revision: revision/);
});
