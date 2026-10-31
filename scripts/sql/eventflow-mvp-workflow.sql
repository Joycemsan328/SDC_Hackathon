-- REVIEW / APPROVAL REQUIRED. This file is NOT applied automatically.
-- Run as the Supabase database owner in one transaction after approval.
-- Adds workflow state only; never rewrites/deletes existing requests or proposals.
begin;

create table if not exists public.eventflow_plan_selections (
  request_id uuid primary key references public.requests(id),
  customer_id uuid not null references auth.users(id),
  proposal_id uuid not null references public.proposals(id),
  plan_key text not null check (plan_key in ('A', 'B')),
  revision text not null,
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'changes_requested')),
  message text not null default '',
  selected_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

-- A lease prevents concurrent API processes / retries from invoking RunPod twice.
create table if not exists public.eventflow_generation_leases (
  request_id uuid primary key references public.requests(id),
  customer_id uuid not null references auth.users(id),
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.eventflow_plan_selections enable row level security;
alter table public.eventflow_generation_leases enable row level security;
revoke all on public.eventflow_plan_selections, public.eventflow_generation_leases from anon, authenticated;
grant select on public.eventflow_plan_selections to authenticated;

create or replace function public.eventflow_is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid()
    and p.approval_status = 'approved'
    and (p.role = 'admin' or (p.role = 'staff' and p.account_type = 'business'))
  );
$$;
revoke all on function public.eventflow_is_staff() from public;
grant execute on function public.eventflow_is_staff() to authenticated;

drop policy if exists eventflow_selection_read on public.eventflow_plan_selections;
create policy eventflow_selection_read on public.eventflow_plan_selections for select to authenticated
using (customer_id = auth.uid() or public.eventflow_is_staff());

-- This function changes selection metadata only, never a saved proposal.
create or replace function public.eventflow_select_plan(p_request_id uuid, p_proposal_id uuid)
returns public.eventflow_plan_selections
language plpgsql security definer set search_path = '' as $$
declare
  r public.requests; p public.proposals; s public.eventflow_plan_selections;
begin
  select * into r from public.requests where id = p_request_id for update;
  if auth.uid() is null or r.customer_id is distinct from auth.uid() then
    raise exception 'This event does not belong to your account.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()
    and account_type = 'customer' and role = 'customer' and approval_status = 'approved') then
    raise exception 'An approved customer account is required.' using errcode = '42501';
  end if;
  select * into p from public.proposals where id = p_proposal_id and request_id = r.id;
  if p.id is null or p.plan_key not in ('A', 'B') or p.plan_content is null or p.revision is null then
    raise exception 'The selected saved plan is unavailable.';
  end if;
  if (select count(*) from public.proposals where request_id = r.id
      and revision::text = p.revision::text and plan_key in ('A', 'B')) <> 2
    or (select count(distinct plan_key) from public.proposals where request_id = r.id
      and revision::text = p.revision::text and plan_key in ('A', 'B')) <> 2 then
    raise exception 'A complete saved Plan A/B pair is required.';
  end if;
  if exists (select 1 from public.proposals q where q.request_id = r.id
    and q.plan_key in ('A', 'B') and q.revision::text ~ '^[0-9]+$'
    and p.revision::text ~ '^[0-9]+$'
    and case when q.revision::text ~ '^[0-9]+$' then q.revision::text::numeric end
      > case when p.revision::text ~ '^[0-9]+$' then p.revision::text::numeric end) then
    raise exception 'A newer proposal revision exists. Refresh before selecting.';
  end if;
  select * into s from public.eventflow_plan_selections where request_id = r.id for update;
  if s.decision = 'approved' and s.proposal_id <> p.id then
    raise exception 'This selection is already approved. Contact your planner to change it.';
  end if;
  if s.proposal_id = p.id and s.decision in ('pending', 'approved') then return s; end if;
  insert into public.eventflow_plan_selections(request_id, customer_id, proposal_id, plan_key, revision)
  values (r.id, auth.uid(), p.id, p.plan_key, p.revision::text)
  on conflict (request_id) do update set
    proposal_id = excluded.proposal_id, plan_key = excluded.plan_key, revision = excluded.revision,
    decision = 'pending', message = '', selected_at = clock_timestamp(), reviewed_at = null, reviewed_by = null
  returning * into s;
  return s;
end;
$$;

-- Staff reviews exactly the customer's selection, with optimistic concurrency.
create or replace function public.eventflow_review_plan(
  p_request_id uuid, p_proposal_id uuid, p_selected_at timestamptz,
  p_decision text, p_message text default ''
)
returns public.eventflow_plan_selections
language plpgsql security definer set search_path = '' as $$
declare s public.eventflow_plan_selections;
begin
  if not public.eventflow_is_staff() then
    raise exception 'Approved Business staff access is required.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then
    raise exception 'Choose Approve or Request Changes.';
  end if;
  if p_decision = 'changes_requested' and length(trim(coalesce(p_message, ''))) = 0 then
    raise exception 'Include a message explaining the requested changes.';
  end if;
  if length(coalesce(p_message, '')) > 4000 then raise exception 'Message must be at most 4000 characters.'; end if;
  perform 1 from public.requests where id = p_request_id for update;
  select * into s from public.eventflow_plan_selections where request_id = p_request_id for update;
  if s.proposal_id is distinct from p_proposal_id or s.selected_at is distinct from p_selected_at then
    raise exception 'The customer selection changed. Refresh and review the current selection.';
  end if;
  if s.decision <> 'pending' then
    if s.decision = p_decision and s.message = trim(coalesce(p_message, '')) then return s; end if;
    raise exception 'This selection has already been reviewed. Refresh to see the decision.';
  end if;
  update public.eventflow_plan_selections set decision = p_decision,
    message = trim(coalesce(p_message, '')), reviewed_at = clock_timestamp(), reviewed_by = auth.uid()
  where request_id = p_request_id returning * into s;
  return s;
