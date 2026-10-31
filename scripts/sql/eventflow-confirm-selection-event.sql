-- REVIEW DRAFT ONLY. Do not execute before the companion review is approved.
-- Replaces ONLY eventflow_confirm_customer_selection(uuid,text).
-- No backfill, existing-row updates, table/RLS/ACL changes, or paid AI calls.
begin;
set local eventflow.confirm_selection_event_reviewed = 'no';

do $preflight$
declare
  v_function pg_catalog.pg_proc;
  v_role pg_catalog.pg_roles;
begin
  if current_setting('eventflow.confirm_selection_event_reviewed',true) is distinct from 'yes' then
    raise exception 'STOP: approve the exact Events compatibility review before installation.';
  end if;
  select * into v_function from pg_catalog.pg_proc
    where oid=to_regprocedure('public.eventflow_confirm_customer_selection(uuid,text)');
  if not found then
    raise exception 'The original confirmation RPC must already be installed.';
  end if;
  select * into v_role from pg_catalog.pg_roles where rolname=current_user;
  if v_function.proowner<>v_role.oid or not (v_role.rolsuper or v_role.rolbypassrls) then
    raise exception 'Execute as the existing trusted bypass-RLS function owner.';
  end if;
  -- Exact raw body from the supplied Production definition, including CRLF.
  -- It differs from the local LF baseline only in line endings; any drift requires review.
  if md5(v_function.prosrc)<>'718868f605cf4ab33c06b3f5a0bed508'
    or not v_function.prosecdef
    or v_function.proconfig is distinct from array['search_path=""','row_security=off']::text[]
    or v_function.prorettype is distinct from to_regtype('public.eventflow_customer_response_actions')::oid
    or v_function.pronargdefaults<>1
    or pg_get_expr(v_function.proargdefaults,0) is distinct from quote_literal('')||'::text'
    or v_function.proargnames is distinct from array['p_response_id','p_confirmation_message']::text[]
    or (select l.lanname from pg_catalog.pg_language l where l.oid=v_function.prolang)<>'plpgsql' then
    raise exception 'The installed confirmation RPC differs from the reviewed baseline. Compare its full definition; do not bypass this check.';
  end if;
  if to_regprocedure('public.eventflow_response_is_staff()') is null then
    raise exception 'The existing approved-staff authorization helper is missing.';
  end if;
  if has_function_privilege('anon',v_function.oid,'EXECUTE')
    or not has_function_privilege('authenticated',v_function.oid,'EXECUTE')
    or exists (select 1 from aclexplode(coalesce(v_function.proacl,acldefault('f',v_function.proowner)))
      where grantee=0 and privilege_type='EXECUTE') then
    raise exception 'The existing confirmation RPC EXECUTE grants require review; this draft does not change them.';
  end if;
  if to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'The core UUID generator is unavailable with the fixed empty search path.';
  end if;
  if exists (
    select 1 from (values
      ('events','id','uuid'),('events','proposal_id','uuid'),
      ('events','customer_id','uuid'),('events','customer_name','uuid'),
      ('events','event_name','text'),('events','event_date','date'),
      ('events','event_time','time'),('events','event_end_time','time'),
      ('events','event_type','text'),('events','venue_id','uuid'),
      ('events','guests','int4'),('events','total_value','numeric'),('events','status','text'),
      ('requests','id','uuid'),('requests','customer_id','uuid'),
      ('requests','event_name','text'),('requests','event_date','date'),
      ('requests','event_time','time'),('requests','event_end_time','time'),
      ('requests','event_type','text'),('requests','venue_id','uuid'),('requests','guests','int4'),
      ('proposals','id','uuid'),('proposals','request_id','uuid'),('proposals','revision','text'),
      ('proposals','plan_key','text'),('proposals','status','text'),('proposals','plan_content','jsonb'),
      ('eventflow_customer_responses','customer_id','uuid')
    ) expected(table_name,column_name,udt_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=expected.table_name
        and c.column_name=expected.column_name and c.udt_name=expected.udt_name
    )
  ) then
    raise exception 'Events/request/selected-proposal columns do not match the reviewed schema.';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='events'
      and column_name='customer_name' and is_nullable='YES')
    or not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='events' and column_name='total_value'
        and (numeric_precision is null or (numeric_scale>=2 and numeric_precision-numeric_scale>=9)))
    or exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='events' and is_nullable='NO'
        and column_default is null and is_identity='NO' and is_generated='NEVER'
        and column_name not in ('id','proposal_id','customer_id','customer_name','event_name',
          'event_date','event_time','event_end_time','event_type','venue_id','guests','total_value','status')) then
    raise exception 'Events requires an unreviewed value or incompatible customer/price storage.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attname='proposal_id'
    where i.indrelid='public.events'::regclass and i.indisunique and i.indisvalid
      and i.indisready and i.indimmediate and i.indnkeyatts=1
      and i.indpred is null and i.indexprs is null and i.indkey[0]=a.attnum
  ) then
    raise exception 'An immediate, valid, nonpartial unique events(proposal_id) index is required.';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid='public.events'::regclass and conname='events_no_venue_overlap'
      and contype='x' and convalidated and not condeferrable)
    or not exists (select 1 from pg_catalog.pg_constraint
      where conrelid='public.events'::regclass and conname='events_valid_booking_time'
        and contype='c' and convalidated) then
    raise exception 'Reviewed immediate venue overlap/time constraints are required.';
  end if;
  if exists (select 1 from (values
    ('public.requests','SELECT'),('public.requests','UPDATE'),
    ('public.proposals','SELECT'),('public.proposals','UPDATE'),
    ('public.events','SELECT'),('public.events','INSERT'),
    ('public.eventflow_customer_responses','SELECT'),('public.eventflow_customer_responses','UPDATE'),
    ('public.eventflow_customer_response_actions','SELECT'),('public.eventflow_customer_response_actions','INSERT'),
    ('public.eventflow_customer_response_actions','UPDATE')
  ) required(relation_name,privilege_name)
    where not has_table_privilege(current_user,required.relation_name,required.privilege_name))
    or not has_schema_privilege(current_user,'public','CREATE') then
    raise exception 'The existing function owner lacks a required privilege; no grants are changed by this draft.';
  end if;
  -- Transaction-local metadata snapshot used by the postflight assertion.
  perform set_config('eventflow.confirm_selection_event_identity',jsonb_build_object(
    'oid',v_function.oid,'owner',v_function.proowner,'acl',v_function.proacl,
    'config',v_function.proconfig,'security_definer',v_function.prosecdef,
    'arguments',v_function.proargtypes::text,'argument_names',v_function.proargnames,
    'defaults',pg_get_expr(v_function.proargdefaults,0),'return_type',v_function.prorettype
  )::text,true);
