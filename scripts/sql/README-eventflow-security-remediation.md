# EventFlow Supabase security-remediation review

**Preparation only. No grants, policies, functions, records, or defaults were
changed.** Do not execute the remediation SQL without separately approving the
exact statement set and the preflight outputs.

## Evidence reviewed

The current Query 3 export names `anon` and `authenticated` directly in the
`TABLE_ACL` output for all five base tables. These are explicit ACL entries,
not merely privileges inferred from RLS or inherited roles. The export also
shows effective `TRUNCATE`, `TRIGGER`, `REFERENCES`, and `MAINTAIN` access.
It does not preserve whether those direct ACLs were originally issued by an
explicit `GRANT` or materialized from a default ACL when the table was created.
Query C is now reported to show broad public-schema defaults for both `postgres`
and `supabase_admin`, including client `TRUNCATE`. Query B executed but its
actual rows have not been supplied/confirmed. **This draft is not finalized or
approved for execution until those rows (or an explicit empty result) are reviewed.**
Keep the full Query C export for scope, grant-option and rollback verification.

The same Query 3 results show public-schema `USAGE` but no `CREATE` for client
roles; auth-schema `USAGE` is also present. The remediation leaves both schemas
and all `service_role` grants untouched.

The policy export confirms ordinary row operations remain RLS-gated:
Customers select their own requests and only Business-approved proposal states;
request insertion is ownership-checked; proposal/request/event/line writes are
staff-policy controlled. RLS does not protect `TRUNCATE`.

## Table-by-table proposal

