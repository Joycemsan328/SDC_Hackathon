# Pending AI proposal editor — review only

`eventflow-edit-pending-ai-proposal.sql` is an unexecuted migration draft. Its
review acknowledgement is intentionally `no`; it must not be applied until the
Production catalog and this exact migration have been reviewed and approved.

## What it adds

- `public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb)`, a
  `SECURITY DEFINER` RPC for authenticated approved Business staff.
- It locks the request and the A/B proposal rows, requires both plans to remain
  `Pending Business Approval`, validates the edited content and itemized MYR
  arithmetic, retains every service in the saved request, and updates only the
  selected proposal's `plan_content`.
- It persists an explicit allowlist of fields exposed by the existing editor.
  The saved `id`, unknown top-level metadata, and uneditable nested venue
  metadata are retained from the locked database value; client-supplied extras
  are not merged into the saved object. The current editor does not expose
  separate `description` or `exclusions` fields, so any such existing keys are
  preserved but not edited.
- It preserves the proposal ID, request ID, revision, plan key, status,
  recommendation, and all other columns.
- It grants RPC execution to `authenticated` only, not `anon` or `PUBLIC`.
- It revokes table-level and per-column `UPDATE` from `anon`, `authenticated`,
  and `PUBLIC` on `public.proposals`. It does not revoke `service_role` or
  `postgres` privileges. Postflight asserts that client roles have no effective
  table or column UPDATE, including privileges inherited through membership.
  If any such privilege remains, the transaction raises an error and rolls back.
- It preserves the staff UPDATE RLS policy as-is. With client UPDATE privileges
  removed, that policy no longer creates a direct table-write path; approved
  staff write through the pending-only RPC.
- It does not alter `approve_ai_proposal_pair`, `accept_proposal`, or
  `eventflow_confirm_customer_selection`. Preflight requires the existing
  functions to remain SECURITY DEFINER, their owners to retain proposal UPDATE
  access, and their owners to retain RLS bypass. The portal/API source scan found
  no direct proposal-table UPDATE call: reads use Supabase SELECTs, edit/approval
  use RPCs, and proposal creation uses backend RPC persistence.
- It does not change triggers, proposal rows, requests, generation code, or call
  RunPod.

## Known Production evidence and remaining verification

The latest user-provided Production checks showed:

- `anon`, `authenticated`, `service_role`, and `postgres` all had effective
  table and column UPDATE on `public.proposals`.
- The `Staff can update proposals` RLS policy applies to `authenticated` and
  uses `is_staff()` in both `USING` and `WITH CHECK`; it has no pending-status
  restriction.
- `accept_proposal`, `approve_ai_proposal_pair`, and
  `eventflow_confirm_customer_selection` exist, are `SECURITY DEFINER`, and
  are owned by `postgres`.
- Query 6A found nine routines mentioning proposals, but their names and source
  definitions were not included in the supplied result.

Therefore the existing policy plus the client grants permit approved Business
staff to update rows outside the pending-only editor RPC. The migration removes
the direct client path, but it has **not** been executed. The Production query
result does not identify whether every privilege came from direct table/column
ACLs, `PUBLIC`, or role membership. The revokes address direct ACLs and
`PUBLIC`; effective postflight checks catch inherited privileges and abort the
transaction if any remain. Do not broaden the migration to revoke privileges
from unrelated inherited roles without identifying their other members and
dependencies.

Before any future execution, re-run a read-only catalog check for effective
table/column UPDATE on `anon`, `authenticated`, `service_role`, and `postgres`,
and inspect policies and role memberships. Also recheck `requests.services`,
the proposal column types, the named A/B revision index, RLS, `public.is_staff()`,
the three dependent function owners/security modes, migration-role privileges,
and RPC-signature absence.

The migration has a conservative preflight for stored routines whose source
contains a conventional `UPDATE ... proposals` statement; it aborts if such a
routine is not `SECURITY DEFINER` or its owner lacks RLS bypass/UPDATE. This
cannot detect every dynamic SQL construction or external caller. The exact nine
Query 6A routine names/definitions still need review before Production approval.

## Installation and verification sequence

1. Test in a separate PostgreSQL 17/Supabase staging project with synthetic
   requests and pairs. Test authorized and unauthorized calls, a save after
   either plan is approved, concurrent edit/approval, malformed JSON, invalid
   amounts/totals, repeated saves, preservation of unknown metadata, unchanged
   IDs/status/revision, and Customer visibility. The shared request-row lock
   serializes edit against approval: if approval commits first, the edit must
   fail its pending-pair check. Concurrent edits themselves serialize but are
   last-writer-wins if both clients submit stale drafts.
2. Obtain approval for this exact SQL. Only after approval may the acknowledgement
   be changed to `yes` and the migration run manually as a trusted database
   owner. Do not execute it in Production before staging and privilege checks pass.
3. Confirm postflight: `anon` and `authenticated` have no effective table or
   column UPDATE; `service_role`, `postgres`, and the RPC owner retain required
   UPDATE; authenticated can execute the RPC while anon and PUBLIC cannot.
4. Confirm existing `approve_ai_proposal_pair`, `accept_proposal`, and
   `eventflow_confirm_customer_selection` still function; verify no proposal
   status or non-`plan_content` field changed.
5. Test the UI: save edits to A and B separately, cancel an edit, approve via
   the existing pair action, and confirm the Customer sees the saved approved
   content. Do not use RunPod for these tests.

## Rollback

First disable or revert the frontend editor. Then manually drop only the new RPC
using the commented rollback block at the end of the migration. Keep the client
UPDATE revocations in place. Do **not** restore the previous broad client grants
as a rollback; if a real dependency is discovered, review and grant only the
minimum privilege it requires.

The offline tests check migration/source invariants only; they are not PostgreSQL
execution tests.

The review acknowledgement is a human safety gate, not proof of catalog
compatibility. Do not treat a successful frontend build as database validation.
