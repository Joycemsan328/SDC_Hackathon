-- REVIEW DRAFT ONLY. NOT APPLIED BY APP STARTUP, BUILD, OR THE AGENT.
-- First review eventflow-customer-responses-preflight.sql with the database owner.
-- Separate owner approval of this exact SQL is required before execution.
-- No changes to existing tables, policies, RPCs, approval statuses or bookings.
begin;
set local eventflow.customer_response_catalog_reviewed = 'no';

do $preflight$
declare v_name text;
begin
  if current_setting('eventflow.customer_response_catalog_reviewed',true) is distinct from 'yes' then
    raise exception 'STOP: owner catalog/security review and exact migration approval are required.';
  end if;
  if not exists(select 1 from pg_catalog.pg_roles
    where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'A trusted bypass-RLS migration owner is required for these definer functions.';
  end if;
  foreach v_name in array array['requests','proposals','profiles'] loop
    if not exists(select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_name and c.relkind in ('r','p') and c.relrowsecurity) then
      raise exception 'Required base table/RLS missing: %',v_name;
    end if;
  end loop;
  if exists(
    select 1 from (values
      ('requests','id','uuid'),('requests','customer_id','uuid'),
      ('proposals','id','uuid'),('proposals','request_id','uuid'),
      ('proposals','revision','text'),('proposals','plan_key','text'),
      ('proposals','status','text'),('proposals','plan_content','jsonb'),
      ('profiles','id','uuid')
    ) expected(table_name,column_name,udt_name)
    where not exists(select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=expected.table_name
      and c.column_name=expected.column_name and c.udt_name=expected.udt_name)
  ) or exists(
    select 1 from (values ('role'),('account_type'),('approval_status')) expected(column_name)
    where not exists(select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name='profiles'
      and c.column_name=expected.column_name)
  ) then raise exception 'Base column compatibility changed; review before installing.'; end if;
  if pg_catalog.to_regclass('public.eventflow_customer_responses') is not null
    or pg_catalog.to_regclass('public.eventflow_proposal_revisions') is not null
    or pg_catalog.to_regclass('public.eventflow_plan_selections') is not null
    or pg_catalog.to_regclass('public.eventflow_generation_leases') is not null
    or exists(select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and
        (p.proname like 'eventflow_response_%' or p.proname='eventflow_submit_customer_response')) then
    raise exception 'Response or workflow objects already exist; review coexistence/upgrade instead of reinstalling.';
  end if;
  -- Owner review must also verify this index's partial predicate covers every A/B
  -- row with non-NULL request/revision, as shown in the supplied catalog export.
  if not exists(select 1 from pg_catalog.pg_index i
    where i.indrelid='public.proposals'::regclass and i.indisunique and i.indisvalid
    and i.indnkeyatts=3 and i.indexprs is null
    and array(select a.attname::text
      from unnest(i.indkey::smallint[]) with ordinality k(attnum,position)
      join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
      where k.position<=i.indnkeyatts order by k.position)
      =array['request_id','revision','plan_key']::text[]) then
    raise exception 'The existing unique request/revision/plan index must be verified first.';
  end if;
end;
$preflight$;

create table public.eventflow_customer_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id),
  revision text not null check (char_length(revision)<=32 and revision ~ '^[1-9][0-9]*$'),
  customer_id uuid not null references auth.users(id),
  plan_a_id uuid not null references public.proposals(id),
  plan_b_id uuid not null references public.proposals(id),
  response_kind text not null check (response_kind in ('selection','change_request')),
  response_status text not null check (response_status in ('selection_submitted','changes_requested')),
  selected_proposal_id uuid references public.proposals(id),
  feedback text not null default '' check (char_length(feedback)<=4000),
  idempotency_key uuid not null,
  responded_at timestamptz not null default clock_timestamp(),
  unique(request_id,revision),
  unique(customer_id,idempotency_key),
  check(plan_a_id<>plan_b_id),
  check(
    (response_kind='selection' and response_status='selection_submitted'
      and selected_proposal_id is not null
      and selected_proposal_id in (plan_a_id,plan_b_id) and feedback='')
    or
    (response_kind='change_request' and response_status='changes_requested'
      and selected_proposal_id is null and length(btrim(feedback))>0)
  )
);
create index eventflow_response_customer_time
  on public.eventflow_customer_responses(customer_id,responded_at desc);

alter table public.eventflow_customer_responses enable row level security;
revoke all on public.eventflow_customer_responses from public,anon,authenticated;
grant select on public.eventflow_customer_responses to authenticated;
-- Preserve standard trusted service-role access; never revoke existing grants.
grant all on public.eventflow_customer_responses to service_role;

create function public.eventflow_response_is_customer()
returns boolean language sql stable security definer
set search_path='' set row_security=off as $fn$
  select exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.role::text='customer'
    and p.account_type::text='customer' and p.approval_status::text='approved');
$fn$;

create function public.eventflow_response_is_staff()
returns boolean language sql stable security definer
set search_path='' set row_security=off as $fn$
  select exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.approval_status::text='approved'
    and ((p.role::text='staff' and p.account_type::text='business') or p.role::text='admin'));
$fn$;
create policy eventflow_response_read
on public.eventflow_customer_responses for select to authenticated using (
  public.eventflow_response_is_staff()
  or (customer_id=(select auth.uid()) and public.eventflow_response_is_customer()
    and exists(select 1 from public.requests r
      where r.id=eventflow_customer_responses.request_id and r.customer_id=(select auth.uid())))
);
-- Deliberately no INSERT, UPDATE or DELETE client policies or grants.

