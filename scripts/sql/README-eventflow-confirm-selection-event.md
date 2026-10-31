# Confirmation to Event: review draft, NOT installed

## Scope and recommendation

**GO for draft review; HOLD for Production execution** until the focused catalog
checks below match. No database was queried or changed to prepare these files.

The companion SQL replaces only
`public.eventflow_confirm_customer_selection(uuid,text)`. It does not install
tables, add indexes, alter RLS, change grants, update existing rows, backfill,
generate proposals, or invoke RunPod. The acknowledgement stays `no`.

### Evidence and its limits

The owner reports Production has zero Events, three confirmed selections,
34 proposals, numeric `plan_content.totalEstimatedMYR`, the unique proposal index,
and venue overlap exclusion. Those are supplied findings, not new live checks.

Saved catalog results in `attached_assets/` identify:

- Events: UUID id/proposal/customer/customer_name/venue identifiers, text name/type/
  status, date, start/end `time without time zone`, integer guests, numeric value.
- `events.customer_name` is nullable UUID. It is NOT a display-name field.
- Requests have corresponding scheduling fields, `customer_id` UUID and a TEXT
  display name.
- `events_valid_booking_time` requires complete increasing times when a venue
  UUID is present; the overlap exclusion covers `Upcoming` and `Confirmed`.
- Earlier Events RLS permits owning Customer SELECT and staff SELECT/INSERT/UPDATE.

These older exports establish the schema baseline, not fresh confirmation that
Production has not changed. The supplied complete Production confirmation definition
was compared offline against the original local action migration. The only body
difference is line endings: Production uses 73 CRLF pairs (3,414 bytes), while the
local baseline uses LF (3,341 bytes). Replacing only CRLF with LF makes the bodies
byte-for-byte identical; there are no functional differences.

The draft requires the exact raw Production `prosrc` MD5
`718868f605cf4ab33c06b3f5a0bed508` before replacing anything. The original local LF
hash `5b33c7863e154e501f6b13324d462309` differs exclusively because of those line
endings. Both hashes were reproduced offline from the supplied definition and
local baseline. The guard still hashes raw source without newline normalization.
This is a drift check, not a cryptographic approval signature. A mismatch is a STOP:
obtain and compare the live definition; do not simply change/remove the hash.

## Preserved behavior and added connection

Preserved: signature and return shape, parameter names/default, approved staff
helper, SECURITY DEFINER, empty search path, row_security=off, request/response/
action locks, latest canonical TEXT revision validation, released exact A/B
verification, same-message idempotency and different-message rejection.

The new code additionally:

1. Locks both source proposal rows so saved pricing/release status stays stable.
2. Verifies response ownership against the locked request's `customer_id`.
3. Reads the selected proposal only; rejects string/missing/negative/oversized
   totals, invalid cost lines and itemized arithmetic mismatches.
4. Requires amounts already normalized to cents, 1–80 cost lines and values no
   greater than RM100,000,000, matching the generator's monetary bounds.
   PostgreSQL numeric arithmetic avoids floating-point summation artifacts.
5. Inserts one Event before inserting the original confirmation action. Both
   succeed or both roll back; no exception is swallowed.
6. Preserves the RPC owner, identity, settings and ACL, with a postflight assertion.

There is no budget ceiling and no budget mutation. `total_value` comes from the
selected `plan_content.totalEstimatedMYR`, verified against the itemized amounts,
not request.budget or potentially empty legacy proposal_lines.

### Field mapping

| Event column | Source |
| --- | --- |
| id | Core `gen_random_uuid()` |
| proposal_id | Exact saved selected proposal ID |
| customer_id | Locked `requests.customer_id`, checked against the response |
| customer_name | Explicit `NULL::uuid`; never requests.customer_name TEXT |
| event_name/date/time/end_time/type/venue_id/guests | Corresponding saved request fields |
| total_value | Validated selected-plan total |
| status | `Confirmed`, covered by the previously exported exclusion predicate |
| created_at | Existing database default |

