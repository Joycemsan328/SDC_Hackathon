-- BUSINESS-FIRST WORKFLOW. REVIEW ONLY: NOT APPLIED AUTOMATICALLY.
-- First inspect eventflow-workflow-catalog-review.sql, including independent indexes,
-- policies, effective grants, defaults, enum/CHECK values, and profile escalation.
-- An owner must explicitly change the following acknowledgement AFTER that review.
-- Existing proposal rows are NOT backfilled, released, updated or deleted.
begin;
set local eventflow.catalog_reviewed = 'no';
do $$
begin
  if current_setting('eventflow.catalog_reviewed', true) is distinct from 'yes' then
    raise exception 'STOP: complete the catalog/security review, then explicitly acknowledge it in this migration.';
  end if;
  if to_regclass('public.eventflow_plan_selections') is not null
     or to_regclass('public.eventflow_generation_leases') is not null
     or to_regclass('public.eventflow_proposal_revisions') is not null then
    raise exception 'Workflow objects already exist. Review upgrade SQL instead of reinstalling.';
  end if;
end;
$$;

create table public.eventflow_proposal_revisions (
  request_id uuid not null references public.requests(id),
  revision integer not null check (revision > 0),
  customer_id uuid not null references auth.users(id),
  state text not null check (state in (
    'queued', 'generating', 'business_review', 'released',
    'selected', 'confirmed', 'changes_requested'
  )),
  plan_a_id uuid unique references public.proposals(id),
  plan_b_id uuid unique references public.proposals(id),
  selected_proposal_id uuid references public.proposals(id),
  change_message text not null default '' check (length(change_message) <= 4000),
  business_message text not null default '' check (length(business_message) <= 4000),
  released_at timestamptz,
  released_by uuid references auth.users(id),
  selected_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (request_id, revision),
  check (plan_a_id is null or plan_b_id is null or plan_a_id <> plan_b_id),
  check (selected_proposal_id is null or selected_proposal_id in (plan_a_id, plan_b_id)),
  check (state not in ('business_review','released','selected','confirmed','changes_requested')
    or (plan_a_id is not null and plan_b_id is not null)),
  check (state not in ('released','selected','confirmed','changes_requested')
    or (released_at is not null and released_by is not null)),
  check (state not in ('selected','confirmed')
    or (selected_proposal_id is not null and selected_at is not null)),
  check (state <> 'confirmed' or (confirmed_at is not null and confirmed_by is not null))
);
create index eventflow_revision_customer on public.eventflow_proposal_revisions(customer_id);
create table public.eventflow_generation_leases (
  request_id uuid primary key references public.requests(id),
  revision integer not null,
  token uuid not null,
  expires_at timestamptz not null,
  foreign key (request_id, revision) references public.eventflow_proposal_revisions(request_id, revision)
);
alter table public.eventflow_proposal_revisions enable row level security;
alter table public.eventflow_generation_leases enable row level security;
revoke all on public.eventflow_proposal_revisions, public.eventflow_generation_leases from public, anon, authenticated;
grant select on public.eventflow_proposal_revisions to authenticated;

create function public.eventflow_is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid()
    and approval_status = 'approved'
    and (role = 'admin' or (role = 'staff' and account_type = 'business')));
$$;
create function public.eventflow_is_customer(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_id
    and approval_status = 'approved' and role = 'customer' and account_type = 'customer');
