// Offline source guards and REFERENCE client contract only.
// No app imports, SQL execution, network, credentials, Supabase or RunPod calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../sql/eventflow-contact-your-planner.sql", import.meta.url), "utf8");
const readme = readFileSync(new URL("../sql/README-eventflow-contact-your-planner.md", import.meta.url), "utf8");
const plan = readFileSync(new URL("../sql/TESTPLAN-eventflow-contact-your-planner.md", import.meta.url), "utf8");
const clean = sql.replace(/--[^\n]*/g, "");
const definitions = [...clean.matchAll(
  /create function public\.(\w+)\s*\(([\s\S]*?)\)\s*([\s\S]*?)as \$fn\$([\s\S]*?)\$fn\$;/g,
)];
const routine = suffix => {
  const definition = definitions.find(match => match[1] === `eventflow_planner_${suffix}`);
  assert.ok(definition, `missing routine ${suffix}`);
  return { arguments: definition[2], declaration: definition[3], body: definition[4] };
};

function integer(value) {
  assert.equal(typeof value, "string", "use a lossless decimal string, not a JS Number");
  assert.match(value, /^(0|[1-9][0-9]*)$/);
  return BigInt(value);
}

// NOT production frontend code. Models the required acknowledgement contract:
// completeInterval is evidence the whole authoritative history interval was
// fetched successfully, not a flag inferred from a latest page or Realtime.
// The real frontend must establish this evidence and wait for actual rendering.
function referenceAcknowledgement({
  lastAcknowledged = "0",
  fetchedAfter = "0",
  fetchedThrough = "0",
  completeInterval = false,
  activeConversation = true,
  historyRows = [],
  displayedIds = [],
  // Realtime rows do NOT establish authoritative history coverage.
  realtimeRows: _realtimeRows = [],
}) {
  const previous = integer(lastAcknowledged);
  const from = integer(fetchedAfter);
  const through = integer(fetchedThrough);
  assert.ok(through >= from, "invalid history interval");
  if (!activeConversation || !completeInterval || from !== previous) {
    return { p_conversation_id: "synthetic-conversation", p_last_seen_seq: String(previous) };
  }
  const bySequence = new Map();
  const byId = new Map();
  for (const row of historyRows) {
    const sequence = integer(row.message_seq);
    assert.ok(sequence > from && sequence <= through, "row outside verified interval");
    assert.ok(!bySequence.has(sequence) || bySequence.get(sequence).id === row.id, "conflicting order");
    assert.ok(!byId.has(row.id) || byId.get(row.id) === sequence, "conflicting message ID");
    bySequence.set(sequence, row);
    byId.set(row.id, sequence);
  }
  let displayedBoundary = previous;
  const visible = new Set(displayedIds);
  for (const sequence of [...bySequence.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!visible.has(bySequence.get(sequence).id)) break;
    displayedBoundary = sequence;
  }
  return { p_conversation_id: "synthetic-conversation", p_last_seen_seq: String(displayedBoundary) };
}

const row = sequence => ({ id: `synthetic-${sequence}`, message_seq: String(sequence) });
const complete = (patch = {}) => ({
  fetchedThrough: "3", completeInterval: true,
  historyRows: [row(1), row(2), row(3)],
  displayedIds: ["synthetic-1", "synthetic-2", "synthetic-3"],
  ...patch,
});
const boundary = input => referenceAcknowledgement(input).p_last_seen_seq;

test("reference only: acknowledge the complete actually displayed history through RPC arguments", () => {
  assert.deepEqual(referenceAcknowledgement(complete()), {
    p_conversation_id: "synthetic-conversation", p_last_seen_seq: "3",
  });
});

test("reference only: out-of-order Realtime does not advance an authoritative boundary", () => {
  assert.equal(boundary(complete({
    fetchedThrough: "1", historyRows: [row(1)],
    realtimeRows: [row(3)], displayedIds: ["synthetic-1", "synthetic-3"],
  })), "1");
});

test("reference only: latest-page-only and failed/incomplete history cannot skip earlier unread rows", () => {
  assert.equal(boundary(complete({
    fetchedAfter: "2", historyRows: [row(3)], displayedIds: ["synthetic-3"],
  })), "0");
  assert.equal(boundary(complete({ completeInterval: false })), "0");
});

