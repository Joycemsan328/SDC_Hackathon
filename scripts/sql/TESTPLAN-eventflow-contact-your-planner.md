# Contact Your Planner — separate-project test plan (not executed)

## Safety boundary

This is a manual review/test plan, not an installation script. No SQL, API writes,
environment changes or Realtime tests were executed while preparing it.
The approved revision-continuity and Customer-first rules are now present in the
review draft. Production execution remains **HOLD**: the migration acknowledgement
is `no`, no database engine test or separate-project test has run, and approval of
drafting was not approval to install. Do not change the repository acknowledgement.

1. Create or identify a separate Supabase development/staging project. Do not
   assume the previously named staging project still exists or has the schema.
2. Record its project reference and URL separately from Production. Before every
   installation/test session, compare the Dashboard project banner, SQL Editor
   project reference, database connection host and test-client URL to that
   allowlisted staging reference. Any mismatch means STOP.
3. Use a dedicated test directory/client configuration containing staging-only
   credentials. Never load the website's Production environment or alter its
   deployed secrets. Do not point the published website at staging.
4. Never copy Production customer rows, Auth users, sessions, tokens, secret
   function literals, Vault contents, provider endpoints or Redis configuration.
   Disable/exclude external HTTP triggers/jobs/webhooks in the staging baseline.
   Do not configure RunPod or quota endpoints in the test client.
5. Reproduce the required application structure from a reviewed schema-only
   baseline. The repository's additive migrations alone do not establish a
   complete baseline for an empty database. Keep Supabase-managed Auth schemas
   managed by the staging project; do not overwrite them.
6. Compare only the needed columns/types, constraints/indexes, profile/signup
   helpers, acceptance/approval/response/action/revision RPCs, RLS and grants.
   Verify PostgreSQL 17+, helper ownership/security and effective privileges.
   Missing baseline or incompatible dependencies means STOP, not a speculative
   repair against Production.
7. Only after separate approval of the revised migration, use an execution copy
   with acknowledgement `yes` on this verified staging project. Repository stays
   `no`. Run the complete transaction once and retain sanitized postflight results.
8. Run offline tests first:
   `node --test scripts/tests/contact-your-planner-review.test.mjs`.
   These are source/reference-model checks, not database tests.

## Synthetic identities and fixtures

Create new staging-only Auth accounts through the normal staging signup flow:
approved Customer A and B, an unapproved Customer, approved Business staff A and
B, an approved admin and an unapproved Business account. Use the reviewed
staging-only approval operation to assign approved roles. Do not reuse real
customer identities or print passwords/JWTs.

Create synthetic requests owned by each Customer. Insert clearly named
`STAGING SYNTHETIC — NOT AI` Plan A/B fixtures through owner-only fixture setup,
using the actual staging columns, positive text revisions and coherent itemized
prices. Use the existing staging approval, response and confirmation RPCs to
produce valid workflow evidence. There is no need to call an AI endpoint.

Prepare independent requests for:
- valid current confirmation, and approved-but-unconfirmed proposals;
- null/mismatched confirmation evidence (owner-only negative fixtures);
- old confirmed revision plus newer queued, pending, released or confirmed revision;
- existing conversation before a newer revision, and no conversation before it;
- higher queued revision races a new open; request-first locks serialize admission;
- existing pinned proof after a newer revision remains accessible, but an
  invalidated pin fails closed without deleting the conversation;
- original selection is confirmed again after revision; the same thread remains
  pinned to the original evidence and is not silently rebound;
- valid legacy Accepted proposal plus linked owner Event;
- missing/mismatched legacy Event and mixed/unorderable legacy revisions.

Negative fixture setup must not weaken RLS, disable triggers, or change the
application RPCs just to make tests pass. Use fresh independent fixture requests
where ordinary constraints prohibit an invalid state. If an impossible state
cannot be constructed legally, record the enforcing constraint instead.

## API/RLS and UX matrix

Use the staging publishable key with real staging user sessions for API and
Realtime tests, **not service_role**. Owner/privileged clients are for fixture
setup and catalog checks only. Never log auth headers or message contents.

| Test | Expected result |
| --- | --- |
| anon SELECT/mutation/RPC attempts | denied |
| Customer A reads/sends/marks Customer B's conversation | denied/unavailable |
| unapproved profiles attempt chat | denied |
| Customer A creates eligible conversation | one empty thread |
| Business attempts to create conversation | unavailable, no row created |
| Customer opens but does not send | absent from Business inbox |
| Customer sends first message | appears in shared approved-Business inbox |
| Business knows Customer-created empty thread ID and sends first | denied with uniform unavailable response |
| Customer and Business race the first send | Business cannot commit before a Customer message |
| Customer first send commits before Business reply | Business reply succeeds |
| direct authenticated INSERT/UPDATE/DELETE/TRUNCATE | denied |
| approved staff A/B read inbox | both allowed; independent unread cursors |
| Customers query staff inbox | denied |
| same send key/body repeated | original row/order; counter unchanged on RPC retry |
| same send key/different body | conflict; no extra row/order |
| new key/same text | separate legitimate message |
| all normal SQL writes fail/rollback | no partial counter/message/read changes |
| service-role UPDATE/DELETE with current client-only append contract | authorized by design; use disposable fixture only |
| strict guard variant, if separately approved/implemented | UPDATE/DELETE/TRUNCATE rejected even for trusted role; sends/read updates still work |

For first-message visibility, test opening a thread and abandoning it before send.
Do not change that behavior by generating a system greeting or automatically
sending an empty message. Customer-created and Customer-first-send are separate
rules: the draft enforces both, but only an actual Customer send reveals the
conversation in the shared Business inbox.

