-- REVIEW DRAFT ONLY. Do not execute until the migration and catalog checks
-- are approved. The acknowledgement intentionally remains 'no' in this file.
--
-- Adds one shared-team conversation per eligible request, messages append-only
-- for authenticated clients (NOT immutable to trusted service_role/owners),
-- with transaction-serialized per-conversation ordering, per-user read cursors,
-- narrowly scoped authenticated RPCs, and message INSERT
-- membership in the existing supabase_realtime publication.
--
-- Does not alter requests, proposals, events, Customer Responses/actions,
-- notification tables, existing functions, authentication, or AI generation.

begin;
set local eventflow.contact_your_planner_reviewed = 'no';

do $preflight$
declare
  v_publication_owner oid;
begin
  if current_setting('eventflow.contact_your_planner_reviewed', true)
      is distinct from 'yes' then
    raise exception 'STOP: review and approve the Contact Your Planner migration before installation.';
  end if;
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'PostgreSQL 17 or newer is required for the MAINTAIN privilege assertions.';
  end if;
  if not has_schema_privilege(current_user,'public','CREATE')
     or not exists (
       select 1 from pg_catalog.pg_roles
       where rolname=current_user and (rolsuper or rolbypassrls)
     )
     or not exists (
       select 1 from pg_catalog.pg_roles where rolname='service_role'
     ) then
    raise exception 'Execution role needs public CREATE and BYPASSRLS (or superuser) authority, and service_role must exist.';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname='authenticated')
     or to_regprocedure('auth.uid()') is null
     or not has_schema_privilege(current_user,'public','USAGE')
     or not has_schema_privilege(current_user,'auth','USAGE')
     or not has_schema_privilege('authenticated','public','USAGE')
     or not has_schema_privilege('authenticated','auth','USAGE') then
    raise exception 'Supabase API roles, auth.uid(), and required schema USAGE privileges must exist.';
  end if;

  if to_regclass('public.eventflow_planner_conversations') is not null
     or to_regclass('public.eventflow_planner_messages') is not null
     or to_regclass('public.eventflow_planner_reads') is not null then
    raise exception 'A Contact Your Planner relation already exists. Inspect and prepare an upgrade; do not rerun this install.';
  end if;

  if to_regprocedure('public.eventflow_planner_request_is_eligible(uuid)') is not null
     or to_regprocedure('public.eventflow_planner_pinned_proof_is_valid(uuid)') is not null
     or to_regprocedure('public.eventflow_planner_preserve_proof_anchor()') is not null
     or to_regprocedure('public.eventflow_planner_can_access_conversation(uuid)') is not null
     or to_regprocedure('public.eventflow_planner_open_conversation(uuid)') is not null
     or to_regprocedure('public.eventflow_planner_send_message(uuid,uuid,text)') is not null
     or to_regprocedure('public.eventflow_planner_mark_read(uuid)') is not null
     or to_regprocedure('public.eventflow_planner_mark_read(uuid,bigint)') is not null
     or to_regprocedure('public.eventflow_planner_assign_message_order()') is not null
     or to_regprocedure('public.eventflow_planner_business_inbox()') is not null then
    raise exception 'A Contact Your Planner routine already exists. Inspect it before preparing an upgrade.';
  end if;

  if to_regclass('public.requests') is null
     or to_regclass('public.proposals') is null
     or to_regclass('public.events') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.eventflow_customer_responses') is null
     or to_regclass('public.eventflow_customer_response_actions') is null
     or to_regclass('auth.users') is null then
    raise exception 'A required request, proposal, event, profile, response, action, or Auth relation is missing.';
  end if;

  if exists (
    select 1 from (values
      ('requests','id','uuid'), ('requests','customer_id','uuid'),
      ('requests','customer_name','text'), ('requests','event_name','text'),
      ('proposals','id','uuid'), ('proposals','request_id','uuid'),
      ('proposals','revision','text'), ('proposals','plan_key','text'),
      ('proposals','status','text'),
      ('events','proposal_id','uuid'), ('events','customer_id','uuid'),
      ('eventflow_customer_responses','id','uuid'),
      ('eventflow_customer_responses','request_id','uuid'),
      ('eventflow_customer_responses','customer_id','uuid'),
      ('eventflow_customer_responses','revision','text'),
      ('eventflow_customer_responses','response_kind','text'),
      ('eventflow_customer_responses','response_status','text'),
      ('eventflow_customer_responses','selected_proposal_id','uuid'),
      ('eventflow_customer_responses','plan_a_id','uuid'),
      ('eventflow_customer_responses','plan_b_id','uuid'),
      ('eventflow_customer_response_actions','response_id','uuid'),
      ('eventflow_customer_response_actions','request_id','uuid'),
      ('eventflow_customer_response_actions','source_revision','text'),
      ('eventflow_customer_response_actions','next_revision','text'),
      ('eventflow_customer_response_actions','action_kind','text'),
      ('eventflow_customer_response_actions','status','text'),
      ('eventflow_customer_response_actions','confirmed_by','uuid'),
      ('eventflow_customer_response_actions','confirmed_at','timestamptz'),
      ('profiles','id','uuid'), ('profiles','full_name','text'),
      ('profiles','role','text'), ('profiles','account_type','text'),
      ('profiles','approval_status','text')
    ) expected(table_name,column_name,udt_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public'
        and c.table_name=expected.table_name
        and c.column_name=expected.column_name
        and c.udt_name=expected.udt_name
    )
  ) then
    raise exception 'A required workflow column is missing or has an incompatible type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='requests'
      and column_name='customer_id' and is_nullable='NO'
  ) then
    raise exception 'requests.customer_id must be a non-null UUID ownership field.';
  end if;

  -- This migration deliberately does NOT require or add a requests.customer_id
  -- FK to auth.users. Ownership is checked against auth.uid() and approved
  -- profile helpers. The FK catalog result must still be reviewed separately.

  -- BYPASSRLS is not a substitute for ordinary SELECT/REFERENCES privileges.
  if exists (
    select 1 from (values
      ('public.requests'),('public.proposals'),('public.events'),
      ('public.profiles'),('public.eventflow_customer_responses'),
      ('public.eventflow_customer_response_actions')
    ) dependency(relation_name)
    where not has_table_privilege(current_user,dependency.relation_name,'SELECT')
  ) or not has_column_privilege(current_user,'public.requests','id','REFERENCES')
    or not has_column_privilege(current_user,'public.proposals','id','REFERENCES')
    or not has_column_privilege(
      current_user,'public.eventflow_customer_responses','id','REFERENCES')
    or not has_column_privilege(current_user,'auth.users','id','REFERENCES') then
    raise exception 'Execution/function-owner role needs dependency SELECT and FK REFERENCES privileges.';
  end if;
  if exists (
    select 1
    from public.eventflow_customer_response_actions a
    where a.action_kind='revision'
      and (a.status not in ('queued','generating','business_review','released')
        or a.next_revision is null
        or char_length(a.next_revision)>32
        or a.next_revision !~ '^[1-9][0-9]*$')
  ) then
    raise exception 'An active revision action has an unorderable target revision.';
  end if;

  if to_regprocedure('public.eventflow_response_is_customer()') is null
     or to_regprocedure('public.eventflow_response_is_staff()') is null
     or to_regprocedure('public.accept_proposal(uuid)') is null then
    raise exception 'The reviewed approved-account helpers or legacy acceptance RPC are missing.';
  end if;
  if not has_function_privilege(current_user,'auth.uid()','EXECUTE')
     or not has_function_privilege('authenticated','auth.uid()','EXECUTE')
     or not has_function_privilege(current_user,'public.eventflow_response_is_customer()','EXECUTE')
     or not has_function_privilege(current_user,'public.eventflow_response_is_staff()','EXECUTE') then
    raise exception 'Execution/function-owner role and API role need the required auth/helper EXECUTE privileges.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid in (
      to_regprocedure('public.eventflow_response_is_customer()'),
      to_regprocedure('public.eventflow_response_is_staff()')
    )
      and (p.prorettype is distinct from 'boolean'::regtype
        or not p.prosecdef
        or p.proconfig is distinct from array['search_path=""','row_security=off']::text[])
  ) then
    raise exception 'Approved account helpers do not match the reviewed secure function settings.';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
    where p.oid in (
      to_regprocedure('public.eventflow_response_is_customer()'),
      to_regprocedure('public.eventflow_response_is_staff()')
    )
      and not (owner_role.rolsuper or owner_role.rolbypassrls)
  ) then
    raise exception 'Approved account helper owners must bypass RLS for their reviewed SECURITY DEFINER behavior.';
  end if;
  if not has_function_privilege(
       'authenticated','public.eventflow_response_is_customer()','EXECUTE')
     or not has_function_privilege(
       'authenticated','public.eventflow_response_is_staff()','EXECUTE')
     or has_function_privilege(
       'anon','public.eventflow_response_is_customer()','EXECUTE')
     or has_function_privilege(
       'anon','public.eventflow_response_is_staff()','EXECUTE')
     or exists (
       select 1
       from pg_catalog.pg_proc p
       cross join lateral aclexplode(
         coalesce(p.proacl,acldefault('f',p.proowner))
       ) acl
       where p.oid in (
         to_regprocedure('public.eventflow_response_is_customer()'),
         to_regprocedure('public.eventflow_response_is_staff()')
       )
         and acl.grantee=0
         and acl.privilege_type='EXECUTE'
     ) then
    raise exception 'Approved account helper grants differ from the reviewed authenticated-only baseline.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication
    where pubname='supabase_realtime' and pubinsert
  ) then
    raise exception 'The supabase_realtime publication is missing or does not publish INSERTs.';
  end if;
  select pubowner into v_publication_owner
  from pg_catalog.pg_publication where pubname='supabase_realtime';
  -- Check the EXECUTING role, not whether the publication OWNER is superuser.
  -- MEMBER alone is insufficient for a non-inheriting membership: execution
  -- must already have owner authority (USAGE) or explicitly SET ROLE first.
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname=current_user and rolsuper
  ) and not pg_has_role(current_user,v_publication_owner,'USAGE') then
    raise exception 'The current execution role cannot alter supabase_realtime.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where policyname in (
      'eventflow_planner_conversations_read',
      'eventflow_planner_messages_read',
      'eventflow_planner_reads_read',
      'eventflow_planner_conversations_preserve_proof_anchor'
    )
  ) then
    raise exception 'A Contact Your Planner policy name already exists.';
  end if;