$$;
create policy eventflow_revision_read on public.eventflow_proposal_revisions
for select to authenticated using (
  public.eventflow_is_staff() or
  (customer_id = auth.uid() and public.eventflow_is_customer(auth.uid()))
);
-- Metadata only is visible before release; no draft titles, costs or plan JSON here.
create function public.eventflow_can_read_proposal(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.eventflow_is_staff() or (
    public.eventflow_is_customer(auth.uid()) and exists (
      select 1 from public.eventflow_proposal_revisions v
      join public.requests r on r.id = v.request_id and r.customer_id = auth.uid()
      where v.customer_id = auth.uid() and v.released_at is not null
        and p_id in (v.plan_a_id, v.plan_b_id)
    )
  );
$$;
alter table public.proposals enable row level security;
-- Restrictive policies AND with every existing permissive policy.
-- Thus an old "owner can select" policy cannot reveal an unreleased draft.
create policy eventflow_proposal_release_guard on public.proposals
as restrictive for select to anon, authenticated
using (public.eventflow_can_read_proposal(id));
create policy eventflow_proposal_read on public.proposals
for select to authenticated using (public.eventflow_can_read_proposal(id));
grant select on public.proposals to authenticated;
-- All proposal content writes now go through the backend's service-role RPC.
-- Existing permissive write policies cannot override these guards.
create policy eventflow_no_client_insert on public.proposals
as restrictive for insert to anon, authenticated with check (false);
create policy eventflow_no_client_update on public.proposals
as restrictive for update to anon, authenticated using (false) with check (false);
create policy eventflow_no_client_delete on public.proposals
as restrictive for delete to anon, authenticated using (false);

-- Server-only claim. Actor identity is verified by Express before this RPC and
-- checked again against ownership/profile here. Never grant to authenticated.
create function public.eventflow_prepare_generation(p_customer_id uuid, p_request_id uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.eventflow_proposal_revisions; claimed uuid; next_revision integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Backend only.' using errcode='42501'; end if;
  perform 1 from public.requests where id=p_request_id and customer_id=p_customer_id for update;
  if not found or not public.eventflow_is_customer(p_customer_id) or p_token is null then
    raise exception 'Approved request owner required.' using errcode='42501';
  end if;
  select * into v from public.eventflow_proposal_revisions
    where request_id=p_request_id order by revision desc limit 1;
  if v.request_id is null then
    -- Never guess which legacy pair is approved or regenerate over old records.
    if exists(select 1 from public.proposals where request_id=p_request_id) then
      raise exception 'Legacy proposals need owner-reviewed adoption; nothing was changed.';
    end if;
    insert into public.eventflow_proposal_revisions(request_id,revision,customer_id,state)
    values(p_request_id,1,p_customer_id,'queued') returning * into v;
  end if;
  if v.state not in ('queued','generating') then
    return jsonb_build_object('state','exists','revision',v.revision,'workflowState',v.state);
  end if;
  insert into public.eventflow_generation_leases(request_id,revision,token,expires_at)
  values(p_request_id,v.revision,p_token,clock_timestamp()+interval '10 minutes')
  on conflict(request_id) do update set revision=excluded.revision,token=excluded.token,expires_at=excluded.expires_at
  where public.eventflow_generation_leases.expires_at < clock_timestamp()
  returning token into claimed;
  if claimed is null then
    return jsonb_build_object('state','in_progress','revision',v.revision,'workflowState',v.state);
  end if;
  update public.eventflow_proposal_revisions set state='generating'
    where request_id=p_request_id and revision=v.revision;
  return jsonb_build_object('state','claimed','revision',v.revision,
    'workflowState','generating','changeMessage',coalesce((
      select string_agg('Revision ' || revision::text || ': ' || change_message,E'\n' order by revision)
      from public.eventflow_proposal_revisions where request_id=p_request_id
        and revision<=v.revision and change_message<>''
    ),''));
end;
$$;

create function public.eventflow_store_generated_pair(
  p_customer_id uuid, p_request_id uuid, p_revision integer, p_token uuid,
  p_recommendation text, p_plans jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.requests; v public.eventflow_proposal_revisions;
  x public.proposals; plan jsonb; saved_id uuid; a_id uuid; b_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Backend only.' using errcode='42501'; end if;
  select * into r from public.requests where id=p_request_id for update;
  if r.id is null or r.customer_id is distinct from p_customer_id
    or not public.eventflow_is_customer(p_customer_id) then
    raise exception 'Approved request owner required.' using errcode='42501';
  end if;
  select * into v from public.eventflow_proposal_revisions
    where request_id=r.id and revision=p_revision for update;
  if v.state = 'business_review' and v.plan_a_id is not null and v.plan_b_id is not null then
    return jsonb_build_object('requestId',r.id,'revision',p_revision,'workflowState',v.state,'persistence','existing');
  end if;
  if v.request_id is null or v.state <> 'generating' or p_token is null
    or not exists(select 1 from public.eventflow_generation_leases
      where request_id=r.id and revision=p_revision and token=p_token and expires_at>clock_timestamp()) then
    raise exception 'Generation lease missing or expired.';
  end if;
  if exists(select 1 from public.proposals where request_id=r.id and revision::text=p_revision::text) then
    raise exception 'This revision already contains proposals; nothing was overwritten.';
  end if;
  if p_plans is null or jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception 'Plan array required.';
  end if;
  if jsonb_array_length(p_plans) <> 2 or
    (select count(distinct value->>'id') from jsonb_array_elements(p_plans) where value->>'id' in ('A','B')) <> 2
    or nullif(trim(p_recommendation),'') is null then raise exception 'Complete A/B pair required.'; end if;
  for plan in select value from jsonb_array_elements(p_plans) loop
    if jsonb_typeof(plan->'costBreakdown') is distinct from 'array'
      or jsonb_typeof(plan->'totalEstimatedMYR') is distinct from 'number'
      or (plan->>'totalEstimatedMYR')::numeric < 0
      or nullif(trim(plan->>'title'),'') is null then raise exception 'Invalid plan.'; end if;
    if exists(select 1 from jsonb_array_elements(plan->'costBreakdown') item
      where jsonb_typeof(item->'amountMYR') is distinct from 'number'
        or nullif(trim(item->>'item'),'') is null
        or jsonb_typeof(item->'description') is distinct from 'string') then
      raise exception 'Invalid cost item.';
    end if;
    if exists(select 1 from jsonb_array_elements(plan->'costBreakdown') item
      where (item->>'amountMYR')::numeric < 0) then raise exception 'Negative cost.'; end if;
    select * into x from jsonb_populate_record(null::public.proposals,jsonb_build_object(
      'request_id',r.id,'customer_name',r.customer_name,'event_name',r.event_name,
      'event_date',r.event_date,'event_type',r.event_type,'budget',r.budget,
      'event_time',r.event_time,'venue_id',r.venue_id,'event_end_time',r.event_end_time,
      'revision',p_revision::text,'recommendation',p_recommendation,
      'status','Pending Business Approval','plan_key',plan->>'id','plan_content',plan));
    insert into public.proposals(request_id,customer_name,event_name,event_date,event_type,
      budget,event_time,venue_id,event_end_time,revision,recommendation,status,plan_key,plan_content)
    values(x.request_id,x.customer_name,x.event_name,x.event_date,x.event_type,
      x.budget,x.event_time,x.venue_id,x.event_end_time,x.revision,x.recommendation,x.status,x.plan_key,x.plan_content)
    returning id into saved_id;
    if plan->>'id'='A' then a_id:=saved_id; else b_id:=saved_id; end if;
  end loop;
  update public.eventflow_proposal_revisions set state='business_review',plan_a_id=a_id,plan_b_id=b_id
    where request_id=r.id and revision=p_revision;
  delete from public.eventflow_generation_leases where request_id=r.id and token=p_token;
  -- Deliberately return metadata only: the requesting customer cannot read drafts.
  return jsonb_build_object('requestId',r.id,'revision',p_revision,
    'workflowState','business_review','persistence','created');
end;
$$;

create function public.eventflow_release_pair(p_request_id uuid,p_revision integer)
returns public.eventflow_proposal_revisions
language plpgsql security definer set search_path = '' as $$
declare v public.eventflow_proposal_revisions;
begin
  if not public.eventflow_is_staff() then raise exception 'Approved staff required.' using errcode='42501'; end if;
  perform 1 from public.requests where id=p_request_id for update;
  select * into v from public.eventflow_proposal_revisions where request_id=p_request_id and revision=p_revision for update;
  if v.request_id is null or exists(select 1 from public.eventflow_proposal_revisions
    where request_id=p_request_id and revision>p_revision) then raise exception 'Refresh the latest revision.'; end if;
  if v.state='released' then return v; end if;
  if v.state <> 'business_review' then raise exception 'Only a complete draft pair can be released.'; end if;
  if (select count(*) from public.proposals where request_id=p_request_id and revision::text=p_revision::text
    and ((id=v.plan_a_id and plan_key='A') or (id=v.plan_b_id and plan_key='B')) and plan_content is not null) <> 2 then
    raise exception 'Both saved plans must be reviewed before release.';
  end if;
  update public.eventflow_proposal_revisions set state='released',released_at=clock_timestamp(),released_by=auth.uid()
    where request_id=p_request_id and revision=p_revision returning * into v;
  return v;
end;
$$;
-- Explicit staff action for existing records. Does not edit/release a quotation.
-- Ambiguous/non-numeric legacy revisions need a separate owner-reviewed mapping.
create function public.eventflow_adopt_legacy_pair(
  p_request_id uuid,p_revision integer,p_plan_a_id uuid,p_plan_b_id uuid
)
returns public.eventflow_proposal_revisions
language plpgsql security definer set search_path = '' as $$
declare r public.requests; v public.eventflow_proposal_revisions;
begin
  if not public.eventflow_is_staff() then raise exception 'Approved staff required.' using errcode='42501'; end if;
  select * into r from public.requests where id=p_request_id for update;
  if r.id is null or not public.eventflow_is_customer(r.customer_id) then raise exception 'Approved request owner required.'; end if;
  if exists(select 1 from public.eventflow_proposal_revisions where request_id=r.id) then
    raise exception 'A managed revision already exists. Refresh first.';
  end if;
  if p_revision is null or p_revision<1 or p_plan_a_id is null or p_plan_b_id is null or p_plan_a_id=p_plan_b_id then
    raise exception 'A complete numeric legacy revision is required.';
  end if;
  if exists(select 1 from public.proposals where request_id=r.id
    and (revision is null or revision::text !~ '^[0-9]+$')) then
    raise exception 'Legacy revision mapping needs owner review.';
  end if;
  if exists(select 1 from public.proposals where request_id=r.id
    and case when revision::text ~ '^[0-9]+$' then revision::text::numeric end>p_revision) then
    raise exception 'Adopt the latest saved revision.';
  end if;
  if (select count(*) from public.proposals where request_id=r.id and revision::text=p_revision::text)<>2
    or (select count(*) from public.proposals where request_id=r.id and revision::text=p_revision::text
      and ((id=p_plan_a_id and plan_key='A') or (id=p_plan_b_id and plan_key='B'))
      and plan_content is not null)<>2 then
    raise exception 'The exact saved Plan A/B pair could not be verified.';
  end if;
  insert into public.eventflow_proposal_revisions(request_id,revision,customer_id,state,plan_a_id,plan_b_id)
  values(r.id,p_revision,r.customer_id,'business_review',p_plan_a_id,p_plan_b_id) returning * into v;
  return v;
end;
$$;
create function public.eventflow_select_plan(p_request_id uuid,p_proposal_id uuid)
returns public.eventflow_proposal_revisions
language plpgsql security definer set search_path = '' as $$
declare v public.eventflow_proposal_revisions;
begin
  perform 1 from public.requests where id=p_request_id and customer_id=auth.uid() for update;
  if not found or not public.eventflow_is_customer(auth.uid()) then
    raise exception 'Approved request owner required.' using errcode='42501'; end if;
  select * into v from public.eventflow_proposal_revisions where request_id=p_request_id order by revision desc limit 1 for update;
  if v.state='selected' and v.selected_proposal_id=p_proposal_id then return v; end if;
  if v.request_id is null or v.state not in ('released','selected') or v.released_at is null
    or p_proposal_id is null or p_proposal_id not in (v.plan_a_id,v.plan_b_id) then
    raise exception 'Only the latest Business-released plans may be selected.';
  end if;
  update public.eventflow_proposal_revisions set state='selected',
    selected_proposal_id=p_proposal_id,selected_at=clock_timestamp()
    where request_id=v.request_id and revision=v.revision returning * into v;
  return v;
end;
$$;
create function public.eventflow_request_changes(p_request_id uuid,p_revision integer,p_message text)
returns public.eventflow_proposal_revisions
language plpgsql security definer set search_path = '' as $$
declare v public.eventflow_proposal_revisions;
begin
  perform 1 from public.requests where id=p_request_id and customer_id=auth.uid() for update;
  if not found or not public.eventflow_is_customer(auth.uid()) then
    raise exception 'Approved request owner required.' using errcode='42501'; end if;
  if nullif(trim(p_message),'') is null or length(p_message)>4000 then raise exception 'A message of 1–4000 characters is required.'; end if;
  select * into v from public.eventflow_proposal_revisions where request_id=p_request_id order by revision desc limit 1 for update;
  -- Idempotent retry after the change was queued but its response was lost.
  if v.revision=p_revision+1 and v.change_message=trim(p_message) then return v; end if;
  if v.request_id is null or v.revision is distinct from p_revision or v.state not in ('released','selected') then
    raise exception 'Only the current released revision can be changed; refresh first.';
  end if;
  if length(p_message) + coalesce((select sum(length(change_message)+40)
      from public.eventflow_proposal_revisions where request_id=p_request_id),0)
      + coalesce((select length(notes) from public.requests where id=p_request_id),0) > 7500 then
    raise exception 'The accumulated change history is too long for safe generation. Ask your planner to consolidate it before retrying.';
  end if;
  update public.eventflow_proposal_revisions set state='changes_requested'
    where request_id=v.request_id and revision=v.revision;
  insert into public.eventflow_proposal_revisions(request_id,revision,customer_id,state,change_message)
    values(v.request_id,v.revision+1,auth.uid(),'queued',trim(p_message)) returning * into v;
  return v;
end;
$$;
create function public.eventflow_confirm_selection(
  p_request_id uuid,p_revision integer,p_proposal_id uuid,p_selected_at timestamptz,p_message text default ''
)
returns public.eventflow_proposal_revisions
language plpgsql security definer set search_path = '' as $$
declare v public.eventflow_proposal_revisions;
begin
  if not public.eventflow_is_staff() then raise exception 'Approved staff required.' using errcode='42501'; end if;
  if length(coalesce(p_message,''))>4000 then raise exception 'Message too long.'; end if;
  perform 1 from public.requests where id=p_request_id for update;
  select * into v from public.eventflow_proposal_revisions where request_id=p_request_id order by revision desc limit 1 for update;
  if v.request_id is null or v.revision is distinct from p_revision or p_proposal_id is null or p_selected_at is null
    or v.selected_proposal_id is distinct from p_proposal_id or v.selected_at is distinct from p_selected_at then
    raise exception 'The selection changed; refresh first.';
  end if;
  if v.state='confirmed' then return v; end if;
  if v.state<>'selected' then raise exception 'A current customer selection is required.'; end if;
  update public.eventflow_proposal_revisions set state='confirmed',confirmed_by=auth.uid(),
    confirmed_at=clock_timestamp(),business_message=trim(coalesce(p_message,''))
    where request_id=v.request_id and revision=v.revision returning * into v;
  return v;
end;
$$;

-- Explicitly remove both PUBLIC and direct anon/authenticated grants.
revoke all on function public.eventflow_is_staff() from public,anon,authenticated;
revoke all on function public.eventflow_is_customer(uuid) from public,anon,authenticated;
revoke all on function public.eventflow_can_read_proposal(uuid) from public,anon,authenticated;
grant execute on function public.eventflow_is_staff(),public.eventflow_is_customer(uuid) to authenticated,service_role;
grant execute on function public.eventflow_can_read_proposal(uuid) to anon,authenticated;
revoke all on function public.eventflow_prepare_generation(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.eventflow_store_generated_pair(uuid,uuid,integer,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.eventflow_prepare_generation(uuid,uuid,uuid),
  public.eventflow_store_generated_pair(uuid,uuid,integer,uuid,text,jsonb) to service_role;
revoke all on function public.eventflow_release_pair(uuid,integer) from public,anon,authenticated;
revoke all on function public.eventflow_adopt_legacy_pair(uuid,integer,uuid,uuid) from public,anon,authenticated;
revoke all on function public.eventflow_select_plan(uuid,uuid) from public,anon,authenticated;
revoke all on function public.eventflow_request_changes(uuid,integer,text) from public,anon,authenticated;
revoke all on function public.eventflow_confirm_selection(uuid,integer,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.eventflow_release_pair(uuid,integer),
  public.eventflow_adopt_legacy_pair(uuid,integer,uuid,uuid),
  public.eventflow_select_plan(uuid,uuid),public.eventflow_request_changes(uuid,integer,text),
  public.eventflow_confirm_selection(uuid,integer,uuid,timestamptz,text) to authenticated;
-- IMPORTANT: catalog review must also identify/revoke or secure legacy SECURITY
-- DEFINER RPCs and views which expose/write proposals. RLS cannot contain a
-- separate bypass-RLS function, owner-rights view, or leaked service credential.
notify pgrst, 'reload schema';
commit;
