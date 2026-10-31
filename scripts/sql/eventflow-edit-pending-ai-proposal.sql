-- REVIEW DRAFT ONLY. Do not execute until this exact migration is reviewed and approved.
-- Adds a narrowly scoped Business RPC and removes direct client UPDATE paths on
-- public.proposals. It does not change proposal data or existing workflow RPCs.
begin;
set local eventflow.pending_ai_proposal_edit_reviewed = 'no';

do $preflight$
declare
  v_role record;
  v_function_oid oid;
  v_function_owner oid;
  v_is_security_definer boolean;
  v_signature text;
begin
  if current_setting('eventflow.pending_ai_proposal_edit_reviewed', true) is distinct from 'yes' then
    raise exception 'STOP: review and approve this exact proposal-edit migration before execution.';
  end if;

  select rolsuper, rolbypassrls into v_role
  from pg_catalog.pg_roles where rolname = current_user;
  if not found or (not v_role.rolsuper and not v_role.rolbypassrls) then
    raise exception 'A trusted superuser or BYPASSRLS migration role is required.';
  end if;
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'The migration role cannot create the reviewed RPC in public.';
  end if;
  if to_regprocedure('public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb)') is not null then
    raise exception 'The proposal-edit RPC already exists; review an upgrade instead of replacing it.';
  end if;
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'The existing approved-staff authorization function public.is_staff() is missing.';
  end if;
  if not has_function_privilege(current_user, 'public.is_staff()', 'EXECUTE') then
    raise exception 'The migration role cannot call public.is_staff().';
  end if;
  if not has_table_privilege(current_user, 'public.requests', 'SELECT')
     or not has_table_privilege(current_user, 'public.requests', 'UPDATE')
     or not has_table_privilege(current_user, 'public.proposals', 'SELECT')
     or not has_table_privilege(current_user, 'public.proposals', 'UPDATE') then
    raise exception 'The RPC owner needs SELECT and UPDATE privileges on requests and proposals.';
  end if;
  if not has_table_privilege('postgres', 'public.proposals', 'UPDATE')
     or not has_any_column_privilege('postgres', 'public.proposals', 'UPDATE')
     or not has_table_privilege('service_role', 'public.proposals', 'UPDATE')
     or not has_any_column_privilege('service_role', 'public.proposals', 'UPDATE') then
    raise exception 'Trusted postgres and service_role UPDATE access must exist before migration.';
  end if;
  if not coalesce((
    select c.relrowsecurity
    from pg_catalog.pg_class c
    where c.oid = 'public.proposals'::regclass
  ), false) then
    raise exception 'RLS must remain enabled on public.proposals.';
  end if;
  if exists (
    select 1
    from (values
      ('requests','id','uuid'),
      ('requests','services',null),
      ('proposals','id','uuid'),
      ('proposals','request_id','uuid'),
      ('proposals','revision','text'),
      ('proposals','plan_key','text'),
      ('proposals','status','text'),
      ('proposals','plan_content','jsonb')
    ) as expected(table_name,column_name,udt_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name=expected.table_name
        and c.column_name=expected.column_name
        and (expected.udt_name is null or c.udt_name=expected.udt_name)
    )
  ) then
    raise exception 'The requests/proposals columns differ from the reviewed schema.';
  end if;
  if to_regclass('public.proposals_request_revision_plan_key_uidx') is null then
    raise exception 'The unique request/revision/plan-key index is missing.';
  end if;

  -- These SECURITY DEFINER functions are existing proposal/status workflows.
  -- Reject the migration if any owner depends on client-role table grants.
  for v_signature in
    select signature from (values
      ('public.approve_ai_proposal_pair(uuid,text)'),
      ('public.accept_proposal(uuid)'),
      ('public.eventflow_confirm_customer_selection(uuid,text)')
    ) as required(signature)
  loop
    v_function_oid := to_regprocedure(v_signature);
    if v_function_oid is null then
      raise exception 'Required existing workflow function % is missing.', v_signature;
    end if;
    select p.proowner, p.prosecdef
      into v_function_owner, v_is_security_definer
    from pg_catalog.pg_proc p
    where p.oid=v_function_oid;
    if not v_is_security_definer
       or not exists (
         select 1 from pg_catalog.pg_roles r
         where r.oid=v_function_owner and (r.rolsuper or r.rolbypassrls)
       )
       or not has_table_privilege(v_function_owner, 'public.proposals', 'UPDATE') then
      raise exception 'Workflow function % must remain SECURITY DEFINER with proposal UPDATE access.', v_signature;
    end if;
  end loop;

  -- Fail closed if another stored routine appears to UPDATE proposals but
  -- would lose its caller's direct table permission. This complements, but
  -- does not replace, review of the Production Query 6A routine list.
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_roles owner on owner.oid=p.proowner
    where n.nspname='public'
      and p.prokind in ('f','p')
      and p.prosrc ~* 'update[[:space:]]+(only[[:space:]]+)?("?public"?[.])?"?proposals"?([[:space:]]|$)'
      and (
        not p.prosecdef
        or not (owner.rolsuper or owner.rolbypassrls)
        or not has_table_privilege(p.proowner,'public.proposals','UPDATE')
      )
  ) then
    raise exception 'A proposal-updating routine may depend on caller UPDATE; review all Query 6A routines before migration.';
  end if;