end;
$preflight$;

create table public.eventflow_planner_conversations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references public.requests(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  last_message_at timestamptz,
  -- Immutable-at-creation proof. Current flow pins the exact response/action,
  -- selected proposal and revision; legacy flow pins the accepted proposal.
  eligibility_kind text not null
    check (eligibility_kind in ('selection','legacy_acceptance')),
  eligibility_proposal_id uuid not null
    references public.proposals(id) on delete restrict,
  eligibility_response_id uuid
    references public.eventflow_customer_responses(id) on delete restrict,
  eligibility_revision text,
  constraint eventflow_planner_conversations_eligibility_anchor check (
    (eligibility_kind='selection'
      and eligibility_response_id is not null
      and eligibility_revision is not null)
    or
    (eligibility_kind='legacy_acceptance'
      and eligibility_response_id is null)
  ),
  -- Transactional row data, NOT nextval()/identity: the row lock is held until
  -- the allocating message transaction commits or rolls back.
  last_message_seq bigint not null default 0 check (last_message_seq>=0)
);

create table public.eventflow_planner_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.eventflow_planner_conversations(id) on delete restrict,
  -- For authenticated clients, set only by the send RPC from auth.uid().
  -- Trusted service-role maintenance is outside that client-only guarantee.
  -- No FK is used so message history survives Auth account deletion.
  sender_id uuid not null,
  sender_display_name text not null
    check (char_length(btrim(sender_display_name)) between 1 and 200),
  client_message_id uuid not null,
  body text not null
    check (char_length(btrim(body)) between 1 and 4000),
  -- Assigned by the BEFORE INSERT trigger; never supplied by the API caller.
  message_seq bigint not null check (message_seq>0),
  created_at timestamptz not null default clock_timestamp(),
  constraint eventflow_planner_messages_order
    unique (conversation_id,message_seq),
  constraint eventflow_planner_messages_idempotency
    unique (conversation_id,sender_id,client_message_id)
);