| Table | Anon | Authenticated | App dependencies and rationale |
|---|---|---|---|
| `requests` | Revoke table and column ACLs. No anon RLS policy. | Keep `SELECT`, `INSERT`, `UPDATE`; remove `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, and independent column ACLs. | Customer Portal reads own requests and inserts saved requests. Business reads requests; existing staff update policy is preserved. |
| `proposals` | Revoke table and column ACLs. | Keep `SELECT`, `INSERT`, `UPDATE`; remove other table privileges and independent column ACLs. | Customer and Business portals read proposals; Business review reads saved content; staff-only RLS policies retain proposal creation/update paths. AI persistence uses the backend. |
| `profiles` | Revoke table and column ACLs. | Keep `SELECT` only; remove `REFERENCES`, `TRUNCATE`, `TRIGGER`, `MAINTAIN`, and column ACLs. | Unified auth reads the signed-in profile; Business admin reads pending profiles. Registration review is an RPC, not a client table write. There are no profile write policies in the supplied policy output. |
| `events` | Revoke table and column ACLs. | Keep `SELECT`, `INSERT`, `UPDATE`; remove other table privileges and independent column ACLs. | Preserve the existing own-event read and staff create/update policies. Do not use the legacy booking RPC for Customer response selection. |
| `proposal_lines` | Revoke table and column ACLs. | Keep `SELECT`, `INSERT`, `UPDATE`; remove other table privileges and independent column ACLs. | Business reads saved line items; retain the existing staff-only write policies. Legacy `accept_proposal` reads these lines. |

The draft first revokes both per-column and table ACLs for just `anon` and
`authenticated`, then restores the table-level rights listed above. It does not
touch `PUBLIC`, `service_role`, RLS policies, schema grants, or any row.
Its STOP guards reject unexpected `PUBLIC` ACLs, missing RLS, or unreviewed
global/other-owner default privileges.

`MAINTAIN` is reported by this database’s PostgreSQL version. Revoking all table
privileges for these client roles removes it along with the other excess rights.

## What the grants do—and do not—mean

- A direct ACL grant allows an operation at the PostgreSQL privilege layer.
  Ordinary Supabase REST reads/inserts/updates/deletes still need a matching
  RLS policy. The exported policies deny anon and prevent Customer proposal
  writes. They do not make the grants good least-privilege practice.
- `TRUNCATE` is not subject to RLS. The ACL result confirms the privilege, but
  does not prove a public REST endpoint accepts an arbitrary SQL/TRUNCATE
  request; no destructive test was run.
- Schema `USAGE` is required for PostgREST object resolution; `CREATE` is not
  required by the portals and is already false for these roles.
- Direct ACLs are visible now. Historical provenance is not: a table ACL does
  not say whether it came from a hand-written `GRANT` or an earlier default ACL.
- The draft removes `public` table/sequence defaults to anon/authenticated for
  both `postgres` and `supabase_admin`. Existing objects are unaffected by default
  privilege changes. Future objects need explicit, reviewed client grants.
  Schema-specific revokes cannot cancel global defaults: the draft stops on
  global, PUBLIC, or other-creator defaults instead of silently leaving them.
- The execution role must be authorized to alter defaults for **both** creators.
  Database ownership or BYPASSRLS alone does not establish that authorization.

## SECURITY DEFINER review

Evidence available from the supplied function exports:

| Function | Evidence and recommendation |
|---|---|
| `is_staff()` | `SECURITY DEFINER`, empty search path, fully qualified `public.profiles`, bound to `auth.uid()`, and requires approved staff/business or approved admin profile. Keep authenticated access needed by policies; do not change its ACL until Query D confirms current grants. |
| `approve_ai_proposal_pair(uuid,text)` | `SECURITY DEFINER`, empty search path; checks non-NULL `auth.uid()` and `is_staff()`, locks the request, requires exactly one pending A and B, updates both atomically. Supplied ACL export reports anon cannot execute and authenticated can. Preserve authenticated execution; no change is drafted. |
| `accept_proposal(uuid)` | `SECURITY DEFINER`, empty search path; verifies login, request ownership, proposal status and required booking fields, then inserts an event and marks the proposal Accepted. Supplied ACL export reports anon and authenticated can execute. An anon call fails its login guard, but anon EXECUTE remains unnecessary. Its status test is not NULL-safe; the current proposal status column is nullable. It also computes a booking total from `proposal_lines`, requires venue/time details, and inserts text `requests.customer_name` into UUID `events.customer_name`—a confirmed schema compatibility issue. `events_proposal_id_unique` prevents a duplicate event for the same proposal but does not make a retry return the original result. Retain authenticated legacy access pending explicit product/owner decision; do not call it for selection. |
| `is_admin()` | Query D is reported to confirm approved-admin authorization tied to `auth.uid()`. Preserve authenticated EXECUTE: the profile SELECT policy depends on it. Unnecessary anon execution is not proof of an authorization bypass. |
| Both `review_business_registration(...)` overloads | Query D is reported to confirm internal admin authorization. Preserve authenticated EXECUTE for Business Registration. Review actual direct ACLs before separate anon/PUBLIC EXECUTE cleanup. |
| `handle_new_user()` | Query D reports customer-role profiles and pending business registrations. Preserve its body, ownership, trigger and ACLs in this minimal remediation. A trigger-returning function is not an ordinary directly callable RPC. |
| `persist_runpod_ai_proposal_pair(...)` | Query D reports anon/authenticated cannot execute it. Leave this backend-only function and trusted access unchanged. |
| `rls_auto_enable()` | Query D reports an event-trigger function with broad EXECUTE grants. This alone does not let clients call it as an ordinary RPC or create event triggers. Leave its event trigger intact; review EXECUTE cleanup separately with exact ACLs and trusted callers. |
| Other profile/security RPCs | Query D returns all public `SECURITY DEFINER` functions and profile/admin/staff/registration-related functions, with body, owner, `proconfig`, direct ACL, and effective anon/authenticated/service-role execution. Do not apply a blanket function revoke. |

No function-grant changes are included in the table-ACL migration. This preserves
signup, Business Registration, pair approval and legacy booking. A separately
approved cleanup can revoke direct anon EXECUTE where present. If access comes
from PUBLIC, removing PUBLIC EXECUTE must preserve authenticated execution of
is_admin, registration overloads and required legacy RPCs, plus trusted callers.
Revoking from anon alone is insufficient; Query B must rule out inherited paths.

Conditional `accept_proposal` statements for that follow-on—not approved for
execution yet—are:

```sql
-- Only if Query D shows a direct anon ACL entry:
revoke execute on function public.accept_proposal(uuid) from anon;

