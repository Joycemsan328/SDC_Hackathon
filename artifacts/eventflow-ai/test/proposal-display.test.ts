import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import type { CustomerEvent } from "../src/customer/data";
import { canDisplayProposal, CustomerProposalApiError, proposalDisplayStatus } from "../src/customer/proposalDisplay";

const event = (patch: Partial<CustomerEvent> = {}): CustomerEvent => ({
  id: "own-request", requestSource: "supabase", name: "Selected event", type: "Birthday",
  date: "2027-02-20", location: "Venue", guests: 40, budget: 16000, theme: "Garden",
  services: [], requirements: "", status: "Pending Business Approval", createdAt: "2026-10-30T00:00:00Z",
  proposalLookup: { state: "empty", rowCount: 0 }, ...patch,
});
const savedProposal = { source: "persisted-ai", plans: [{ id: "A" }, { id: "B" }] } as CustomerEvent["proposal"];

test("zero customer-visible rows never establish no generation or Business review", () => {
  const status = proposalDisplayStatus(event(), false, "");
  assert.equal(status.state, "unavailable");
  assert.match(status.description, /cannot confirm/);
  assert.doesNotMatch(status.title, /generated|Awaiting Business/);
});
test("only explicit generation evidence permits not-generated, pending and quota states", () => {
  assert.equal(proposalDisplayStatus(event(), false, "", "not_generated").state, "not_generated");
  assert.equal(proposalDisplayStatus(event(), false, "", "business_review").state, "business_review");
  assert.equal(proposalDisplayStatus(event(), false, "", "quota_exhausted").state, "quota_exhausted");
  assert.equal(proposalDisplayStatus(event(), false, "", "released").state, "unavailable", "a receipt does not grant visibility");
  assert.equal(proposalDisplayStatus(event(), false, "", "failed").state, "error");
  assert.equal(proposalDisplayStatus(event(), false, "", "generating").state, "loading");
});
test("lookup failures and initial loading are distinct from absence or Business review", () => {
  assert.equal(proposalDisplayStatus(event(), true, "").state, "loading");
  assert.equal(proposalDisplayStatus(event(), false, "network failed", "business_review").state, "error");
  assert.equal(proposalDisplayStatus(event({ proposalLookup: { state: "error", rowCount: 1 } }), false, "").state, "error");
});
test("pending or rejected plans cannot render; approved comparison remains available", () => {
  for (const status of ["AI Draft", "Pending Business Approval", "Changes Requested"] as const) {
    assert.equal(canDisplayProposal(event({ status, proposal: savedProposal })), false);
  }
  for (const status of ["Approved for Customer", "Customer Accepted"] as const) {
    const current = event({ status, proposal: savedProposal });
    assert.equal(canDisplayProposal(current), true);
    assert.equal(proposalDisplayStatus(current, false, "", "quota_exhausted").state, "approved");
  }
});
test("visible saved pending pair establishes review without exposing its content", () => {
  const current = event({ proposalLookup: { state: "ready", rowCount: 2 } });
  assert.equal(proposalDisplayStatus(current, false, "").state, "business_review");
  assert.equal(canDisplayProposal(current), false);
});
test("the actual request mapper never releases a mixed Accepted / pending pair", () => {
  const text = readFileSync(new URL("../src/customer/data.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("data.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mapper = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "mapSavedRequest");
  assert.ok(mapper);
  const js = ts.transpileModule(mapper.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const map = runInNewContext(`${js}; mapSavedRequest`, {
    mapPersistedPlan: (value: unknown) => value,
    mapGeneratedPlans: (_recommendation: unknown, plans: unknown) => plans,
  });
  const row = { id: "own-request", customer_id: "own-customer", services: [], notes: "", created_at: "2026-10-30T00:00:00Z" };
  const pair = (statuses: string[]) => statuses.map((status, index) => ({
    id: `proposal-${index}`, request_id: row.id, revision: "1", plan_key: index ? "B" : "A", status, plan_content: {},
  }));
  assert.equal(canDisplayProposal(map(row, pair(["Accepted", "Pending Business Approval"]), row.customer_id)), false);
  assert.equal(canDisplayProposal(map(row, pair(["Pending Business Approval", "Accepted"]), row.customer_id)), false);
  assert.equal(canDisplayProposal(map(row, pair(["Awaiting Customer", "Awaiting Customer"]), row.customer_id)), true);
});
test("quota failures retain their structured code without changing the API message", () => {
  const error = new CustomerProposalApiError("Budget exhausted", "DEMO_BUDGET_EXHAUSTED");
  assert.equal(error.code, "DEMO_BUDGET_EXHAUSTED");
  assert.equal(error.message, "Budget exhausted");
});
test("legacy budget rejection is shown as a genuine generation failure, not a budget ceiling", () => {
  const data = readFileSync(new URL("../src/customer/data.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("data.tsx", data, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mapper = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "persistedErrorMessage");
  assert.ok(mapper);
  const js = ts.transpileModule(mapper.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const mapError = runInNewContext(`${js}; persistedErrorMessage`) as (code: unknown, message: unknown) => string;
  const message = mapError("PROPOSAL_EXCEEDS_BUDGET", "A generated plan exceeds the saved event budget.");
  assert.equal(message, "Proposal generation could not be completed. Your request is saved, and no automatic retry will be made. Please contact the planning team.");
  assert.doesNotMatch(message, /exceeds the saved event budget/i);
});
test("Customer and Business proposal views keep budget and estimated total comparable", () => {
  const customerPortal = readFileSync(new URL("../src/customer/Portal.tsx", import.meta.url), "utf8");
  const businessPortal = readFileSync(new URL("../src/business/BusinessPortal.tsx", import.meta.url), "utf8");
  assert.match(customerPortal, /Estimated total/);
  assert.match(customerPortal, /Budget: \{money\(event\.budget\)\}/);
  assert.match(customerPortal, /over budget/);
  assert.match(businessPortal, /Budget \{money\(p\.budget\)\}/);
  assert.match(businessPortal, /total <= p\.budget \? "within budget" : "over budget"/);
});
test("Event Details has no debug UI/cross-event fallbacks; Create Event retains retry", () => {
  const portal = readFileSync(new URL("../src/customer/Portal.tsx", import.meta.url), "utf8");
  const detail = portal.slice(portal.indexOf("function EventDetail("), portal.indexOf("export function AuthPage"));
  for (const removed of ["Request ID:", "saved proposal row(s)", "Lookup:", "button-check-saved-proposals",
    "button-generate-missing-plans", "link-saved-plan-event-", "generateMissingPlans", "generateProposal",
    "different event request"]) assert.ok(!detail.includes(removed), removed);
  assert.match(detail, /events\.find\(\(item\) => item\.id === id\)/);
  assert.match(detail, /canViewProposal && event\.proposal/);
  assert.match(detail, /event\.proposal\.plans\.map/);
  assert.match(detail, /not sent to Business/);
  assert.match(portal, /data-testid="button-retry-proposal"/);
  assert.match(portal, /await generateProposal\(id, input, 'supabase'\)/);
});
test("generation notices are request-scoped, cleared at the account boundary, and never persisted", () => {
  const data = readFileSync(new URL("../src/customer/data.tsx", import.meta.url), "utf8");
  assert.match(data, /remoteOwner\.current = user\?\.id \?\? null;\s*setGenerationNotices\(\{\}\)/);
  assert.match(data, /\[id\]: "generating"/);
  assert.match(data, /error\.code === "DEMO_BUDGET_EXHAUSTED"/);
  assert.match(data, /generationNotices: sameAccount \? generationNotices : \{\}/);
  assert.match(data, /requestId: string, onReceipt\?/);
});