-- The unique conversation/message_seq index also supports ordered history and
-- reverse scans for the latest message. UUIDs and timestamps are display-only.
create index eventflow_planner_messages_unread_idx
  on public.eventflow_planner_messages(conversation_id,message_seq,sender_id);

create table public.eventflow_planner_reads (
  conversation_id uuid not null
    references public.eventflow_planner_conversations(id) on delete restrict,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default clock_timestamp(),
  -- Zero means no messages acknowledged. Nonzero values are verified by the
  -- mark-read RPC against an existing message in this conversation.
  last_read_seq bigint not null default 0 check (last_read_seq>=0),
  constraint eventflow_planner_reads_pk primary key(conversation_id,user_id)
);
create index eventflow_planner_reads_user_idx
  on public.eventflow_planner_reads(user_id,conversation_id);

alter table public.eventflow_planner_conversations enable row level security;
alter table public.eventflow_planner_messages enable row level security;
alter table public.eventflow_planner_reads enable row level security;

revoke all on public.eventflow_planner_conversations,
  public.eventflow_planner_messages,
  public.eventflow_planner_reads
  from public,anon,authenticated;
grant select on public.eventflow_planner_conversations,
  public.eventflow_planner_messages,
  public.eventflow_planner_reads to authenticated;
grant all on public.eventflow_planner_conversations,
  public.eventflow_planner_messages,
  public.eventflow_planner_reads to service_role;

create function public.eventflow_planner_assign_message_order()
returns trigger
language plpgsql security definer
set search_path='' set row_security=off
as $fn$
declare
  v_previous_seq bigint;
begin
  -- All inserts, including trusted service-role inserts, acquire the same
  -- conversation lock BEFORE assigning an order. This lock is retained until
  -- transaction end, not merely until the trigger or send RPC returns.
  select c.last_message_seq into v_previous_seq
  from public.eventflow_planner_conversations c
  where c.id=new.conversation_id
  for update;
  if not found then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  new.message_seq := v_previous_seq+1;
  new.created_at := clock_timestamp();
  update public.eventflow_planner_conversations c
  set last_message_seq=new.message_seq,
      last_message_at=new.created_at
  where c.id=new.conversation_id;
  -- Counter update and message insert roll back together on any error.
  return new;
end;
$fn$;

create trigger eventflow_planner_messages_assign_order
  before insert on public.eventflow_planner_messages
  for each row execute function public.eventflow_planner_assign_message_order();

create function public.eventflow_planner_request_is_eligible(p_request_id uuid)
returns table(
  eligibility_proposal_id uuid,
  eligibility_response_id uuid,
  eligibility_kind text,
  eligibility_revision text
)
language plpgsql stable security definer
set search_path='' set row_security=off
as $fn$
declare
  v_has_unorderable_revision boolean;
  v_latest_revision numeric;
  v_candidate_count bigint;
  v_legacy_revision text;
