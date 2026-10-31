# Customer Response Workflow — Phases 1–3 review package

**PREPARATION ONLY. Not installed, activated, wired into the app, or published.**
Do not execute the migration or any record-writing integration tests without
separate approval. No startup/build hook references these files.

## Evidence and review gate

The configured Supabase Data API returned HTTP 200 on 2026-10-30. It exposes
requests/proposals/profiles and the existing acceptance/pair-approval RPCs, not
the proposed response table/RPC or the earlier revision ledger.
The uploaded catalog exports show owner-scoped Customer reads, staff-only
proposal writes, and the independent unique (request_id, revision, plan_key)
index. They also show historical client TRUNCATE grants.

Those exports do NOT establish today's RLS enabled/FORCE flags, effective role
privileges, trigger definitions, private objects or profile-writer security.
No owner catalog SQL was executed. Run **eventflow-customer-responses-preflight.sql
first**, returning every result set, including empty ones. Review before changing
the migration acknowledgement from `no` to `yes`; that change is not approval by
itself. Migration execution remains a separately authorized step.

The draft asserts base RLS, types, a compatible unique index and trusted function
owner, and refuses existing response/older workflow objects pending coexistence
review. The index's partial predicate
requires manual owner review. Profile escalation paths, legacy definer functions,
and grants must be reviewed; merely enabling RLS is not sufficient.

## Narrow database design

One new table: `public.eventflow_customer_responses`.
One response per (request_id, revision); each response is either:

- selection / selection_submitted: exact proposal ID, both saved pair IDs, server timestamp;
- change_request / changes_requested: feedback, both pair IDs, server timestamp.

This is a **Customer decision**, not a booking or a new Business confirmation.
It does not change requests.status or proposals.status. Response status is the
new authoritative status for the Customer response; display it separately from
the existing approval status. Existing reads and pair approval remain unchanged.

The RPC `eventflow_submit_customer_response`:

1. Verifies auth.uid() and approved Customer profile, then locks the owned request.
2. Returns a semantically identical saved response on retry (same ID/timestamp),
   including after the proposal later changes. Ownership/role are still checked.
3. Rejects a conflicting response and reused operation IDs for other responses.
4. Locks existing proposal rows and verifies the latest canonical numeric-text
   revision contains exactly one A and B, both `Awaiting Customer` with plan JSON.
5. Inserts only response metadata/feedback. It never writes proposal content,
   books events, approves plans, dispatches AI or changes quota.

The existing request lock also serializes the working pair-approval RPC.
`Awaiting Customer` is the existing submission-MVP approval/release marker; no
new release ledger or change to the Business approval RPC is required.
The unique response key is a second concurrency safeguard across instances.
Clients have SELECT only on their authorized responses and EXECUTE on the RPC,
not direct INSERT/UPDATE/DELETE/TRUNCATE. Approved staff/admin can read responses.
Definers have empty search_path; row_security=off fails closed if their trusted
owner loses required bypass capability. Only fixed, qualified SQL is used.
Trusted service-role access remains backend-only.

### Deliberate boundaries

- A submitted response is immutable through the client API for that revision.
  Selecting another plan, editing feedback, or changing a submitted selection
  requires a future, explicitly approved reopening/new-revision action.
  Before submission, the Customer may freely change the local draft choice.
- Existing local demo preferences are **not** migrated or treated as submitted.
- Existing approved numeric-text A/B pairs need no backfill or ledger adoption.
  Noncanonical/mixed legacy revisions are blocked from NEW responses, not hidden.
- Already Accepted/Declined legacy bookings stay readable under existing rules,
  but cannot receive a new response through this RPC.
- Existing approved plans remain visible after a change request, clearly labeled
  as the earlier approved quotation. No revised plans exist until separately
  generated and Business-approved.
- No extra final Business confirmation or booking workflow is introduced.
- Foreign keys deliberately do not cascade deletes. A response will prevent
  deletion of its referenced request/proposals/auth user until an authorized
  retention/deletion procedure handles it. No existing data is touched on install.

## Prepared application files (feature remains disabled)

The response flow is implemented behind the hard-coded
`CUSTOMER_RESPONSE_WORKFLOW_ENABLED = false` flag. The flag must remain false until
catalog/security review, migration approval, and database verification are complete.

| File under artifacts/eventflow-ai/src | Proposed work |
| --- | --- |
| customer/customerResponses.ts (new) | Default-off feature gate and authenticated session RPC client. It submits only through `eventflow_submit_customer_response`; no service key or direct table writes. |
| customer/customerResponseTypes.ts (new) | Validates response records and verifies RPC results match the request, revision, Customer, and action. |
| customer/data.tsx | Reads responses for the signed-in Customer through the existing refresh mechanism; submits only after explicit action; retains proposal visibility on response-read errors. |
| customer/Portal.tsx | Local draft A/B choice, explicit Confirm Selection, saved response/timestamp, and feedback form. No booking or proposal regeneration is triggered. |
| business/BusinessPortal.tsx | Reads response metadata through the existing refresh cycle. Shows selected plan, timestamp or feedback in proposal list/detail and displays read errors. |