-- Only if Query D shows anon access is inherited from PUBLIC, and the owner
-- approves removing PUBLIC execution after enumerating all existing callers:
revoke execute on function public.accept_proposal(uuid) from public;
grant execute on function public.accept_proposal(uuid) to authenticated;
```

Do not revoke `PUBLIC` execution without preserving any other existing
service-role or application role whose effective access Query D shows is
required. Do not change `approve_ai_proposal_pair`, `is_staff`, `is_admin`, or
profile-registration RPC grants without exact ACL/caller review. Trigger and
event-trigger EXECUTE overgrants are cleanup candidates, not a confirmed direct
RPC vulnerability.

## Default grants and rollback

Before considering the draft, supply the already-run Query B result and retain
the full Query C export. Do not repeat completed catalog checks. If
`anon`/`authenticated` are members of an unexpected privileged role, or if
global/PUBLIC/other-owner default ACL entries exist, stop and review them
separately. Do not infer inheritance or future defaults from current table ACLs.
All three SQL approval flags remain `no`. An extra guard rejects memberships
where either client role is a member of another role, pending an explicitly
reviewed allowed set. Membership of `authenticator` *in* the client roles is a
different direction and is not rejected by that guard.

The remediation is transactional; a SQL error rolls back the transaction.
Before execution, retain existing A/A2/C/D/E exports and the actual B rows.
Retrieving missing snapshots is necessary for rollback, not a new investigation.
If a later owner-approved rollback is
needed, restore exactly the previous table privileges for anon/authenticated:

```sql
grant all privileges on table public.requests,public.proposals,
  public.events,public.proposal_lines to anon,authenticated;
grant select,references,trigger,truncate,maintain
  on table public.profiles to anon,authenticated;
```

Those statements restore the prior broad table ACL behavior recorded in Query 3;
they are intentionally **not** in the remediation migration. Only restore
default privileges if Query C showed they previously existed, using its exact
owner/schema/grantee/privilege/grant-option output for **both** creators. Do not
invent a `GRANT ALL` default rollback from the summarized Query C result.
Rollback reintroduces known excess privileges and needs explicit approval.
No service-role, PUBLIC, function,
schema, or RLS ACL rollback is needed because the draft does not alter them.
Table-level grants restore the old all-column effective grant coverage; the
previous independent column-grant presentation is not identical. If exact ACL
shape is required, restore saved A2 column grants too. Do not use CASCADE;
dependent-grant errors must abort rather than revoke other callers silently.

## Before/after verification and activation gates

1. **Before:** use existing A/A2/C/D/E exports as the baseline; confirm the missing
   B rows. Confirm the execution role can alter both creators' defaults.
2. **After an approved staging run:** rerun A/A2/C/D/E from
   `eventflow-security-remediation-review.sql`. Anon must have no table/column
   access; authenticated must match the table matrix; neither creator may have
   public table/sequence defaults for clients. RLS, schema grants, service-role
   access and function ACLs must match the saved baseline.
3. The transaction asserts effective table privileges, cleared independent column
   ACLs and cleared targeted defaults before COMMIT; a mismatch aborts everything.
4. Test signup, Business Registration/review, Customer request submit/read,
   Business editing/pair approval and Customer approved-proposal reads in staging.
   Use existing/mock data; do not call RunPod.
5. Separately approve the Customer Response migration. Its new table revokes
   PUBLIC/anon/authenticated ACLs then grants authenticated SELECT only; writes
   use the ownership/role-checking response RPC. Its functions explicitly revoke
   default client/PUBLIC EXECUTE then grant required access. Trusted service-role
   access is preserved; existing table grants are not changed.
6. Apply nothing until the owner approves the exact SQL. After migration and
   permission/behavior verification, separately approve enabling the frontend
   feature flag and publishing. Keep the feature disabled until then.

## Tests before applying

After owner approval and only in an approved disposable/staging project:

1. Confirm anon and authenticated no longer have `TRUNCATE`, `TRIGGER`,
   `REFERENCES`, `MAINTAIN`, or `DELETE` on these tables.
2. Confirm authenticated portal operations still work: Customer own-request
   SELECT/INSERT; Customer approved-proposal SELECT; Business request/proposal/
   line SELECT and staff-policy-approved writes; profile SELECT; pair-approval
   RPC and registration-review RPC.
3. Confirm anon cannot access application rows or call protected RPCs.
4. Confirm Customers still cannot write proposals, proposal lines, events,
   profiles, or other Customers' requests even though staff-facing table
   privileges remain.
5. Confirm all five RLS policies/flags are unchanged and `service_role` ACLs
   are unchanged.
6. Inspect the future-table default ACL result for the expected creator role.
7. Exercise existing authenticated and admin profile workflows before any
   production execution.

The query export establishes ACLs and policy definitions, not an authenticated
behavioral test. No SQL, data writes, privilege changes, or destructive tests
were executed while preparing this review.