begin
  if p_request_id is null or not exists (
    select 1 from public.requests r where r.id=p_request_id
  ) then
    return;
  end if;

  -- Do not cast an untrusted/noncanonical legacy revision. For the current
  -- numeric workflow, any unorderable proposal makes "latest" ambiguous.
  select exists (
    select 1 from public.proposals p
    where p.request_id=p_request_id
      and (p.revision is null or char_length(p.revision)>32
        or p.revision !~ '^[1-9][0-9]*$')
  ) into v_has_unorderable_revision;

  if not v_has_unorderable_revision then
    select max(p.revision::numeric) into v_latest_revision
    from public.proposals p where p.request_id=p_request_id;

    if v_latest_revision is not null then
      select count(*) into v_candidate_count
      from public.eventflow_customer_responses cr
      join public.eventflow_customer_response_actions a
        on a.response_id=cr.id
       and a.request_id=cr.request_id
       and a.source_revision=cr.revision
       and a.action_kind='selection_confirmation'
       and a.status='confirmed'
       and a.confirmed_by is not null
       and a.confirmed_at is not null
      join public.proposals p
        on p.id=cr.selected_proposal_id
       and p.request_id=cr.request_id
       and p.revision=cr.revision
       and p.status='Awaiting Customer'
      where cr.request_id=p_request_id
        and cr.response_kind='selection'
        and cr.response_status='selection_submitted'
        and (
          (cr.selected_proposal_id=cr.plan_a_id and p.plan_key='A')
          or (cr.selected_proposal_id=cr.plan_b_id and p.plan_key='B')
        )
        and p.revision::numeric=v_latest_revision
        -- Revision start locks requests before recording a queued action.
        -- Do not admit a stale confirmation while a higher revision is in flight.
        and not exists (
          select 1 from public.eventflow_customer_response_actions pending
          where pending.request_id=p_request_id
            and pending.action_kind='revision'
            and case
              when pending.status='released' then
                case
                  when char_length(pending.next_revision)<=32
                    and pending.next_revision ~ '^[1-9][0-9]*$'
                  then pending.next_revision::numeric>v_latest_revision
                  else true
                end
              when pending.status in ('queued','generating','business_review') then
                case
                  when char_length(pending.next_revision)<=32
                    and pending.next_revision ~ '^[1-9][0-9]*$'
                  then pending.next_revision::numeric>=v_latest_revision
                  else true
                end
              else true
            end
        );

      if v_candidate_count=1 then
        return query
        select p.id,cr.id,'selection'::text,p.revision
        from public.eventflow_customer_responses cr
        join public.eventflow_customer_response_actions a
          on a.response_id=cr.id
         and a.request_id=cr.request_id
         and a.source_revision=cr.revision
         and a.action_kind='selection_confirmation'
         and a.status='confirmed'
         and a.confirmed_by is not null
         and a.confirmed_at is not null
        join public.proposals p
          on p.id=cr.selected_proposal_id
         and p.request_id=cr.request_id
         and p.revision=cr.revision
         and p.status='Awaiting Customer'
        where cr.request_id=p_request_id
          and cr.response_kind='selection'
          and cr.response_status='selection_submitted'
          and (
            (cr.selected_proposal_id=cr.plan_a_id and p.plan_key='A')
            or (cr.selected_proposal_id=cr.plan_b_id and p.plan_key='B')
          )
          and p.revision::numeric=v_latest_revision
          and not exists (
            select 1 from public.eventflow_customer_response_actions pending
            where pending.request_id=p_request_id
              and pending.action_kind='revision'
              and case
                when pending.status='released' then
                  case
                    when char_length(pending.next_revision)<=32
                      and pending.next_revision ~ '^[1-9][0-9]*$'
                    then pending.next_revision::numeric>v_latest_revision
                    else true
                  end
                when pending.status in ('queued','generating','business_review') then
                  case
                    when char_length(pending.next_revision)<=32
                      and pending.next_revision ~ '^[1-9][0-9]*$'
                    then pending.next_revision::numeric>=v_latest_revision
                    else true
                  end
                else true
              end
          );
        return;
      end if;

      -- Legacy numeric acceptance is eligible for a NEW conversation only if
      -- it is the latest numeric proposal and no higher revision is in flight.
      select count(*) into v_candidate_count
      from public.proposals p
      join public.events e on e.proposal_id=p.id
      join public.requests r on r.id=p.request_id
      where p.request_id=p_request_id
        and p.revision::numeric=v_latest_revision
        and p.status='Accepted'
        and e.customer_id=r.customer_id
        and not exists (
          select 1 from public.eventflow_customer_response_actions pending
          where pending.request_id=p_request_id
            and pending.action_kind='revision'
            and case
              when pending.status='released' then
                case
                  when char_length(pending.next_revision)<=32
                    and pending.next_revision ~ '^[1-9][0-9]*$'
                  then pending.next_revision::numeric>v_latest_revision
                  else true
                end
              when pending.status in ('queued','generating','business_review') then
                case
                  when char_length(pending.next_revision)<=32
                    and pending.next_revision ~ '^[1-9][0-9]*$'
                  then pending.next_revision::numeric>=v_latest_revision
                  else true
                end
              else true
            end
        );
      if v_candidate_count=1 then
        return query
        select p.id,null::uuid,'legacy_acceptance'::text,p.revision
        from public.proposals p
        join public.events e on e.proposal_id=p.id
        join public.requests r on r.id=p.request_id
        where p.request_id=p_request_id
          and p.revision::numeric=v_latest_revision
          and p.status='Accepted'
          and e.customer_id=r.customer_id;
        return;
      end if;
    end if;
  end if;

  -- Unorderable legacy revisions are allowed only as one exact, unambiguous
  -- revision context with a single matching Accepted proposal/Event and no
  -- revision workflow history. Never sort text revisions or timestamps.
  select p.revision into v_legacy_revision
  from public.proposals p
  join public.events e on e.proposal_id=p.id
  join public.requests r on r.id=p.request_id
  where p.request_id=p_request_id
    and p.status='Accepted'
    and e.customer_id=r.customer_id
  group by p.revision
  having count(distinct p.id)=1;
  if not found
     or exists (
       select 1 from public.proposals p
       where p.request_id=p_request_id
         and p.revision is distinct from v_legacy_revision
     )
     or exists (
       select 1 from public.eventflow_customer_response_actions a
       where a.request_id=p_request_id and a.action_kind='revision'
     ) then
    return;
  end if;

  select count(*) into v_candidate_count
  from public.proposals p
  join public.events e on e.proposal_id=p.id
  join public.requests r on r.id=p.request_id
  where p.request_id=p_request_id
    and p.revision is not distinct from v_legacy_revision
    and p.status='Accepted'
    and e.customer_id=r.customer_id;
  if v_candidate_count=1 then
    return query
    select p.id,null::uuid,'legacy_acceptance'::text,p.revision
    from public.proposals p
    join public.events e on e.proposal_id=p.id
    join public.requests r on r.id=p.request_id
    where p.request_id=p_request_id
      and p.revision is not distinct from v_legacy_revision
      and p.status='Accepted'
      and e.customer_id=r.customer_id;
  end if;
end;
$fn$;

create function public.eventflow_planner_pinned_proof_is_valid(
  p_conversation_id uuid
)
returns boolean
language sql stable security definer
set search_path='' set row_security=off
as $fn$
  select exists (
    select 1
    from public.eventflow_planner_conversations c
    join public.requests r on r.id=c.request_id
    where c.id=p_conversation_id
      and (
        (
          c.eligibility_kind='selection'
          and exists (
            select 1
            from public.eventflow_customer_responses cr
            join public.eventflow_customer_response_actions a
              on a.response_id=cr.id
             and a.request_id=cr.request_id
             and a.source_revision=cr.revision
             and a.action_kind='selection_confirmation'
             and a.status='confirmed'
             and a.confirmed_by is not null
             and a.confirmed_at is not null
            join public.proposals p on p.id=c.eligibility_proposal_id
            where cr.id=c.eligibility_response_id
              and cr.request_id=r.id
              and cr.customer_id=r.customer_id
              and cr.response_kind='selection'
              and cr.response_status='selection_submitted'
              and cr.revision=c.eligibility_revision
              and cr.selected_proposal_id=c.eligibility_proposal_id
              and p.request_id=r.id
              and p.revision=c.eligibility_revision
              -- New revisions do not revoke a valid pinned confirmation.
              -- These are the accepted statuses for the original proof.
              and p.status in ('Awaiting Customer','Accepted')
              and (
                (cr.selected_proposal_id=cr.plan_a_id and p.plan_key='A')
                or (cr.selected_proposal_id=cr.plan_b_id and p.plan_key='B')
              )
          )
        )
        or (
          c.eligibility_kind='legacy_acceptance'
          and c.eligibility_response_id is null
          and exists (
            select 1
            from public.proposals p
            join public.events e on e.proposal_id=p.id
            where p.id=c.eligibility_proposal_id
              and p.request_id=r.id
              and p.revision is not distinct from c.eligibility_revision
              and p.status='Accepted'
              and e.customer_id=r.customer_id
          )
        )
      )
  );
