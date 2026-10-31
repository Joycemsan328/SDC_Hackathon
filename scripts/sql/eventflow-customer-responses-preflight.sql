-- OWNER READ-ONLY REVIEW. Prepared only; NOT run by the Agent/application.
-- Run this file FIRST in Supabase SQL Editor and return all result sets.
-- No application records, credentials, mutations, or function execution.
select current_user, session_user;

select c.oid::regclass as relation, c.relkind, c.relrowsecurity,
  c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and (
  c.relname in ('requests','proposals','profiles','events','proposal_lines')
  or c.relname like 'eventflow%response%'
  or c.relname in ('eventflow_proposal_revisions','eventflow_plan_selections'))
order by c.relname;

select rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
from pg_roles where rolname in ('anon','authenticated','service_role',current_user);

select table_name,column_name,data_type,udt_name,is_nullable,column_default
from information_schema.columns where table_schema='public'
and table_name in ('requests','proposals','profiles','events','eventflow_customer_responses')
order by table_name,ordinal_position;

-- Refresh the earlier exports: they are historical evidence, not current proof.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
and tablename in ('requests','proposals','profiles','events','proposal_lines','eventflow_customer_responses')
order by tablename,policyname;

select c.relname as table_name,r.rolname as grantee,p.privilege,
  has_table_privilege(r.rolname,c.oid,p.privilege) as effective
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join pg_roles r
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
  ('REFERENCES'),('TRIGGER')) p(privilege)
where n.nspname='public' and c.relkind in ('r','p')
and c.relname in ('requests','proposals','profiles','events','proposal_lines','eventflow_customer_responses')
and r.rolname in ('anon','authenticated','service_role')
order by c.relname,r.rolname,p.privilege;

select table_name,column_name,grantee,privilege_type
from information_schema.column_privileges where table_schema='public'
and table_name in ('requests','proposals','profiles','eventflow_customer_responses')
order by table_name,column_name,grantee;

select c.conrelid::regclass as relation,c.conname,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public'
and t.relname in ('requests','proposals','profiles','events','eventflow_customer_responses')
order by (c.conrelid::regclass)::text,c.conname;

select i.indrelid::regclass as relation,i.indexrelid::regclass as index_name,
  i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) as definition,
  pg_get_expr(i.indpred,i.indrelid) as predicate
from pg_index i join pg_class t on t.oid=i.indrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public'
and t.relname in ('requests','proposals','events','eventflow_customer_responses')
order by (i.indrelid::regclass)::text,(i.indexrelid::regclass)::text;

select t.tgrelid::regclass as relation,t.tgname,pg_get_triggerdef(t.oid) as trigger,
  pg_get_functiondef(t.tgfoid) as trigger_function
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
and c.relname in ('requests','proposals','profiles','events','eventflow_customer_responses');

-- Review public application definer functions, including profile/role writers.
-- Do not invoke any of these functions during review.
select p.oid::regprocedure as function_name,p.prosecdef,
  pg_get_userbyid(p.proowner) as owner,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f'
and (p.prosecdef or p.proname ~ '(profile|staff|admin|response|selection|request_changes)')
order by p.proname;

select c.relname,c.relkind,c.reloptions,pg_get_viewdef(c.oid,true) as definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('v','m');
