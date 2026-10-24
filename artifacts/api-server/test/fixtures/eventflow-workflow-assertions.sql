\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
do $$
declare s public.eventflow_plan_selections;
begin
  s := public.eventflow_select_plan('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
  assert s.plan_key = 'A' and s.decision = 'pending', 'Selection must persist';
  assert (select count(*) from public.eventflow_plan_selections) = 1, 'Exactly one plan is selected';
  begin
    perform public.eventflow_review_plan(s.request_id, s.proposal_id, s.selected_at, 'approved', '');
    raise exception 'Customer was allowed to approve!';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
do $$
begin
  assert (select count(*) from public.eventflow_plan_selections) = 0, 'Customer must not read another customer selection';
  begin
    perform public.eventflow_select_plan('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');
    raise exception 'Other customer was allowed to select!';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
do $$
declare s public.eventflow_plan_selections;
begin
  select * into strict s from public.eventflow_plan_selections;
  begin
    perform public.eventflow_review_plan(s.request_id, s.proposal_id, s.selected_at, 'changes_requested', ' ');
    raise exception 'Blank change message was accepted!';
  exception when raise_exception then
    if sqlerrm = 'Blank change message was accepted!' then raise; end if;
  end;
  s := public.eventflow_review_plan(s.request_id, s.proposal_id, s.selected_at, 'changes_requested', 'Please reduce catering cost.');
  assert s.message = 'Please reduce catering cost.' and s.decision = 'changes_requested';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
do $$
declare s public.eventflow_plan_selections;
begin
  select * into strict s from public.eventflow_plan_selections;
  assert s.message = 'Please reduce catering cost.', 'Customer must see staff message';
  s := public.eventflow_select_plan(s.request_id, '20000000-0000-4000-8000-000000000002');
  assert s.plan_key = 'B' and s.decision = 'pending', 'Resubmission must select exactly Plan B';
  assert (select count(*) from public.eventflow_plan_selections) = 1;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
do $$
declare s public.eventflow_plan_selections;
begin
  select * into strict s from public.eventflow_plan_selections;
  begin
    perform public.eventflow_review_plan(s.request_id, '20000000-0000-4000-8000-000000000001', s.selected_at, 'approved', '');
    raise exception 'Unselected plan was approved!';
  exception when raise_exception then
    if sqlerrm = 'Unselected plan was approved!' then raise; end if;
  end;
  s := public.eventflow_review_plan(s.request_id, s.proposal_id, s.selected_at, 'approved', 'Plan B looks good.');
  assert s.plan_key = 'B' and s.decision = 'approved';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
do $$
declare result jsonb;
begin
  assert public.eventflow_claim_generation('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001');
  assert not public.eventflow_claim_generation('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002'), 'Concurrent generation must be blocked';
  result := public.eventflow_persist_proposal_pair(
    '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    1, 'Choose A', '{}',
    '[{"id":"A","title":"A","costBreakdown":[],"totalEstimatedMYR":100},{"id":"B","title":"B","costBreakdown":[],"totalEstimatedMYR":200}]',
    '30000000-0000-4000-8000-000000000001'
  );
  assert result->>'status' = 'created' and jsonb_array_length(result->'proposals') = 2;
  result := public.eventflow_persist_proposal_pair(
    '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    1, 'Must not overwrite', '{}', '[]', '30000000-0000-4000-8000-000000000001'
  );
  assert result->>'status' = 'existing', 'Retries must return existing proposals';
  assert result->'proposals'->0->>'recommendation' = 'Choose A', 'Saved recommendation must not be overwritten';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.proposals) = 4;
  assert (select count(*) from public.proposals where status = 'Awaiting Customer') = 2, 'Old proposal statuses must not change';
  assert (select plan_content->>'totalEstimatedMYR' from public.proposals where id = '20000000-0000-4000-8000-000000000001') = '100';
  assert (select status from public.requests where id = '10000000-0000-4000-8000-000000000001') = 'New', 'Original request must not change';
end $$;
\echo 'Workflow SQL assertions passed: ownership, RLS, selection, single-plan review, messages, leases, insert-only persistence.'