test("reference only: a fetched but unrendered row stops acknowledgement", () => {
  assert.equal(boundary(complete({ displayedIds: ["synthetic-1", "synthetic-3"] })), "1");
});

test("reference only: hidden conversation never advances, even when data was fetched", () => {
  assert.equal(boundary(complete({ activeConversation: false })), "0");
});

test("reference only: verified numeric gaps are not missing-history assumptions", () => {
  assert.equal(boundary(complete({
    fetchedThrough: "4", historyRows: [row(1), row(2), row(4)],
    displayedIds: ["synthetic-1", "synthetic-2", "synthetic-4"],
  })), "4");
  assert.equal(boundary(complete({
    fetchedThrough: "4", completeInterval: false, historyRows: [row(1), row(4)],
    displayedIds: ["synthetic-1", "synthetic-4"],
  })), "0");
});

test("reference only: a later arrival after the history fetch remains outside the acknowledgement", () => {
  assert.equal(boundary(complete({ realtimeRows: [row(4)] })), "3");
});

test("reference only: duplicate delivery and unsorted history do not change the displayed boundary", () => {
  assert.equal(boundary(complete({ historyRows: [row(3), row(1), row(2), row(2)] })), "3");
  assert.throws(() => boundary(complete({
    historyRows: [row(1), { id: "conflicting-id", message_seq: "1" }],
  })), /conflicting order/);
});

test("reference only: cursor values beyond JS safe-integer range remain exact", () => {
  const previous = "9007199254740992", next = "9007199254740993";
  assert.equal(boundary({
    lastAcknowledged: previous, fetchedAfter: previous, fetchedThrough: next,
    completeInterval: true, historyRows: [row(next)], displayedIds: [`synthetic-${next}`],
  }), next);
  assert.throws(() => integer(Number(next)), /lossless decimal string/);
});

test("reference only: empty history acknowledges zero and invalid ranges are rejected", () => {
  assert.equal(boundary({ completeInterval: true }), "0");
  assert.throws(() => boundary(complete({ fetchedAfter: "4" })), /invalid history interval/);
  assert.throws(() => integer("-1"));
});