end;
$preflight$;

create or replace function public.eventflow_confirm_customer_selection(
  p_response_id uuid,p_confirmation_message text default ''
)
returns public.eventflow_customer_response_actions
language plpgsql security definer set search_path='' set row_security=off as $fn$
declare
  v_response public.eventflow_customer_responses;
  v_action public.eventflow_customer_response_actions;
  v_request_id uuid;
  v_pair_count bigint;
  v_latest numeric;
  v_message text := btrim(coalesce(p_confirmation_message,''));
  v_request public.requests;
  v_selected public.proposals;
  v_line jsonb;
  v_amount numeric;
  v_total numeric;
  v_itemized numeric := 0;
  v_event_id uuid;
begin
  if auth.uid() is null or not public.eventflow_response_is_staff() then
    raise exception 'Approved Business staff required.' using errcode='42501';
  end if;
  if p_response_id is null or char_length(coalesce(p_confirmation_message,''))>4000 then
    raise exception 'A saved selection and valid confirmation message are required.' using errcode='22023';
  end if;

  select r.id into v_request_id
    from public.requests r
    join public.eventflow_customer_responses cr on cr.request_id=r.id
    where cr.id=p_response_id
    for update of r;
  if v_request_id is null then
    raise exception 'Customer response unavailable.' using errcode='42501';
  end if;
  select * into v_response from public.eventflow_customer_responses
    where id=p_response_id and request_id=v_request_id for update;
  if not found then
    raise exception 'Customer response unavailable.' using errcode='42501';
  end if;

  select * into v_action from public.eventflow_customer_response_actions
    where response_id=p_response_id for update;
  if found then
    -- Preserve the original early return, including historical confirmations.
    -- Deliberately do not create/recover/backfill an Event in this branch.
    if v_action.action_kind='selection_confirmation'
      and v_action.confirmation_message=v_message then return v_action; end if;
    raise exception 'A different Business action already exists for this response.' using errcode='23505';
  end if;
  if v_response.response_kind<>'selection'
    or v_response.response_status<>'selection_submitted'
    or v_response.selected_proposal_id not in (v_response.plan_a_id,v_response.plan_b_id) then
    raise exception 'Only a saved Customer Plan A/B selection can be confirmed.' using errcode='42501';
  end if;

  if exists (
    select 1 from public.proposals p where p.request_id=v_request_id
      and (p.revision is null or char_length(p.revision)>32 or p.revision !~ '^[1-9][0-9]*$')
  ) then
    raise exception 'A legacy proposal revision needs manual review before confirmation.' using errcode='22023';
  end if;
  select max(p.revision::numeric) into v_latest
    from public.proposals p where p.request_id=v_request_id;
  if v_latest is null or v_latest<>v_response.revision::numeric then
    raise exception 'The Customer selection is no longer for the latest proposal revision.' using errcode='22023';
  end if;
  -- Additional row locks keep approval and pricing stable through Event creation.
  perform p.id from public.proposals p
    where p.id in (v_response.plan_a_id,v_response.plan_b_id)
    order by p.id for update;
  select count(*) into v_pair_count
    from public.proposals p
    where p.request_id=v_request_id and p.revision=v_response.revision
      and p.status='Awaiting Customer' and jsonb_typeof(p.plan_content)='object'
      and ((p.id=v_response.plan_a_id and p.plan_key='A')
        or (p.id=v_response.plan_b_id and p.plan_key='B'));
  if v_pair_count<>2 then
    raise exception 'The exact Business-approved Plan A/B pair could not be verified.' using errcode='42501';
  end if;

  -- New confirmations only: use saved request ownership/details and the exact
  -- selected proposal. Never derive a UUID from a customer's display name.
  select * into v_request from public.requests where id=v_request_id;
  if v_request.customer_id is null or v_request.customer_id is distinct from v_response.customer_id then
    raise exception 'The selection and request ownership do not match.' using errcode='42501';
  end if;
  select * into v_selected from public.proposals
    where id=v_response.selected_proposal_id and request_id=v_request_id
      and revision=v_response.revision and status='Awaiting Customer';
  if not found then
    raise exception 'The selected approved proposal could not be verified.' using errcode='42501';
  end if;
  if v_request.event_date is null or nullif(btrim(v_request.event_name),'') is null
    or (v_request.guests is not null and v_request.guests<0)
    or (v_request.event_time is not null and v_request.event_end_time is not null
      and v_request.event_end_time<=v_request.event_time)
    or (v_request.venue_id is not null
      and (v_request.event_time is null or v_request.event_end_time is null)) then
    raise exception 'Saved request details are incomplete or invalid for Event confirmation.' using errcode='22023';
  end if;

  if jsonb_typeof(v_selected.plan_content->'totalEstimatedMYR') is distinct from 'number'
    or jsonb_typeof(v_selected.plan_content->'costBreakdown') is distinct from 'array' then
    raise exception 'The selected plan price is not a verified numeric itemized estimate.' using errcode='22023';
  end if;
  v_total := (v_selected.plan_content->>'totalEstimatedMYR')::numeric;
  if v_total<0 or v_total>100000000 or v_total<>round(v_total,2)
    or jsonb_array_length(v_selected.plan_content->'costBreakdown') not between 1 and 80 then
    raise exception 'The selected plan total is outside the supported monetary format.' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(v_selected.plan_content->'costBreakdown')
  loop
    if jsonb_typeof(v_line) is distinct from 'object'
      or jsonb_typeof(v_line->'amountMYR') is distinct from 'number' then
      raise exception 'A selected plan cost line has no valid numeric amount.' using errcode='22023';
    end if;
    v_amount := (v_line->>'amountMYR')::numeric;
    if v_amount<0 or v_amount>100000000 or v_amount<>round(v_amount,2) then
      raise exception 'A selected plan cost line is outside the supported monetary format.' using errcode='22023';
    end if;
    v_itemized := v_itemized+v_amount;
  end loop;
  if v_total<>v_itemized then
    raise exception 'The selected plan total does not match its itemized costs.' using errcode='22023';
  end if;
  -- No comparison to request.budget: preserve the Customer's budget unchanged.
  if exists (
    select 1 from public.events e
      join public.proposals p on p.id=e.proposal_id
      where p.request_id=v_request_id
  ) then
    raise exception 'An Event already exists for this request. No new confirmation was saved.' using errcode='23505';
  end if;

  begin
    insert into public.events(
      id,proposal_id,customer_id,customer_name,event_name,event_date,
      event_time,event_end_time,event_type,venue_id,guests,total_value,status
    ) values (
      gen_random_uuid(),v_selected.id,v_request.customer_id,null::uuid,
      v_request.event_name,v_request.event_date,v_request.event_time,v_request.event_end_time,
      v_request.event_type,v_request.venue_id,v_request.guests,v_total,'Confirmed'
    ) returning id into v_event_id;
    if v_event_id is null then
      raise exception 'The Event insert did not create a record. No new confirmation was saved.' using errcode='23514';
    end if;
  exception
    when exclusion_violation then
      raise exception 'The venue time conflicts with an existing booking. No new confirmation was saved.' using errcode='23P01';
    when unique_violation then
      raise exception 'An Event conflicts with an existing record. No new confirmation was saved.' using errcode='23505';
  end;

  insert into public.eventflow_customer_response_actions(
    response_id,request_id,source_revision,action_kind,status,started_by,
    confirmed_by,confirmed_at,confirmation_message
  ) values (
    p_response_id,v_request_id,v_response.revision,'selection_confirmation','confirmed',
    auth.uid(),auth.uid(),clock_timestamp(),v_message
  ) returning * into v_action;
  return v_action;
end;
$fn$;

-- CREATE OR REPLACE preserves the function identity, owner and existing ACL.
-- Assert this instead of adding/revoking grants in this migration.
do $postflight$
declare
  v_function pg_catalog.pg_proc;
  v_identity jsonb;
begin
  select * into strict v_function from pg_catalog.pg_proc
    where oid='public.eventflow_confirm_customer_selection(uuid,text)'::regprocedure;
  v_identity := jsonb_build_object(
    'oid',v_function.oid,'owner',v_function.proowner,'acl',v_function.proacl,
    'config',v_function.proconfig,'security_definer',v_function.prosecdef,
    'arguments',v_function.proargtypes::text,'argument_names',v_function.proargnames,
    'defaults',pg_get_expr(v_function.proargdefaults,0),'return_type',v_function.prorettype
  );
  if v_identity is distinct from current_setting('eventflow.confirm_selection_event_identity')::jsonb then
    raise exception 'Confirmation RPC identity/security/grants changed unexpectedly; rolling back.';
  end if;
end;
$postflight$;
notify pgrst,'reload schema';
commit;
