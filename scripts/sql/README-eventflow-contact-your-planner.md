# Contact Your Planner: review-only migration package

## Status

`eventflow-contact-your-planner.sql` is a proposed migration. It has **not** been
executed. The `eventflow.contact_your_planner_reviewed` acknowledgement remains
`'no'`. No application code, notification objects, Production data, Realtime
settings, or website deployment were changed.

**Execution status: REVIEW ONLY / NOT EXECUTED.** The user approved the policy
for this next SQL draft only. That approval does not approve database installation.
The migration acknowledgement remains `no`; the required staging compatibility,
security and transaction tests have not run.

Production verification supplied by the user confirms PostgreSQL **17.11
(170011)** and the Customer Response Actions columns `confirmed_by` (`uuid`,
nullable) and `confirmed_at` (`timestamptz`, nullable). These facts were not queried
again by the agent. The preflight now explicitly verifies those column types and
requires PostgreSQL 17+ for its `MAINTAIN` privilege assertions. Nullable columns
are expected for non-confirmation actions; chat eligibility requires both values
to be non-null for a confirmed selection. No existing column is altered.

The Production ownership column is confirmed as UUID and NOT NULL. The exact
catalog result for a direct `requests.customer_id -> auth.users.id` foreign key
was not included in the uploaded summary. This migration deliberately does not
require or add that FK: every customer authorization checks `requests.customer_id`
against `auth.uid()` and calls the approved-customer helper. The FK is still an
unverified referential-integrity fact and must be checked with Query 1 below.

## Evidence used

- No existing chat/conversation table was found.
- `notification_events` and `notification_reads` exist with RLS and staff-only
  policies. This migration does not alter them.
- Existing approved-profile helpers are `eventflow_response_is_customer()` and
  `eventflow_response_is_staff()`.
- The shared Business access model is approved staff/admin, with no planner
  assignment or separate Planner role.
- The `supabase_realtime` publication exists, supports INSERT, and is not
  configured for all tables. This migration adds only the new messages table.
- Earlier supplied snapshot (not freshly queried): three
  `selection_confirmation / confirmed` actions, three
  `selection / selection_submitted` responses, one `change_request /
  changes_requested`, 34 `Awaiting Customer` proposals, and no legacy `Accepted`
  proposals or linked Events.
- The legacy `accept_proposal(uuid)` definition requires Customer ownership,
  creates an Event for the proposal, and sets the proposal status to `Accepted`.
- Current Business confirmation is represented by the saved selection response
  joined to a `selection_confirmation / confirmed` action for the same request,
  response revision, and selected proposal. That function does not itself change
  the proposal status from `Awaiting Customer`.

## Missing FK catalog result

Run this read-only query in Production and retain its result:

```sql
select
  'requests_customer_auth_foreign_key' as check_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid, true) as definition,
  con.convalidated as validated
from pg_catalog.pg_constraint con
where con.conrelid = 'public.requests'::regclass
  and con.confrelid = 'auth.users'::regclass
  and con.contype = 'f';
```

Expected: either a validated FK covering `requests.customer_id` and
`auth.users.id`, or no rows. If absent, the migration still enforces chat ownership
by comparing the saved request owner with `auth.uid()` and verifying the approved
Customer profile. It does not silently add a FK or alter existing requests.

If a final status/function confirmation is needed, use these read-only queries:

```sql
select
  p.oid::regprocedure as routine,
  p.prosecdef as security_definer,
  p.proconfig as settings,
  pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('accept_proposal','eventflow_confirm_customer_selection')
order by p.proname,p.oid::regprocedure::text;
```

```sql
select 'proposal' as source, coalesce(p.status,'<NULL>') as state,
  count(*) as row_count, count(e.proposal_id) as linked_event_count
from public.proposals p
left join public.events e on e.proposal_id=p.id
group by p.status
union all
select 'customer_response',
  coalesce(cr.response_kind,'<NULL>') || '/' ||
  coalesce(cr.response_status,'<NULL>'),
  count(*),0::bigint
from public.eventflow_customer_responses cr
group by cr.response_kind,cr.response_status
union all
select 'business_action',
  coalesce(a.action_kind,'<NULL>') || '/' || coalesce(a.status,'<NULL>'),
  count(*),0::bigint
from public.eventflow_customer_response_actions a
group by a.action_kind,a.status
order by source,state;
```