end;
$preflight$;

create function public.eventflow_update_pending_ai_proposal(
  p_request_id uuid,
  p_revision text,
  p_plan_key text,
  p_plan_content jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_request public.requests%rowtype;
  v_item jsonb;
  v_service text;
  v_requested_services jsonb;
  v_total numeric;
  v_amount numeric;
  v_sum numeric := 0;
  v_updated_id uuid;
  v_count integer;
  v_a_pending integer;
  v_b_pending integer;
  v_current_plan_content jsonb;
  v_persisted_plan_content jsonb;
begin
  if auth.uid() is null or coalesce(public.is_staff(), false) is not true then
    raise exception 'Approved Business staff required.' using errcode='42501';
  end if;
  if p_request_id is null
     or p_revision is null
     or length(p_revision) > 32
     or p_revision !~ '^[1-9][0-9]*$'
     or p_plan_key is null
     or p_plan_key not in ('A','B') then
    raise exception 'A valid request, revision, and Plan A/B key are required.' using errcode='22023';
  end if;

  -- This request lock serializes edits with approve_ai_proposal_pair, which locks the same row.
  select * into v_request
  from public.requests
  where id=p_request_id
  for update;
  if not found then
    raise exception 'The saved request is unavailable.' using errcode='P0002';
  end if;

  -- Lock both rows and require the exact, still-pending pair before changing either plan.
  perform 1
  from public.proposals
  where request_id=p_request_id and revision=p_revision and plan_key in ('A','B')
  order by plan_key
  for update;
  select count(*),
         count(*) filter (where plan_key='A' and status='Pending Business Approval'),
         count(*) filter (where plan_key='B' and status='Pending Business Approval')
    into v_count,v_a_pending,v_b_pending
  from public.proposals
  where request_id=p_request_id and revision=p_revision and plan_key in ('A','B');
  if v_count<>2 or v_a_pending<>1 or v_b_pending<>1 then
    raise exception 'Both plans must remain Pending Business Approval to edit either plan.' using errcode='40001';
  end if;

  -- Keep a locked copy of the selected plan. The RPC accepts the editor's
  -- supported fields, but persists them onto the saved object so unknown or
  -- noneditable metadata cannot be replaced by a client payload.
  select plan_content into v_current_plan_content
  from public.proposals
  where request_id=p_request_id and revision=p_revision and plan_key=p_plan_key
  for update;
  if not found
     or jsonb_typeof(v_current_plan_content) is distinct from 'object'
     or v_current_plan_content->>'id' is distinct from p_plan_key
     or jsonb_typeof(v_current_plan_content->'venue') is distinct from 'object' then
    raise exception 'The saved proposal content is invalid; no edit was made.' using errcode='22023';
  end if;

  if jsonb_typeof(p_plan_content) is distinct from 'object'
     or p_plan_content->>'id' is distinct from p_plan_key then
    raise exception 'The edited plan content is invalid.' using errcode='22023';
  end if;
  if jsonb_typeof(p_plan_content->'title') is distinct from 'string'
     or length(trim(p_plan_content->>'title')) not between 1 and 160
     or jsonb_typeof(p_plan_content->'concept') is distinct from 'string'
     or length(trim(p_plan_content->>'concept')) not between 1 and 2000
     or jsonb_typeof(p_plan_content->'theme') is distinct from 'string'
     or length(trim(p_plan_content->>'theme')) not between 1 and 500
     or jsonb_typeof(p_plan_content->'venue') is distinct from 'object'
     or jsonb_typeof(p_plan_content->'venue'->'name') is distinct from 'string'
     or length(trim(p_plan_content->'venue'->>'name')) not between 1 and 240
     or jsonb_typeof(p_plan_content->'venue'->'setup') is distinct from 'string'
     or length(trim(p_plan_content->'venue'->>'setup')) not between 1 and 2000
     or jsonb_typeof(p_plan_content->'catering') is distinct from 'string'
     or length(trim(p_plan_content->>'catering')) not between 1 and 2000 then
    raise exception 'Required plan text or venue fields are invalid.' using errcode='22023';
  end if;

  if jsonb_typeof(p_plan_content->'timeline') is distinct from 'array' then
    raise exception 'Timeline must be an array.' using errcode='22023';
  end if;
  if jsonb_array_length(p_plan_content->'timeline') not between 1 and 40 then
    raise exception 'Timeline must contain between 1 and 40 items.' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_plan_content->'timeline')
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'time') is distinct from 'string'
       or length(trim(v_item->>'time')) not between 1 and 80
       or jsonb_typeof(v_item->'activity') is distinct from 'string'
       or length(trim(v_item->>'activity')) not between 1 and 500 then
      raise exception 'Timeline entries must include valid time and activity text.' using errcode='22023';
    end if;
  end loop;

  if jsonb_typeof(p_plan_content->'services') is distinct from 'array' then
    raise exception 'Services must be an array.' using errcode='22023';
  end if;
  if jsonb_array_length(p_plan_content->'services') not between 1 and 40 then
    raise exception 'Services must contain between 1 and 40 items.' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_plan_content->'services')
  loop
    if jsonb_typeof(v_item) is distinct from 'string'
       or length(trim(v_item#>>'{}')) not between 1 and 200 then
      raise exception 'Each service must be nonempty text.' using errcode='22023';
    end if;
  end loop;

  -- Retain every service in the original Customer request.
  v_requested_services := coalesce(to_jsonb(v_request.services), '[]'::jsonb);
  if jsonb_typeof(v_requested_services) is distinct from 'array' then
    raise exception 'The saved request service list is invalid; no proposal edit was made.' using errcode='22023';
  end if;
  for v_service in select value from jsonb_array_elements_text(v_requested_services)
  loop
    if not (p_plan_content->'services' @> jsonb_build_array(v_service)) then
      raise exception 'Edited plans must retain every service requested by the Customer.' using errcode='22023';
    end if;
  end loop;

  if jsonb_typeof(p_plan_content->'costBreakdown') is distinct from 'array' then
    raise exception 'Cost breakdown must be an array.' using errcode='22023';
  end if;
  if jsonb_array_length(p_plan_content->'costBreakdown') not between 1 and 80 then
    raise exception 'Cost breakdown must contain between 1 and 80 items.' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_plan_content->'costBreakdown')
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'item') is distinct from 'string'
       or length(trim(v_item->>'item')) not between 1 and 160
       or jsonb_typeof(v_item->'description') is distinct from 'string'
       or length(trim(v_item->>'description')) not between 1 and 500
       or jsonb_typeof(v_item->'amountMYR') is distinct from 'number' then
      raise exception 'Each cost item must include valid labels and a numeric amount.' using errcode='22023';
    end if;
    v_amount := (v_item->>'amountMYR')::numeric;
    if v_amount < 0 or v_amount > 100000000 or v_amount<>round(v_amount,2) then
      raise exception 'Cost amounts must be nonnegative and within the supported range.' using errcode='22023';
    end if;
    v_sum := v_sum + v_amount;
  end loop;

  if jsonb_typeof(p_plan_content->'totalEstimatedMYR') is distinct from 'number' then
    raise exception 'The calculated proposal total must be numeric.' using errcode='22023';
  end if;
  v_total := (p_plan_content->>'totalEstimatedMYR')::numeric;
  if v_total < 0 or v_total > 100000000
     or v_total<>round(v_total,2)
     or v_total<>v_sum then
    raise exception 'The proposal total must equal its nonnegative itemized costs.' using errcode='22023';
  end if;

  if jsonb_typeof(p_plan_content->'assumptions') is distinct from 'array'
     or jsonb_typeof(p_plan_content->'unconfirmedCosts') is distinct from 'array' then
    raise exception 'Assumptions or unconfirmed-cost details must be arrays.' using errcode='22023';
  end if;
  if jsonb_array_length(p_plan_content->'assumptions') not between 1 and 30
     or jsonb_array_length(p_plan_content->'unconfirmedCosts') > 30 then
    raise exception 'Assumptions or unconfirmed-cost details are invalid.' using errcode='22023';
  end if;
  for v_item in
    select value from jsonb_array_elements(p_plan_content->'assumptions')
    union all
    select value from jsonb_array_elements(p_plan_content->'unconfirmedCosts')
  loop
    if jsonb_typeof(v_item) is distinct from 'string'
       or length(trim(v_item#>>'{}')) not between 1 and 1000 then
      raise exception 'Assumptions and unconfirmed costs must be nonempty text.' using errcode='22023';
    end if;
  end loop;

  -- Only these existing editor fields are mutable. Preserve the saved id,
  -- all unknown plan metadata, and nested venue metadata not exposed by the UI.
  v_persisted_plan_content := v_current_plan_content || jsonb_build_object(
    'title',p_plan_content->'title',
    'concept',p_plan_content->'concept',
    'theme',p_plan_content->'theme',
    'timeline',p_plan_content->'timeline',
    'venue',v_current_plan_content->'venue' || jsonb_build_object(
      'name',p_plan_content->'venue'->'name',
      'setup',p_plan_content->'venue'->'setup'
    ),
    'catering',p_plan_content->'catering',
    'services',p_plan_content->'services',
    'costBreakdown',p_plan_content->'costBreakdown',
    'totalEstimatedMYR',p_plan_content->'totalEstimatedMYR',
    'assumptions',p_plan_content->'assumptions',
    'unconfirmedCosts',p_plan_content->'unconfirmedCosts'
  );

  update public.proposals
  set plan_content=v_persisted_plan_content
  where request_id=p_request_id
    and revision=p_revision
    and plan_key=p_plan_key
    and status='Pending Business Approval'
  returning id into v_updated_id;
  if not found then
    raise exception 'The selected pending plan changed; reload before editing.' using errcode='40001';
  end if;
  return v_updated_id;
end;
$function$;

revoke all on function public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb) from public,anon;
grant execute on function public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb) to authenticated;

