-- REVIEW DRAFT ONLY. This additive migration depends on
-- eventflow-customer-response-actions.sql having been reviewed and installed.
-- It never changes Customer responses, previous proposals, approval RPCs, or quota.
begin;
set local eventflow.customer_revision_generation_reviewed = 'no';

do $preflight$
begin
  if current_setting('eventflow.customer_revision_generation_reviewed', true) is distinct from 'yes' then
    raise exception 'STOP: review the live catalog and approve this exact revision-generation migration first.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname=current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'A trusted bypass-RLS migration owner is required.';
  end if;
  if to_regclass('public.eventflow_customer_response_actions') is null
    or to_regclass('public.eventflow_customer_responses') is null
    or to_regprocedure('public.eventflow_start_customer_revision(uuid)') is null
    or to_regprocedure('public.eventflow_claim_customer_revision_generation(uuid)') is not null
    or to_regprocedure('public.eventflow_store_customer_revision_pair(uuid,uuid,text,jsonb)') is not null
    or to_regprocedure('public.eventflow_fail_customer_revision_generation(uuid,uuid,text)') is not null then
    raise exception 'Phase 1 Customer Response actions are missing, or a Phase 2 routine already exists.';
  end if;
  if exists (
    select 1 from (values
      ('eventflow_customer_response_actions','response_id','uuid'),
      ('eventflow_customer_response_actions','request_id','uuid'),
      ('eventflow_customer_response_actions','source_revision','text'),
      ('eventflow_customer_response_actions','action_kind','text'),
      ('eventflow_customer_response_actions','next_revision','text'),
      ('eventflow_customer_response_actions','status','text'),
      ('eventflow_customer_responses','id','uuid'),
      ('eventflow_customer_responses','request_id','uuid'),
      ('eventflow_customer_responses','revision','text'),
      ('eventflow_customer_responses','customer_id','uuid'),
      ('eventflow_customer_responses','response_kind','text'),
      ('eventflow_customer_responses','response_status','text'),
      ('eventflow_customer_responses','plan_a_id','uuid'),
      ('eventflow_customer_responses','plan_b_id','uuid'),
      ('eventflow_customer_responses','feedback','text'),
      ('requests','id','uuid'),
      ('requests','customer_id','uuid'),
      ('requests','customer_name','text'),
      ('requests','event_name','text'),
      ('requests','event_type','text'),
      ('requests','event_date','date'),
      ('requests','budget','numeric'),
      ('requests','event_time','time'),
      ('requests','venue_id','uuid'),
      ('requests','event_end_time','time'),
      ('proposals','id','uuid'),
      ('proposals','request_id','uuid'),
      ('proposals','revision','text'),
      ('proposals','recommendation','text'),
      ('proposals','status','text'),
      ('proposals','plan_key','text'),
      ('proposals','plan_content','jsonb')
    ) expected(table_name,column_name,udt_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=expected.table_name
        and c.column_name=expected.column_name and c.udt_name=expected.udt_name
    )
  ) then
    raise exception 'A required Phase 1, request, or proposal column has an incompatible type.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    where i.indrelid='public.proposals'::regclass and i.indisunique and i.indisvalid
      and i.indnkeyatts=3 and i.indexprs is null
      and array(
        select a.attname::text
        from unnest(i.indkey::smallint[]) with ordinality k(attnum,position)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
        where k.position<=i.indnkeyatts order by k.position
      )=array['request_id','revision','plan_key']::text[]
  ) then
    raise exception 'The unique request/revision/plan-key index is missing or incompatible.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='eventflow_customer_response_actions'
      and column_name in ('generation_token','generation_started_at','generation_completed_at','generation_error_code')
  ) then
    raise exception 'Phase 2 generation metadata already exists; inspect this as an upgrade instead.';
  end if;
end;
$preflight$;

alter table public.eventflow_customer_response_actions
  add column generation_token uuid,
  add column generation_started_at timestamptz,
  add column generation_completed_at timestamptz,
  add column generation_error_code text;

create unique index eventflow_customer_response_actions_generation_token_uidx
  on public.eventflow_customer_response_actions(generation_token)
  where generation_token is not null;

alter table public.eventflow_customer_response_actions
  add constraint eventflow_customer_response_actions_generation_error_check
  check (generation_error_code is null or generation_error_code in (
    'AI_GENERATION_FAILED','PROPOSAL_VALIDATION_FAILED','RUNPOD_FAILURE'
  )),
  add constraint eventflow_customer_response_actions_generation_state_check
  check (
    (generation_error_code is null or
      (action_kind='revision' and status='generating' and generation_token is not null))
    and (generation_started_at is null or generation_token is not null)
    and (generation_completed_at is null or
      (action_kind='revision' and status='business_review' and generation_token is not null))
  );