The migration's **new-conversation eligibility** function accepts either:

1. A current selection response whose selected proposal belongs to the same
   request/revision and Plan A/B ID/key, remains `Awaiting Customer`, and has a
   matching `selection_confirmation / confirmed` Business action with non-null
   `confirmed_by` and `confirmed_at`; or
2. A legacy proposal with status `Accepted` and an Event linked to that proposal
   whose `customer_id` matches the request owner.

The second condition follows the reviewed legacy RPC, which both creates that
Event and changes the proposal status. For a new conversation, numeric legacy
revisions must be current; unorderable history is accepted only as one exact,
unambiguous revision context without revision-action history. The current supplied
Production snapshot contains no such legacy rows, so that branch lacks a
Production example.

## Object and authorization design

New objects, all prefixed `eventflow_planner_`:

- `conversations`: one row per request, enforced by unique `request_id`, with a
  restrictive FK to requests, `last_message_at`, transactional `last_message_seq`,
  and a pinned eligibility proof: proof kind, selected/accepted proposal ID,
  original response ID for current flow, and original revision. The pinned columns
  have checks and restrictive FKs; no proposal/response content is copied or
  overwritten. A BEFORE UPDATE OF trigger prevents changing the conversation ID,
  request ID, or pinned proof columns even through ordinary trusted service-role
  updates; database owners can still disable/drop the trigger. A request with a conversation
  cannot be deleted through ordinary FK-respecting operations; this intentionally
  protects chat history and should be checked against any future administrative
  request-deletion process.
- `messages`: text that is append-only **for authenticated clients**, authenticated
  sender UUID, sender-name snapshot,
  database timestamp, trigger-assigned positive `message_seq`, unique
  `(conversation_id,message_seq)` order, and a unique
  `(conversation_id,sender_id,client_message_id)` idempotency key. Body is trimmed
  and limited to 1–4,000 characters.
- `reads`: one `last_read_seq` cursor per conversation and authenticated user;
  zero means no messages acknowledged. `last_read_at` is an audit timestamp only.
  The RPC verifies a nonzero cursor names a real message in the same conversation
  and never decreases an existing cursor. There is no UUID read-cursor field.

No customer ID is copied into a conversation. It is derived from the request to
avoid a second, potentially inconsistent owner value. No FK is added to
`requests.customer_id`; its direct Auth FK result remains unverified.

Authenticated users receive table SELECT only. RLS restricts reads to the owning
approved Customer or the shared approved Business staff/admin group. There are
no direct client INSERT/UPDATE/DELETE policies. All writes go through
authenticated-only, SECURITY DEFINER RPCs with an empty search path and
`row_security=off`; RPCs use `auth.uid()` rather than trusting a client sender ID.
The internal eligibility helper is not executable by API roles.

The current access helper rechecks eligibility as well as approval and request ownership
for SELECT policies, sends, and read acknowledgements. The Business inbox also
filters by eligibility. Removing the required confirmation facts therefore fails
closed for chat without changing any proposal/response workflow. Existing valid
legacy acceptance remains supported. Previously approved Business confirmations
are not reinterpreted according to the approver's current account status.

`eventflow_planner_request_is_eligible(uuid)` is for **new** conversation
creation. It requires a valid Business-confirmed selection on the latest numeric
proposal revision and blocks a higher queued/in-progress revision action before
its proposal rows exist. Existing conversations instead use
`eventflow_planner_pinned_proof_is_valid(uuid)`: it verifies the exact saved
response, selected proposal, confirmation action and request owner without
requiring that pinned revision to remain latest. A newer revision alone therefore
does not hide an already-valid conversation.

When a previously confirmed selection becomes stale before a conversation exists,
it cannot create one. If pinned proof or request ownership later becomes invalid,
the conversation is denied and retained; this draft does not silently rebind its
history to a newer selection. A future administrative reauthorization/rebind is a
separate design decision, not an implicit fallback.

