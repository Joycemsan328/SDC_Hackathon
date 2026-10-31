import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  confirmCustomerSelection,
  generateCustomerRevision,
  parseCustomerResponseAction,
  startCustomerRevision,
} from "../src/business/customerResponseActions";
import { MockResponseWorkflow } from "./fixtures/mock-response-workflow";

const requestId = "request-1";

test("Business revision generation sends only the response ID and signed-in bearer to the backend", async () => {
  let sent: RequestInit | undefined;
  const result = await generateCustomerRevision("FAKE-BEARER", { requestId, responseId: "change-1" },
    async (url, options) => {
      assert.equal(url, "/api/business/revisions/generate");
      sent = options;
      return Response.json({ requestId, revision: "2", persistence: "created", workflowState: "business_review" });
    });
  assert.deepEqual(result, { requestId, revision: "2" });
  assert.equal(new Headers(sent?.headers).get("authorization"), "Bearer FAKE-BEARER");
  assert.deepEqual(JSON.parse(String(sent?.body)), { responseId: "change-1" });
  await assert.rejects(generateCustomerRevision("FAKE", { requestId, responseId: "change-1" },
    async () => Response.json({ requestId: "other-request", revision: "2", persistence: "created", workflowState: "business_review" })),
  /could not be verified/);
  await assert.rejects(generateCustomerRevision("FAKE", { requestId, responseId: "change-1" },
    async () => Response.json({ error: "Revised AI proposal generation is not enabled." }, { status: 503 })),
  /not enabled/);
});

test("Business-only action RPCs reject unauthorized users", async () => {
  const workflow = new MockResponseWorkflow(null);
  workflow.addApprovedPair(requestId, "1");
  workflow.addChangeRequest("change-1", requestId, "1");
  workflow.addSelection("selection-1", requestId, "1");
  await assert.rejects(startCustomerRevision(workflow.rpc, { requestId, responseId: "change-1" }), /approved Business staff/i);
  await assert.rejects(confirmCustomerSelection(workflow.rpc, { requestId, responseId: "selection-1", message: "" }), /approved Business staff/i);
});

test("repeated clicks return one queued revision and do not rewrite history", async () => {
  const workflow = new MockResponseWorkflow();
  workflow.addApprovedPair(requestId, "1");
  workflow.addChangeRequest("change-1", requestId, "1");
  const first = await startCustomerRevision(workflow.rpc, { requestId, responseId: "change-1" });
  const second = await startCustomerRevision(workflow.rpc, { requestId, responseId: "change-1" });
  assert.equal(first.next_revision, "2");
  assert.deepEqual(second, first);
  assert.equal(workflow.actions.size, 1);
  assert.equal(workflow.responses.size, 1);
  assert.equal(workflow.proposals.length, 2);
});

test("concurrent duplicate requests serialize to one revision", async () => {
  const workflow = new MockResponseWorkflow();
  workflow.addApprovedPair(requestId, "1");
  workflow.addChangeRequest("change-1", requestId, "1");
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    startCustomerRevision(workflow.rpc, { requestId, responseId: "change-1" })));
  assert.deepEqual(new Set(results.map(result => result.next_revision)), new Set(["2"]));
  assert.equal(workflow.actions.size, 1);
});

test("revision progression is monotonic and old proposals/responses remain intact", async () => {
  const workflow = new MockResponseWorkflow();
  workflow.addApprovedPair(requestId, "1");
  workflow.addChangeRequest("change-1", requestId, "1");
  const first = await startCustomerRevision(workflow.rpc, { requestId, responseId: "change-1" });
  assert.equal(first.next_revision, "2");
  const mockPair = await workflow.mockGenerateQueuedRevision("change-1");
  assert.equal(mockPair.length, 2);
  assert.ok(mockPair.every(plan => plan.mock === true && plan.status === "Pending Business Approval"));
  assert.equal(workflow.proposals.length, 4);

  // Simulate the existing Business pair-approval RPC before a new Customer response.
  for (const proposal of mockPair) proposal.status = "Awaiting Customer";
  workflow.addChangeRequest("change-2", requestId, "2");
  const second = await startCustomerRevision(workflow.rpc, { requestId, responseId: "change-2" });
  assert.equal(second.next_revision, "3");
  assert.equal(workflow.responses.size, 2);
  assert.equal(workflow.proposals.length, 4);
});

test("Business confirmation is idempotent and does not modify the Customer selection", async () => {
  const workflow = new MockResponseWorkflow();
  workflow.addApprovedPair(requestId, "1");
  const response = workflow.addSelection("selection-1", requestId, "1", "B");
  const first = await confirmCustomerSelection(workflow.rpc, { requestId, responseId: response.id, message: "Confirmed." });
  const second = await confirmCustomerSelection(workflow.rpc, { requestId, responseId: response.id, message: "Confirmed." });
  assert.equal(first.status, "confirmed");
  assert.deepEqual(second, first);
  assert.equal(workflow.responses.get(response.id)?.selected_proposal_id, response.plan_b_id);
  await assert.rejects(confirmCustomerSelection(workflow.rpc, { requestId, responseId: response.id, message: "Different message." }));
});

test("action parser rejects cross-request and malformed revision metadata", () => {
  assert.throws(() => parseCustomerResponseAction({
    response_id: "r", request_id: "q", source_revision: "1", action_kind: "revision",
    next_revision: "1", status: "queued", started_by: "staff",
    started_at: new Date().toISOString(), confirmed_by: null, confirmed_at: null, confirmation_message: "",
  }));
});

test("review migration gates staff-only idempotent actions and avoids existing data writes", () => {
  const sql = readFileSync(new URL("../../../scripts/sql/eventflow-customer-response-actions.sql", import.meta.url), "utf8");
  assert.match(sql, /set local eventflow\.customer_response_actions_reviewed = 'no'/);
  assert.match(sql, /public\.eventflow_response_is_staff\(\)/);
  assert.match(sql, /for update of r/);
  assert.match(sql, /unique\(request_id,next_revision\)/);
  assert.match(sql, /response_id uuid primary key/);
  assert.match(sql, /if found then[\s\S]+return v_action/);
  assert.match(sql, /grant execute on function public\.eventflow_start_customer_revision\(uuid\) to authenticated/);
  assert.doesNotMatch(sql, /update\s+public\.(requests|proposals|eventflow_customer_responses)\b/i);
  assert.doesNotMatch(sql, /runpod|fetch\(/i);
});

test("Business response action UI is wired only to the authenticated Supabase RPC client", () => {
  const panel = readFileSync(new URL("../src/business/CustomerResponseActionPanel.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/business/customerResponseActions.ts", import.meta.url), "utf8");
  const business = readFileSync(new URL("../src/business/BusinessPortal.tsx", import.meta.url), "utf8");
  const queue = readFileSync(new URL("../src/business/CustomerResponsesQueue.tsx", import.meta.url), "utf8");
  assert.match(actions, /eventflow_start_customer_revision/);
  assert.match(actions, /eventflow_confirm_customer_selection/);
  assert.match(panel, /supabase\.rpc/);
  assert.match(panel, /Start Revised Proposals/);
  assert.match(business, /eventflow_customer_response_actions/);
  assert.match(business, /CustomerResponsesQueue/);
  assert.match(queue, /CustomerResponseActionPanel/);
  assert.doesNotMatch(business, /<CustomerResponseActionPanel/);
});