## Transaction/concurrency matrix

Use two genuinely independent database connections and explicit transaction
barriers. Authentication must be simulated only in this isolated database with
the correct `authenticated` role and staging-only claim identity, or via a
purpose-built staging test gateway. Such claim simulation does not verify JWT
signature validation; the real-session API tests above cover transport auth.

Do not infer locking correctness from a fast mocked Promise test. Verify the
second connection is waiting on the intended conversation lock, then commit or
roll back the first. Set test-only statement/lock timeouts so sessions do not
remain blocked, and release both connections in cleanup even on failure.

| Interleaving | Expected result |
| --- | --- |
| two concurrent opens for one request | exactly one conversation |
| two concurrent distinct-key sends | unique increasing per-conversation orders |
| two concurrent same-key sends | same persisted message/order, one counter advance |
| sender holds assigned N uncommitted; second sender waits | second cannot commit N+1 before N transaction finishes |
| sender holds N; read acknowledgement waits | cursor cannot advance past the pending transaction |
| first sender rolls back | message/counter disappear together; later send remains valid |
| earlier-started transaction delays send until later committed send/ack | delayed send receives higher order and is unread |
| reader locks first and acknowledges displayed N | later send waits, then receives order greater than N |
| transaction sends twice then rolls back | both messages and both increments roll back |
| same-key retry after connection uncertainty | resolve saved row; never invent a new client key automatically |
| repeat at REPEATABLE READ/SERIALIZABLE | success or explicit serialization failure; no cursor skipping |

Check unrelated conversations do not serialize on a single global counter.
Keep real application transactions short. Deadlock/serialization failures must
be surfaced; if retried, reuse the original operation key.

## Displayed-history/read-cursor matrix

The future UI must track authoritative, fully fetched history **and rendering**.
Use `eventflow_planner_mark_read(uuid,bigint)` only after the whole history
interval since the last acknowledgement is loaded and displayed in an active
conversation. The database cannot prove visibility; a self-read acknowledgement
can lie without accessing anyone else's data.

| Case | Expected acknowledgement |
| --- | --- |
| rows 1,2,3 fetched and displayed | 3 |
| row 3 delivered by Realtime before row 2 is reconciled | stay at displayed complete prefix |
| latest page displayed but older unread page missing | do not jump past the missing page |
| intermediate page fetch fails | stop before that page; show/retry failure |
| row fetched but not yet rendered | stop before it |
| hidden conversation/tab | no advancement |
| numeric gap verified by complete authoritative history (1,2,4) | 4 may be acknowledged after all three rows display |
| gap only guessed from Realtime (1,4) | do not infer 2/3 never existed |
| new row commits after fetch, before mark-read call | acknowledge fetched boundary only; new row remains unread |
| stale lower read request completes later | stored cursor never decreases |
| another Business user reads | this user's cursor/unread count unchanged |
| cursor negative/null/future/from another conversation | rejected without mutation |
| order beyond JavaScript safe-integer range | preserve exact value using bigint/string handling |

The local reference tests demonstrate these client requirements only. Actual
frontend/browser verification remains a separate gate once that UI exists.

## Revision eligibility matrix — required staging verification

1. Without a conversation: an old confirmation plus newer queued action must not
   allow creation, even before the new proposal rows exist.
2. Without a conversation: newer pending or released-but-unconfirmed revision must
   block the old confirmation. A confirmed latest revision may create the thread.
3. Existing conversation: newer revision alone must not remove history, read
   state, sending or shared-inbox visibility while original pinned proof is valid.
4. Tamper/revoke the pinned confirmation in a disposable fixture, change request
   ownership, or revoke caller approval: access fails closed; rows are preserved.
5. Confirm a later revision: the same conversation remains; original eligibility
   evidence is not silently overwritten.
6. Race a new-conversation open against revision start/store: both must coordinate
   on the existing request-first lock so stale proof cannot win after the newer
   workflow has started. Verify actual installed RPC lock order first.
7. Legacy numeric acceptance is latest-only; a single identical legacy revision
   context with one matching Accepted/Event proof can qualify. Mixed or
   unorderable histories with revision-action evidence are blocked for new
   admission, not lexically sorted.

## Realtime matrix

Confirm publication membership and INSERT support without changing global
publication settings. Subscribe as the Customer owner, two approved Business
users and an unrelated/unapproved account; insert a synthetic message through
the send RPC.

- Authorized sessions receive permitted INSERT rows; unauthorized sessions
  receive no message rows.
- Subscribe before/reconcile during initial history loading; a send between
  subscription setup and fetch completion is neither lost nor double-rendered.
- Deduplicate event replay and reconcile out-of-order deliveries by sequence.
- Reconnection performs authenticated history catch-up; no missing range is
  acknowledged based on a later event alone.
- Unsubscribe/dispose listeners on conversation/account changes.
- Test actual browser rendering and read acknowledgement on desktop/mobile later.
  The SQL/reference tests cannot prove this.

## Evidence and cleanup

Retain sanitized pass/fail results, request/messaging row counts, function
signatures/security/grants, trigger metadata, lock-test transcripts and Realtime
delivery counts. No passwords, JWTs, real customer data or raw network dumps.

Compare counts for unrelated staging request/proposal/response/event/notification
fixtures before/after installation: migration must not mutate them. Test actions
may mutate their designated synthetic fixtures only, never the Production copies.

Clean up connections, subscriptions and disposable fixtures **in staging only**.
If testing fails, revoke access/remove publication membership on new staging
objects and preserve rows/logs for diagnosis. Do not cascade-drop existing app or
Auth objects. Full teardown or strict-retention exceptions require separate
approval. Passing staging tests does not authorize Production installation.