`eventflow_planner_open_conversation(uuid)` uses the same `42501 / Conversation
unavailable.` response for a nonexistent request, an unauthorized or unapproved
account, an ineligible request, or a Business-open attempt before the Customer
creates the conversation. This removes the distinct request-existence errors.

The send RPC locks the conversation and resolves duplicate sends before trying
an INSERT. Retrying the same key/body returns the original message and order;
reusing the key with different text is rejected. Messages keep a sender-name
snapshot so Customers do not need expanded access to other users' `profiles`.
The first-sender check runs only after the conversation lock and authorization
recheck. Concurrent Customer/Business attempts therefore serialize: a Business
send that wins before any Customer message is rejected; after the Customer commits
the first message, the Business reply can proceed. New-thread open checks the
caller before locking, then locks the request and rechecks owner/approval before
reading latest-revision evidence, limiting unauthorized lock contention.

Per-user read cursors give each Business staff member independent unread counts.
The inbox RPC is Business-only and returns the latest message and unread count;
it does not grant Customers staff inbox access. The messages table is added to
the existing Realtime publication without changing its global operation settings;
the planned UI subscribes to INSERT events. Existing notification tables/policies
are untouched.

### Append-only scope and optional strict enforcement

The migration does **not** make messages strictly immutable to all database
roles. `anon` has no table access; `authenticated` has SELECT only and no mutation
policies; the send RPC inserts only. Trusted `service_role` retains table CRUD,
and owners can maintain the database. Thus authenticated clients cannot edit,
delete, or truncate messages, but trusted service-role UPDATE/DELETE operations
are intentionally not blocked by this draft.

This client-only append-only contract is approved for the review draft. Use
audited, separately approved trusted maintenance for retention/corrections. It
preserves trusted-operation compatibility and does not claim tamper-proof history.

If strict operational append-only is required, propose an additional
`BEFORE UPDATE OR DELETE OR TRUNCATE ... FOR EACH STATEMENT` trigger on messages,
calling a private trigger function that always raises an exception. Use
`ENABLE ALWAYS TRIGGER` if replica-mode writes must also be blocked. This would
reject even zero-row mutation attempts while leaving message INSERTs,
conversation-counter updates and per-user read updates functional. No new
runtime bypass flag or caller-settable custom GUC should disable that guard.
Any future retention, redaction, or repair would require separately authorized,
audited owner maintenance; owners/superusers can still disable/drop triggers,
so this is not cryptographic or owner-proof immutability.

That stricter trigger is **not selected and not added**. If reconsidered later, update the
grants/postflight/test contract too: a successful trusted CRUD privilege check
would no longer imply successful UPDATE/DELETE execution. Decide retention and
repair requirements before enabling this option.

### Business inbox behavior: unchanged

Only the owning approved Customer creates a conversation via the open RPC.
Opening creates an empty thread but does not send a message. Business staff
cannot create it. The send RPC locks the same conversation row used by the order
trigger and rejects Business sends until an authenticated message from the current
request-owning Customer exists. The Business inbox also excludes a thread until
an actual first message exists (`latest.created_at IS NOT NULL`).

UX implication: opening and abandoning chat does not alert Business; an approved
Business user may read the empty conversation row if they know its ID, but cannot
send until the Customer sends first. Do not expose empty threads in the shared
Business inbox or create Business-initiated conversations. An INSERT using a
spoofed Customer sender ID is not allowed through the authenticated RPC, which
sets `sender_id=auth.uid()`.

## Implemented draft policy: latest admission, pinned continuity

| Case | Proposed result |
| --- | --- |
| No conversation; latest revision is selected and Business-confirmed | Customer may create one conversation |
| No conversation; old revision confirmed, newer revision saved or explicitly queued | Deny creation until the current revision is confirmed |
| Existing conversation; original confirmation remains valid; newer revision queued/pending/released | Preserve history, sends, read cursors, and inbox visibility |
| Existing conversation; original proof removed/revoked, ownership mismatch, or caller loses approval | Deny access; retain all rows |
| Existing conversation; newer selection later confirmed | Keep the same thread; do not silently overwrite its original eligibility evidence |
| Valid legacy Accepted proposal with matching Event | Apply the legacy freshness rule below for creation, or preserve its pinned proof for an existing conversation |

