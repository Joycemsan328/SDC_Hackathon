import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertCustomerResponseMatches,
  parseCustomerResponse,
  parseCustomerResponseRows,
  type CustomerResponseRecord,
} from "../src/customer/customerResponseTypes";

const selection: CustomerResponseRecord = {
  id: "response-1",
  request_id: "request-1",
  revision: "1",
  customer_id: "customer-1",
  plan_a_id: "proposal-a",
  plan_b_id: "proposal-b",
  response_kind: "selection",
  response_status: "selection_submitted",
  selected_proposal_id: "proposal-a",
  feedback: "",
  idempotency_key: "operation-1",
  responded_at: "2026-10-30T10:00:00.000Z",
};

test("valid saved selection and Change Request rows are parsed", () => {
  assert.deepEqual(parseCustomerResponse(selection), selection);
  const change = parseCustomerResponse({
    ...selection,
    response_kind: "change_request",
    response_status: "changes_requested",
    selected_proposal_id: null,
    feedback: "Please update the decor.",
  });
  assert.equal(change.feedback, "Please update the decor.");
  assert.equal(parseCustomerResponseRows([selection]).length, 1);
});

test("malformed response status, selection, timestamp, and row shapes are rejected", () => {
  assert.throws(() => parseCustomerResponse({ ...selection, response_status: "changes_requested" }));
  assert.throws(() => parseCustomerResponse({ ...selection, selected_proposal_id: "unrelated-proposal" }));
  assert.throws(() => parseCustomerResponse({ ...selection, responded_at: "not-a-date" }));
  assert.throws(() => parseCustomerResponseRows({ ...selection }));
});

test("lost-response idempotent retries may return the original operation key", () => {
  assert.doesNotThrow(() => assertCustomerResponseMatches(selection, {
    requestId: selection.request_id,
    revision: selection.revision,
    kind: "selection",
    selectedProposalId: selection.selected_proposal_id ?? undefined,
    idempotencyKey: "retry-operation",
  }, selection.customer_id));
  assert.throws(() => assertCustomerResponseMatches(selection, {
    requestId: "another-request",
    revision: selection.revision,
    kind: "selection",
    selectedProposalId: selection.selected_proposal_id ?? undefined,
  }, selection.customer_id));
});

test("enabled customer responses use the owner-checking RPC and display in Business", () => {
  const service = readFileSync(new URL("../src/customer/customerResponses.ts", import.meta.url), "utf8");
  const customer = readFileSync(new URL("../src/customer/data.tsx", import.meta.url), "utf8");
  const portal = readFileSync(new URL("../src/customer/Portal.tsx", import.meta.url), "utf8");
  const business = readFileSync(new URL("../src/business/BusinessPortal.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-customer-responses.sql", import.meta.url), "utf8");
  assert.match(service, /CUSTOMER_RESPONSE_WORKFLOW_ENABLED\s*=\s*true/);
  assert.match(service, /supabase\.rpc\("eventflow_submit_customer_response"/);
  assert.doesNotMatch(service, /\.from\(["']eventflow_customer_responses["']\)\s*\.\s*(insert|update|delete)\s*\(/);
  assert.match(portal, /kind:\s*'selection'/);
  assert.match(portal, /kind:\s*'change_request'/);
  assert.match(customer, /\.from\("eventflow_customer_responses"\)/);
  assert.match(business, /\.from\("eventflow_customer_responses"\)/);
  assert.match(business, /Customer selected Plan/);
  assert.match(business, /text-customer-change-feedback/);
  assert.match(migration, /selection_submitted/);
  assert.doesNotMatch(migration, /response_status in \('confirmed'/);
  assert.match(migration, /grant execute on function public\.eventflow_submit_customer_response[\s\S]*?to authenticated/i);
  assert.match(migration, /where r\.id=p_request_id and r\.customer_id=v_customer for update/);
});
