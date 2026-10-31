-- EventFlow notifications, Step 2 verification.
-- Read-only. Run only after the migration is approved and applied.

-- Tables, owners, and RLS flags.
select
  c.oid::regclass as relation,
  c.relkind as object_kind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  pg_get_userbyid(c.relowner) as owner
from pg_class c
where c.oid in (
  to_regclass('public.notification_events'),
  to_regclass('public.notification_reads')
)
order by c.oid::regclass::text;

-- Columns and defaults.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('notification_events', 'notification_reads')
order by table_name, ordinal_position;

-- Constraints and indexes, including the event/user uniqueness key.
select
  c.conrelid::regclass as relation,
  c.conname,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid in (
  'public.notification_events'::regclass,
  'public.notification_reads'::regclass
)
order by c.conrelid::regclass::text, c.conname;

select
  i.indrelid::regclass as relation,
  i.indexrelid::regclass as index_name,
  i.indisunique,
  i.indisvalid,
  pg_get_indexdef(i.indexrelid) as definition
from pg_index i
where i.indrelid in (
  'public.notification_events'::regclass,
  'public.notification_reads'::regclass
)
order by i.indrelid::regclass::text, i.indexrelid::regclass::text;

-- Exact RLS expressions and grants.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('notification_events', 'notification_reads')
order by tablename, policyname;

-- Expected: one staff SELECT policy on events; one own-row SELECT and one
-- own-row INSERT policy on reads; no UPDATE/DELETE policy on reads.
select
  count(*) filter (
    where tablename = 'notification_events' and cmd = 'SELECT'
  ) as event_select_policies,
  count(*) filter (
    where tablename = 'notification_events' and cmd <> 'SELECT'
  ) as event_write_policies,
  count(*) filter (
    where tablename = 'notification_reads' and cmd = 'SELECT'
  ) as read_select_policies,
  count(*) filter (
    where tablename = 'notification_reads' and cmd = 'INSERT'
  ) as read_insert_policies,
  count(*) filter (
    where tablename = 'notification_reads' and cmd in ('UPDATE', 'DELETE')
  ) as forbidden_read_update_delete_policies
from pg_policies
where schemaname = 'public'
  and tablename in ('notification_events', 'notification_reads');

-- Shows effective privileges for service_role without assuming or changing its
-- project-level defaults. Its ACL is deliberately not modified by this script.
with effective_acl as (
  select
    r.rolname,
    has_table_privilege(r.rolname, 'public.notification_events', 'SELECT') as can_read_events,
    has_table_privilege(r.rolname, 'public.notification_events', 'INSERT') as can_insert_events,
    has_table_privilege(r.rolname, 'public.notification_events', 'UPDATE') as can_update_events,
    has_table_privilege(r.rolname, 'public.notification_events', 'DELETE') as can_delete_events,
    has_table_privilege(r.rolname, 'public.notification_reads', 'SELECT') as can_read_read_states,
    has_table_privilege(r.rolname, 'public.notification_reads', 'INSERT') as can_insert_read_states,
    has_table_privilege(r.rolname, 'public.notification_reads', 'UPDATE') as can_update_read_states,
    has_table_privilege(r.rolname, 'public.notification_reads', 'DELETE') as can_delete_read_states
  from pg_roles r
  where r.rolname in ('anon', 'authenticated', 'service_role')
)
select
  effective_acl.*,
  case
    when rolname = 'anon' then
      not (can_read_events or can_insert_events or can_update_events or can_delete_events
        or can_read_read_states or can_insert_read_states
        or can_update_read_states or can_delete_read_states)
    when rolname = 'authenticated' then
      can_read_events
      and not (can_insert_events or can_update_events or can_delete_events)
      and can_read_read_states and can_insert_read_states
      and not (can_update_read_states or can_delete_read_states)
    else null
  end as expected_client_grants_match,
  case
    when rolname = 'service_role' then
      can_read_events and can_insert_events and can_update_events and can_delete_events
      and can_read_read_states and can_insert_read_states
      and can_update_read_states and can_delete_read_states
    else null
  end as service_role_crud_preserved
from effective_acl
order by rolname;

-- Verify the existing staff predicate used by the policies. Review its
-- definition, owner, SECURITY DEFINER flag, search_path, and authenticated EXECUTE.
select
  p.oid::regprocedure as function_name,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.oid = to_regprocedure('public.is_staff()');

-- Step 2 intentionally creates no triggers and no historical notification rows.
select
  t.tgrelid::regclass as relation,
  t.tgname,
  pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where not t.tgisinternal
  and t.tgrelid in (
    'public.notification_events'::regclass,
    'public.notification_reads'::regclass
  )
order by t.tgrelid::regclass::text, t.tgname;

select
  (select count(*) from public.notification_events) as event_rows,
  (select count(*) from public.notification_reads) as read_rows;