1. With no conversation, the Customer must have a confirmed selection for the
   latest current proposal revision. Revision strings must be positive decimal
   text of at most 32 digits and are compared as `numeric`, never lexically.
   Any invalid/unorderable proposal revision blocks this current-flow admission.
2. A queued/generating/business-review action for the current or a higher target
   revision, or a released action targeting beyond the highest saved proposal,
   blocks stale admission even if proposal rows do not yet exist. A released action
   targeting the current revision is expected after Business approval. Conversation
   creation locks `requests` before checking/inserting; reviewed revision-start
   and revision-persistence functions also lock the request first. Verify those
   installed lock contracts before relying on this race protection.
3. New-conversation legacy admission requires one matching Accepted proposal and
   owner Event. Numeric history must be latest and have no higher in-flight action.
   Unorderable history is accepted only if all request proposals have exactly the
   same revision (including all-NULL), there is exactly one valid Accepted/Event
   proposal, and no revision action exists. Mixed/ambiguous history fails closed.
4. Creation stores the proof anchor. Current-flow access checks the original
   selection response, selected Plan A/B ID/key, same request/customer/revision,
   matching confirmed action and non-null confirmation fields, and the selected
   proposal still has an accepted status (`Awaiting Customer` or `Accepted`).
   Legacy access checks the pinned Accepted proposal and linked Event owner.
5. Existing-chat access rechecks the current caller's approved role and current
   request owner against the pinned evidence but does not compare the pinned
   revision with latest proposals or pending revisions. A newer proposal revision
   alone preserves the existing thread and unread history.
6. If the pinned confirmation is removed, its proposal becomes invalid, request
   ownership no longer matches, or caller loses approved status, access fails
   closed and data stays intact. Confirming a later selection does not silently
   rewrite the old thread's proof. Any recovery/rebind needs a separate authorized
   workflow.
7. Legacy/malformed histories may be blocked for new threads; no timestamps or
   lexicographic text ordering are guessed.

This does not modify approval, generation, revision, request or proposal
workflows. It only determines whether a new conversation can be created and
whether an existing anchored conversation remains accessible.

## Message ordering and transaction safety

The old `(created_at, random UUID)` unread boundary is removed. UUIDs remain row
identifiers, and timestamps remain human-readable metadata; neither establishes
message order. A PostgreSQL global sequence, `SERIAL`, or identity column is not
used: sequence allocation order is not transaction commit order.

The new `eventflow_planner_messages_assign_order` BEFORE INSERT trigger calls
`eventflow_planner_assign_message_order()`:

1. Lock the conversation row with `SELECT ... FOR UPDATE`.
2. Only after acquiring the lock, assign the next `message_seq` from the row's
   transactional `last_message_seq` value. Ignore any caller-supplied order or
   timestamp and set the timestamp on the server.
3. Update the conversation counter and insert the message within the same
   transaction. PostgreSQL retains that row lock until the whole transaction
   commits or rolls back, even if the RPC has already returned.

The trigger is not client-executable and applies to trusted service-role INSERTs
too. Normal application sends must use the RPC. The unique order constraint is a
second guard against duplicate orders. Do not assume gapless numbering: trusted
raw `INSERT ... ON CONFLICT DO NOTHING` can advance the counter without adding a
message. Only actual message rows contribute to unread counts and the latest
inbox message, and read cursors must identify actual message rows (or zero).

`eventflow_planner_mark_read(uuid,bigint)` acquires the **same conversation lock**.
The second parameter, `p_last_seen_seq`, must be the highest contiguous message
order the UI has actually displayed through its read boundary, not the server's
latest counter or the newest out-of-order Realtime event. The RPC checks the
cursor is nonnegative, no greater than the locked counter, and, unless zero,
exists in this conversation. It then stores the greater of the old and supplied
cursor for `auth.uid()` only.

