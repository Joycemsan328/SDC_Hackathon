# EventFlow MVP activation — approval required

Exact migration: `scripts/sql/eventflow-mvp-workflow.sql`.

**Not applied to your Supabase database.** No live RunPod generation was performed during implementation.

## What the migration does

- Adds a one-selection-per-request table for cross-device choice, Business decision, and message.
- Adds a generation lease table to prevent concurrent paid generation.
- Adds authenticated, ownership-checked selection, single-plan review, generation-claim and insert-only persistence functions.
- Restricts read/write access using approved Customer/Business profiles and row-level security.
- Does not update or delete existing requests, proposals, prices or plan content.
- Does not use `approve_ai_proposal_pair`.

After reviewing and approving the exact SQL, run it in your existing Supabase project's SQL Editor as the database owner. The transaction rolls back on an error; do not bypass an error by deleting existing data. Existing schema constraints are still enforced. The script was tested against a synthetic local schema, not applied against the live schema.

The Express server uses the existing public Supabase configuration plus the authenticated customer's bearer token. The persistence functions enforce ownership; no service-role key is placed in the browser.

## Preview test — existing proposals, no RunPod

1. Sign into the Customer Portal. Open `/events/a75b1974-0aa2-4517-a8a0-7dec86f60b24`.
2. Confirm Plan A/B, services, itemized RM costs, and totals. Click Select Plan A or Select Plan B.
3. Reload or sign in on another device: the selected plan must remain selected.
4. Open the **Business Portal artifact**, sign in with an approved staff/admin account, and open `/approvals`.
5. Only the chosen plan belongs in the queue. Open Full review to see the complete selected plan.
6. Enter a message and click Request Changes. Within 10 seconds the customer sees the decision and message.
7. On Customer, resubmit the same plan or select the other plan. Business can then approve that selected plan.
8. Refresh Customer: Business approval and its optional message appear. The unselected proposal stays unchanged.

Do not click Generate when testing existing proposals. Viewing, rechecking, selecting and reviewing never call RunPod.

## New request / generation test — intentionally invokes RunPod

After the migration is applied, create a new event in Customer. Submission saves the request first, then invokes the existing Express/Qwen3-8B integration and atomically saves Plan A/B.

If generation fails, the request remains saved. Retry uses the same request ID; saved proposals are read back rather than overwritten. An interrupted generation retains its safety lease for up to 10 minutes before another generation is allowed.

## Verification performed

- Full workspace type checks.
- Production builds for Customer, Business and Express.
- 33 API tests, using mocked RunPod responses.
- Real PostgreSQL execution in a disposable local database using synthetic records: RLS, ownership, selection, messages, single-plan review, generation lease, insert-only persistence and retry safety.
- Running API health and unauthenticated-generation rejection.

Signed-in, cross-account live end-to-end verification remains blocked on applying the approved migration. The screenshot check reached the sign-in screen; it did not exercise authenticated controls.