$fn$;

-- Keep the conversation's eligibility evidence pinned even for trusted
-- service-role maintenance. This does not make message history immutable.
create function public.eventflow_planner_preserve_proof_anchor()
returns trigger
language plpgsql security invoker
set search_path=''
as $fn$
begin
  if new.id is distinct from old.id
     or new.request_id is distinct from old.request_id
     or new.eligibility_kind is distinct from old.eligibility_kind
     or new.eligibility_proposal_id is distinct from old.eligibility_proposal_id
     or new.eligibility_response_id is distinct from old.eligibility_response_id
     or new.eligibility_revision is distinct from old.eligibility_revision then
    raise exception 'Conversation eligibility proof is immutable.'
      using errcode='23514';
  end if;
  return new;
end;
$fn$;

create trigger eventflow_planner_conversations_preserve_proof_anchor
before update of id,request_id,eligibility_kind,eligibility_proposal_id,
  eligibility_response_id,eligibility_revision
on public.eventflow_planner_conversations
for each row execute function public.eventflow_planner_preserve_proof_anchor();

create function public.eventflow_planner_can_access_conversation(
  p_conversation_id uuid
)
returns boolean
language sql stable security definer
set search_path='' set row_security=off
as $fn$
  select auth.uid() is not null and exists (
    select 1
    from public.eventflow_planner_conversations c
    join public.requests r on r.id=c.request_id
    where c.id=p_conversation_id
      and public.eventflow_planner_pinned_proof_is_valid(c.id)
      and (
        (r.customer_id=auth.uid()
          and public.eventflow_response_is_customer())
        or public.eventflow_response_is_staff()
      )
  );
$fn$;

create policy eventflow_planner_conversations_read
  on public.eventflow_planner_conversations
  for select to authenticated
  using (public.eventflow_planner_can_access_conversation(id));
create policy eventflow_planner_messages_read
  on public.eventflow_planner_messages
  for select to authenticated
  using (public.eventflow_planner_can_access_conversation(conversation_id));
create policy eventflow_planner_reads_read
  on public.eventflow_planner_reads
  for select to authenticated
  using (user_id=auth.uid()
    and public.eventflow_planner_can_access_conversation(conversation_id));

create function public.eventflow_planner_open_conversation(p_request_id uuid)
returns public.eventflow_planner_conversations
language plpgsql security definer
set search_path='' set row_security=off
as $fn$
declare
  v_customer_id uuid;
  v_is_customer boolean;
  v_is_staff boolean;
  v_eligibility_proposal_id uuid;
  v_eligibility_response_id uuid;
  v_eligibility_kind text;
  v_eligibility_revision text;
  v_conversation public.eventflow_planner_conversations;
begin
  if auth.uid() is null or p_request_id is null then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  -- Reject unrelated callers before taking a request lock.
  select r.customer_id into v_customer_id
  from public.requests r where r.id=p_request_id;
  if not found then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;

  v_is_customer := v_customer_id=auth.uid()
    and public.eventflow_response_is_customer();
  v_is_staff := public.eventflow_response_is_staff();
  if not v_is_customer and not v_is_staff then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  -- Serialize eligibility and creation with revision-start/store RPCs, then
  -- repeat the ownership/approval check against the row after any wait.
  select r.customer_id into v_customer_id
  from public.requests r where r.id=p_request_id
  for update;
  if not found then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  v_is_customer := v_customer_id=auth.uid()
    and public.eventflow_response_is_customer();
  v_is_staff := public.eventflow_response_is_staff();
  if not v_is_customer and not v_is_staff then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;

  -- A prior conversation keeps its original proof; do not require its
  -- confirmation to remain the latest revision.
  select c.* into v_conversation
  from public.eventflow_planner_conversations c
  where c.request_id=p_request_id;
  if found then
    if not public.eventflow_planner_can_access_conversation(v_conversation.id) then
      raise exception 'Conversation unavailable.' using errcode='42501';
    end if;
    return v_conversation;
  end if;

  -- Only the request-owning approved Customer can create a new thread.
  if not v_is_customer then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  select eligible.eligibility_proposal_id,eligible.eligibility_response_id,
    eligible.eligibility_kind,eligible.eligibility_revision
  into v_eligibility_proposal_id,v_eligibility_response_id,
    v_eligibility_kind,v_eligibility_revision
  from public.eventflow_planner_request_is_eligible(p_request_id) eligible;
  if not found then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;

  insert into public.eventflow_planner_conversations(
    request_id,eligibility_proposal_id,eligibility_response_id,
    eligibility_kind,eligibility_revision
  ) values (
    p_request_id,v_eligibility_proposal_id,v_eligibility_response_id,
    v_eligibility_kind,v_eligibility_revision
  )
  on conflict (request_id) do nothing;

  select c.* into v_conversation
  from public.eventflow_planner_conversations c
  where c.request_id=p_request_id;
  if not found
     or not public.eventflow_planner_can_access_conversation(v_conversation.id) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  return v_conversation;
end;
$fn$;

create function public.eventflow_planner_send_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_body text
)
returns public.eventflow_planner_messages
language plpgsql security definer
set search_path='' set row_security=off
as $fn$
declare
  v_body text := btrim(coalesce(p_body,''));
  v_sender_name text;
  v_customer_id uuid;
  v_is_staff boolean;
  v_locked_conversation_id uuid;
  v_message public.eventflow_planner_messages;
