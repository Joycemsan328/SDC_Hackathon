# Business-first EventFlow workflow — REVIEW ONLY

**Not installed, activated, published, or tested against live SQL. No AI calls were made.**
The older selection-first SQL has been replaced, not applied. This is an
installation for a database with no EventFlow workflow objects. It deliberately
fails if an earlier version was installed.

## State machine and actors

| From | Action | Actor | To |
|---|---|---|---|
| No managed revision / queued | Acquire expiring lease | Backend, verified owner | generating |
| generating | Atomically insert A and B | Backend only | business_review |
| business_review | Review and release the complete pair | Approved Business/admin | released |
| released | Choose one released proposal | Approved owning customer | selected |
| selected | Change choice before confirmation | Approved owning customer | selected |
| released / selected | Request changes with message | Approved owning customer | old: changes_requested; new: queued |
| selected | Confirm exact current choice/timestamp | Approved Business/admin | confirmed |

Every new revision repeats generation → Business review/release. Old proposal
rows, prices, release audit data and change messages are retained. The generator
uses original requirements plus cumulative change messages. Overlong accumulated
history is rejected rather than silently truncating instructions.

## Mandatory catalog review before installation

The owner's checks confirm UUID primary keys, request FK, A/B CHECK, no conflicting
UNIQUE *constraint*, no reported triggers, and absent workflow objects.
They do **not** include the effective RLS/privilege inventory or independent unique
index definitions. This Agent could not retrieve those through the public API.

`eventflow-workflow-catalog-review.sql` is a **read-only script for later owner review**.
It was not executed. Inspect its results for:

1. All column types/defaults/nullability. `proposals.id` needs a UUID default;
   omitted NOT NULL columns need defaults. Verify copied request types and JSON.
2. `status` must accept `Pending Business Approval`; revision must support each
   positive integer serialized as text. Check enum labels and CHECK definitions.
3. Independent indexes, including expressions/partial indexes, must allow both
   plan keys and multiple revisions. A missing UNIQUE constraint is not proof.
4. All existing RLS policies, table/column grants, RLS/FORCE RLS and table ownership.
5. Profile writes and RPCs: customers must not be able to change their own
   role/account_type/approval_status or insert an approved staff/admin profile.
6. Every existing SECURITY DEFINER RPC and view which reads or writes proposals.
   Owner-rights views, materialized copies, legacy approval/persistence functions,
   broad RPCs, or a leaked service key can bypass base-table RLS. They must be
   revoked/secured in an explicit, separately reviewed compatibility addendum.
   Do not blindly revoke all old functions; registration/admin features may use them.
7. Triggers and trigger-function definitions, including profile and request
   triggers, for side effects or authority escalation.

Until this review and any necessary addendum are complete, **NO-GO for activation**.
The migration intentionally starts with `eventflow.catalog_reviewed = 'no'`.
Only the owner should change that acknowledgement after resolving these items.
The gate is a manual review safeguard, not an automatic security audit.

## Proposed database changes

- Add `eventflow_proposal_revisions` and `eventflow_generation_leases`.
- Add ownership/staff helpers and server-only generation/persistence RPCs.
- Add authenticated release, selection, change-request, confirmation, and
  explicit legacy-adoption RPCs.
- Enable proposal RLS and add a restrictive SELECT guard ANDed with all old
  permissive policies. Customers see only their released pair IDs; unregistered
  legacy proposals are hidden. Business sees existing proposals.
- Add restrictive INSERT/UPDATE/DELETE guards for browser roles. This intentionally
  blocks any existing browser-direct proposal-content edits; such workflows need
  reviewed backend/RPC alternatives before activation.
- New tables have no client write policies; lease data is backend-only.
- Explicitly revoke PUBLIC/anon/authenticated execution from generation/persistence
  RPCs, then grant only to service_role. Definer functions use empty search paths.
- No updates/deletes to existing requests, proposals or profiles. Existing
  proposals.status is not rewritten: new UI states derive from the revision ledger.

Foreign keys intentionally restrict deletion of referenced records. This may
affect older delete flows and must be accepted before installation.

## Existing proposals

No existing pair is automatically trusted, released or regenerated.
After installation, approved Business staff can open an existing proposal under
`/business/proposals`, choose **Register existing pair for Business review**,
inspect both plans and then **Release both plans to Customer**.
Adoption references existing IDs without editing the original proposal rows.
Only an unambiguous, complete, latest positive-integer revision is accepted.
Non-numeric revisions, duplicate/incomplete pairs, or ambiguous legacy data remain
blocked for an owner-reviewed mapping. Older already-released revision history
remains readable to its owner, but only the current released revision is selectable.

## Backend configuration (NAMES ONLY)

Existing public config: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Optional server aliases: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.

New server-only credential: `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
Never use a VITE_ prefix. Nothing was requested, added or changed during preparation.

Activation flag: `EVENTFLOW_BUSINESS_FIRST_ENABLED`. Keep absent/false until SQL
and security review pass. The route returns 503 before RunPod when disabled.

Existing generation credentials: `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`.
No browser ever receives privileged credentials, generation tokens, or draft JSON
from the generation response.

## Checks performed without SQL or paid calls

- API tests inject mock AI and mock Supabase responses.
- Contract generation and workspace TypeScript checks.
- Static SQL guardrail assertions (not database execution/SQL syntax proof).
- Production compilation and read-only health checks.
- Browser verification must use intercepted Supabase/API fixtures only.

Before deployment, test the SQL against an isolated matching schema after separate
approval. Verify direct customer REST reads return no drafts, client persistence
RPCs fail, profile self-promotion fails, staff can release both, other customers
cannot read them, stale selections cannot be confirmed, retries do not regenerate,
and revision 2 is hidden until another Business release. This was not proven by
the mock/static tests and is a deployment blocker.

No migration or seed runs during build/start. No public mock-AI switch was added.

## Later activation sequence — not authorized in this preparation

1. Complete catalog review and compatibility addendum; approve exact final SQL.
2. Validate installation and RLS in an isolated schema with mock-generated fixtures.
3. Take/verify a backup and coordinate an installation window. Existing legacy
   visibility and browser-direct writes change when policies install.
4. Install approved SQL. Keep generation disabled while verifying access controls.
5. Add server-only credential through Secrets, then enable the activation flag.
6. Explicitly register/release legacy pairs where appropriate.
7. Run a separately authorized paid generation smoke test only if desired.
8. Publish only after the owner separately authorizes deployment.
