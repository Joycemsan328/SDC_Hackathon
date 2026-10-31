import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { buildCustomerResponseQueue } from "../src/business/customerResponseQueue";
import type { CustomerResponseRecord } from "../src/customer/customerResponseTypes";
import type { CustomerResponseAction } from "../src/business/customerResponseActions";

const selection: CustomerResponseRecord = {
  id: "selection-1", request_id: "request-1", revision: "1", customer_id: "customer-1",
  plan_a_id: "plan-a", plan_b_id: "plan-b", response_kind: "selection",
  response_status: "selection_submitted", selected_proposal_id: "plan-b", feedback: "",
  idempotency_key: "key-1", responded_at: "2026-10-31T10:00:00Z",
};
const change: CustomerResponseRecord = {
  ...selection, id: "change-1", request_id: "request-2",
  response_kind: "change_request", response_status: "changes_requested",
  selected_proposal_id: null, feedback: "Change to 40 guests",
};
const action = (response: CustomerResponseRecord, status: CustomerResponseAction["status"]): CustomerResponseAction => ({
  response_id: response.id, request_id: response.request_id, source_revision: response.revision,
  action_kind: response.response_kind === "selection" ? "selection_confirmation" : "revision",
  next_revision: response.response_kind === "change_request" ? "2" : null, status,
  started_by: "staff", started_at: selection.responded_at, confirmed_by: null, confirmed_at: null,
  confirmation_message: "",
});
const proposals = [
  { requestId: selection.request_id, revision: "1", customer: "Test Customer", event: "Test event" },
  { requestId: selection.request_id, revision: "1", customer: "Test Customer", event: "Test event" },
];

test("one response creates one queue item, independent of A/B proposals and duplicate response rows", () => {
  const entries = buildCustomerResponseQueue([selection, selection], [], proposals);
  assert.equal(entries.length, 1);
  assert.equal(entries.filter(entry => entry.actionable).length, 1);
  assert.match(entries[0].status, /Awaiting Business confirmation/);
});

test("both selection and change requests are actionable before a Business action", () => {
  const entries = buildCustomerResponseQueue([selection, change], [], proposals);
  assert.equal(entries.filter(entry => entry.actionable).length, 2);
});

test("confirmed selections and completed revisions are history, not pending actions", () => {
  assert.equal(buildCustomerResponseQueue([selection], [action(selection, "confirmed")], proposals)[0].actionable, false);
  for (const status of ["business_review", "released"] as const) {
    assert.equal(buildCustomerResponseQueue([change], [action(change, status)], [])[0].actionable, false);
  }
});

test("queued and reserved revisions retain existing generation/check behavior, but failed attempts cannot be retried", () => {
  for (const status of ["queued", "generating"] as const) {
    assert.equal(buildCustomerResponseQueue([change], [action(change, status)], [])[0].actionable, true);
  }
  const failed = { ...action(change, "generating"), generation_error_code: "RUNPOD_HTTP_ERROR" };
  const entry = buildCustomerResponseQueue([change], [failed], [])[0];
  assert.equal(entry.actionable, false);
  assert.match(entry.status, /no automatic retry/);
});

test("old revisions, mismatched actions, and invalid revision data fail closed", () => {
  const newer = [{ requestId: selection.request_id, revision: "2" }];
  assert.equal(buildCustomerResponseQueue([selection], [], newer)[0].actionable, false);
  assert.equal(buildCustomerResponseQueue([selection], [{ ...action(selection, "confirmed"), request_id: "other" }], [])[0].actionable, false);
  assert.equal(buildCustomerResponseQueue([{ ...selection, revision: "bad" }], [], [])[0].actionable, false);
});

// Render the actual queue markup offline. Replace only the mutating action panel
// with an inert button; no Supabase session, backend call, or paid job is possible.
const require = createRequire(import.meta.url);
const componentText = readFileSync(new URL("../src/business/CustomerResponsesQueue.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(componentText, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: Record<string, any> = {};
runInNewContext(compiled, {
  exports,
  require: (name: string) => {
    if (name === "./customerResponseQueue") return { buildCustomerResponseQueue };
    if (name === "./CustomerResponseActionPanel") return {
      default: ({ response, workflowError }: { response: CustomerResponseRecord; workflowError?: string }) =>
        createElement("button", { disabled: Boolean(workflowError), "data-testid": `action-${response.id}` }, "Existing action"),
    };
    return require(name);
  },
});

test("rendered queue shows required Customer details and a single action per response", () => {
  const html = renderToStaticMarkup(createElement(exports.default, {
    responses: [selection, selection, change], actions: [], proposals,
    requests: [
      { id: selection.request_id, customer: "Test Customer", name: "Birthday" },
      { id: change.request_id, customer: "Other Customer", name: "Dinner" },
    ], onSaved: () => {},
  }));
  assert.equal((html.match(/data-testid="action-selection-1"/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="action-change-1"/g) ?? []).length, 1);
  for (const value of ["Customer Responses", "Test Customer", "Birthday", "Customer selected Plan B",
    "Change Request", "Change to 40 guests", "Request request-1", "Revision 1", "Received"]) {
    assert.ok(html.includes(value), value);
  }
});

test("rendered completed responses have no action controls and refresh errors disable pending actions", () => {
  const common = { responses: [selection, change], proposals, requests: [], onSaved: () => {} };
  const completed = renderToStaticMarkup(createElement(exports.default, {
    ...common, actions: [action(selection, "confirmed"), action(change, "business_review")],
  }));
  assert.doesNotMatch(completed, /data-testid="action-/);
  assert.match(completed, /Confirmed by Business/);
  const unavailable = renderToStaticMarkup(createElement(exports.default, {
    ...common, actions: [], error: "Could not refresh actions",
  }));
  assert.equal((unavailable.match(/disabled=""/g) ?? []).length, 2);
  assert.match(unavailable, /role="alert"/);
});

test("actions live only in Approvals; Proposal Details retain history and their existing release control", () => {
  const source = readFileSync(new URL("../src/business/BusinessPortal.tsx", import.meta.url), "utf8");
  const approvals = source.slice(source.indexOf("function Approvals("), source.indexOf("function ApprovalCard("));
  const detail = source.slice(source.indexOf("function SavedProposalDetail("), source.indexOf("function Approvals("));
  assert.match(approvals, /<CustomerResponsesQueue/);
  assert.match(detail, /customer-response-detail-/);
  assert.match(detail, /text-customer-change-feedback-/);
  assert.match(detail, /<SavedPlanReview/);
  assert.doesNotMatch(detail, /CustomerResponseActionPanel|CustomerResponsesQueue/);
  assert.match(source, /await approveSubmissionPair\(p.requestId, p.revision\)/);
  assert.match(source, /const actions = \(actionData \?\? \[\]\)\.map\(parseCustomerResponseAction\);[\s\S]*?setCustomerResponses\(responses\);[\s\S]*?setCustomerResponseActions\(actions\);/);
});
