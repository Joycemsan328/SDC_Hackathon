# Proposed Business-first implementation

## Scope and status

Implementation is prepared locally for review. No SQL was executed; no production
records, database permissions, secrets, activation flags or deployments changed.
No real RunPod request was made. The standalone Business backup is unchanged.

## File changes

| Files | Change |
|---|---|
| `scripts/sql/eventflow-mvp-workflow.sql` | Replaces the unapplied selection-first installation with a revision ledger, restrictive proposal RLS, backend-only persistence, Business pair release and final confirmation, customer changes, explicit legacy adoption, and a catalog-review installation guard. |
| `scripts/sql/eventflow-workflow-catalog-review.sql` | New unexecuted metadata inventory covering policies, grants, independent indexes, types/defaults/enums, triggers, definer functions and views. |
| `scripts/sql/README-eventflow-mvp.md` | Exact state machine, review blockers, credential names, compatibility impacts, legacy handling and later activation procedure. |
| `DEPLOYMENT.md` | Replaces obsolete customer-token persistence setup instructions with the new backend credential/activation prerequisites. |
| `artifacts/api-server/src/services/businessFirstWorkflow.ts` | Backend-only Supabase RPC repository; verifies revision receipts, uses server-owned revisions/leases, validates mock/AI output and returns metadata without drafts. |
| `artifacts/api-server/src/routes/businessFirstGeneration.ts` | Existing generation URL now authenticates ownership and accepts only request ID. Disabled without explicit activation and a privileged server credential. |
| `artifacts/api-server/src/routes/persistedProposals.ts` | Switches the mounted default route to Business-first. Legacy factory remains unmounted for regression tests; it is not a customer-accessible fallback. |
| `lib/api-spec/openapi.yaml` and generated `lib/api-client-react` / `lib/api-zod` files | Changes generation contract to metadata only; regenerated client/schema outputs. |
| `artifacts/eventflow-ai/src/lib/businessWorkflow.ts` | Shared revision types, checked RPC result wrapper and refresh event. |
| `artifacts/eventflow-ai/src/customer/workflow.ts` | Selection consumes the new revision-based RPC result. |
| `artifacts/eventflow-ai/src/customer/data.tsx` | Loads revision metadata, polls decisions, only displays current released plans, saves change requests then invokes next-revision generation, and never reads drafts from a generation response. |
| `artifacts/eventflow-ai/src/customer/Portal.tsx` | Pending-release status, released-plan selection, persistent change-request form with AI-cost notice and generation retry. Existing layout/auth/routes retained. |
| `artifacts/eventflow-ai/src/business/SavedPlanReview.tsx` | Review both saved plans, explicitly register legacy pairs, release pair, then confirm the exact final customer selection. |
| `artifacts/eventflow-ai/src/business/BusinessPortal.tsx` | Queues draft pairs before customer selection and selected plans afterward; refreshes ledger state across sessions. |
| `artifacts/api-server/test/businessFirstWorkflow.test.ts` | Mock AI/HTTP/Supabase tests and static SQL safety assertions. |
| `.agents/memory/` | Updates the standing workflow requirement so future work does not restore selection-first behavior. |

## Remaining risks / NO-GO items

1. Full live catalog review is outstanding: absence of UNIQUE constraints does not
   establish absence of incompatible independent unique indexes.
2. Base-table RLS does not protect data exposed by existing bypass-RLS RPCs/views.
   Review and secure those paths before acknowledging the installation gate.
3. Existing profile permissions must prevent authority escalation.
4. Status enums/CHECKs, revision types, UUID defaults and other required columns
   remain unverified. A paid job could otherwise finish before persistence fails.
5. No SQL was executed, including in a disposable database: syntax, installation,
   real RLS and concurrency need approved database testing, not just mocks.
6. Existing legacy plans become private to customers until explicit Business
   registration/release; direct browser proposal edits become blocked.
7. Previously downloaded/cached content cannot be made secret retroactively.
8. All approved Business staff are one trusted planning team; tenant/assignment
   separation is not added.
9. In-process HTTP generation still has an expiring 10-minute lease and no durable
   worker queue. Interrupted jobs need an explicit retry; do not shorten leases.
10. Final confirmation is terminal. Reopening a confirmed event requires a
    separately designed and approved action; it is not silently allowed.

See `scripts/sql/README-eventflow-mvp.md` for exact activation order.

## Verification results

- Workspace type checks and production API/React builds passed.
- 45 API tests passed (10 new mock/static guardrail tests plus 35 regression tests).
- `/api/healthz` returned HTTP 200 with healthy JSON.
- Public login screenshot rendered normally.
- One browser pass with fresh fake sessions and fully intercepted Supabase/API
  responses verified draft hiding, both-plan review/release, selected Plan B
  across reload, Business final confirmation, and change-request revision 2
  staying private until a second release. No real service writes or AI calls.
- The browser pass found a stale sidebar status label; its text was corrected.
- These results do not establish SQL syntax/installation, effective live RLS,
  trigger/constraint compatibility, or database concurrency correctness.