The database can validate that the boundary exists and belongs to the caller's
conversation, but it **cannot know what a browser actually rendered**. The future
frontend must prove locally that the entire interval after its last acknowledged
boundary was fetched successfully and displayed before advancing. "Contiguous"
means complete history coverage, not consecutive integers: verified sequence
gaps are allowed. A latest-page-only fetch, failed intermediate page, hidden
browser tab, unrendered row, or an out-of-order Realtime message is not sufficient.
Do not use the newest received order or conversation counter as a shortcut.

The executable offline reference tests in
`scripts/tests/contact-your-planner-review.test.mjs` cover this client contract,
including out-of-order arrivals, incomplete history, verified gaps, retries,
hidden/unrendered history and lossless bigint cursors. They do not import or test
an application frontend, execute SQL, or prove that a browser follows the contract.

This is a deliberate signature change in an **uninstalled draft**: the old
one-argument read RPC is not installed or granted. Future frontend code must pass
the displayed sequence. Neither frontend nor backend code is changed here.

### Why a read cursor cannot overtake a later-committing lower-order message

- If a sender has assigned order N but not committed, it still holds the
  conversation lock. A competing sender cannot assign N+1 and a reader cannot
  advance the cursor until that transaction finishes.
- If the sender commits, its message is visible before a waiting read RPC
  validates/advances a cursor under normal READ COMMITTED isolation. If it rolls
  back, both the message and counter increment roll back.
- If a reader locks first and acknowledges N, a later sender can only allocate a
  higher order. That message remains unread. A transaction that started earlier
  but sends later likewise receives an order only when it acquires the lock.
- Under REPEATABLE READ / SERIALIZABLE, an incompatible stale snapshot can raise
  a serialization failure rather than advance a cursor. Errors must not be
  hidden; any retry must reuse the original send key.
- A message committed between a history fetch and read acknowledgement is not
  silently marked read: the caller still supplies its previously displayed
  boundary.

History/pagination sorts by `message_seq`, and unread counts use
`message_seq > coalesce(last_read_seq,0)` while excluding the caller's own sends.
Inbox thread sorting still uses display timestamps; it does not promise global
commit ordering across independent conversations and has no role in message or
unread correctness.

The guarantee assumes the installed trigger remains enabled and normal clients
retain SELECT-only table access. Trusted owners/service roles can deliberately
alter tables, disable triggers, or update/delete history, and are outside that
client-security guarantee. No data-retention or deletion behavior is added.

## UI implementation plan (not included in this SQL draft)

1. Add the responsive Contact Your Planner entry to eligible Supabase-backed
   Customer proposal details. It appears only after current Business confirmation
   or verified legacy acceptance.
2. On opening, call the open-conversation RPC, subscribe to message INSERTs and
   reconcile history under RLS in `message_seq` order so arrivals during setup
   are not missed. Deduplicate by message ID/order. Call
   `eventflow_planner_mark_read` with `p_conversation_id` and `p_last_seen_seq`
   only through the contiguous displayed boundary. If a Realtime order arrives
   ahead of loaded history, fetch the intervening history before acknowledging
   it; do not acknowledge unseen earlier rows. Use lossless integer handling for
   bigint cursors (do not round large cursor values in JavaScript).
3. Add a Messages route to the existing Business sidebar. Load the shared inbox
   via its RPC and conversation history via RLS-protected SELECT.
4. Reuse existing authentication, layout, typography, pink palette, and refresh
   behavior; do not add polling or modify proposal/notification workflows.

Expected frontend files: `artifacts/eventflow-ai/src/customer/Portal.tsx`,
`artifacts/eventflow-ai/src/customer/data.tsx` or focused new chat/service files,
`artifacts/eventflow-ai/src/business/BusinessPortal.tsx`, plus focused tests.
No Express service-role endpoint is required.

## Verification and acceptance tests

After migration review and only in an approved test environment:

Use the separate-project checklist and matrix in
`TESTPLAN-eventflow-contact-your-planner.md`. Do not run fixture, mutation,
concurrency or Realtime tests against Production.

- Confirm all three new tables have RLS enabled; anon has no effective table
  privileges; authenticated has SELECT only; service_role remains trusted.
