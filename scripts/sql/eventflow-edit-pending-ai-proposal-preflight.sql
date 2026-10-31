-- READ-ONLY Production preflight for the pending AI Proposal Editor migration.
-- Paste into Supabase SQL Editor and run before considering the migration.
-- This file contains SELECT statements only; it does not change grants, RLS,
-- functions, data, or schema.

-- 1. Effective UPDATE privileges (includes PUBLIC and inherited role privileges).
-- GO after the migration only if anon/authenticated are false for both columns;
-- service_role/postgres and the eventual RPC owner must retain required access.
with target_roles as (
  select oid, rolname, rolsuper, rolbypassrls
  from pg_catalog.pg_roles
  where rolname in ('anon','authenticated','service_role','postgres')
),
proposal_columns as (
  select attname
  from pg_catalog.pg_attribute
  where attrelid=to_regclass('public.proposals')
    and attnum>0
    and not attisdropped
)
select
  '01_effective_update_privileges' as check_name,
  r.rolname as role_name,
  r.rolsuper as is_superuser,
  r.rolbypassrls as bypasses_rls,
  has_table_privilege(r.oid,'public.proposals','UPDATE') as table_update,
  coalesce(bool_or(has_column_privilege(
    r.oid,'public.proposals',c.attname,'UPDATE'
  )),false) as any_column_update,
  string_agg(c.attname,', ' order by c.attname)
    filter (where has_column_privilege(
      r.oid,'public.proposals',c.attname,'UPDATE'
    )) as columns_with_update
from target_roles r
cross join proposal_columns c
group by r.oid,r.rolname,r.rolsuper,r.rolbypassrls
order by r.rolname;

-- 2. Explicit table/column UPDATE ACL entries. This distinguishes direct grants
-- from effective privileges reported above. Zero rows for anon/authenticated/
-- PUBLIC is the intended post-migration result.
select
  '02_direct_update_acl' as check_name,
  'table'::text as object_scope,
  'public.proposals'::text as object_name,
  coalesce(grantee.rolname,'PUBLIC') as grantee,
  grantor.rolname as grantor,
  acl.privilege_type,
  acl.is_grantable
from pg_catalog.pg_class c
cross join lateral aclexplode(
  coalesce(c.relacl,acldefault('r',c.relowner))
) acl
left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
left join pg_catalog.pg_roles grantor on grantor.oid=acl.grantor
where c.oid=to_regclass('public.proposals')
  and acl.privilege_type='UPDATE'
union all
select
  '02_direct_update_acl',
  'column',
  format('public.proposals.%I',att.attname),
  coalesce(grantee.rolname,'PUBLIC'),
  grantor.rolname,
  acl.privilege_type,
  acl.is_grantable
from pg_catalog.pg_attribute att
cross join lateral aclexplode(coalesce(att.attacl,'{}'::aclitem[])) acl
left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
left join pg_catalog.pg_roles grantor on grantor.oid=acl.grantor
where att.attrelid=to_regclass('public.proposals')
  and att.attnum>0
  and not att.attisdropped
  and acl.privilege_type='UPDATE'
order by object_scope,object_name,grantee;

-- 3. Proposals RLS flags and every UPDATE/ALL policy predicate.
-- RLS should remain enabled; inspect USING and WITH CHECK for each returned row.
select
  '03_proposals_update_policies' as check_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual as using_expression,
  p.with_check
from pg_catalog.pg_class c
left join pg_catalog.pg_policies p
  on p.schemaname='public'
 and p.tablename='proposals'
 and p.cmd in ('UPDATE','ALL')
where c.oid=to_regclass('public.proposals')
order by p.policyname;

-- 4. The proposed edit RPC, if it already exists.
-- Expected before first installation: function_exists=false.
-- If present, review its owner/security mode and all execution access before
-- deciding whether the migration can be applied or rerun.
with expected(signature) as (
  values ('public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb)')
),
resolved as (
  select e.signature, p.*
  from expected e
  left join pg_catalog.pg_proc p on p.oid=to_regprocedure(e.signature)
)
select
  '04_edit_rpc' as check_name,
  signature,
  resolved.oid is not null as function_exists,
  case when resolved.oid is not null then resolved.oid::regprocedure::text end as resolved_signature,
  owner.rolname as owner_name,
  owner.rolsuper as owner_is_superuser,
  owner.rolbypassrls as owner_bypasses_rls,
  prosecdef as security_definer,
  proconfig as function_settings,
  case when resolved.oid is not null then
    has_table_privilege(resolved.proowner,'public.proposals','UPDATE')
  else false end as owner_can_update_proposals,
  case when resolved.oid is not null then
    has_function_privilege('authenticated',resolved.oid,'EXECUTE')
  else false end as authenticated_execute,
  case when resolved.oid is not null then
    has_function_privilege('anon',resolved.oid,'EXECUTE')
  else false end as anon_execute,
  coalesce((
    select bool_or(a.grantee=0 and a.privilege_type='EXECUTE')
    from aclexplode(coalesce(resolved.proacl,acldefault('f',resolved.proowner))) a
  ),false) as public_execute