Do not invent a venue ID from an AI venue name or free-text location. Without a
saved venue UUID the Event is a confirmed event, NOT a guaranteed venue booking.
Missing optional times stay NULL. Missing date/name, negative guests or invalid
time ranges fail before saving anything. A non-null venue requires both times.

Request fields are intentionally authoritative under this scope. Revised feedback
such as “40 guests” may exist only in proposal prose while requests.guests still
contains the original count. The draft does not parse prose or silently overwrite
requests. Confirm this mapping is acceptable before installation.

### Retries, concurrency, history and conflicts

- The existing early return for an identical saved confirmation remains BEFORE
  any Event logic. Retrying any of the three historical confirmations returns its
  existing action and still creates NO Event.
- New successful confirmations return the same action type as before. Retrying
  returns that action without another Event; changed messages still fail.
- Cooperating confirmation/revision RPCs serialize on the request row. The
  existing immediate unique(proposal_id) index is the final per-proposal guard.
- An existing Event for any proposal of the request blocks a new confirmation
  rather than reusing, updating or overwriting it.
- That request-level check does not establish a new database-wide unique request
  invariant across unrelated legacy/direct writers. Existing unique(proposal_id)
  protects each proposal; global per-request uniqueness would need a separate
  design if unrelated writers can concurrently book different proposals.
- Venue exclusions are not changed. A conflicting insert raises 23P01; a unique
  conflict raises 23505. No new confirmation or Event survives a failed call.

## Remaining focused read-only catalog checks

Run manually only when requested; none were run by the agent. Export each result.

### 1. Exact installed confirmation definition, owner, settings and privileges

```sql
select '01_confirmation_baseline' as check_name,
  p.oid::regprocedure as routine, md5(p.prosrc) as body_md5,
  pg_get_functiondef(p.oid) as definition,
  pg_get_userbyid(p.proowner) as function_owner,
  current_user as execution_role, r.rolsuper, r.rolbypassrls,
  p.prosecdef, p.proconfig, p.proacl,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))
    where grantee=0 and privilege_type='EXECUTE') as public_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_roles r on r.rolname=current_user
where p.oid=to_regprocedure('public.eventflow_confirm_customer_selection(uuid,text)');
```

Expected: one row; baseline hash above; exact reviewed function; existing trusted
owner equals execution role with bypass-RLS/superuser; SECURITY DEFINER true;
empty search path and row_security=off; anon/public false, authenticated true.
Export the COMPLETE definition and ACL for rollback BEFORE any installation.

### 2. Column compatibility and required values

```sql
select '02_event_mapping_columns' as check_name, table_name, ordinal_position,
  column_name, data_type, udt_name, is_nullable, column_default,
  numeric_precision, numeric_scale, is_identity, is_generated
from information_schema.columns
where table_schema='public'
  and (table_name='events'
    or (table_name='requests' and column_name in
      ('id','customer_id','event_name','event_date','event_time',
       'event_end_time','event_type','venue_id','guests')))
order by table_name,ordinal_position;
```

Expected: mappings/types above; nullable UUID events.customer_name; numeric value
either unbounded or at least 9 integer digits and 2 fractional digits; no new
required column without a default outside the explicit insert.
Review generated/identity columns before approving (draft expects ordinary
writable columns for explicitly inserted values).

### 3. Actual Event constraint definitions and enabled user triggers

```sql
select '03_event_constraints' as check_name, conname, contype,
  convalidated, condeferrable, condeferred, pg_get_constraintdef(oid,true) as definition
from pg_catalog.pg_constraint
where conrelid='public.events'::regclass
order by conname;
```

Expected: same proposal/venue FKs, valid booking-time CHECK, and immediate
venue-overlap exclusion whose predicate includes `Confirmed`. Any status CHECK
must accept `Confirmed`. Any other CHECK/FK must accept the proposed mapping.
The already confirmed unique proposal index is also asserted by the draft.

```sql
select '03_enabled_event_action_triggers' as check_name,
  t.tgrelid::regclass as relation, t.tgname, t.tgenabled,
  pg_get_triggerdef(t.oid,true) as definition,
  t.tgfoid::regprocedure as function_name
from pg_catalog.pg_trigger t
where t.tgrelid in ('public.events'::regclass,
  'public.eventflow_customer_response_actions'::regclass)
  and not t.tgisinternal and t.tgenabled<>'D'
order by t.tgrelid::regclass::text,t.tgname;
```

