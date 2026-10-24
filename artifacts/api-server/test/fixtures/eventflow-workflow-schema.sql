-- Synthetic schema for a disposable LOCAL database only; no real customer data.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table public.profiles(id uuid primary key, role text, account_type text, approval_status text);
create table public.requests(
  id uuid primary key, customer_id uuid, customer_name text, event_name text,
  event_date date, event_type text, budget numeric, event_time time, venue_id uuid,
  event_end_time time, status text default 'New'
);
create table public.proposals(
  id uuid primary key default gen_random_uuid(), request_id uuid references public.requests(id),
  customer_name text, event_name text, event_date date, event_type text, budget numeric,
  event_time time, venue_id uuid, event_end_time time, revision text, recommendation text,
  status text, plan_key text, plan_content jsonb
);
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'), ('00000000-0000-4000-8000-000000000003');
insert into public.profiles values
 ('00000000-0000-4000-8000-000000000001', 'customer', 'customer', 'approved'),
 ('00000000-0000-4000-8000-000000000002', 'customer', 'customer', 'approved'),
 ('00000000-0000-4000-8000-000000000003', 'staff', 'business', 'approved');
insert into public.requests(id, customer_id, event_name) values
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Existing'),
 ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'New');
insert into public.proposals(id, request_id, revision, status, plan_key, plan_content) values
 ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '1', 'Awaiting Customer', 'A', '{"id":"A","title":"A","costBreakdown":[],"totalEstimatedMYR":100}'),
 ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '1', 'Awaiting Customer', 'B', '{"id":"B","title":"B","costBreakdown":[],"totalEstimatedMYR":200}');
