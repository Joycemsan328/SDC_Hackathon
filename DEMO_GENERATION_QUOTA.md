# Capped genuine AI generation

## Activation and quota state

This document describes the workspace implementation, not a live deployment
verification. The initial ledger cap is five. A prior approved extension supports
a limit of 20; this code adds a guarded, one-time 20-to-35 extension. This change
does not inspect or modify Production Redis, change flags, run inference, or deploy.
The API tests use mocked AI and an in-memory atomic ledger simulation.

## Cost protection

- Existing approved Customer authentication and request ownership checks stay first.
- Existing saved A/B pairs are returned without quota use or inference.
- Before a RunPod submission, one Redis EVAL atomically reserves a request and
  increments the shared finite budget. All production instances use the same key.
- Exactly one attempted generation per saved request; the ledger limit is shared
  across instances, days, restarts, and deployments. Prior saved pairs are unchanged.
- Failed or uncertain attempts remain consumed. No refunds, lease expiry, automatic
  resubmission, budget reset, or local-counter fallback.
- Validated generated content is cached privately before Supabase persistence.
  Persistence failures can recover that content without buying another AI response,
  even when the finite job budget is exhausted.
- Supabase still receives one atomic A/B insert with Pending Business Approval.
  The unique index remains the final duplicate-row guard.
- Neither cached drafts, quota ownership tokens, nor backend credentials are sent
  to browsers. Existing Business approval and Customer-read policies remain in use.
- The global key is `eventflow:submission-demo:quota`. Do not rename or delete it
  to obtain another budget, and do not initialize a replacement automatically.

## Required backend-only configuration

- `EVENTFLOW_QUOTA_REDIS_REST_URL`: HTTPS REST endpoint of a persistent Upstash
  Redis database, e.g. its normal `*.upstash.io` REST endpoint.
- `EVENTFLOW_QUOTA_REDIS_REST_TOKEN`: standard read/write REST token, not a
  read-only token. Configure through project Secrets, never a VITE variable.
- `EVENTFLOW_MVP_INSERT_VERIFIED=true`: only after the already-completed schema
  compatibility review is accepted.
- `EVENTFLOW_LIVE_GENERATION_ENABLED=true`: separate owner-approved activation,
  only after all quota tests and configuration are verified.

No new Supabase tables, columns, RLS policies, or RPC definitions are needed.
Use a persistent, owner-controlled Redis database with durable writes, no eviction,
and no expiration for this ledger. A temporary expiring scratch database is not
suitable for the production budget. Provider storage/request charges may apply.

## Safe setup order

1. Keep live generation disabled. Connect the Redis REST URL/token securely.
2. Run the REAL Redis/Lua self-test with synthetic data:
   `pnpm --filter @workspace/api-server exec tsx ../../scripts/verify-demo-quota.ts --redis-only-no-inference`
   It uses an isolated random self-test ledger, never Supabase or RunPod, and removes
   only its own test ledger. It does not consume the five production slots.
3. COMPLETED with owner approval: initialize the production quota exactly once:
   `pnpm --filter @workspace/api-server exec tsx ../../scripts/initialize-demo-quota.ts --initialize-five-new-jobs`
   An existing key is never reset. Initialization does not enable generation.
4. Before any quota extension, verify the exact Production ledger state read-only
   and ensure the guarded code is deployed with both generation flags disabled.
5. The prepared operator command for the one-time increase is:
   `pnpm --filter @workspace/api-server exec tsx ../../scripts/extend-demo-quota.ts --approve-35-total-attempts`
   It only accepts the expected 20-limit ledger with the existing 5-to-20 marker,
   preserves the consumed count and reservation history,
   and refuses if either activation flag is exactly `true`. Do not run it until the
   Production preconditions and a separate owner approval are confirmed.
   For the previously reported ledger (14 used), the expected result is limit 35,
   used 14, and 21 remaining.
6. Obtain separate approval before activating capped live generation. Quota
   configuration or extension alone never enables inference.

## Explicit limitations

- This is a cap on application job submissions, not an exact dollar billing cap.
  Existing output-token and job-time limits remain unchanged.
- Safety favors not charging twice: a crash or ambiguous provider/network result
  can consume a slot without delivering proposals. Such requests require manual
  reconciliation, not another automatic paid attempt.
- If a process dies before its valid output reaches Redis, that output is not
  automatically recovered. The reservation still prevents a second paid job.
- Storage outages block new jobs. Lost/corrupt ledgers fail closed; do not reset them.
- The guarantee assumes the provider honors atomic EVAL and durable acknowledged
  writes, and operators do not delete/roll back/evict ledger data or deploy an older
  unguarded generation path. Real Redis verification is required before activation.
- Mock tests exercise independent routers/store clients and simulated restarts,
  lost acknowledgements, exhausted quotas, invalid ownership, and cached recovery.
- Error codes distinguish disabled/unconfigured quota, in-progress/consumed
  attempts, exhausted budgets, and persistence errors. Retrying a consumed request
  never authorizes another AI call.
