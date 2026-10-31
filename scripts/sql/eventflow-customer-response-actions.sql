-- REVIEW DRAFT ONLY. Do not execute until Production catalog/security review
-- and explicit approval of this exact migration are complete.
-- Adds Business action metadata only. Does not alter existing requests,
-- proposals, Customer responses, proposal statuses, RLS policies, or RPCs.
begin;
set local eventflow.customer_response_actions_reviewed = 'no';

do $preflight$
begin
  if current_setting('eventflow.customer_response_actions_reviewed', true) is distinct from 'yes' then
    raise exception 'STOP: review the current Production catalog and approve this exact migration first.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname=current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'A trusted bypass-RLS migration owner is required.';
  end if;
  if to_regclass('public.eventflow_customer_responses') is null
    or to_regclass('public.eventflow_customer_response_actions') is not null
    or to_regprocedure('public.eventflow_start_customer_revision(uuid)') is not null
    or to_regprocedure('public.eventflow_confirm_customer_selection(uuid,text)') is not null then
    raise exception 'Customer response prerequisites are missing or action objects already exist; review an upgrade instead.';
  end if;
  if to_regprocedure('public.eventflow_response_is_staff()') is null then
    raise exception 'The approved staff authorization helper is missing.';
  end if;
  if exists (
    select 1 from (values
      ('eventflow_customer_responses','id','uuid'),
      ('eventflow_customer_responses','request_id','uuid'),
      ('eventflow_customer_responses','revision','text'),
      ('eventflow_customer_responses','response_kind','text'),
      ('eventflow_customer_responses','response_status','text'),
      ('eventflow_customer_responses','plan_a_id','uuid'),
      ('eventflow_customer_responses','plan_b_id','uuid'),
      ('eventflow_customer_responses','selected_proposal_id','uuid'),
      ('requests','id','uuid'),
      ('proposals','id','uuid'),
      ('proposals','request_id','uuid'),
      ('proposals','revision','text'),
      ('proposals','plan_key','text'),
      ('proposals','status','text'),
      ('proposals','plan_content','jsonb')
    ) expected(table_name,column_name,udt_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=expected.table_name
        and c.column_name=expected.column_name and c.udt_name=expected.udt_name
    )
  ) then
    raise exception 'The installed Customer Response/proposal schema differs from the reviewed schema.';
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
end;
$preflight$;

create table public.eventflow_customer_response_actions (
  response_id uuid primary key references public.eventflow_customer_responses(id),
  request_id uuid not null references public.requests(id),
  source_revision text not null check (
    char_length(source_revision)<=32 and source_revision ~ '^[1-9][0-9]*$'
  ),
  action_kind text not null check (action_kind in ('revision','selection_confirmation')),
  next_revision text check (
    next_revision is null or
    (char_length(next_revision)<=32 and next_revision ~ '^[1-9][0-9]*$')
  ),
  status text not null check (status in ('queued','generating','business_review','released','confirmed')),
  started_by uuid not null references auth.users(id),
  started_at timestamptz not null default clock_timestamp(),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  confirmation_message text not null default '' check (char_length(confirmation_message)<=4000),
  unique(request_id,next_revision),
  check (
    (action_kind='revision' and next_revision is not null and status<>'confirmed'
      and confirmed_by is null and confirmed_at is null and confirmation_message='')
    or
    (action_kind='selection_confirmation' and next_revision is null and status='confirmed'
      and confirmed_by is not null and confirmed_at is not null)
  )
);

alter table public.eventflow_customer_response_actions enable row level security;
revoke all on public.eventflow_customer_response_actions from public,anon,authenticated;
grant select on public.eventflow_customer_response_actions to authenticated;
grant all on public.eventflow_customer_response_actions to service_role;
create policy eventflow_customer_response_actions_staff_read
  on public.eventflow_customer_response_actions
  for select to authenticated
  using (public.eventflow_response_is_staff());

create function public.eventflow_start_customer_revision(p_response_id uuid)
returns public.eventflow_customer_response_actions
language plpgsql security definer set search_path='' set row_security=off as $fn$
declare
  v_response public.eventflow_customer_responses;
  v_action public.eventflow_customer_response_actions;
  v_request_id uuid;
  v_pair_count bigint;
  v_latest numeric;
  v_next text;
begin
  if auth.uid() is null or not public.eventflow_response_is_staff() then
    raise exception 'Approved Business staff required.' using errcode='42501';
  end if;
  if p_response_id is null then
    raise exception 'A saved Customer response is required.' using errcode='22023';
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
    if v_action.action_kind='revision' then return v_action; end if;
    raise exception 'A different Business action already exists for this response.' using errcode='23505';
  end if;
  if v_response.response_kind<>'change_request'
    or v_response.response_status<>'changes_requested' then
    raise exception 'Only a saved Change Request can start a revised proposal.' using errcode='42501';
  end if;

  if exists (
    select 1 from public.proposals p where p.request_id=v_request_id
      and (p.revision is null or char_length(p.revision)>32 or p.revision !~ '^[1-9][0-9]*$')
  ) then
    raise exception 'A legacy proposal revision needs manual review before starting another revision.' using errcode='22023';
  end if;
  select max(p.revision::numeric) into v_latest
    from public.proposals p where p.request_id=v_request_id;
  if v_latest is null or v_latest<>v_response.revision::numeric then
    raise exception 'This Change Request is not for the latest proposal revision.' using errcode='22023';
  end if;

  select count(*) into v_pair_count
    from public.proposals p
    where p.request_id=v_request_id and p.revision=v_response.revision
      and p.status='Awaiting Customer' and jsonb_typeof(p.plan_content)='object'
      and ((p.id=v_response.plan_a_id and p.plan_key='A')
        or (p.id=v_response.plan_b_id and p.plan_key='B'));
  if v_pair_count<>2 then
    raise exception 'The exact Business-approved Plan A/B pair could not be verified.' using errcode='42501';
  end if;

  v_next := (v_latest+1)::text;
  if char_length(v_next)>32 or exists (
    select 1 from public.proposals p where p.request_id=v_request_id and p.revision=v_next
  ) then
    raise exception 'The next revision is unavailable; refresh and review the saved proposals.' using errcode='23505';
  end if;
  insert into public.eventflow_customer_response_actions(
    response_id,request_id,source_revision,action_kind,next_revision,status,started_by
  ) values (
    p_response_id,v_request_id,v_response.revision,'revision',v_next,'queued',auth.uid()
  ) returning * into v_action;
  return v_action;
end;
$fn$;

create function public.eventflow_confirm_customer_selection(
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
  select count(*) into v_pair_count
    from public.proposals p
    where p.request_id=v_request_id and p.revision=v_response.revision
      and p.status='Awaiting Customer' and jsonb_typeof(p.plan_content)='object'
      and ((p.id=v_response.plan_a_id and p.plan_key='A')
        or (p.id=v_response.plan_b_id and p.plan_key='B'));
  if v_pair_count<>2 then
    raise exception 'The exact Business-approved Plan A/B pair could not be verified.' using errcode='42501';
  end if;

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

revoke all on function public.eventflow_start_customer_revision(uuid) from public,anon,authenticated;
revoke all on function public.eventflow_confirm_customer_selection(uuid,text) from public,anon,authenticated;
grant execute on function public.eventflow_start_customer_revision(uuid) to authenticated;
grant execute on function public.eventflow_confirm_customer_selection(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