-- Remove both table-level and per-column UPDATE grants. PUBLIC is included so
-- grants inherited from PUBLIC are removed as well. Any remaining inherited
-- privileges are detected by the postflight assertions, which abort this
-- transaction rather than leave a direct client UPDATE path.
revoke update on table public.proposals from public,anon,authenticated;
do $revoke_column_updates$
declare
  v_columns text;
begin
  select string_agg(format('%I',a.attname),', ' order by a.attnum)
    into v_columns
  from pg_catalog.pg_attribute a
  where a.attrelid='public.proposals'::regclass
    and a.attnum>0
    and not a.attisdropped;
  if v_columns is null then
    raise exception 'Could not enumerate proposal columns for client UPDATE revocation.';
  end if;
  execute format(
    'revoke update (%s) on table public.proposals from public,anon,authenticated',
    v_columns
  );
end;
$revoke_column_updates$;

do $postflight$
declare
  v_function oid := to_regprocedure('public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb)');
  v_owner oid;
begin
  if v_function is null
     or not has_function_privilege('authenticated',v_function,'EXECUTE')
     or has_function_privilege('anon',v_function,'EXECUTE') then
    raise exception 'Proposal-edit RPC postflight permission check failed.';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=v_function and a.grantee=0 and a.privilege_type='EXECUTE'
  ) then
    raise exception 'Proposal-edit RPC must not be executable by PUBLIC.';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid=v_function and (r.rolsuper or r.rolbypassrls)
      and has_table_privilege(p.proowner,'public.requests','SELECT')
      and has_table_privilege(p.proowner,'public.requests','UPDATE')
      and has_table_privilege(p.proowner,'public.proposals','SELECT')
      and has_table_privilege(p.proowner,'public.proposals','UPDATE')
  ) then
    raise exception 'Proposal-edit RPC owner must retain trusted RLS-bypass authority and required table access.';
  end if;
  select proowner into v_owner from pg_catalog.pg_proc where oid=v_function;
  if has_table_privilege('anon','public.proposals','UPDATE')
     or has_any_column_privilege('anon','public.proposals','UPDATE')
     or has_table_privilege('authenticated','public.proposals','UPDATE')
     or has_any_column_privilege('authenticated','public.proposals','UPDATE') then
    raise exception 'Effective anon/authenticated UPDATE remains on proposals; transaction rolled back.';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid='public.proposals'::regclass
      and a.grantee in (
        0,
        (select oid from pg_catalog.pg_roles where rolname='anon'),
        (select oid from pg_catalog.pg_roles where rolname='authenticated')
      )
      and a.privilege_type='UPDATE'
  ) or exists (
    select 1
    from pg_catalog.pg_attribute att
    cross join lateral aclexplode(coalesce(att.attacl,'{}'::aclitem[])) a
    where att.attrelid='public.proposals'::regclass
      and att.attnum>0 and not att.attisdropped
      and a.grantee in (
        0,
        (select oid from pg_catalog.pg_roles where rolname='anon'),
        (select oid from pg_catalog.pg_roles where rolname='authenticated')
      )
      and a.privilege_type='UPDATE'
  ) then
    raise exception 'Direct PUBLIC/anon/authenticated table or column UPDATE ACL remains; transaction rolled back.';
  end if;
  if not has_table_privilege('postgres','public.proposals','UPDATE')
     or not has_any_column_privilege('postgres','public.proposals','UPDATE')
     or not has_table_privilege('service_role','public.proposals','UPDATE')
     or not has_any_column_privilege('service_role','public.proposals','UPDATE') then
    raise exception 'Trusted postgres/service_role UPDATE privileges changed; transaction rolled back.';
  end if;
  if not has_table_privilege(v_owner,'public.proposals','UPDATE') then
    raise exception 'The proposal-edit RPC owner lost UPDATE privilege.';
  end if;
end;
$postflight$;

notify pgrst,'reload schema';
commit;

-- ROLLBACK (manual, only after disabling/reverting the frontend):
-- BEGIN;
-- REVOKE ALL ON FUNCTION public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb)
--   FROM authenticated,anon,PUBLIC;
-- DROP FUNCTION public.eventflow_update_pending_ai_proposal(uuid,text,text,jsonb);
-- COMMIT;
-- Keep the direct anon/authenticated UPDATE revocations in place. Do not restore
-- the previous broad grants as rollback; restore a specific grant only after
-- identifying and approving a concrete dependent operation.