create function public.eventflow_claim_customer_revision_generation(p_response_id uuid)
returns public.eventflow_customer_response_actions
language plpgsql security definer set search_path='' set row_security=off as $fn$
declare
  v_request_id uuid;
  v_action public.eventflow_customer_response_actions;
  v_response public.eventflow_customer_responses;
  v_pair_count bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required.' using errcode='42501';
  end if;
  if p_response_id is null then
    raise exception 'A saved Change Request is required.' using errcode='22023';
  end if;
  select a.request_id into v_request_id
    from public.eventflow_customer_response_actions a
    where a.response_id=p_response_id and a.action_kind='revision';
  if v_request_id is null then
    raise exception 'A queued Customer revision is unavailable.' using errcode='42501';
  end if;
  perform 1 from public.requests r where r.id=v_request_id for update;
  if not found then
    raise exception 'The saved request is unavailable.' using errcode='42501';
  end if;
  select * into v_action from public.eventflow_customer_response_actions a
    where a.response_id=p_response_id and a.request_id=v_request_id for update;
  if not found or v_action.action_kind<>'revision' then
    raise exception 'A queued Customer revision is unavailable.' using errcode='42501';
  end if;
  if v_action.status='business_review' then return v_action; end if;
  select * into v_response from public.eventflow_customer_responses cr
    where cr.id=p_response_id and cr.request_id=v_request_id for update;
  if not found or v_response.response_kind<>'change_request'
    or v_response.response_status<>'changes_requested'
    or v_response.revision<>v_action.source_revision
    or v_action.next_revision::numeric<>v_action.source_revision::numeric+1
    or not exists (select 1 from public.requests r
      where r.id=v_request_id and r.customer_id=v_response.customer_id) then
    raise exception 'The saved Change Request does not match this revision.' using errcode='42501';
  end if;
  if exists (select 1 from public.proposals p where p.request_id=v_request_id
    and (p.revision is null or char_length(p.revision)>32 or p.revision !~ '^[1-9][0-9]*$')) then
    raise exception 'Legacy revision mapping requires manual review.' using errcode='22023';
  end if;
  if exists (select 1 from public.proposals p where p.request_id=v_request_id
    and p.revision::numeric>v_action.source_revision::numeric) then
    raise exception 'A newer proposal revision already exists.' using errcode='23505';
  end if;
  select count(*) into v_pair_count from public.proposals p
    where p.request_id=v_request_id and p.revision=v_action.source_revision
      and p.status='Awaiting Customer'
      and ((p.id=v_response.plan_a_id and p.plan_key='A')
        or (p.id=v_response.plan_b_id and p.plan_key='B'));
  if v_pair_count<>2 then
    raise exception 'The exact approved source pair is unavailable.' using errcode='42501';
  end if;
  if v_action.status='queued' then
    update public.eventflow_customer_response_actions
      set status='generating',
          generation_token=coalesce(generation_token,gen_random_uuid()),
          generation_started_at=coalesce(generation_started_at,clock_timestamp()),
          generation_error_code=null
      where response_id=p_response_id
      returning * into v_action;
    return v_action;
  end if;
  if v_action.status in ('generating','business_review') then
    return v_action;
  end if;
  raise exception 'This revision cannot be generated again.' using errcode='23505';
end;
$fn$;

create function public.eventflow_fail_customer_revision_generation(
  p_response_id uuid,p_generation_token uuid,p_error_code text
)
returns public.eventflow_customer_response_actions
language plpgsql security definer set search_path='' set row_security=off as $fn$
declare
  v_request_id uuid;
  v_action public.eventflow_customer_response_actions;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required.' using errcode='42501';
  end if;
  if p_response_id is null or p_generation_token is null or p_error_code is null
    or p_error_code not in ('AI_GENERATION_FAILED','PROPOSAL_VALIDATION_FAILED','RUNPOD_FAILURE') then
    raise exception 'A valid failed generation receipt is required.' using errcode='22023';
  end if;
  select a.request_id into v_request_id
    from public.eventflow_customer_response_actions a
    where a.response_id=p_response_id and a.action_kind='revision';
  if v_request_id is null then
    raise exception 'The revision action is unavailable.' using errcode='42501';
  end if;
  perform 1 from public.requests r where r.id=v_request_id for update;
  select * into v_action from public.eventflow_customer_response_actions a
    where a.response_id=p_response_id and a.request_id=v_request_id for update;
  if not found then
    raise exception 'The revision action is unavailable.' using errcode='42501';
  end if;
  if v_action.status='business_review' then return v_action; end if;
  if v_action.status<>'generating' or v_action.generation_token is distinct from p_generation_token then
    raise exception 'The generation receipt does not match the active revision.' using errcode='23505';
  end if;
  if exists (
    select 1 from public.proposals p
    where p.request_id=v_request_id and p.revision=v_action.next_revision
  ) then
    raise exception 'Saved proposals are preserved; a persisted pair cannot be marked failed.' using errcode='23505';
  end if;
  update public.eventflow_customer_response_actions
    set generation_error_code=p_error_code
    where response_id=p_response_id
    returning * into v_action;
  return v_action;