begin
  if auth.uid() is null
     or p_conversation_id is null
     or p_client_message_id is null
     or char_length(v_body) not between 1 and 4000 then
    raise exception 'A valid message, conversation, and send ID are required.' using errcode='22023';
  end if;
  if not public.eventflow_planner_can_access_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  -- Serialize message insertion with read-cursor updates for this conversation.
  select c.id into v_locked_conversation_id
  from public.eventflow_planner_conversations c
  where c.id=p_conversation_id
  for update;
  if not found then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  -- Recheck approval/ownership/eligibility after waiting for the row lock.
  if not public.eventflow_planner_can_access_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  select r.customer_id into v_customer_id
  from public.eventflow_planner_conversations c
  join public.requests r on r.id=c.request_id
  where c.id=p_conversation_id;
  if not found then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  v_is_staff := public.eventflow_response_is_staff();
  -- Check only after acquiring the conversation lock and rechecking access.
  -- The Customer send and this Business check therefore cannot win a race
  -- against one another out of order.
  if v_is_staff and not exists (
    select 1 from public.eventflow_planner_messages m
    where m.conversation_id=p_conversation_id
      and m.sender_id=v_customer_id
  ) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;

  -- Resolve retries BEFORE the INSERT trigger allocates an order. All writers
  -- serialize on this conversation, so concurrent same-key sends return one row.
  select m.* into v_message
  from public.eventflow_planner_messages m
  where m.conversation_id=p_conversation_id
    and m.sender_id=auth.uid()
    and m.client_message_id=p_client_message_id;
  if found then
    if v_message.body is distinct from v_body then
      raise exception 'The message send ID was already used for different text.' using errcode='23505';
    end if;
    return v_message;
  end if;

  select coalesce(
    nullif(left(btrim(p.full_name),200),''),
    case when v_is_staff
      then 'EventFlow Business' else 'Customer' end
  ) into v_sender_name
  from public.profiles p where p.id=auth.uid();
  if not found then
    raise exception 'The sender profile is unavailable.' using errcode='42501';
  end if;

  insert into public.eventflow_planner_messages(
    conversation_id,sender_id,sender_display_name,client_message_id,body
  ) values (
    p_conversation_id,auth.uid(),v_sender_name,p_client_message_id,v_body
  )
  returning * into v_message;

  return v_message;
end;
$fn$;

create function public.eventflow_planner_mark_read(
  p_conversation_id uuid,
  p_last_seen_seq bigint
)
returns void
language plpgsql security definer
set search_path='' set row_security=off
as $fn$
declare
  v_latest_seq bigint;
begin
  if auth.uid() is null
     or not public.eventflow_planner_can_access_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  if p_last_seen_seq is null or p_last_seen_seq<0 then
    raise exception 'A valid displayed-message cursor is required.' using errcode='22023';
  end if;
  select c.last_message_seq into v_latest_seq
  from public.eventflow_planner_conversations c
  where c.id=p_conversation_id
  for update;
  if not found then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  if not public.eventflow_planner_can_access_conversation(p_conversation_id) then
    raise exception 'Conversation unavailable.' using errcode='42501';
  end if;
  -- The caller supplies the highest contiguous order actually displayed, not
  -- the server's current tip. Never acknowledge later arrivals automatically.
  if p_last_seen_seq>v_latest_seq
     or (p_last_seen_seq>0 and not exists (
       select 1 from public.eventflow_planner_messages m
       where m.conversation_id=p_conversation_id
         and m.message_seq=p_last_seen_seq
     )) then
    raise exception 'The displayed-message cursor is unavailable.' using errcode='22023';
  end if;

  insert into public.eventflow_planner_reads as existing_read(
    conversation_id,user_id,last_read_at,last_read_seq
  )
  values (p_conversation_id,auth.uid(),clock_timestamp(),p_last_seen_seq)
  on conflict (conversation_id,user_id)
  do update set
    last_read_at=excluded.last_read_at,
    last_read_seq=greatest(
      existing_read.last_read_seq,excluded.last_read_seq
    );
end;
$fn$;

create function public.eventflow_planner_business_inbox()
returns table(
  conversation_id uuid,
  request_id uuid,
  customer_name text,
  event_name text,
  latest_message text,
  latest_sender_name text,
  latest_message_at timestamptz,
  unread_count bigint
)
language plpgsql security definer
set search_path='' set row_security=off
as $fn$
begin
  if auth.uid() is null or not public.eventflow_response_is_staff() then
    raise exception 'Approved Business staff required.' using errcode='42501';
  end if;
  return query
  select c.id,c.request_id,coalesce(r.customer_name,'Customer'),r.event_name,
    latest.body,latest.sender_display_name,latest.created_at,
    (
      select count(*)::bigint
      from public.eventflow_planner_messages unread
      where unread.conversation_id=c.id
        and unread.sender_id<>auth.uid()
        and unread.message_seq>coalesce(read_state.last_read_seq,0)
    )
  from public.eventflow_planner_conversations c
  join public.requests r on r.id=c.request_id
  left join public.eventflow_planner_reads read_state
    on read_state.conversation_id=c.id and read_state.user_id=auth.uid()
  left join lateral (
    select m.body,m.sender_display_name,m.created_at
    from public.eventflow_planner_messages m
    where m.conversation_id=c.id
    order by m.message_seq desc
    limit 1
  ) latest on true
  where latest.created_at is not null
    and public.eventflow_planner_can_access_conversation(c.id)
  -- This only sorts independent inbox threads for display. Message ordering
  -- and unread correctness never compare UUIDs or wall-clock timestamps.
  order by latest.created_at desc;
end;
$fn$;