- Confirm the five exposed routines have authenticated EXECUTE, with no
  anon/PUBLIC execution. The eligibility helper and order-trigger function must
  not be executable by authenticated/anon/PUBLIC.
- Confirm only the three intended SELECT policies exist and call the access helper.
- Confirm the enabled BEFORE INSERT order trigger and BEFORE UPDATE
  anchor-protection trigger reference their expected functions.
- Confirm `eventflow_planner_messages` is in `supabase_realtime`.
- Unauthenticated/anon access is denied.
- Customer A cannot open, read, mark read, or send to Customer B's request.
- Unapproved Customer and Business profiles are denied.
- Approved Business staff/admins can access the shared inbox but cannot create a
  conversation before the Customer opens it.
- Current flow: the three confirmed-selection cases qualify only when the exact
  response, selected proposal, request, and confirmed action all match.
- Legacy flow: synthetic `Accepted` proposal plus correctly linked Event qualifies;
  `Accepted` without the matching Event, or an Event for another owner, does not.
- Change Request alone does not qualify.
- A confirmation with null `confirmed_by` or `confirmed_at`, mismatched request/
  revision/selection, an unreleased proposal, or an unapproved current caller
  does not qualify. The pinned-proof and latest-admission rules are in this
  review draft; their actual SQL and concurrent behavior are not yet tested.
- Nonexistent and unauthorized request IDs produce the same open-RPC error.
- Concurrent opens create one conversation per request.
- A caller who is not the owner or approved staff is rejected before request-row
  locking; ownership and approval are rechecked after the lock.
- Trusted service-role attempts to retarget pinned proof columns fail; permitted
  message/read maintenance remains available under the client-only append contract.
- Same send key/body returns one message; same key with different body is rejected;
  neither retry allocates a new order. Different keys produce separate orders.
- Read cursors and unread counts are independent per Customer and Business user.
- Use two test database connections: hold a send transaction open after assigning
  order N; a competing send/read must block on the conversation row. Commit the
  first transaction and verify ordered visibility; repeat with rollback and
  verify the counter and message both roll back. Do not run these tests against
  Production without separate approval.
- Start a transaction before another sender, but delay its send until after the
  second transaction commits and a reader acknowledges that message. The delayed
  send must get a higher order and remain unread.
- Hold a read transaction open first; a competing sender must wait and then get
  a higher order. Test a history-fetch/read-RPC interleaving: later arrivals stay
  unread when the UI acknowledges its earlier displayed sequence.
- Identical timestamps, reverse-sorting UUIDs, and stale lower read cursors must
  not lose unread messages or move a cursor backwards. Reject negative/null,
  future, nonexistent, and wrong-conversation cursor values without mutation.
- History ordering/pagination and authenticated Realtime INSERT delivery work on
  desktop and mobile; unauthorized subscribers receive no rows.
- Existing proposal, response, action, event, and notification counts remain
  unchanged by installation.

No test messages or sample activity are seeded by this migration.

## Static review versus database execution

Static checks inspect acknowledgement, transaction boundaries, quote/statement
structure, lock placement, sequence allocation, bounded monotonic read cursors,
eligibility fields, uniform errors, grants, RLS, and publication statements.
They do **not** prove PostgreSQL execution, lock behavior, effective permissions,
or Realtime delivery. No SQL has been executed for this revision.

Run the persistent offline checks with:

```sh
node --test scripts/tests/contact-your-planner-review.test.mjs
```

The prior 27 ad-hoc text checks were superseded by this repeatable test file.
The latest revision's test count and result are recorded in the final review
response. The tests cover source contracts and offline reference behavior only. PostgreSQL syntax
parsing/execution, actual concurrent-session behavior, effective runtime RLS,
and Realtime delivery remain **NOT VERIFIED**. Passing source guards is not a
PostgreSQL or authenticated-browser test.

### PostgreSQL 17 signature and permission review

