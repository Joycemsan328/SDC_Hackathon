import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildProposalPlanContent, createProposalPlanDraft } from "../src/business/proposalEditorModel";

const plan = {
  id: "A",
  title: "Garden reception",
  concept: "A relaxed celebration",
  theme: "Botanical",
  timeline: [{ time: "18:00", activity: "Guest arrival" }],
  venue: { name: "Garden Hall", setup: "Round tables" },
  catering: "Buffet dinner",
  services: ["Catering", "Decoration"],
  costBreakdown: [
    { item: "Venue", description: "Hall hire", amountMYR: 1000.1 },
    { item: "Food", description: "Buffet", amountMYR: 2000.2 },
  ],
  totalEstimatedMYR: 3000.3,
  assumptions: ["Venue availability must be checked"],
  unconfirmedCosts: [],
  retainedMetadata: { source: "ai" },
};

test("proposal editor preserves plan metadata and derives a cents-accurate total", () => {
  const draft = createProposalPlanDraft(plan, "A");
  draft.costBreakdown[0]!.amountMYR = "999.99";
  const saved = buildProposalPlanContent(draft);
  assert.equal(saved.id, "A");
  assert.equal(saved.totalEstimatedMYR, 3000.19);
  assert.deepEqual((saved as unknown as Record<string, unknown>).retainedMetadata, { source: "ai" });
  assert.equal(saved.costBreakdown[0]!.amountMYR, 999.99);
});

test("proposal editor rejects incomplete plans, negative costs, and empty required fields", () => {
  assert.throws(() => createProposalPlanDraft({ ...plan, id: "B" }, "A"), /incomplete/);
  const draft = createProposalPlanDraft(plan, "A");
  draft.costBreakdown[0]!.amountMYR = "-0.01";
  assert.throws(() => buildProposalPlanContent(draft), /nonnegative/);
  const empty = createProposalPlanDraft(plan, "A");
  empty.services = [""];
  assert.throws(() => buildProposalPlanContent(empty), /Service is required/);
});