test("source: transaction and acknowledgement remain review-only and complete", () => {
  assert.equal((clean.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((clean.match(/^commit;/gm) ?? []).length, 1);
  assert.match(clean, /set local eventflow\.contact_your_planner_reviewed = 'no';/);
  assert.doesNotMatch(clean, /set local eventflow\.contact_your_planner_reviewed = 'yes'/);
  assert.match(clean, /notify pgrst,'reload schema';\s*commit;\s*$/);
  for (const tag of ["$preflight$", "$realtime$", "$postflight$"]) {
    assert.equal(clean.split(tag).length - 1, 2);
  }
  assert.equal(clean.split("$fn$").length - 1, 18);
  const unquoted = clean.replace(/'(?:''|[^'])*'/g, "");
  assert.ok(!unquoted.includes("'"));
  let depth = 0;
  for (const character of unquoted) {
    if (character === "(") depth++;
    if (character === ")") depth--;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
});

test("source: all nine signatures and secure function declarations match the review", () => {
  assert.equal(definitions.length, 9);
  const expected = {
    assign_message_order: ["", "returns trigger", false],
    request_is_eligible: ["p_request_id uuid", "returns table(", true],
    pinned_proof_is_valid: ["p_conversation_id uuid", "returns boolean", true],
    preserve_proof_anchor: ["", "returns trigger", false],
    can_access_conversation: ["p_conversation_id uuid", "returns boolean", true],
    open_conversation: ["p_request_id uuid", "returns public.eventflow_planner_conversations", false],
    send_message: ["p_conversation_id uuid, p_client_message_id uuid, p_body text", "returns public.eventflow_planner_messages", false],
    mark_read: ["p_conversation_id uuid, p_last_seen_seq bigint", "returns void", false],
    business_inbox: ["", "returns table(", false],
  };
  for (const [name, [args, result, stable]] of Object.entries(expected)) {
    const fn = routine(name);
    assert.equal(fn.arguments.trim().replace(/\s+/g, " "), args);
    assert.ok(fn.declaration.includes(result), name);
    if (name === "preserve_proof_anchor") {
      assert.match(fn.declaration, /security invoker/);
      assert.match(fn.declaration, /set search_path=''/);
    } else {
      assert.match(fn.declaration, /security definer/);
      assert.match(fn.declaration, /set search_path='' set row_security=off/);
    }
    assert.equal(/\bstable\b/.test(fn.declaration), stable);
  }
  assert.match(routine("business_inbox").declaration, /unread_count bigint/);
});

test("source: PostgreSQL 17 dependency and execution-owner privileges are checked", () => {
  assert.match(clean, /server_version_num'\)::integer < 170000/);
  assert.match(clean, /'confirmed_by','uuid'/);
  assert.match(clean, /'confirmed_at','timestamptz'/);
  assert.match(clean, /has_table_privilege\(current_user,dependency\.relation_name,'SELECT'\)/);
  assert.match(clean, /has_column_privilege\(current_user,'auth\.users','id','REFERENCES'\)/);
  assert.match(clean, /has_function_privilege\(current_user,'public\.eventflow_response_is_staff\(\)','EXECUTE'\)/);
  assert.match(clean, /has_schema_privilege\('authenticated','auth','USAGE'\)/);
});

test("source: publication authority checks executor superuser or effective inherited ownership", () => {
  assert.match(clean, /where rolname=current_user and rolsuper/);
  assert.match(clean, /pg_has_role\(current_user,v_publication_owner,'USAGE'\)/);
  assert.doesNotMatch(clean, /pg_has_role\(current_user,v_publication_owner,'MEMBER'\)/);
});

test("source: order allocation and cursor advancement share a transaction-held conversation lock", () => {
  const order = routine("assign_message_order").body;
  assert.ok(order.indexOf("for update;") < order.indexOf("new.message_seq :="));
  assert.match(order, /new\.message_seq := v_previous_seq\+1/);
  assert.match(order, /set last_message_seq=new\.message_seq/);
  for (const suffix of ["send_message", "mark_read"]) {
    assert.match(routine(suffix).body,
      /from public\.eventflow_planner_conversations c\s*where c\.id=p_conversation_id\s*for update;/);
  }
  assert.match(clean, /unique \(conversation_id,message_seq\)/);
  assert.doesNotMatch(clean, /\b(?:nextval\s*\(|create sequence|serial\b|generated .*identity)/i);
});

test("source: idempotent sends resolve before any new message INSERT", () => {
  const send = routine("send_message").body;
  assert.ok(send.indexOf("for update;") < send.indexOf("select m.* into v_message"));
  assert.ok(send.indexOf("return v_message;") < send.indexOf("insert into public.eventflow_planner_messages"));
  assert.match(send, /v_message\.body is distinct from v_body/);
  assert.match(clean, /unique \(conversation_id,sender_id,client_message_id\)/);
});

test("source: read RPC bounds and validates the displayed sequence and stores a monotonic per-user cursor", () => {
  const read = routine("mark_read").body;
  assert.match(read, /p_last_seen_seq is null or p_last_seen_seq<0/);
  assert.match(read, /p_last_seen_seq>v_latest_seq/);
  assert.match(read, /m\.conversation_id=p_conversation_id\s*and m\.message_seq=p_last_seen_seq/);
  assert.match(read, /p_conversation_id,auth\.uid\(\),clock_timestamp\(\),p_last_seen_seq/);
  assert.match(read, /greatest\(\s*existing_read\.last_read_seq,excluded\.last_read_seq\s*\)/);
  assert.match(clean, /primary key\(conversation_id,user_id\)/);
});

test("source: unread/latest message ordering uses sequence, never timestamp or UUID comparison", () => {
  const inbox = routine("business_inbox").body;
  assert.match(inbox, /unread\.message_seq>coalesce\(read_state\.last_read_seq,0\)/);
  assert.match(inbox, /unread\.sender_id<>auth\.uid\(\)/);
  assert.match(inbox, /order by m\.message_seq desc/);
  assert.doesNotMatch(inbox, /unread\.(?:id|created_at)\s*[><=]/);
  assert.doesNotMatch(clean, /last_read_message_id/);
});

test("source: new conversations are Customer-created and Customer-first, with uniform denials", () => {
  const open = routine("open_conversation").body;
  const send = routine("send_message").body;
  assert.match(open, /from public\.requests r where r\.id=p_request_id\s*for update;/);
  const requestLock = open.indexOf("for update;");
  assert.ok(open.indexOf("if not v_is_customer and not v_is_staff") < requestLock);
  assert.ok(open.indexOf("if not v_is_customer and not v_is_staff", requestLock) > requestLock);
  assert.ok(open.indexOf("for update;") < open.indexOf("from public.eventflow_planner_request_is_eligible"));
  assert.match(open, /if not v_is_customer then\s*raise exception 'Conversation unavailable\.'/);
  assert.match(open, /insert into public\.eventflow_planner_conversations\([\s\S]*?eligibility_proposal_id,eligibility_response_id/);
  assert.match(send, /for update;/);
  assert.ok(send.indexOf("for update;") < send.indexOf("if v_is_staff and not exists"));
  assert.ok(send.indexOf("if v_is_staff and not exists") < send.indexOf("select m.* into v_message"));
  assert.match(send, /m\.sender_id=v_customer_id/);
  assert.match(send, /p_conversation_id,auth\.uid\(\),v_sender_name,p_client_message_id,v_body/);
  assert.match(routine("business_inbox").body, /where latest\.created_at is not null/);
  const errors = [...open.matchAll(/raise exception '([^']+)' using errcode='([^']+)'/g)];
  assert.equal(errors.length, 9);
  for (const error of errors) assert.deepEqual(error.slice(1), ["Conversation unavailable.", "42501"]);
});

test("source: new admission is latest-only while existing chats use pinned proof", () => {
  const eligible = routine("request_is_eligible").body;
  const pinned = routine("pinned_proof_is_valid").body;
  const open = routine("open_conversation").body;
  for (const check of [
    /a\.confirmed_by is not null/, /a\.confirmed_at is not null/,
    /a\.source_revision=cr\.revision/, /p\.id=cr\.selected_proposal_id/,
    /p\.status='Accepted'/, /e\.customer_id=r\.customer_id/,
  ]) assert.match(eligible, check);
  assert.match(eligible, /p\.revision::numeric=v_latest_revision/);
  assert.match(eligible, /pending\.next_revision::numeric>v_latest_revision/);
  assert.match(eligible, /pending\.next_revision::numeric>=v_latest_revision/);
  assert.match(eligible, /pending\.status='released'/);
  assert.match(eligible, /pending\.status in \('queued','generating','business_review'\)/);
  assert.match(eligible, /having count\(distinct p\.id\)=1/);
  assert.match(eligible, /p\.revision is distinct from v_legacy_revision/);
  assert.match(clean, /eligibility_proposal_id uuid not null/);
  assert.match(clean, /eligibility_response_id uuid[\s\S]*references public\.eventflow_customer_responses\(id\) on delete restrict/);
  assert.match(clean, /eventflow_planner_conversations_eligibility_anchor/);
  assert.match(routine("preserve_proof_anchor").body, /new\.eligibility_response_id is distinct from old\.eligibility_response_id/);
  assert.match(clean, /before update of id,request_id,eligibility_kind,eligibility_proposal_id/);
  assert.match(clean, /eventflow_planner_conversations_preserve_proof_anchor/);
  assert.match(open, /if found then\s*if not public\.eventflow_planner_can_access_conversation/);
  for (const check of [
    /cr\.id=c\.eligibility_response_id/,
    /cr\.customer_id=r\.customer_id/,
    /cr\.selected_proposal_id=c\.eligibility_proposal_id/,
    /cr\.revision=c\.eligibility_revision/,
    /a\.confirmed_by is not null/,
    /a\.confirmed_at is not null/,
    /p\.status in \('Awaiting Customer','Accepted'\)/,
    /e\.customer_id=r\.customer_id/,
  ]) assert.match(pinned, check);
  assert.doesNotMatch(pinned, /latest_revision|request_is_eligible/);
  assert.match(readme, /Existing conversation; original confirmation remains valid/);
  assert.match(readme, /new-conversation eligibility/);
  assert.match(readme, /does not silently rebind its\s+history/);
});

test("source: client-only append-only contract and trusted service-role maintenance remain explicit", () => {
  assert.match(clean, /grant all on public\.eventflow_planner_conversations,[\s\S]*?to service_role;/);
  assert.match(clean, /grant select on public\.eventflow_planner_conversations,[\s\S]*?to authenticated;/);
  assert.doesNotMatch(clean, /grant (?:all|insert|update|delete) [^;]*to (?:public|anon|authenticated)/i);
  assert.match(readme, /append-only \*\*for authenticated clients\*\*/);
  assert.match(readme, /stricter trigger is \*\*not selected and not added\*\*/);
});

test("source: nine client/PUBLIC revocations and five authenticated routine grants", () => {
  assert.equal((clean.match(/revoke all on function public\.eventflow_planner_/g) ?? []).length, 9);
  assert.equal((clean.match(/grant execute on function public\.eventflow_planner_/g) ?? []).length, 5);
  assert.doesNotMatch(clean, /grant execute on function public\.eventflow_planner_(?:assign_message_order|request_is_eligible|pinned_proof_is_valid|preserve_proof_anchor)\(/);
  assert.doesNotMatch(clean, /grant execute on function public\.eventflow_planner_mark_read\(uuid\)/);
});

test("source: postflight checks security/type/owner/PUBLIC ACL contracts and exact SELECT policy shape", () => {
  for (const pattern of [
    /v_routine\.prorettype is distinct from to_regtype/,
    /v_routine\.proretset is distinct from v_routine\.returns_set/,
    /v_routine\.provolatile::text is distinct from v_routine\.volatility/,
    /v_routine\.actual_arg_names is distinct from v_routine\.arg_names/,
    /v_routine\.actual_arg_modes is distinct from v_routine\.arg_modes/,
    /v_routine\.proowner is distinct from \(current_user::regrole\)::oid/,
    /\('public\.eventflow_planner_request_is_eligible\(uuid\)','record',true,'s',\s*'\{p_request_id,eligibility_proposal_id,eligibility_response_id,eligibility_kind,eligibility_revision\}'/,
    /\('public\.eventflow_planner_pinned_proof_is_valid\(uuid\)','boolean',false,'s',\s*'\{p_conversation_id\}','\{i\}'\)/,
    /eventflow_planner_conversations_eligibility_anchor/,
    /eligibility_proposal_id\) REFERENCES public\.proposals\(id\)/,
    /eligibility_response_id\) REFERENCES public\.eventflow_customer_responses\(id\)/,
    /acl\.grantee=0 and acl\.privilege_type='EXECUTE'/,
    /p\.prosecdef is false/,
    /cmd<>'SELECT' or roles is distinct from array\['authenticated'\]::name\[\]/,
    /t\.tgtype=7/,
    /t\.tgtype=19/,
    /t\.tgenabled='O'/,
  ]) assert.match(clean, pattern);
});

test("source: additive migration leaves existing application objects unchanged", () => {
  assert.equal((clean.match(/create table public\./g) ?? []).length, 3);
  assert.equal((clean.match(/create trigger /g) ?? []).length, 2);
  assert.equal((clean.match(/create policy /g) ?? []).length, 3);
  assert.equal((clean.match(/enable row level security/g) ?? []).length, 3);
  assert.doesNotMatch(clean,
    /\b(?:insert into|update|delete from|alter table|truncate(?: table)?|drop table)\s+public\.(?:requests|proposals|profiles|events|eventflow_customer_responses|eventflow_customer_response_actions)\b/i);
  assert.doesNotMatch(clean, /create or replace|alter default privileges|drop\s+(?:table|function)/i);
  assert.match(clean, /alter publication supabase_realtime\s*add table public\.eventflow_planner_messages;/);
});

test("documentation: staging isolation, synthetic data, RLS, rollback and Realtime tests are explicit and unexecuted", () => {
  for (const pattern of [
    /separate Supabase development\/staging project/,
    /No SQL.*executed/s,
    /schema-only/,
    /two genuinely independent database connections/,
    /first sender rolls back/,
    /real staging user sessions/,
    /Reconnection performs authenticated history catch-up/,
    /Customer-first/,
    /Passing staging tests does not authorize Production installation/,
  ]) assert.match(plan, pattern);
  assert.match(readme, /cannot know what a browser actually rendered/);
});