-- Functions default to PUBLIC EXECUTE unless explicitly revoked.
revoke all on function public.eventflow_planner_request_is_eligible(uuid)
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_pinned_proof_is_valid(uuid)
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_preserve_proof_anchor()
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_can_access_conversation(uuid)
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_open_conversation(uuid)
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_send_message(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_mark_read(uuid,bigint)
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_business_inbox()
  from public,anon,authenticated;
revoke all on function public.eventflow_planner_assign_message_order()
  from public,anon,authenticated;
grant execute on function public.eventflow_planner_can_access_conversation(uuid)
  to authenticated;
grant execute on function public.eventflow_planner_open_conversation(uuid)
  to authenticated;
grant execute on function public.eventflow_planner_send_message(uuid,uuid,text)
  to authenticated;
grant execute on function public.eventflow_planner_mark_read(uuid,bigint)
  to authenticated;
grant execute on function public.eventflow_planner_business_inbox()
  to authenticated;

do $realtime$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='eventflow_planner_messages'
  ) then
    alter publication supabase_realtime
      add table public.eventflow_planner_messages;
  end if;
end;
$realtime$;

do $postflight$
declare
  v_routine record;
begin
  -- Check argument names/modes too: PostgREST RPC arguments and table-return
  -- column names are part of the API contract, not just regprocedure types.
  for v_routine in
    select expected.*,p.oid,p.prorettype,p.proretset,p.provolatile,
      p.prosecdef,p.proconfig,p.proowner,p.proacl,
      p.proargnames::text as actual_arg_names,
      p.proargmodes::text as actual_arg_modes
    from (values
      ('public.eventflow_planner_assign_message_order()','trigger',false,'v',null::text,null::text),
      ('public.eventflow_planner_request_is_eligible(uuid)','record',true,'s',
        '{p_request_id,eligibility_proposal_id,eligibility_response_id,eligibility_kind,eligibility_revision}',
        '{i,t,t,t,t}'),
      ('public.eventflow_planner_pinned_proof_is_valid(uuid)','boolean',false,'s',
        '{p_conversation_id}','{i}'),
      ('public.eventflow_planner_can_access_conversation(uuid)','boolean',false,'s',
        '{p_conversation_id}','{i}'),
      ('public.eventflow_planner_open_conversation(uuid)','public.eventflow_planner_conversations',false,'v',
        '{p_request_id}','{i}'),
      ('public.eventflow_planner_send_message(uuid,uuid,text)','public.eventflow_planner_messages',false,'v',
        '{p_conversation_id,p_client_message_id,p_body}','{i,i,i}'),
      ('public.eventflow_planner_mark_read(uuid,bigint)','void',false,'v',
        '{p_conversation_id,p_last_seen_seq}','{i,i}'),
      ('public.eventflow_planner_business_inbox()','record',true,'v',
        '{conversation_id,request_id,customer_name,event_name,latest_message,latest_sender_name,latest_message_at,unread_count}',
        '{t,t,t,t,t,t,t,t}')
    ) expected(signature,result_type,returns_set,volatility,arg_names,arg_modes)
    left join pg_catalog.pg_proc p
      on p.oid=to_regprocedure(expected.signature)
  loop
    if v_routine.oid is null
       or v_routine.prorettype is distinct from to_regtype(v_routine.result_type)::oid
       or v_routine.proretset is distinct from v_routine.returns_set
       or v_routine.provolatile::text is distinct from v_routine.volatility
       or v_routine.actual_arg_names is distinct from v_routine.arg_names
       or v_routine.actual_arg_modes is distinct from v_routine.arg_modes
       or v_routine.prosecdef is distinct from true
       or v_routine.proowner is distinct from (current_user::regrole)::oid
       or v_routine.proconfig is distinct from array['search_path=""','row_security=off']::text[]
       or exists (
         select 1 from aclexplode(
           coalesce(v_routine.proacl,acldefault('f',v_routine.proowner))
         ) acl where acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'Messaging routine catalog contract failed: %',v_routine.signature;
    end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid='public.eventflow_planner_preserve_proof_anchor()'::regprocedure
      and p.prorettype='trigger'::regtype
      and p.provolatile='v'
      and p.prosecdef is false
      and p.proowner=(current_user::regrole)::oid
      and p.proconfig=array['search_path=""']::text[]
      and not has_function_privilege(
        'authenticated','public.eventflow_planner_preserve_proof_anchor()','EXECUTE')
      and not has_function_privilege(
        'anon','public.eventflow_planner_preserve_proof_anchor()','EXECUTE')
      and not exists (
        select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'
      )
  ) then
    raise exception 'Pinned-proof trigger function security contract failed.';
  end if;
  if not (
    (select relrowsecurity from pg_catalog.pg_class
      where oid='public.eventflow_planner_conversations'::regclass)
    and (select relrowsecurity from pg_catalog.pg_class
      where oid='public.eventflow_planner_messages'::regclass)
    and (select relrowsecurity from pg_catalog.pg_class
      where oid='public.eventflow_planner_reads'::regclass)
  ) then
    raise exception 'RLS was not enabled on all planner messaging tables.';
  end if;
  if not exists (
       select 1 from pg_catalog.pg_constraint con
       where con.conrelid='public.eventflow_planner_conversations'::regclass
         and con.conname='eventflow_planner_conversations_eligibility_anchor'
         and con.contype='c' and con.convalidated
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint con
       where con.conrelid='public.eventflow_planner_conversations'::regclass
         and con.contype='f'
         and con.confrelid='public.proposals'::regclass
         and pg_get_constraintdef(con.oid) like
           'FOREIGN KEY (eligibility_proposal_id) REFERENCES public.proposals(id)%'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint con
       where con.conrelid='public.eventflow_planner_conversations'::regclass
         and con.contype='f'
         and con.confrelid='public.eventflow_customer_responses'::regclass
         and pg_get_constraintdef(con.oid) like
           'FOREIGN KEY (eligibility_response_id) REFERENCES public.eventflow_customer_responses(id)%'
     ) then
    raise exception 'Pinned conversation eligibility constraints are missing.';
  end if;
  if has_table_privilege('anon','public.eventflow_planner_conversations','SELECT')
     or has_table_privilege('anon','public.eventflow_planner_messages','SELECT')
     or has_table_privilege('anon','public.eventflow_planner_reads','SELECT')
     or not has_table_privilege('authenticated','public.eventflow_planner_conversations','SELECT')
     or not has_table_privilege('authenticated','public.eventflow_planner_messages','SELECT')
     or not has_table_privilege('authenticated','public.eventflow_planner_reads','SELECT')
     or exists (
       select 1
       from (values
         ('anon','public.eventflow_planner_conversations'),
         ('anon','public.eventflow_planner_messages'),
         ('anon','public.eventflow_planner_reads'),
         ('authenticated','public.eventflow_planner_conversations'),
         ('authenticated','public.eventflow_planner_messages'),
         ('authenticated','public.eventflow_planner_reads')
       ) target(role_name,relation_name)
       cross join (values
         ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')
       ) privilege(privilege_name)
       where has_table_privilege(target.role_name,target.relation_name,privilege.privilege_name)
     ) then
    raise exception 'Messaging table grants do not match the least-privilege design.';
  end if;
  if not has_table_privilege('service_role','public.eventflow_planner_conversations','SELECT')
     or not has_table_privilege('service_role','public.eventflow_planner_conversations','INSERT')
     or not has_table_privilege('service_role','public.eventflow_planner_conversations','UPDATE')
     or not has_table_privilege('service_role','public.eventflow_planner_conversations','DELETE')
     or not has_table_privilege('service_role','public.eventflow_planner_messages','SELECT')
     or not has_table_privilege('service_role','public.eventflow_planner_messages','INSERT')
     or not has_table_privilege('service_role','public.eventflow_planner_messages','UPDATE')
     or not has_table_privilege('service_role','public.eventflow_planner_messages','DELETE')
     or not has_table_privilege('service_role','public.eventflow_planner_reads','SELECT')
     or not has_table_privilege('service_role','public.eventflow_planner_reads','INSERT')
     or not has_table_privilege('service_role','public.eventflow_planner_reads','UPDATE')
     or not has_table_privilege('service_role','public.eventflow_planner_reads','DELETE') then
    raise exception 'Trusted service_role CRUD access was not granted to the new messaging tables.';
  end if;
  if (select count(*) from pg_catalog.pg_policies
      where schemaname='public'
        and tablename in (
          'eventflow_planner_conversations',
          'eventflow_planner_messages',
          'eventflow_planner_reads'
        ))<>3 or exists (
          select 1 from pg_catalog.pg_policies
          where schemaname='public'
            and tablename in (
              'eventflow_planner_conversations',
              'eventflow_planner_messages',
              'eventflow_planner_reads'
            )
            and (cmd<>'SELECT' or roles is distinct from array['authenticated']::name[]
              or permissive<>'PERMISSIVE' or qual is null or with_check is not null)
        ) then
    raise exception 'Unexpected messaging RLS policy set; rolling back.';
  end if;
  if not has_function_privilege(
       'authenticated','public.eventflow_planner_can_access_conversation(uuid)','EXECUTE')
     or not has_function_privilege(
       'authenticated','public.eventflow_planner_open_conversation(uuid)','EXECUTE')
     or not has_function_privilege(
       'authenticated','public.eventflow_planner_send_message(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege(
        'authenticated','public.eventflow_planner_mark_read(uuid,bigint)','EXECUTE')
     or not has_function_privilege(
       'authenticated','public.eventflow_planner_business_inbox()','EXECUTE')
     or has_function_privilege(
       'authenticated','public.eventflow_planner_request_is_eligible(uuid)','EXECUTE')
      or has_function_privilege(
        'authenticated','public.eventflow_planner_pinned_proof_is_valid(uuid)','EXECUTE')
      or has_function_privilege(
        'authenticated','public.eventflow_planner_assign_message_order()','EXECUTE')
     or has_function_privilege(
       'anon','public.eventflow_planner_can_access_conversation(uuid)','EXECUTE')
     or has_function_privilege(
       'anon','public.eventflow_planner_open_conversation(uuid)','EXECUTE')
     or has_function_privilege(
       'anon','public.eventflow_planner_send_message(uuid,uuid,text)','EXECUTE')
     or has_function_privilege(
        'anon','public.eventflow_planner_mark_read(uuid,bigint)','EXECUTE')
     or has_function_privilege(
       'anon','public.eventflow_planner_business_inbox()','EXECUTE')
     or has_function_privilege(
        'anon','public.eventflow_planner_request_is_eligible(uuid)','EXECUTE')
      or has_function_privilege(
        'anon','public.eventflow_planner_pinned_proof_is_valid(uuid)','EXECUTE')
      or has_function_privilege(
        'anon','public.eventflow_planner_assign_message_order()','EXECUTE') then
    raise exception 'Messaging RPC EXECUTE grants do not match the authenticated-only design.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.eventflow_planner_messages'::regclass
      and t.tgname='eventflow_planner_messages_assign_order'
      and t.tgfoid='public.eventflow_planner_assign_message_order()'::regprocedure
      and not t.tgisinternal
      and t.tgenabled='O'
      and t.tgtype=7 -- ROW | BEFORE | INSERT
  ) then
    raise exception 'The mandatory message-order trigger is missing or disabled.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.eventflow_planner_conversations'::regclass
      and t.tgname='eventflow_planner_conversations_preserve_proof_anchor'
      and t.tgfoid='public.eventflow_planner_preserve_proof_anchor()'::regprocedure
      and not t.tgisinternal
      and t.tgenabled='O'
      and t.tgtype=19 -- ROW | BEFORE | UPDATE
  ) then
    raise exception 'The conversation proof-anchor protection trigger is missing.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='eventflow_planner_messages'
  ) then
    raise exception 'Planner messages were not added to supabase_realtime.';
  end if;
end;
$postflight$;

notify pgrst,'reload schema';
commit;