test("saved proposal editor uses the scoped RPC and never updates the table directly", () => {
  const helper = readFileSync(new URL("../src/lib/submissionMvp.ts", import.meta.url), "utf8");
  const review = readFileSync(new URL("../src/business/SubmissionPairReview.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../src/business/ProposalEditor.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-edit-pending-ai-proposal.sql", import.meta.url), "utf8");
  assert.match(helper, /supabase\.rpc\("eventflow_update_pending_ai_proposal"/);
  assert.match(review, /plan\.status === "Pending Business Approval"/);
  assert.match(editor, /Save Changes/);
  assert.match(migration, /for update/);
  assert.match(migration, /grant execute on function public\.eventflow_update_pending_ai_proposal[\s\S]*?to authenticated/i);
  assert.match(migration, /from public,anon/i);
  assert.match(migration, /set plan_content=v_persisted_plan_content/i);
  assert.doesNotMatch(migration, /set\s+(status|request_id|revision|plan_key)\s*=/i);
  assert.doesNotMatch(migration, /set plan_content=p_plan_content/i);
  assert.doesNotMatch(helper, /\.from\(["']proposals["']\)\s*\.\s*update\s*\(/);
  assert.doesNotMatch(migration, /runpod|fetch\(/i);
  assert.match(migration, /eventflow\.pending_ai_proposal_edit_reviewed = 'no'/);
});

test("unauthorized calls cannot reach the proposal UPDATE", () => {
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-edit-pending-ai-proposal.sql", import.meta.url), "utf8");
  const guard = migration.indexOf("if auth.uid() is null or coalesce(public.is_staff(), false) is not true");
  const update = migration.indexOf("update public.proposals\n  set plan_content=v_persisted_plan_content");
  assert.ok(guard >= 0 && update > guard, "staff/auth guard must precede the only proposal UPDATE");
  assert.match(migration, /grant execute on function public\.eventflow_update_pending_ai_proposal[\s\S]*?to authenticated/i);
  assert.match(migration, /from public,anon/i);
});

test("approved or selected pairs are rejected and concurrent approval is serialized", () => {
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-edit-pending-ai-proposal.sql", import.meta.url), "utf8");
  const approvalCatalog = readFileSync(new URL("../../../attached_assets/Supabase_Snippet_Untitled_query_(18)_1792852202070.csv", import.meta.url), "utf8");
  assert.match(migration, /from public\.requests[\s\S]*?where id=p_request_id[\s\S]*?for update/i);
  assert.match(migration, /from public\.proposals[\s\S]*?plan_key in \('A','B'\)[\s\S]*?for update/i);
  assert.match(approvalCatalog, /PERFORM 1\s+FROM public\.requests\s+WHERE id = p_request_id\s+FOR UPDATE;/i);
  assert.match(migration, /v_a_pending<>1 or v_b_pending<>1/i);
  assert.match(migration, /where request_id=p_request_id[\s\S]*?and revision=p_revision[\s\S]*?and plan_key=p_plan_key[\s\S]*?and status='Pending Business Approval'/i);
  assert.match(migration, /approve_ai_proposal_pair/);
});

test("malformed plan JSON and invalid prices/totals fail closed", () => {
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-edit-pending-ai-proposal.sql", import.meta.url), "utf8");
  assert.match(migration, /jsonb_typeof\(p_plan_content\) is distinct from 'object'/i);
  assert.match(migration, /v_current_plan_content->>'id' is distinct from p_plan_key/i);
  assert.match(migration, /jsonb_typeof\(p_plan_content->'timeline'\) is distinct from 'array'/i);
  assert.match(migration, /jsonb_typeof\(p_plan_content->'costBreakdown'\) is distinct from 'array'/i);
  assert.match(migration, /v_amount < 0 or v_amount > 100000000 or v_amount<>round\(v_amount,2\)/i);
  assert.match(migration, /v_total<>round\(v_total,2\)[\s\S]*?or v_total<>v_sum/i);
});

test("editor persists only its field allowlist and preserves existing metadata", () => {
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-edit-pending-ai-proposal.sql", import.meta.url), "utf8");
  assert.match(migration, /v_persisted_plan_content := v_current_plan_content \|\| jsonb_build_object/i);
  assert.match(migration, /'venue',v_current_plan_content->'venue' \|\| jsonb_build_object/i);
  assert.match(migration, /'name',p_plan_content->'venue'->'name'/i);
  assert.match(migration, /'setup',p_plan_content->'venue'->'setup'/i);
  assert.doesNotMatch(migration, /'id',\s*p_plan_content->'id'/i);
  assert.match(migration, /set plan_content=v_persisted_plan_content/i);
});

test("repeat submissions update one existing row without changing workflow identity", () => {
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-edit-pending-ai-proposal.sql", import.meta.url), "utf8");
  assert.equal((migration.match(/update public\.proposals/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.proposals/i);
  assert.match(migration, /where request_id=p_request_id[\s\S]*?and revision=p_revision[\s\S]*?and plan_key=p_plan_key[\s\S]*?and status='Pending Business Approval'/i);
});

test("client UPDATE revokes cover table, PUBLIC, and column ACLs with fail-closed assertions", () => {
  const migration = readFileSync(new URL("../../../scripts/sql/eventflow-edit-pending-ai-proposal.sql", import.meta.url), "utf8");
  assert.match(migration, /revoke update on table public\.proposals from public,anon,authenticated/i);
  assert.match(migration, /revoke update \(%s\) on table public\.proposals from public,anon,authenticated/i);
  assert.match(migration, /has_table_privilege\('anon','public\.proposals','UPDATE'\)/i);
  assert.match(migration, /has_any_column_privilege\('authenticated','public\.proposals','UPDATE'\)/i);
  assert.match(migration, /a\.grantee in \([\s\S]*?a\.privilege_type='UPDATE'/i);
  assert.match(migration, /has_table_privilege\('service_role','public\.proposals','UPDATE'\)/i);
  assert.match(migration, /has_table_privilege\('postgres','public\.proposals','UPDATE'\)/i);
});
