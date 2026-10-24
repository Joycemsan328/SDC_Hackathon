import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express from "express";
import { test } from "node:test";
import { createPersistedProposalRouter } from "../src/routes/persistedProposals";
import { CustomerDataAccessError, mapSavedRequestToProposalInput, SupabaseCustomerRequestGateway, type CustomerRequestGateway } from "../src/services/customerSupabase";
import { createCustomerProposalRepository, INITIAL_PROPOSAL_REVISION, mapProposalMetadata, ProposalPersistenceError, SupabaseAdminProposalPairRepository, type ProposalPairRepository } from "../src/services/proposalPersistence";
import type { GeneratedProposal } from "../src/services/proposalGenerator";

const customerId = "56beec8f-5031-44e9-b60c-576c1584042a";
const requestId = "45386295-f36c-4ef6-8f4c-ae9304128015";
const proposalA = {
  id: "A", title: "Plan A", concept: "An intimate garden dinner.", theme: "Garden", timeline: [{ time: "6pm", activity: "Welcome" }],
  venue: { name: "Garden venue", setup: "Long tables" }, catering: "Dinner", services: ["Catering"],
  costBreakdown: [{ item: "Dinner", description: "Meal service", amountMYR: 100 }], totalEstimatedMYR: 100,
  assumptions: ["Availability is unconfirmed."], unconfirmedCosts: [],
};
const proposalB = { ...proposalA, id: "B", title: "Plan B", concept: "A covered garden dinner." };
const generated: GeneratedProposal = { recommendation: "Plan A best fits the budget.", plans: [proposalA, proposalB] };
const persisted = {
  request_id: requestId, revision: 1, status: "created",
  proposals: [
    { plan_key: "A", proposal_id: "86670ca3-81db-4f75-8a1b-08f4eb484107", status: "Pending Business Approval", recommendation: generated.recommendation, plan_content: proposalA },
    { plan_key: "B", proposal_id: "e130a98d-a4fc-41e6-8b17-4b27486e3bc0", status: "Pending Business Approval", recommendation: generated.recommendation, plan_content: proposalB },
  ],
} as const;
const request = {
  id: requestId, customer_id: customerId, customer_name: "Customer", email: "customer@example.test", phone: null,
  event_name: "Dinner", event_type: "Birthday", event_date: "2027-04-15", event_time: null,
  guests: 20, budget: 1000, services: ["Catering"], notes: "Location: Kuala Lumpur\n\nA quiet evening.",
  status: "New", created_at: null, venue_id: null, event_end_time: null,
};