end;
$$;

-- Called BEFORE RunPod. Missing migration / denied access cannot waste an AI call.
create or replace function public.eventflow_claim_generation(p_request_id uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed uuid;
begin
  perform 1 from public.requests where id = p_request_id and customer_id = auth.uid() for update;
  if not found or auth.uid() is null then raise exception 'Your saved request was not found.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()
    and account_type = 'customer' and role = 'customer' and approval_status = 'approved') then
    raise exception 'An approved customer account is required.' using errcode = '42501';
  end if;
  if exists (select 1 from public.proposals where request_id = p_request_id) then
    raise exception 'Saved proposals already exist. Reload them instead of generating again.';
  end if;
  insert into public.eventflow_generation_leases(request_id, customer_id, token, expires_at)
  values (p_request_id, auth.uid(), p_token, clock_timestamp() + interval '10 minutes')
  on conflict (request_id) do update set token = excluded.token, expires_at = excluded.expires_at
  where public.eventflow_generation_leases.expires_at < clock_timestamp()
  returning token into claimed;
  return claimed is not null;
end;
$$;

-- Atomic, insert-only persistence. Existing records are returned, never updated.
-- jsonb_populate_record preserves the existing proposals column types.
create or replace function public.eventflow_persist_proposal_pair(
  p_customer_id uuid, p_request_id uuid, p_revision integer,
  p_recommendation text, p_proposal_fields jsonb, p_plans jsonb, p_generation_token uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.requests; x public.proposals; plan jsonb; result jsonb; existing_count integer;
begin
  select * into r from public.requests where id = p_request_id for update;
  if auth.uid() is null or p_customer_id is distinct from auth.uid() or r.customer_id is distinct from auth.uid() then
    raise exception 'Your saved request was not found.' using errcode = '42501';
  end if;
  select count(*) into existing_count from public.proposals where request_id = r.id;
  if existing_count > 0 then
    if (select count(*) from public.proposals where request_id = r.id and revision::text = p_revision::text
        and plan_key in ('A', 'B')) <> 2 then raise exception 'Existing proposals need review; nothing was overwritten.'; end if;
  else
    if not exists (select 1 from public.eventflow_generation_leases where request_id = r.id
        and customer_id = auth.uid() and token = p_generation_token and expires_at > clock_timestamp()) then
      raise exception 'Generation lease expired. No proposals were overwritten.';
    end if;
    if p_revision <> 1 or jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) <> 2
      or (select count(distinct value->>'id') from jsonb_array_elements(p_plans) where value->>'id' in ('A', 'B')) <> 2 then
      raise exception 'One initial Plan A and Plan B are required.';
    end if;
    for plan in select value from jsonb_array_elements(p_plans) loop
      if jsonb_typeof(plan->'costBreakdown') is distinct from 'array'
        or jsonb_typeof(plan->'totalEstimatedMYR') is distinct from 'number'
        or (plan->>'totalEstimatedMYR')::numeric < 0 or nullif(plan->>'title', '') is null then
        raise exception 'Each plan needs a title, itemized costs and a nonnegative total.';
      end if;
      select * into x from jsonb_populate_record(null::public.proposals, jsonb_build_object(
        'request_id', r.id, 'customer_name', r.customer_name, 'event_name', r.event_name,
        'event_date', r.event_date, 'event_type', r.event_type, 'budget', r.budget,
        'event_time', r.event_time, 'venue_id', r.venue_id, 'event_end_time', r.event_end_time,
        'revision', p_revision::text, 'recommendation', p_recommendation,
        'status', 'Pending Business Approval', 'plan_key', plan->>'id', 'plan_content', plan
      ));
      insert into public.proposals(request_id, customer_name, event_name, event_date, event_type,
        budget, event_time, venue_id, event_end_time, revision, recommendation, status, plan_key, plan_content)
      values (x.request_id, x.customer_name, x.event_name, x.event_date, x.event_type,
        x.budget, x.event_time, x.venue_id, x.event_end_time, x.revision, x.recommendation, x.status, x.plan_key, x.plan_content);
    end loop;
  end if;
  select jsonb_build_object('request_id', r.id, 'revision', p_revision,
    'status', case when existing_count > 0 then 'existing' else 'created' end,
    'proposals', jsonb_agg(jsonb_build_object('proposal_id', p.id, 'plan_key', p.plan_key,
      'status', p.status, 'recommendation', p.recommendation, 'plan_content', p.plan_content) order by p.plan_key))
  into result from public.proposals p where p.request_id = r.id and p.revision::text = p_revision::text and p.plan_key in ('A', 'B');
  delete from public.eventflow_generation_leases where request_id = r.id and token = p_generation_token;
  return result;
end;
$$;

revoke all on function public.eventflow_select_plan(uuid, uuid) from public;
revoke all on function public.eventflow_review_plan(uuid, uuid, timestamptz, text, text) from public;
revoke all on function public.eventflow_claim_generation(uuid, uuid) from public;
revoke all on function public.eventflow_persist_proposal_pair(uuid, uuid, integer, text, jsonb, jsonb, uuid) from public;
grant execute on function public.eventflow_select_plan(uuid, uuid) to authenticated;
grant execute on function public.eventflow_review_plan(uuid, uuid, timestamptz, text, text) to authenticated;
grant execute on function public.eventflow_claim_generation(uuid, uuid) to authenticated;
grant execute on function public.eventflow_persist_proposal_pair(uuid, uuid, integer, text, jsonb, jsonb, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
