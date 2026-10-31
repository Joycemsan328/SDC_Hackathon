-- READ-ONLY SECURITY REVIEW. Do not execute functions returned by this query.
-- Run each SELECT independently and retain every result set.

-- QUERY A: Direct table ACLs vs effective table privileges.
-- ACL entries name a direct grantee. has_table_privilege also includes
-- PUBLIC and inherited role privileges.
with target_tables as (
  select c.oid,c.relname,c.relowner,c.relacl,n.nspname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
    and c.relname in ('requests','proposals','profiles','events','proposal_lines')
), direct_acl as (
  select t.nspname,t.relname,
    case when a.grantee=0 then 'PUBLIC'
      else coalesce(r.rolname,'OID:'||a.grantee::text) end as grantee,
    a.privilege_type,a.is_grantable
  from target_tables t
  cross join lateral pg_catalog.aclexplode(
    coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
), effective as (
  select t.nspname,t.relname,r.rolname,p.privilege,
    pg_catalog.has_table_privilege(r.rolname,t.oid,p.privilege) as effective
  from target_tables t
  cross join pg_catalog.pg_roles r
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
    ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
  where r.rolname in ('anon','authenticated','service_role')
)
select 'A_DIRECT_AND_EFFECTIVE_TABLE_GRANTS'::text as check_name,
  'direct_acl'::text as result_type,d.nspname as schema_name,d.relname as object_name,
  d.grantee,d.privilege_type as privilege,d.is_grantable,
  null::boolean as effective_privilege
from direct_acl d
union all
select 'A_DIRECT_AND_EFFECTIVE_TABLE_GRANTS','effective',e.nspname,e.relname,
  e.rolname,e.privilege,null::boolean,e.effective
from effective e
order by 3,4,5,6,2;

-- QUERY A2: Direct column ACLs vs effective column privileges. This distinguishes
-- independent per-column grants from table-level grants that also cover columns.
with target_columns as (
  select c.oid as table_oid,c.relname,a.attnum,a.attname,a.attacl,n.nspname,
    c.relowner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid
  where n.nspname='public' and c.relkind in ('r','p')
    and c.relname in ('requests','proposals','profiles','events','proposal_lines')
    and a.attnum>0 and not a.attisdropped
), direct_acl as (
  select t.nspname,t.relname,t.attname,
    case when a.grantee=0 then 'PUBLIC'
      else coalesce(r.rolname,'OID:'||a.grantee::text) end as grantee,
    a.privilege_type,a.is_grantable
  from target_columns t
  cross join lateral pg_catalog.aclexplode(
    coalesce(t.attacl,'{}'::pg_catalog.aclitem[])
  ) a
  left join pg_catalog.pg_roles r on r.oid=a.grantee
), effective as (
  select t.nspname,t.relname,t.attname,r.rolname,p.privilege,
    pg_catalog.has_column_privilege(r.rolname,t.table_oid,t.attnum,p.privilege) as effective
  from target_columns t
  cross join pg_catalog.pg_roles r
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
  where r.rolname in ('anon','authenticated','service_role')
)
select 'A2_DIRECT_AND_EFFECTIVE_COLUMN_GRANTS'::text as check_name,
  'direct_acl'::text as result_type,d.nspname as schema_name,d.relname as object_name,
  d.attname as column_name,d.grantee,d.privilege_type as privilege,d.is_grantable,
  null::boolean as effective_privilege
from direct_acl d
union all
select 'A2_DIRECT_AND_EFFECTIVE_COLUMN_GRANTS','effective',e.nspname,e.relname,
  e.attname,e.rolname,e.privilege,null::boolean,e.effective
from effective e
order by 3,4,5,6,7,2;

-- QUERY B: Role memberships. The ACL query above shows current effective access;
-- this identifies direct memberships that can explain inherited role privileges.
select 'B_ROLE_MEMBERSHIPS'::text as check_name,
  member.rolname as member_role,granted.rolname as granted_role,
  membership.admin_option,membership.inherit_option,membership.set_option,
  pg_catalog.pg_has_role(member.rolname,granted.rolname,'USAGE') as inherits_privileges,
  pg_catalog.pg_has_role(member.rolname,granted.rolname,'MEMBER') as is_member
from pg_catalog.pg_auth_members membership
join pg_catalog.pg_roles member on member.oid=membership.member
join pg_catalog.pg_roles granted on granted.oid=membership.roleid
where member.rolname in ('anon','authenticated','service_role')
   or granted.rolname in ('anon','authenticated','service_role')
order by member.rolname,granted.rolname;

-- QUERY C: Default ACLs for new public objects. No rows means no explicit
-- pg_default_acl entries in this scope; it does not mean current table ACLs
-- have no grants. ACLs do not retain whether they were originally issued by
-- GRANT or materialized from a default ACL when the table was created.
select 'C_PUBLIC_DEFAULT_ACLS'::text as check_name,
  owner_role.rolname as object_creator,
  case when d.defaclnamespace=0 then '*' else schema_name.nspname end as schema_scope,
  case d.defaclobjtype
    when 'r' then 'tables'
    when 'S' then 'sequences'
    when 'f' then 'functions'
    when 'T' then 'types'
    when 'n' then 'schemas'
    else d.defaclobjtype::text end as object_type,
  case when a.grantee=0 then 'PUBLIC'
    else coalesce(grantee_role.rolname,'OID:'||a.grantee::text) end as grantee,
  a.privilege_type,a.is_grantable
from pg_catalog.pg_default_acl d
join pg_catalog.pg_roles owner_role on owner_role.oid=d.defaclrole
left join pg_catalog.pg_namespace schema_name on schema_name.oid=d.defaclnamespace
cross join lateral pg_catalog.aclexplode(d.defaclacl) a
left join pg_catalog.pg_roles grantee_role on grantee_role.oid=a.grantee
where d.defaclnamespace=0 or schema_name.nspname='public'
order by object_creator,schema_scope,object_type,grantee,privilege_type;

-- QUERY D: Sensitive function definitions, direct ACL entries and effective
-- EXECUTE. The query returns function source for review; it does not invoke it.
select 'D_SECURITY_DEFINER_AND_SENSITIVE_FUNCTIONS'::text as check_name,
  p.oid::regprocedure as function_signature,
  pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
  p.prosecdef as security_definer,p.proconfig as function_settings,
  coalesce((
    select string_agg(
      (case when a.grantee=0 then 'PUBLIC'
        else coalesce(r.rolname,'OID:'||a.grantee::text) end)
      || ':'||a.privilege_type
      ||case when a.is_grantable then ' WITH GRANT OPTION' else '' end,
      ', ' order by a.grantee,a.privilege_type
    )
    from pg_catalog.aclexplode(
      coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
    ) a left join pg_catalog.pg_roles r on r.oid=a.grantee
  ),'(none)') as direct_acl_entries,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
  pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_can_execute,
  pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f'
  and (
    p.prosecdef
    or p.proname in (
      'is_admin','is_staff','accept_proposal','approve_ai_proposal_pair',
      'review_business_registration'
    )
    or p.proname ~ '(profile|admin|staff|registration|proposal|customer|approval)'
  )
order by p.proname,p.oid::regprocedure::text;

-- QUERY E: Current public schema ACL and effective schema privileges.
-- USAGE is retained for PostgREST; CREATE is not required by portal clients.
select 'E_PUBLIC_SCHEMA_GRANTS'::text as check_name,
  case when a.grantee=0 then 'PUBLIC'
    else coalesce(r.rolname,'OID:'||a.grantee::text) end as grantee,
  a.privilege_type,a.is_grantable,
  pg_catalog.has_schema_privilege('anon','public',a.privilege_type) as anon_effective,
  pg_catalog.has_schema_privilege('authenticated','public',a.privilege_type) as authenticated_effective
from pg_catalog.pg_namespace n
cross join lateral pg_catalog.aclexplode(
  coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))
) a
left join pg_catalog.pg_roles r on r.oid=a.grantee
where n.nspname='public'
order by grantee,privilege_type;