from resolved
left join pg_catalog.pg_roles owner on owner.oid=resolved.proowner;

-- 5. Existing approval/acceptance/confirmation functions and their trusted
-- owners. Expected: functions exist, are SECURITY DEFINER, and their owners
-- retain proposal UPDATE. Check EXECUTE grants against the intended callers.
with expected(signature) as (
  values
    ('public.approve_ai_proposal_pair(uuid,text)'),
    ('public.accept_proposal(uuid)'),
    ('public.eventflow_confirm_customer_selection(uuid,text)')
),
resolved as (
  select e.signature, p.*
  from expected e
  left join pg_catalog.pg_proc p on p.oid=to_regprocedure(e.signature)
)
select
  '05_existing_workflow_functions' as check_name,
  signature,
  resolved.oid is not null as function_exists,
  case when resolved.oid is not null then resolved.oid::regprocedure::text end as resolved_signature,
  owner.rolname as owner_name,
  owner.rolsuper as owner_is_superuser,
  owner.rolbypassrls as owner_bypasses_rls,
  prosecdef as security_definer,
  proconfig as function_settings,
  case when resolved.oid is not null then
    has_table_privilege(resolved.proowner,'public.proposals','UPDATE')
  else false end as owner_can_update_proposals,
  case when resolved.oid is not null then
    has_function_privilege('authenticated',resolved.oid,'EXECUTE')
  else false end as authenticated_execute,
  case when resolved.oid is not null then
    has_function_privilege('anon',resolved.oid,'EXECUTE')
  else false end as anon_execute,
  coalesce((
    select bool_or(a.grantee=0 and a.privilege_type='EXECUTE')
    from aclexplode(coalesce(resolved.proacl,acldefault('f',resolved.proowner))) a
  ),false) as public_execute
from resolved
left join pg_catalog.pg_roles owner on owner.oid=resolved.proowner
order by signature;

-- 6a. Candidate routines whose stored source mentions both proposals and UPDATE.
-- This is a dependency aid, not a complete dependency proof: dynamic SQL,
-- external services, and application code may not be visible in routine text.
select
  '06a_candidate_proposal_update_routines' as check_name,
  p.oid::regprocedure as function_signature,
  l.lanname as language,
  owner.rolname as owner_name,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  left(p.prosrc,3000) as source_excerpt
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
join pg_catalog.pg_language l on l.oid=p.prolang
join pg_catalog.pg_roles owner on owner.oid=p.proowner
where n.nspname='public'
  and p.prokind in ('f','p')
  and p.prosrc ~* 'proposals'
  and p.prosrc ~* 'update'
order by p.proname,p.oid::regprocedure::text;

-- 6b. Triggers on proposals that may run when a trusted function updates it.
select
  '06b_proposals_triggers' as check_name,
  t.tgname as trigger_name,
  t.tgenabled as enabled_mode,
  pg_get_triggerdef(t.oid,true) as trigger_definition,
  p.oid::regprocedure as trigger_function,
  owner.rolname as function_owner,
  p.prosecdef as function_security_definer
from pg_catalog.pg_trigger t
join pg_catalog.pg_proc p on p.oid=t.tgfoid
join pg_catalog.pg_roles owner on owner.oid=p.proowner
where t.tgrelid=to_regclass('public.proposals')
  and not t.tgisinternal
order by t.tgname;

-- 6c. Views/materialized views that depend on proposals.
select distinct
  '06c_proposal_dependent_views' as check_name,
  view_ns.nspname as view_schema,
  view_class.relname as view_name,
  view_class.relkind as relation_kind,
  pg_get_viewdef(view_class.oid,true) as view_definition
from pg_catalog.pg_depend d
join pg_catalog.pg_rewrite rw
  on d.classid='pg_catalog.pg_rewrite'::regclass
 and d.objid=rw.oid
join pg_catalog.pg_class view_class on view_class.oid=rw.ev_class
join pg_catalog.pg_namespace view_ns on view_ns.oid=view_class.relnamespace
where d.refclassid='pg_catalog.pg_class'::regclass
  and d.refobjid=to_regclass('public.proposals')
  and view_class.relkind in ('v','m')
order by view_schema,view_name;

-- 7. Static migration checks are not available from the Production catalog.
-- Local review of scripts/sql/eventflow-edit-pending-ai-proposal.sql found:
-- BEGIN/COMMIT, acknowledgement='no', trusted-role preflight, explicit table
-- and per-column UPDATE revokes, and RAISE EXCEPTION postflight assertions.
-- The postflight checks effective client privileges and aborts the transaction
-- if anon/authenticated UPDATE remains; it also checks postgres/service_role
-- and the editor RPC owner retain UPDATE. Re-review the local file itself before
-- execution; this comment is not a database assertion.