create function public.eventflow_submit_customer_response(
  p_request_id uuid,p_revision text,p_kind text,
  p_selected_proposal_id uuid default null,p_feedback text default '',
  p_idempotency_key uuid default null
)
returns public.eventflow_customer_responses
language plpgsql security definer set search_path='' set row_security=off as $fn$
declare
  v_customer uuid := auth.uid();
  v_existing public.eventflow_customer_responses;
  v_result public.eventflow_customer_responses;
  v_feedback text := btrim(coalesce(p_feedback,''));
  v_count bigint;
  v_keys text[];
  v_invalid bigint;
  v_a uuid;
  v_b uuid;
begin
  if v_customer is null or not public.eventflow_response_is_customer() then
    raise exception 'Approved Customer required.' using errcode='42501';
  end if;
  if p_request_id is null or p_revision is null or char_length(p_revision)>32
    or p_revision !~ '^[1-9][0-9]*$' or p_idempotency_key is null
    or p_kind is null or p_kind not in ('selection','change_request') then
    raise exception 'A saved request, canonical revision, response kind and operation ID are required.' using errcode='22023';
  end if;
  if char_length(coalesce(p_feedback,''))>4000
    or (p_kind='selection' and (p_selected_proposal_id is null or v_feedback<>''))
    or (p_kind='change_request' and (p_selected_proposal_id is not null or v_feedback='')) then
    raise exception 'Choose one plan or supply change feedback of 1–4000 characters.' using errcode='22023';
  end if;
  -- Same lock ordering as the existing Business pair approval RPC.
  perform r.id from public.requests r
    where r.id=p_request_id and r.customer_id=v_customer for update;
  if not found then raise exception 'Request unavailable.' using errcode='42501'; end if;

  select * into v_existing from public.eventflow_customer_responses
    where request_id=p_request_id and revision=p_revision;
  if found then
    if v_existing.customer_id=v_customer and v_existing.response_kind=p_kind
      and v_existing.selected_proposal_id is not distinct from p_selected_proposal_id
      and v_existing.feedback=v_feedback then
      return v_existing; -- Lost-response retries preserve the original timestamp.
    end if;
    raise exception 'A different response is already submitted for this revision.' using errcode='23505';
  end if;
  if exists(select 1 from public.eventflow_customer_responses
    where customer_id=v_customer and idempotency_key=p_idempotency_key) then
    raise exception 'This operation ID was already used for another response.' using errcode='23505';
  end if;

  -- Lock every existing proposal for this request in stable order. No writes.
  perform p.id from public.proposals p where p.request_id=p_request_id
    order by p.id for update;
  if exists(select 1 from public.proposals p where p.request_id=p_request_id
    and (p.revision is null or char_length(p.revision)>32 or p.revision !~ '^[1-9][0-9]*$')) then
    raise exception 'Legacy revision mapping requires Business review.' using errcode='22023';
  end if;
  -- Canonical numeric text comparison without integer overflow or unsafe casts.
  if exists(select 1 from public.proposals p where p.request_id=p_request_id
    and (char_length(p.revision)>char_length(p_revision)
      or (char_length(p.revision)=char_length(p_revision)
        and p.revision collate pg_catalog."C">p_revision collate pg_catalog."C"))) then
    raise exception 'A newer revision exists; refresh before responding.' using errcode='22023';
  end if;
  select count(*),array_agg(p.plan_key order by p.plan_key),
    count(*) filter (where p.status is distinct from 'Awaiting Customer'
      or jsonb_typeof(p.plan_content) is distinct from 'object')
    into v_count,v_keys,v_invalid from public.proposals p
    where p.request_id=p_request_id and p.revision=p_revision;
  if v_count<>2 or v_keys is distinct from array['A','B']::text[] or v_invalid<>0 then
    raise exception 'Both saved plans must be approved by Business before responding.' using errcode='42501';
  end if;
  select p.id into v_a from public.proposals p where p.request_id=p_request_id
    and p.revision=p_revision and p.plan_key='A';
  select p.id into v_b from public.proposals p where p.request_id=p_request_id
    and p.revision=p_revision and p.plan_key='B';
  if p_kind='selection' and p_selected_proposal_id not in (v_a,v_b) then
    raise exception 'The selected proposal does not belong to this approved pair.' using errcode='42501';
  end if;
  insert into public.eventflow_customer_responses(
    request_id,revision,customer_id,plan_a_id,plan_b_id,response_kind,response_status,
    selected_proposal_id,feedback,idempotency_key
  ) values(
    p_request_id,p_revision,v_customer,v_a,v_b,p_kind,
    case when p_kind='selection' then 'selection_submitted' else 'changes_requested' end,
    p_selected_proposal_id,v_feedback,p_idempotency_key
  ) returning * into v_result;
  return v_result;
end;
$fn$;

revoke all on function public.eventflow_response_is_customer() from public,anon,authenticated;
revoke all on function public.eventflow_response_is_staff() from public,anon,authenticated;
revoke all on function public.eventflow_submit_customer_response(uuid,text,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.eventflow_response_is_customer(),
  public.eventflow_response_is_staff() to authenticated,service_role;
grant execute on function public.eventflow_submit_customer_response(uuid,text,text,uuid,text,uuid)
  to authenticated;
notify pgrst,'reload schema';
commit;
