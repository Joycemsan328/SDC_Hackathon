-- REVIEW DRAFT ONLY. Never run without explicit approval of this exact SQL.
-- Does not change RLS policies, data, portal code or RunPod.
-- Service-role and all function ACLs remain untouched.
-- Query B output is still outstanding; this transaction is gated on its review.
begin;
set local eventflow.security_grants_reviewed = 'no';
set local eventflow.security_defaults_reviewed = 'no';
set local eventflow.security_memberships_reviewed = 'no';

do $guard$
declare
  v_table text;
  v_anon oid;
  v_authenticated oid;
  v_postgres oid;
  v_supabase_admin oid;
begin
  if current_setting('eventflow.security_grants_reviewed',true) is distinct from 'yes'
    or current_setting('eventflow.security_defaults_reviewed',true) is distinct from 'yes'
    or current_setting('eventflow.security_memberships_reviewed',true) is distinct from 'yes' then
    raise exception 'STOP: review direct ACLs, role memberships, default ACLs and portal dependencies; approve this exact remediation first.';
  end if;

  select oid into v_anon from pg_catalog.pg_roles where rolname='anon';
  select oid into v_authenticated from pg_catalog.pg_roles where rolname='authenticated';
  select oid into v_postgres from pg_catalog.pg_roles where rolname='postgres';
  select oid into v_supabase_admin from pg_catalog.pg_roles where rolname='supabase_admin';
  if v_anon is null or v_authenticated is null or v_postgres is null or v_supabase_admin is null then
    raise exception 'Expected Supabase roles are missing.';
  end if;
  if not pg_catalog.pg_has_role(current_user,'postgres','USAGE')
    or not pg_catalog.pg_has_role(current_user,'supabase_admin','USAGE') then
    raise exception 'Run only with an authorized migration owner that can alter defaults for both postgres and supabase_admin.';
  end if;
  -- Query B must be reviewed before this is changed to "yes". This extra guard
  -- rejects direct memberships from either client role into any other role.
  if exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member on member.oid=membership.member
    where member.rolname in ('anon','authenticated')
  ) then
    raise exception 'Client role memberships exist. Review Query B and amend this guard for the approved membership set.';
  end if;

  foreach v_table in array array['requests','proposals','profiles','events','proposal_lines'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table
        and c.relkind in ('r','p') and c.relrowsecurity
    ) then
      raise exception 'Expected public table with RLS is missing: %',v_table;
    end if;
    -- Never silently remove an unreviewed PUBLIC ACL.
    if exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))
      ) a
      where n.nspname='public' and c.relname=v_table and a.grantee=0
    ) then
      raise exception 'PUBLIC has table ACL entries on %. Review before continuing.',v_table;
    end if;
    if exists (
      select 1 from pg_catalog.pg_attribute attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
      where attribute.attrelid=pg_catalog.to_regclass('public.'||v_table)
        and attribute.attnum>0 and not attribute.attisdropped and acl.grantee=0
    ) then
      raise exception 'PUBLIC has column ACL entries on %. Review before continuing.',v_table;
    end if;
  end loop;

  -- Public-schema defaults for both known creators are handled below. Refuse
  -- global defaults, PUBLIC defaults, and defaults owned by other roles.
  if exists (
    select 1 from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where d.defaclobjtype in ('r','S')
      and (d.defaclnamespace=0 or d.defaclnamespace='public'::regnamespace)
      and (a.grantee=0 or a.grantee in (v_anon,v_authenticated))
      and (d.defaclnamespace=0
        or d.defaclrole not in (v_postgres,v_supabase_admin)
        or a.grantee=0)
  ) then
    raise exception 'Unreviewed global, PUBLIC, or other-owner default ACL exists. Review Query C before changing it.';
  end if;
end;
$guard$;

-- Remove existing direct column grants as well as table grants. Revoking only
-- table ACLs does not remove separately granted column privileges.
do $revoke_client_acl$
declare
  v_table text;
  v_columns text;
begin
  foreach v_table in array array['requests','proposals','profiles','events','proposal_lines'] loop
    select string_agg(pg_catalog.format('%I',a.attname),', ' order by a.attnum)
      into v_columns
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_table
      and a.attnum>0 and not a.attisdropped;
    if v_columns is null then raise exception 'No reviewable columns for public.%',v_table; end if;
    execute pg_catalog.format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM anon, authenticated',
      v_columns,v_table
    );
    execute pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
      v_table
    );
  end loop;
end;
$revoke_client_acl$;

-- Preserve the existing RLS policies and portal operations. RLS continues to
-- decide which authenticated Customer/staff rows and writes are permitted.
grant select,insert,update on table public.requests to authenticated;
grant select,insert,update on table public.proposals to authenticated;
grant select on table public.profiles to authenticated;
grant select,insert,update on table public.events to authenticated;
grant select,insert,update on table public.proposal_lines to authenticated;

-- Prevent either known public-schema creator from granting future table or
-- sequence privileges to anon/authenticated. Global and other-owner defaults
-- are rejected above rather than silently changed.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon,authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon,authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from anon,authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from anon,authenticated;

-- No function EXECUTE ACLs are changed here. The separate function review must
-- identify direct vs PUBLIC grants and required roles before any RPC change.
-- In particular, preserve authenticated EXECUTE on approve_ai_proposal_pair,
-- is_staff/profile review operations and legacy authenticated acceptance.
-- Reported is_admin / registration authorization checks are sound. Removing
-- PUBLIC EXECUTE needs exact ACL/caller review and separate approval; a direct
-- anon revoke alone does not remove PUBLIC or inherited EXECUTE.
-- handle_new_user / rls_auto_enable trigger definitions remain untouched.
-- persist_runpod_ai_proposal_pair remains backend-only.

-- Effective privileges, not just the direct ACLs, must match the intended set.
-- A mismatch aborts and rolls back every table/default change above.
do $postconditions$
declare
  v_table text;
  v_role text;
  v_privilege text;
  v_expected boolean;
begin
  foreach v_table in array array['requests','proposals','profiles','events','proposal_lines'] loop
    foreach v_role in array array['anon','authenticated'] loop
      foreach v_privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        v_expected := v_role='authenticated'
          and (v_privilege='SELECT'
            or (v_table<>'profiles' and v_privilege in ('INSERT','UPDATE')));
        if pg_catalog.has_table_privilege(v_role,'public.'||v_table,v_privilege)
          is distinct from v_expected then
          raise exception 'Unexpected effective % on public.% for %; transaction aborted.',
            v_privilege,v_table,v_role;
        end if;
      end loop;
    end loop;
    if exists (
      select 1 from pg_catalog.pg_attribute attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
      join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
      where attribute.attrelid=pg_catalog.to_regclass('public.'||v_table)
        and attribute.attnum>0 and not attribute.attisdropped
        and grantee.rolname in ('anon','authenticated')
    ) then
      raise exception 'Independent client column grants remain on public.%.',v_table;
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_default_acl defaults
    join pg_catalog.pg_roles creator on creator.oid=defaults.defaclrole
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
    join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
    where creator.rolname in ('postgres','supabase_admin')
      and defaults.defaclnamespace='public'::regnamespace
      and defaults.defaclobjtype in ('r','S')
      and grantee.rolname in ('anon','authenticated')
  ) then
    raise exception 'Client default privileges remain; transaction aborted.';
  end if;
end;
$postconditions$;

commit;
