-- OWNER REVIEW ONLY. Not executed by the app or Agent.
-- Metadata only: no records, mutations, leases, AI calls or migrations.
select table_name,column_name,data_type,udt_name,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in ('requests','proposals','profiles')
order by table_name,ordinal_position;
select c.oid::regclass as relation,c.relrowsecurity,c.relforcerowsecurity,
  pg_get_userbyid(c.relowner) as owner
from pg_class c where c.oid in (
  'public.requests'::regclass,'public.proposals'::regclass,'public.profiles'::regclass);
select t.typname,e.enumlabel,e.enumsortorder
from pg_type t join pg_enum e on e.enumtypid=t.oid
where t.oid in (select a.atttypid from pg_attribute a
  where a.attrelid in ('public.requests'::regclass,'public.proposals'::regclass,'public.profiles'::regclass))
order by t.typname,e.enumsortorder;
select c.conrelid::regclass as relation,c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid in (
  'public.requests'::regclass,'public.proposals'::regclass,'public.profiles'::regclass);
-- Includes UNIQUE INDEXes not backed by pg_constraint, expressions and predicates.
select i.indrelid::regclass as relation,i.indexrelid::regclass as index_name,
  i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) as definition
from pg_index i where i.indrelid in (
  'public.requests'::regclass,'public.proposals'::regclass,'public.profiles'::regclass);
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public';
select table_name,grantee,privilege_type
from information_schema.table_privileges where table_schema='public'
order by table_name,grantee,privilege_type;
select table_name,column_name,grantee,privilege_type
from information_schema.column_privileges where table_schema='public'
and table_name in ('requests','proposals','profiles');
select t.tgrelid::regclass as relation,pg_get_triggerdef(t.oid) as trigger,
  pg_get_functiondef(t.tgfoid) as trigger_function
from pg_trigger t where not t.tgisinternal and t.tgrelid in (
  'public.requests'::regclass,'public.proposals'::regclass,'public.profiles'::regclass);
-- Review ALL definer RPCs, including legacy proposal approval/persistence/read RPCs.
select n.nspname,p.proname,p.prosecdef,p.proacl,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f';
-- Owner-rights views/materialized views can bypass base-table RLS.
select c.relname,c.relkind,c.reloptions,pg_get_viewdef(c.oid,true) as definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('v','m');
-- Profile protection is a prerequisite: a customer must not be able to promote
-- role/account_type/approval_status through UPDATE, INSERT, RPCs, or triggers.
select r.rolname,c.column_name,
  has_column_privilege(r.rolname,'public.profiles',c.column_name,'UPDATE') as can_update,
  has_column_privilege(r.rolname,'public.profiles',c.column_name,'INSERT') as can_insert
from pg_roles r cross join (values ('role'),('account_type'),('approval_status')) c(column_name)
where r.rolname in ('anon','authenticated');