Backend: **no Express changes are required for Phases 1–3.** The existing Supabase
authenticated RPC is the transactional write boundary. No new credential, RunPod
endpoint, quota key, worker or polling interval is needed.

Explicitly unchanged: `lib/submissionMvp.ts`, `business/SubmissionPairReview.tsx`,
`business/SavedPlanReview.tsx` approval actions, UnifiedAuth/UnifiedRoutes,
API `submissionGeneration.ts`, generator and shared quota. Do not reuse the
legacy `accept_proposal` booking RPC or flip the global MVP switch.

## Phased activation sequence (NOT performed)

1. Complete the outstanding read-only catalog/security review.
2. Obtain separate approval for the exact migration, then apply it in the
   intended Supabase environment and verify the table, policies, grants, and RPC.
3. Verify Customer ownership and approved-staff read behavior, including a
   disposable-database concurrency test. Only then consider changing the
   default-off feature flag.
4. Change Requests save feedback only. They do not regenerate proposals; the
   previous approved pair remains unchanged.

Activating/publishing the application needs separate owner approval after these
steps. Phase 4 regeneration is out of scope. Current five-job budget is exhausted;
this package neither reads nor resets it and never starts inference.

## Tests prepared and expected results

Run the focused app tests (no network, credentials or database access):

    pnpm --filter @workspace/api-server exec tsx --test ../eventflow-ai/test/*.test.ts

These include parser, RPC-contract, disabled-flag, UI, and existing auth/data
refresh checks. They are NOT PostgreSQL execution, RLS proof, or real database
concurrency tests.

Before activation, run these against an owner-approved DISPOSABLE test database:

| Scenario | Expected result |
| --- | --- |
| Approved Customer selects released A or B | One `selection_submitted` response with correct IDs/revision and server time; no proposal/request/event mutation. |
| Same request by another Customer | 42501; no write or private response visible. |
| anon, revoked/pending Customer, Business account submitting | Denied; no response. |
| Either plan pending, NULL status, malformed/missing/duplicate pair, wrong request ID | Denied; no response. |
| Stale revision / mixed or nonnumeric legacy revision | Rejected, no old proposals hidden or modified. |
| Identical retry with same or new operation ID | Same response ID/time; one row only. |
| Two separate DB sessions submit A/B concurrently | One commits; other waits on request lock then receives conflict. Never two responses. |
| Two sessions repeat an identical response | Both receive the same saved response. |
| Selection-vs-change concurrently | One response; conflicting operation rejected. |
| Reused operation ID for a different request | Rejected, no second response. |
| Authorized feedback; empty/oversized/foreign-request feedback | Valid feedback saved once; invalid/foreign writes rejected. |
| Direct client table INSERT/UPDATE/DELETE/TRUNCATE | Permission denied independently of RLS. |
| SELECT as owner, unrelated Customer, staff/admin, anon | Own response, zero unrelated rows, staff authorized rows, permission denied respectively. |
| Profile access revoked or account changed | No residual private responses; new RPC and SELECT denied as appropriate. |
| Existing approved 9 pairs / legacy events | Still visible, priced from unchanged plan_content for AI, existing approval behavior unchanged. |
| Background refresh / failed fetch / mobile navigation | Active pages stay mounted; states persist; explicit stale/error notice. |
| Change response submitted | No HTTP call to generation endpoint/RunPod; Redis untouched. |

Use actual separate authenticated roles, not only owner/service-role queries.
Use two independent connections for race tests; a Promise queue in a unit test
is not a database lock test. Apply fixtures only to the approved disposable DB.
After implementation, add real RPC/UI integration tests and run TypeScript and
production build checks. No live persistence or end-to-end success is claimed now.

## Remaining security / compatibility risks

- Current catalog review remains a blocker; earlier client TRUNCATE grants bypass
  RLS in SQL-capable contexts. This migration does not silently alter those grants.
- Any profile-escalation RPC or legacy definer write bypass must be evaluated.
  New Customer UI restrictions cannot secure an existing privileged backdoor.
- Existing acceptance has booking/pricing/null-status compatibility concerns;
  this design avoids it but does not claim to fix that unrelated legacy path.
- Business users currently have proposal UPDATE permission; future revision
  writers must lock the request and stop editing already-responded quotation
  content. These new RPCs cannot prevent a trusted owner/service/staff path from
  changing old content after confirmation; an immutability policy is separate.
- Additive FKs affect future deletion, and PostgreSQL must validate them/briefly
  lock referenced objects during install. Schedule the approved migration safely.
- RPC responses contain Customer feedback: never log bodies; render as text,
  never HTML. Do not infer delivery of an email/push notification from persistence.
- The SQL is review-only and has not been parsed/executed in PostgreSQL here.
