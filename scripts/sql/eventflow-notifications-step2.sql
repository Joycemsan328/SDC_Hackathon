-- EventFlow notifications, Step 2: storage and access rules only.
-- REVIEW ONLY. Do not execute until the migration and target project have
-- been explicitly approved. This file creates no event triggers or history.
--
-- Shared-team model: approved Business staff/admins can read the same immutable
-- events; each authenticated staff member has an independent read state.
-- Step 3 writers must be trusted database-side mechanisms and must use
-- deterministic idempotency keys. Do not grant event writes to client roles.

begin;

do $preflight$
declare
  v_staff_oid oid;
  v_staff_return_type oid;
begin
  if to_regclass('public.notification_events') is not null
     or to_regclass('public.notification_reads') is not null then
    raise exception
      'Notification table already exists. Inspect its schema and prepare an upgrade instead of rerunning this install.';
  end if;

  if to_regclass('public.requests') is null
     or to_regclass('public.proposals') is null
     or to_regclass('auth.users') is null then
    raise exception
      'Required requests, proposals, or auth.users relation is missing; no notification objects were created.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'requests'
      and column_name = 'id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'proposals'
      and column_name = 'id' and data_type = 'uuid'
  ) then
    raise exception
      'Expected UUID primary-key columns were not found on requests and proposals.';
  end if;

  v_staff_oid := to_regprocedure('public.is_staff()');
  if v_staff_oid is null then
    raise exception
      'public.is_staff() is required. Review the staff predicate before installing notification policies.';
  end if;

  select p.prorettype into v_staff_return_type
  from pg_proc p
  where p.oid = v_staff_oid;
  if v_staff_return_type <> 'boolean'::regtype then
    raise exception 'public.is_staff() must return boolean.';
  end if;

  if not has_function_privilege('authenticated', v_staff_oid, 'EXECUTE') then
    raise exception
      'authenticated lacks EXECUTE on public.is_staff(); review existing grants rather than changing them implicitly.';
  end if;
end;
$preflight$;

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null
    check (notification_type in (
      'new_request',
      'request_updated',
      'proposal_pending_business_review',
      'customer_change_requested',
      'customer_plan_confirmed'
    )),
  title text not null
    check (char_length(btrim(title)) between 1 and 200),
  message text not null
    check (char_length(btrim(message)) between 1 and 2000),
  request_id uuid references public.requests(id) on delete set null,
  proposal_id uuid references public.proposals(id) on delete set null,
  destination_route text not null
    check (
      destination_route in ('/requests', '/proposals', '/approvals', '/events')
      or destination_route ~*
        '^/(requests|proposals|events)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  event_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null unique
    check (char_length(btrim(idempotency_key)) between 1 and 200)
);

create index notification_events_event_at_idx
  on public.notification_events (event_at desc, id desc);
create index notification_events_request_idx
  on public.notification_events (request_id, event_at desc)
  where request_id is not null;
create index notification_events_proposal_idx
  on public.notification_events (proposal_id, event_at desc)
  where proposal_id is not null;

create table public.notification_reads (
  notification_event_id uuid not null
    references public.notification_events(id) on delete cascade,
  recipient_user_id uuid not null
    references auth.users(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  constraint notification_reads_event_user_pk
    primary key (notification_event_id, recipient_user_id)
);

create index notification_reads_user_event_idx
  on public.notification_reads (recipient_user_id, notification_event_id);

alter table public.notification_events enable row level security;
alter table public.notification_reads enable row level security;

-- Events are immutable to API clients. No INSERT/UPDATE/DELETE policy is
-- defined; Step 3 will add only a trusted trigger-side writer.
create policy notification_events_select_staff
  on public.notification_events
  for select to authenticated
  using ((select public.is_staff()));

-- The unique pair means one user's read state cannot affect another staff
-- member's unread state. The auth.uid() checks prevent recipient spoofing.
create policy notification_reads_select_own_staff
  on public.notification_reads
  for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and (select public.is_staff())
  );

create policy notification_reads_insert_own_staff
  on public.notification_reads
  for insert to authenticated
  with check (
    recipient_user_id = (select auth.uid())
    and (select public.is_staff())
  );

-- Revoke API access first, then grant only the operations required by the UI.
-- Preserve Supabase's existing service_role/default privileges. No service_role
-- grant or revoke is issued here.
revoke all privileges on table public.notification_events
  from PUBLIC, anon, authenticated;
revoke all privileges on table public.notification_reads
  from PUBLIC, anon, authenticated;

grant select on table public.notification_events to authenticated;
grant select, insert on table public.notification_reads to authenticated;

-- Fail closed if project-level default ACLs do not preserve the expected
-- client restrictions or trusted service_role CRUD access. This block does
-- not grant or revoke any service_role privilege.
do $acl_check$
begin
  if has_table_privilege('anon', 'public.notification_events', 'SELECT')
     or has_table_privilege('anon', 'public.notification_events', 'INSERT')
     or has_table_privilege('anon', 'public.notification_events', 'UPDATE')
     or has_table_privilege('anon', 'public.notification_events', 'DELETE')
     or has_table_privilege('anon', 'public.notification_reads', 'SELECT')
     or has_table_privilege('anon', 'public.notification_reads', 'INSERT')
     or has_table_privilege('anon', 'public.notification_reads', 'UPDATE')
     or has_table_privilege('anon', 'public.notification_reads', 'DELETE') then
    raise exception 'anon still has effective access to notification tables; transaction rolled back.';
  end if;

  if not has_table_privilege('authenticated', 'public.notification_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.notification_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.notification_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.notification_events', 'DELETE')
     or not has_table_privilege('authenticated', 'public.notification_reads', 'SELECT')
     or not has_table_privilege('authenticated', 'public.notification_reads', 'INSERT')
     or has_table_privilege('authenticated', 'public.notification_reads', 'UPDATE')
     or has_table_privilege('authenticated', 'public.notification_reads', 'DELETE') then
    raise exception 'Authenticated notification grants do not match the approved read/insert-only matrix; transaction rolled back.';
  end if;

  if not has_table_privilege('service_role', 'public.notification_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.notification_events', 'INSERT')
     or not has_table_privilege('service_role', 'public.notification_events', 'UPDATE')
     or not has_table_privilege('service_role', 'public.notification_events', 'DELETE')
     or not has_table_privilege('service_role', 'public.notification_reads', 'SELECT')
     or not has_table_privilege('service_role', 'public.notification_reads', 'INSERT')
     or not has_table_privilege('service_role', 'public.notification_reads', 'UPDATE')
     or not has_table_privilege('service_role', 'public.notification_reads', 'DELETE') then
    raise exception 'Standard service_role CRUD access was not preserved by project defaults; transaction rolled back.';
  end if;
end;
$acl_check$;

commit;
