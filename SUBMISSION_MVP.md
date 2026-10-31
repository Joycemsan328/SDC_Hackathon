# Submission MVP repair

## Boundary

No schema/RLS/RPC changes, no RunPod service or endpoint changes, no publication.
The standalone Business backup is unchanged. The unapplied Business-first SQL
remains review-only; submission mode does not use it.

## Active path

Saved customer request -> authenticated existing generation URL -> backend
existing-pair lookup -> read-only schema preflight -> approved live generation ->
validated AI pair -> single transactional INSERT into public.proposals.
Both rows use revision `1` and `Pending Business Approval`. No UPSERT.
Only metadata is returned to the customer. The existing partial unique index
on `(request_id, revision, plan_key)` protects against duplicate records.

Business reviews both plans and calls existing
`approve_ai_proposal_pair(p_request_id, p_revision)`; exactly integer 2 is checked.
Customer reads approved pairs through the existing Supabase ownership/status RLS.
No missing ledger, selection, release, revision or confirmation RPC is called.
Viewing and choosing a plan never invokes AI.

Customer preferences are explicitly demo-only browser storage scoped by customer,
request, revision and proposal IDs. They are not bookings, cross-device selections,
or Business notifications. Existing sample/demo flows remain separate.
Saved-request revisions and final booking confirmation are deferred.

## Safety gates / names only

- Backend `SUPABASE_SECRET_KEY` OR `SUPABASE_SERVICE_ROLE_KEY` required.
  `SUPABASE_URL` may fall back to existing `VITE_SUPABASE_URL`.
  No privileged key may use a VITE_ prefix or enter browser code.
- `EVENTFLOW_MVP_INSERT_VERIFIED=true` only after checking actual proposal column
  requirements/CHECK constraints. Owner read-only queries are in
  scripts/sql/eventflow-submission-insert-check.sql; they have NOT been executed.
  Existing owner CSVs already confirm the A/B partial unique index.
- `EVENTFLOW_LIVE_GENERATION_ENABLED=true` only after owner approves inference.
- Neither gate is enabled by this repair. Mock tests inject their own flags,
  gateway, repository and generator. No production mock mode was added.
- Runtime OpenAPI inspection checks insert columns, additional required/defaulted
  fields and any advertised status enum before inference. It cannot expose every
  PostgreSQL CHECK, so it is not a replacement for the owner's catalog results.
- Paid tests require explicit approval. Do not use developer generation endpoints
  as a production workaround.

## Hosting

The API artifact previously reserved `/api` while declaring no production process.
The root unified production server already hosts `/api`. The development-only API
artifact is now routed under `/api-development`; its development Express process
recognizes that prefix. `/api` therefore reaches the unified server in Preview.
This prepares the routing correction for a future publish, not a verified fix
to the currently published deployment. Do not publish without approval.

## Verification / limitations

60 API tests passed, including mock HTTP generation/persistence, price rejection,
no credential/live approval, atomic pending-pair insertion, preservation of partial
existing data, same-process retry coalescing and unique-conflict recovery.
Workspace types and production build passed; Preview health returns 200.
Mocked browser verification confirmed request saving/generation receipts, draft
privacy, one pair in Business approval, both plan details/prices, the existing
approval RPC, approved Customer visibility, browser-only selection after reload,
and existing demo samples. No ledger reads or workflow/booking RPCs occurred.
The tester identified one stale list label claiming Supabase selection storage;
it was corrected to demo-only browser preference, matching the actual behavior.

The backend credential is now configured and accepted by Supabase. The actual
repository read-only preflight passed against the live project's REST schema:
expected columns exist, id/request_id are required, and relevant formats/defaults
are compatible. PostgreSQL CHECK constraints still require the owner's query
result. The owner subsequently supplied the sole plan_key CHECK (NULL/A/B), which
is compatible. Both website live safety gates stay off.

The owner then approved one controlled server-side RunPod test. Exactly one job
completed: 343 prompt tokens, 980 completion tokens, 1,323 total; reported execution
24.498 seconds and queue delay 124.153 seconds. Generation produced two complete
plans, but strict validation rejected Plan A: itemized costs sum to RM9,500 while
the AI stated RM10,500. Plan B's RM16,000 total matches its lines. Error:
INVALID_PROPOSAL. Persistence was not reached; an independent read confirmed
zero proposals for the tested request and no duplicates. No second job, real
database writes, migrations, RPC execution, or publication occurred.
The owner approved deterministic total calculation and offline recovery. The
backend now validates the full structure and cost items first, derives totals
without modifying any item amounts, and runs strict final validation. The same
paid response passed this process: A RM9,500 (5 lines), B RM16,000 (6 lines).
One atomic insert created exactly two revision-1 Pending Business Approval rows.
Full content readback matched both validated plans; no duplicates were found.
Recovery blocked all non-Supabase network calls, so no further inference occurred.
The original raw response and attempt receipt remain in ignored local diagnostics
for audit. Do not resubmit the paid attempt. General website generation remains
disabled; publishing and any further inference still need owner approval.
Cross-process concurrent generation can consume AI twice; the existing unique
index remains the final duplicate-row guard. A shared Redis quota guard is now
prepared for cross-instance paid-job protection; see `DEMO_GENERATION_QUOTA.md`.
It requires a persistent Redis connection and a real Redis/Lua self-test before
activation. Both live flags remain off. No Supabase leases or schema changes
were introduced.