end;
$fn$;

create function public.eventflow_store_customer_revision_pair(
  p_response_id uuid,p_generation_token uuid,p_recommendation text,p_plans jsonb
)
returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $fn$
declare
  v_request_id uuid;
  v_action public.eventflow_customer_response_actions;
  v_request public.requests;
  v_response public.eventflow_customer_responses;
  v_plan jsonb;
  v_line jsonb;
  v_total numeric;
  v_sum numeric;
  v_pair_count bigint;
  v_plan_a_id uuid;
  v_plan_b_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required.' using errcode='42501';
  end if;
  if p_response_id is null or p_generation_token is null
    or p_recommendation is null or char_length(btrim(p_recommendation)) not between 1 and 2000
    or jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception 'A validated Plan A/B pair and generation receipt are required.' using errcode='22023';
  end if;
  if jsonb_array_length(p_plans)<>2 then
    raise exception 'A complete Plan A/B pair is required.' using errcode='22023';
  end if;
  if (select count(distinct x.value->>'id') from jsonb_array_elements(p_plans) x)<>2
    or not exists (select 1 from jsonb_array_elements(p_plans) x where x.value->>'id'='A')
    or not exists (select 1 from jsonb_array_elements(p_plans) x where x.value->>'id'='B') then
    raise exception 'The stored pair must contain exactly one Plan A and one Plan B.' using errcode='22023';
  end if;

  select a.request_id into v_request_id
    from public.eventflow_customer_response_actions a
    where a.response_id=p_response_id and a.action_kind='revision';
  if v_request_id is null then
    raise exception 'The revision action is unavailable.' using errcode='42501';
  end if;
  perform 1 from public.requests r where r.id=v_request_id for update;
  select * into v_action from public.eventflow_customer_response_actions a
    where a.response_id=p_response_id and a.request_id=v_request_id for update;
  if not found then
    raise exception 'The revision action is unavailable.' using errcode='42501';
  end if;
  if v_action.generation_token is distinct from p_generation_token then
    raise exception 'The generation token does not match this revision.' using errcode='23505';
  end if;

  select * into v_request from public.requests r where r.id=v_request_id;
  if not found or v_request.customer_id is null or v_request.budget is null or v_request.budget<1 then
    raise exception 'The saved request budget or ownership fields are invalid.' using errcode='22023';
  end if;
  select * into v_response from public.eventflow_customer_responses cr
    where cr.id=p_response_id and cr.request_id=v_request_id for update;
  if not found or v_response.customer_id<>v_request.customer_id
    or v_response.revision<>v_action.source_revision
    or v_response.response_kind<>'change_request'
    or v_response.response_status<>'changes_requested' then
    raise exception 'The saved Change Request ownership does not match.' using errcode='42501';
  end if;
  for v_plan in select x.value from jsonb_array_elements(p_plans) x loop
    if jsonb_typeof(v_plan->'totalEstimatedMYR') is distinct from 'number'
      or jsonb_typeof(v_plan->'costBreakdown') is distinct from 'array' then
      raise exception 'Plan totals and itemized costs must be numeric.' using errcode='22023';
    end if;
    if jsonb_array_length(v_plan->'costBreakdown')=0 then
      raise exception 'Itemized costs are required.' using errcode='22023';
    end if;
    v_total := (v_plan->>'totalEstimatedMYR')::numeric;
    v_sum := 0;
    for v_line in select x.value from jsonb_array_elements(v_plan->'costBreakdown') x loop
      if jsonb_typeof(v_line->'amountMYR') is distinct from 'number' then
        raise exception 'Every cost line must contain a numeric amount.' using errcode='22023';
      end if;
      if (v_line->>'amountMYR')::numeric<0
        or (v_line->>'amountMYR')::numeric<>round((v_line->>'amountMYR')::numeric,2) then
        raise exception 'Cost lines must be nonnegative MYR amounts rounded to cents.' using errcode='22023';
      end if;
      v_sum := v_sum + (v_line->>'amountMYR')::numeric;
    end loop;
    if v_total<0 or round(v_sum,2)<>round(v_total,2) then
      raise exception 'The revised plan arithmetic is invalid.' using errcode='22023';
    end if;
  end loop;

  if v_action.status='business_review' then
    select count(*),(min(p.id::text) filter (where p.plan_key='A'))::uuid,
      (min(p.id::text) filter (where p.plan_key='B'))::uuid
      into v_pair_count,v_plan_a_id,v_plan_b_id
      from public.proposals p
      where p.request_id=v_request_id and p.revision=v_action.next_revision
        and p.status='Pending Business Approval';
    if v_pair_count<>2 or v_plan_a_id is null or v_plan_b_id is null then
      raise exception 'The saved revision is inconsistent and requires review.' using errcode='23505';
    end if;
    return jsonb_build_object('request_id',v_request_id,'revision',v_action.next_revision,
      'persistence','existing','workflow_state','business_review');
  end if;
  if v_action.status<>'generating' or v_action.generation_error_code is not null then
    raise exception 'Only an active, non-failed revision may be persisted.' using errcode='23505';
  end if;
  if exists (select 1 from public.proposals p where p.request_id=v_request_id
    and (p.revision is null or char_length(p.revision)>32 or p.revision !~ '^[1-9][0-9]*$')) then
    raise exception 'Legacy revision mapping requires manual review.' using errcode='22023';
  end if;
  if exists (select 1 from public.proposals p where p.request_id=v_request_id
    and p.revision::numeric>v_action.source_revision::numeric) then
    raise exception 'A newer proposal revision exists; no proposal was overwritten.' using errcode='23505';
  end if;
  if exists (
    select 1 from public.proposals p
    where p.request_id=v_request_id and p.revision=v_action.next_revision
  ) then
    raise exception 'A proposal already exists for this revision; no record was overwritten.' using errcode='23505';
  end if;

  insert into public.proposals(
    id,request_id,customer_name,event_name,event_date,event_type,budget,
    event_time,venue_id,event_end_time,revision,recommendation,status,plan_key,plan_content
  )
  select gen_random_uuid(),v_request_id,v_request.customer_name,v_request.event_name,
    v_request.event_date,v_request.event_type,v_request.budget,v_request.event_time,
    v_request.venue_id,v_request.event_end_time,v_action.next_revision,p_recommendation,
    'Pending Business Approval',x.value->>'id',x.value
  from jsonb_array_elements(p_plans) x;

  update public.eventflow_customer_response_actions
    set status='business_review',generation_completed_at=clock_timestamp()
    where response_id=p_response_id
    returning * into v_action;
  return jsonb_build_object('request_id',v_request_id,'revision',v_action.next_revision,
    'persistence','created','workflow_state','business_review');