Expected: no rows per earlier exports, or explicit review of each returned trigger.
Confirm it cannot suppress the Event insert, change mapped values, or cause
unexpected side effects. Names alone do not verify trigger behavior.

## Installation and verification plan (future approval required)

1. Resolve checks 1–3, any trigger behavior and request-field mapping. Review the
   COMPLETE draft, including the stricter saved-price format checks.
2. Save the original pg_get_functiondef output and ACL outside the database.
   Record the three historical confirmation response IDs and baseline counts
   privately; do not copy Customer details into the repository.
3. Obtain explicit approval. In the MANUAL execution copy only, set
   `eventflow.confirm_selection_event_reviewed='yes'`. Run the entire transaction.
   Do not rerun the older action migration and do not change its acknowledgement.
4. Check function identity/ACL/settings against the saved baseline; its body should
   now contain `insert into public.events` and the numeric validations.
   Existing Event/action counts must be unchanged immediately after installation.
5. With synthetic fixtures and separately approved record-writing tests, cover:
   - Unauthenticated, unapproved staff and Customer callers: reject, no writes.
   - New approved selection A and separately B: one Event, correct proposal/
     customer/request details and price, one confirmation action.
   - Same-message retry and concurrent identical confirmations: one Event/action.
     Different-message retry: rejected, no changes.
   - Each historical confirmation retry: same old action, zero backfill.
   - Unreleased/mixed/latest-revision mismatch and ownership mismatch: reject.
   - Missing/string/negative/over-limit/fractional-cent totals, invalid line amounts,
     empty breakdown, arithmetic mismatch: reject both writes.
   - Valid zero and decimal totals: accepted. Valid over-budget estimate: accepted
     without changing the saved request budget.
   - Null venue: no fabricated booking; real overlapping venue/time: both writes
     rejected; adjacent time ranges allowed by the existing `[)` exclusion.
   - Force confirmation-action insertion failure: no Event survives the call.
   None of these tests requires RunPod. Do not seed/write Production without a
   separate explicit approval. Staging availability is not assumed.

### Read-only post-install checks

```sql
select '04_event_links_and_prices' as check_name,
  count(*) as event_count,
  count(*) filter(where e.customer_id is distinct from r.customer_id) as ownership_mismatches,
  count(*) filter(where jsonb_typeof(p.plan_content->'totalEstimatedMYR') is distinct from 'number') as invalid_totals,
  count(*) filter(where e.total_value is distinct from
    case when jsonb_typeof(p.plan_content->'totalEstimatedMYR')='number'
      then (p.plan_content->>'totalEstimatedMYR')::numeric end) as price_mismatches
from public.events e
join public.proposals p on p.id=e.proposal_id
join public.requests r on r.id=p.request_id;

select '04_duplicate_event_proposals' as check_name, proposal_id, count(*) as copies
from public.events
group by proposal_id having count(*)>1;
```

After installation alone: zero Events, no duplicates. After an approved synthetic
confirmation: one matching Event per newly confirmed proposal, mismatch counts
zero. Use the baseline historical IDs to distinguish intentional old action-only
records from any failed new connection; do not treat all old missing Events as a bug.

## Frontend and rollback boundaries

Business Events and Availability still receive browser-local store.events in
BusinessPortal.tsx; calendar-management.tsx does not fetch Supabase. This SQL draft
alone will NOT make real Events appear there. That requires a separately approved
frontend data connection. No frontend was changed in this phase.

Before COMMIT, any preflight/postflight failure rolls the migration back.
After installation, rollback is manual execution of the previously exported
original CREATE OR REPLACE FUNCTION, followed by PostgREST schema reload, under
separate approval. Verify its ACL/owner/settings against the saved copy.
Do NOT delete Events or confirmations created meanwhile. Restoring the old
function stops future Event creation and leaves those records intact; it does
not retroactively undo already committed business actions.