async function listen(router: express.Router) {
  const app = express(); app.use(express.json()); app.use(router);
  const server: Server = createServer(app).listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}/proposals/generate-persisted` };
}
async function close(server: Server) { server.closeAllConnections(); server.close(); await once(server, "close"); }
async function post(url: string, body: unknown = { requestId }, token = "test-customer-token") {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

const customers: CustomerRequestGateway = { loadOwnedRequest: async () => ({ customerId, request }) };
test("is inert until persistence mapping and server-only Supabase credentials are configured", async (context) => {
  let customerCalls = 0; let generationCalls = 0;
  const serverInfo = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" },
    customers: { loadOwnedRequest: async () => { customerCalls += 1; return { customerId, request }; } },
    generator: { generate: async () => { generationCalls += 1; return generated; } },
  }));
  context.after(() => close(serverInfo.server));
  const response = await post(serverInfo.url);
  assert.equal(response.status, 503);
  assert.equal(customerCalls, 0);
  assert.equal(generationCalls, 0);
});

test("persistence remains disabled by default", async (context) => {
  let customerCalls = 0; let generationCalls = 0; let lookupCalls = 0;
  const serverInfo = await listen(createPersistedProposalRouter({
    env: {},
    customers: { loadOwnedRequest: async () => { customerCalls += 1; return { customerId, request }; } },
    generator: { generate: async () => { generationCalls += 1; return generated; } },
    repository: { findExisting: async () => { lookupCalls += 1; return null; }, persist: async () => persisted },
  }));
  context.after(() => close(serverInfo.server));
  const response = await post(serverInfo.url);
  assert.equal(response.status, 503);
  assert.equal(customerCalls, 0); assert.equal(generationCalls, 0); assert.equal(lookupCalls, 0);
});

test("accepts only request ID, verifies ownership, and returns the persisted pair", async (context) => {
  let generatedInput: unknown; let persistedInput: unknown;
  const repository: ProposalPairRepository = { findExisting: async () => null, persist: async (input) => { persistedInput = input; return persisted; } };
  const serverInfo = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" },
    customers: { loadOwnedRequest: async () => ({ customerId, request: { ...request, notes: "Location: Kuala Lumpur\n\nEventFlow request metadata v1:\nTheme: Moonlit garden\n\nA quiet evening." } }) },
    generator: { generate: async (input) => { generatedInput = input; return generated; } },
    repository, metadataMapper: mapProposalMetadata, requestInputMapper: mapSavedRequestToProposalInput,
  }));
  context.after(() => close(serverInfo.server));

  const response = await post(serverInfo.url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { requestId, revision: 1, persistence: "created", proposals: persisted.proposals });
  assert.deepEqual(generatedInput, {
    eventName: "Dinner", eventType: "Birthday", eventDate: "2027-04-15", location: "Kuala Lumpur",
    guestCount: 20, budgetMYR: 1000, theme: "Moonlit garden", selectedServices: ["Catering"], requirements: "A quiet evening.",
  });
  assert.equal((persistedInput as { customerId: string }).customerId, customerId);
  assert.equal((persistedInput as { requestId: string }).requestId, requestId);
  assert.equal((persistedInput as { revision: number }).revision, INITIAL_PROPOSAL_REVISION);
  assert.equal((persistedInput as { recommendation: string }).recommendation, generated.recommendation);
  assert.deepEqual((persistedInput as { proposalFields: unknown }).proposalFields, {
    customer_name: "Customer", event_name: "Dinner", event_date: "2027-04-15", event_type: "Birthday",
    budget: 1000, event_time: null, venue_id: null, event_end_time: null,
  });

  const invalidBody = await post(serverInfo.url, { requestId, plan: generated.plans[0] });
  assert.equal(invalidBody.status, 400);
});

test("maps only verified request metadata and validated AI recommendation", () => {
  const metadata = mapProposalMetadata(request, generated);
  assert.equal(metadata.revision, 1);
  assert.equal(metadata.recommendation, generated.recommendation);
  assert.deepEqual(metadata.fields, {
    customer_name: "Customer", event_name: "Dinner", event_date: "2027-04-15", event_type: "Birthday",
    budget: 1000, event_time: null, venue_id: null, event_end_time: null,
  });
  assert.equal("status" in metadata.fields, false);
  assert.equal("checklist" in metadata.fields, false);
});

test("leaves nullable proposal metadata null rather than inventing values", () => {
  const metadata = mapProposalMetadata({
    ...request, customer_name: null, event_name: null, event_date: null, event_type: null,
    budget: null, event_time: null, venue_id: null, event_end_time: null,
  }, generated);
  assert.deepEqual(metadata.fields, {
    customer_name: null, event_name: null, event_date: null, event_type: null,
    budget: null, event_time: null, venue_id: null, event_end_time: null,
  });
});

test("uses the same initial revision for repeated mapping of a request", () => {
  const first = mapProposalMetadata(request, generated);
  const retry = mapProposalMetadata(request, generated);
  assert.equal(first.revision, INITIAL_PROPOSAL_REVISION);
  assert.equal(retry.revision, INITIAL_PROPOSAL_REVISION);
  assert.deepEqual(retry, first);
});

test("rejects incompatible request metadata and unvalidated AI output", () => {
  assert.throws(() => mapProposalMetadata({ ...request, budget: "not-a-number" }, generated), { code: "INVALID_REQUEST_BUDGET" });
  assert.throws(() => mapProposalMetadata(request, { ...generated, recommendation: "" } as GeneratedProposal), { code: "INVALID_METADATA_SOURCE" });
});

test("reads a newly submitted theme from versioned request notes", () => {
  const input = mapSavedRequestToProposalInput({
    ...request,
    notes: "Location: Kuala Lumpur\n\nEventFlow request metadata v1:\nTheme: Moonlit garden\n\nA quiet evening.",
  });
  assert.equal(input.theme, "Moonlit garden");
  assert.equal(input.requirements, "A quiet evening.");
});

test("does not invent a theme when a new request has none", () => {
  const input = mapSavedRequestToProposalInput({ ...request, notes: "Location: Kuala Lumpur\n\nA quiet evening." });
  assert.equal(input.theme, "");
  assert.equal(input.requirements, "A quiet evening.");
});

test("handles legacy request notes without a theme and preserves their requirements", () => {
  const input = mapSavedRequestToProposalInput({
    ...request,
    notes: "Location: Kuala Lumpur\n\nPlease use a garden setting and keep the music soft.",
  });
  assert.equal(input.theme, "");
  assert.equal(input.requirements, "Please use a garden setting and keep the music soft.");
});

test("does not return newly generated plans when persistence reports a retry conflict", async (context) => {
  const repository: ProposalPairRepository = { findExisting: async () => null, persist: async () => { throw new Error("database content mismatch"); } };
  const serverInfo = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" }, customers,
    generator: { generate: async () => generated }, repository, metadataMapper: mapProposalMetadata, requestInputMapper: mapSavedRequestToProposalInput,
  }));
  context.after(() => close(serverInfo.server));
  const response = await post(serverInfo.url);
  assert.equal(response.status, 503);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.code, "PERSISTED_PROPOSAL_FAILED");
  assert.equal("plans" in body, false);
});

test("customer Supabase gateway verifies profile and scopes request query to authenticated user", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    calls.push({ url: url.toString(), authorization: new Headers(init?.headers).get("authorization") });
    let body: unknown;
    if (url.pathname === "/auth/v1/user") body = { id: customerId, email: "customer@example.test" };
    else if (url.pathname === "/rest/v1/profiles") body = [{ account_type: "customer", role: "customer", approval_status: "approved" }];
    else body = [request];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const gateway = new SupabaseCustomerRequestGateway({ SUPABASE_URL: "https://project.example", SUPABASE_PUBLISHABLE_KEY: "public-test-key" }, fetchMock);
  const result = await gateway.loadOwnedRequest("bearer-test-token", requestId);
  assert.equal(result?.customerId, customerId);
  assert.ok(calls.every((call) => call.authorization === "Bearer bearer-test-token"));
  const requestUrl = new URL(calls[2]!.url);
  assert.equal(requestUrl.searchParams.get("id"), `eq.${requestId}`);
  assert.equal(requestUrl.searchParams.get("customer_id"), `eq.${customerId}`);
});

test("Supabase admin repository uses only the pair RPC and validates its persisted response", async () => {
  let rpcUrl = ""; let rpcHeaders: Headers | null = null; let rpcBody: Record<string, unknown> = {};
  const repository = new SupabaseAdminProposalPairRepository("https://project.example", "server-secret-test-key", async (input, init) => {
    rpcUrl = input.toString(); rpcHeaders = new Headers(init?.headers); rpcBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(persisted), { status: 200, headers: { "content-type": "application/json" } });
  });
  const saved = await repository.persist({ customerId, requestId, revision: 1, recommendation: generated.recommendation, proposalFields: {}, proposal: generated });
  assert.match(rpcUrl, /\/rest\/v1\/rpc\/persist_runpod_ai_proposal_pair$/);
  assert.equal(rpcHeaders?.get("authorization"), "Bearer server-secret-test-key");
  assert.equal(rpcBody["p_customer_id"], customerId); assert.equal(rpcBody["p_request_id"], requestId);
  assert.equal(saved.proposals[0]?.proposal_id, persisted.proposals[0].proposal_id);
});

test("existing complete pair is returned before RunPod generation on retry", async (context) => {
  let generationCalls = 0;
  const repository: ProposalPairRepository = {
    findExisting: async () => ({ ...persisted, status: "existing" }),
    persist: async () => { throw new Error("must not persist on retry"); },
  };
  const serverInfo = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" }, customers,
    generator: { generate: async () => { generationCalls += 1; return generated; } },
    repository, metadataMapper: mapProposalMetadata, requestInputMapper: mapSavedRequestToProposalInput,
  }));
  context.after(() => close(serverInfo.server));
  const response = await post(serverInfo.url);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { persistence: string }).persistence, "existing");
  assert.equal(generationCalls, 0);
});

test("returns authentication failures without generating or persisting", async (context) => {
  let generationCalls = 0;
  const serverInfo = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" },
    customers: { loadOwnedRequest: async () => { throw new CustomerDataAccessError("INVALID_ACCESS_TOKEN", 401, "Your session is invalid or expired."); } },
    generator: { generate: async () => { generationCalls += 1; return generated; } },
    repository: { findExisting: async () => null, persist: async () => persisted },
    metadataMapper: mapProposalMetadata, requestInputMapper: mapSavedRequestToProposalInput,
  }));
  context.after(() => close(serverInfo.server));
  const missingToken = await fetch(serverInfo.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }) });
  assert.equal(missingToken.status, 401);
  const invalidToken = await post(serverInfo.url);
  assert.equal(invalidToken.status, 401);
  assert.equal(generationCalls, 0);
});

test("rejects a gateway ownership mismatch before lookup or generation", async (context) => {
  let lookupCalls = 0; let generationCalls = 0;
  const serverInfo = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" },
    customers: { loadOwnedRequest: async () => ({ customerId, request: { ...request, customer_id: "f3a421ec-40eb-4b92-89c8-a87f1bef3231" } }) },
    generator: { generate: async () => { generationCalls += 1; return generated; } },
    repository: { findExisting: async () => { lookupCalls += 1; return null; }, persist: async () => persisted },
    metadataMapper: mapProposalMetadata, requestInputMapper: mapSavedRequestToProposalInput,
  }));
  context.after(() => close(serverInfo.server));
  const response = await post(serverInfo.url);
  assert.equal(response.status, 403);
  assert.equal(lookupCalls, 0); assert.equal(generationCalls, 0);
});

test("Supabase admin repository reads the persisted pair using only the request/revision lookup", async () => {
  let lookupUrl = ""; let authorization = "";
  const repository = new SupabaseAdminProposalPairRepository("https://project.example", "server-secret-test-key", async (input, init) => {
    lookupUrl = input.toString(); authorization = new Headers(init?.headers).get("authorization") ?? "";
    const rows = persisted.proposals.map((plan) => ({
      request_id: requestId, revision: "1", plan_key: plan.plan_key, id: plan.proposal_id,
      status: plan.status, recommendation: plan.recommendation, plan_content: plan.plan_content,
    }));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  });
  const pair = await repository.findExisting({ requestId, revision: 1 });
  assert.equal(pair?.status, "existing");
  assert.equal(new URL(lookupUrl).searchParams.get("request_id"), `eq.${requestId}`);
  assert.equal(new URL(lookupUrl).searchParams.get("plan_key"), "in.(A,B)");
  assert.equal(authorization, "Bearer server-secret-test-key");
});

test("RPC failure returns the concurrent persisted pair instead of unsaved generated plans", async () => {
  let callCount = 0;
  const repository = new SupabaseAdminProposalPairRepository("https://project.example", "server-secret-test-key", async (input) => {
    callCount += 1;
    if (input.toString().includes("/rpc/")) return new Response("conflict", { status: 409 });
    const rows = persisted.proposals.map((plan) => ({
      request_id: requestId, revision: "1", plan_key: plan.plan_key, id: plan.proposal_id,
      status: plan.status, recommendation: plan.recommendation, plan_content: plan.plan_content,
    }));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  });
  const saved = await repository.persist({ customerId, requestId, revision: 1, recommendation: "different recommendation", proposalFields: {}, proposal: generated });
  assert.equal(callCount, 2);
  assert.equal(saved.status, "existing");
  assert.equal(saved.proposals[0]?.proposal_id, persisted.proposals[0].proposal_id);
});

test("RPC failure without a persisted pair returns a safe error", async () => {
  const repository = new SupabaseAdminProposalPairRepository("https://project.example", "server-secret-test-key", async (input) => {
    if (input.toString().includes("/rpc/")) return new Response("database detail must not escape", { status: 500 });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
  await assert.rejects(
    repository.persist({ customerId, requestId, revision: 1, recommendation: generated.recommendation, proposalFields: {}, proposal: generated }),
    { code: "PROPOSAL_PERSISTENCE_FAILED", message: "Proposals could not be saved safely." },
  );
});

test("an unapproved/missing workflow migration cannot trigger RunPod", async (context) => {
  let generationCalls = 0;
  const info = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" }, customers,
    repository: {
      findExisting: async () => null,
      claimGeneration: async () => { throw new ProposalPersistenceError("WORKFLOW_NOT_READY", 503, "Migration approval required."); },
      persist: async () => { throw new Error("Must not persist."); },
    },
    generator: { generate: async () => { generationCalls++; return generated; } },
  }));
  context.after(() => close(info.server));
  const response = await post(info.url);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "WORKFLOW_NOT_READY");
  assert.equal(generationCalls, 0);
});

test("concurrent customer retries share one generation and persistence operation", async (context) => {
  let generationCalls = 0; let persistCalls = 0; let claims = 0;
  const info = await listen(createPersistedProposalRouter({
    env: { EVENTFLOW_AI_PERSISTENCE_ENABLED: "true" }, customers,
    repository: {
      findExisting: async () => null, claimGeneration: async () => { claims++; },
      persist: async () => { persistCalls++; return persisted; },
    },
    generator: { generate: async () => {
      generationCalls++;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return generated;
    } },
  }));
  context.after(() => close(info.server));
  const responses = await Promise.all([post(info.url), post(info.url), post(info.url)]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.equal(generationCalls, 1); assert.equal(persistCalls, 1); assert.equal(claims, 1);
});

test("authenticated persistence uses the caller token and a lease, never a browser admin key", async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const repository = createCustomerProposalRepository({
    VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
  }, "customer-access-token", async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(String(url).endsWith("eventflow_claim_generation") ? true : persisted), { status: 200 });
  });
  assert.ok(repository);
  await repository.claimGeneration(requestId);
  await repository.persist({ customerId, requestId, revision: 1, recommendation: generated.recommendation, proposalFields: {}, proposal: generated });
  assert.match(calls[0]!.url, /eventflow_claim_generation$/);
  assert.match(calls[1]!.url, /eventflow_persist_proposal_pair$/);
  assert.equal(calls[0]!.body.p_token, calls[1]!.body.p_generation_token);
  assert.equal(calls[1]!.headers.authorization, "Bearer customer-access-token");
  assert.equal(calls[1]!.headers.apikey, "test-public-key");
});

test("Supabase admin repository never calls booking functions or event endpoints", async () => {
  const calls: string[] = [];
  const repository = new SupabaseAdminProposalPairRepository("https://project.example", "server-secret-test-key", async (input) => {
    calls.push(input.toString());
    return new Response(JSON.stringify(persisted), { status: 200, headers: { "content-type": "application/json" } });
  });
  await repository.persist({ customerId, requestId, revision: 1, recommendation: generated.recommendation, proposalFields: {}, proposal: generated });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.endsWith("/rpc/persist_runpod_ai_proposal_pair"));
  assert.ok(calls.every((url) => !/accept_proposal|\/events(?:\?|$)/i.test(url)));
});