end;
$fn$;

revoke all on function public.eventflow_claim_customer_revision_generation(uuid) from public,anon,authenticated,service_role;
revoke all on function public.eventflow_fail_customer_revision_generation(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.eventflow_store_customer_revision_pair(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.eventflow_claim_customer_revision_generation(uuid) to service_role;
grant execute on function public.eventflow_fail_customer_revision_generation(uuid,uuid,text) to service_role;
grant execute on function public.eventflow_store_customer_revision_pair(uuid,uuid,text,jsonb) to service_role;

do $assertions$
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c
    where c.oid='public.eventflow_customer_response_actions'::regclass) then
    raise exception 'Customer response action RLS must remain enabled.';
  end if;
  if has_function_privilege('anon','public.eventflow_claim_customer_revision_generation(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.eventflow_claim_customer_revision_generation(uuid)','EXECUTE')
    or has_function_privilege('anon','public.eventflow_fail_customer_revision_generation(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.eventflow_fail_customer_revision_generation(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.eventflow_store_customer_revision_pair(uuid,uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.eventflow_store_customer_revision_pair(uuid,uuid,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.eventflow_claim_customer_revision_generation(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.eventflow_fail_customer_revision_generation(uuid,uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.eventflow_store_customer_revision_pair(uuid,uuid,text,jsonb)','EXECUTE') then
    raise exception 'Revision persistence RPC grants do not match the service-only contract.';
  end if;
end;
$assertions$;

notify pgrst,'reload schema';
commit;