| Routine | Result | Volatility / access |
| --- | --- | --- |
| `eventflow_planner_assign_message_order()` | trigger | volatile; trigger-only, no API EXECUTE |
| `eventflow_planner_request_is_eligible(uuid)` | table of proof-anchor fields | stable; internal latest-revision admission only |
| `eventflow_planner_pinned_proof_is_valid(uuid)` | boolean | stable; internal existing-conversation authorization |
| `eventflow_planner_preserve_proof_anchor()` | trigger | volatile; invoker; trigger-only, no API EXECUTE |
| `eventflow_planner_can_access_conversation(uuid)` | boolean | stable; authenticated EXECUTE for RLS |
| `eventflow_planner_open_conversation(uuid)` | conversations row | volatile; authenticated |
| `eventflow_planner_send_message(uuid,uuid,text)` | messages row | volatile; authenticated |
| `eventflow_planner_mark_read(uuid,bigint)` | void | volatile; authenticated |
| `eventflow_planner_business_inbox()` | set of eight named columns | volatile; authenticated; staff checked internally |

The eight API/internal workflow routines retain SECURITY DEFINER,
`search_path=''`, `row_security=off`. The separate anchor-protection trigger
function is SECURITY INVOKER with `search_path=''` and no API EXECUTE grants. The
message-order trigger is BEFORE INSERT, FOR EACH ROW (`tgtype=7`); the anchor
guard is BEFORE UPDATE OF the identity/proof columns, FOR EACH ROW (`tgtype=19`).
All nine new routines are revoked from PUBLIC/anon/authenticated before granting
EXECUTE only on the five customer/staff-facing RPCs.
The old one-argument mark-read signature is collision-checked but not installed.
No new sequence object or sequence grant is needed. New tables retain client
SELECT only and trusted service-role access; three SELECT policies remain.

Review changes add preflight checks for actual dependency SELECT/FK REFERENCES,
schema USAGE, and auth/helper EXECUTE privileges; BYPASSRLS alone does not grant
ordinary table access. Publication ownership now checks the **executing** role's
superuser status/effective inherited ownership (`USAGE`), not whether the owner
itself happens to be superuser. A non-inheriting membership (`MEMBER` only) must
SET ROLE appropriately before installation. The postflight now verifies every
SECURITY DEFINER routine's signature, result type, volatility, input/output
argument names and modes, owner, security settings and PUBLIC ACL. It separately
verifies the SECURITY INVOKER anchor-trigger function and both trigger
definitions, and confirms all policies are authenticated-only SELECT policies.
These are PostgreSQL 17 catalog/source assertions, not engine-executed verification.

The supplied PostgreSQL 17.11 result resolves the prior `MAINTAIN` compatibility
uncertainty; the supplied confirmation-column results resolve those type
uncertainties. The policy decisions are implemented in this review draft, but
remaining gates are actual SQL-engine parsing/execution in the separate
development/staging project, the outstanding ownership-FK catalog result and
referential-integrity review, real RLS/RPC tests, concurrent transaction tests,
Realtime tests, and separate migration-installation approval. This drafting
approval does not authorize any of those database operations. The absence of
the ownership FK alone does not bypass RPC ownership authorization.

## Execution and rollback plan

1. Complete the separate-project test plan, confirm the outstanding FK fact, and
   verify the actual acceptance/confirmation/revision function definitions and
   request-first lock ordering.
2. Have the revised migration reviewed and separately approved. In a one-time execution
   copy only, change its acknowledgement from `no` to `yes`; leave the repository
   review draft at `no`.
3. Run the entire transaction once as the authorized database owner. Do not run
   fragments or call any RPC as a migration test.
4. Verify the table/RPC grants, RLS policies, Realtime membership and unchanged
   existing-row counts before any UI code or activation. The two-argument read
   RPC and transaction-order trigger must match this revised draft.

Non-destructive rollback: remove the new messages table from the Realtime
publication, revoke authenticated grants/EXECUTE from the new objects, and keep
the new tables/data intact for investigation. This disables client access without
touching requests, proposals, Events, or notifications.

Full schema removal is a separate destructive decision: first export and retain
messages, then remove publication membership and drop the new functions/tables in
dependency order. Never cascade-drop existing application tables or delete
historical requests/proposals/events/notifications.
