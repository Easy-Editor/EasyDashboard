create table app.agent_run_dispatches (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references app.projects(id) on delete cascade,
  conversation_id text not null check (char_length(conversation_id) between 1 and 160),
  task_id text not null check (char_length(task_id) between 1 and 160),
  operation_id text not null check (char_length(operation_id) between 1 and 200),
  state text not null default 'queued'
    check (state in ('queued', 'running', 'paused', 'succeeded', 'failed', 'canceled', 'indeterminate')),
  desired_state text not null default 'running'
    check (desired_state in ('running', 'paused', 'canceled')),
  generation integer not null default 0 check (generation >= 0),
  lease_owner text,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, operation_id),
  check ((lease_owner is null) = (lease_until is null)),
  check (state not in ('succeeded', 'failed', 'canceled', 'indeterminate') or completed_at is not null)
);

create index agent_run_dispatches_project_task_idx
  on app.agent_run_dispatches(project_id, task_id, created_at desc);
create index agent_run_dispatches_claim_idx
  on app.agent_run_dispatches(desired_state, state, lease_until, created_at);

alter table app.agent_run_dispatches enable row level security;
alter table app.agent_run_dispatches force row level security;

create policy agent_run_dispatches_member_select
  on app.agent_run_dispatches
  for select
  to easy_dashboard_runtime
  using (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
  );

create policy agent_run_dispatches_member_insert
  on app.agent_run_dispatches
  for insert
  to easy_dashboard_runtime
  with check (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
  );

create policy agent_run_dispatches_member_update
  on app.agent_run_dispatches
  for update
  to easy_dashboard_runtime
  using (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
  )
  with check (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
  );

grant select, insert, update on app.agent_run_dispatches to easy_dashboard_runtime;

create function app.claim_agent_run_dispatch(
  claim_worker_id text,
  claim_now timestamptz,
  claim_lease_until timestamptz
)
returns setof app.agent_run_dispatches
language plpgsql
security definer
set search_path = ''
as $$
declare
  canceled_dispatch record;
  durable_operation_status text;
  reconciled_dispatch_state text;
  canceled_before_terminal boolean;
begin
  if nullif(btrim(claim_worker_id), '') is null then
    raise exception 'claim worker id is required';
  end if;
  if claim_lease_until <= claim_now then
    raise exception 'claim lease must end after claim time';
  end if;

  update app.agent_run_dispatches as dispatch
  set
    state = 'paused',
    lease_owner = null,
    lease_until = null,
    updated_at = claim_now
  where dispatch.state = 'running'
    and dispatch.desired_state = 'paused'
    and dispatch.lease_until <= claim_now;

  for canceled_dispatch in
    select
      dispatch.id,
      dispatch.actor_id,
      dispatch.project_id,
      dispatch.operation_id
    from app.agent_run_dispatches as dispatch
    where dispatch.state = 'running'
      and dispatch.desired_state = 'canceled'
      and dispatch.lease_until <= claim_now
    order by dispatch.created_at, dispatch.id
    for update of dispatch skip locked
  loop
    durable_operation_status := null;
    canceled_before_terminal := false;

    select operation.status
    into durable_operation_status
    from app.agent_spike_operations as operation
    where operation.actor_id = canceled_dispatch.actor_id
      and operation.project_id = canceled_dispatch.project_id
      and operation.operation_id = canceled_dispatch.operation_id
    for update of operation;

    if durable_operation_status in ('issued', 'prepared') then
      update app.agent_spike_operations as operation
      set
        status = 'failed_not_applied',
        outcome = pg_catalog.jsonb_build_object(
          'status', 'failed_not_applied',
          'reason', 'user_canceled'
        ),
        completed_at = claim_now,
        updated_at = claim_now
      where operation.actor_id = canceled_dispatch.actor_id
        and operation.project_id = canceled_dispatch.project_id
        and operation.operation_id = canceled_dispatch.operation_id
        and operation.status = durable_operation_status;

      durable_operation_status := 'failed_not_applied';
      canceled_before_terminal := true;
    end if;

    reconciled_dispatch_state := case
      when canceled_before_terminal then 'canceled'
      when durable_operation_status = 'committed' then 'succeeded'
      when durable_operation_status in ('rejected_stale', 'failed_not_applied') then 'failed'
      when durable_operation_status = 'indeterminate' then 'indeterminate'
      else 'indeterminate'
    end;

    update app.agent_run_dispatches as dispatch
    set
      state = reconciled_dispatch_state,
      lease_owner = null,
      lease_until = null,
      error_code = case
        when reconciled_dispatch_state = 'indeterminate' then 'operation_state_indeterminate'
        else dispatch.error_code
      end,
      error_message = case
        when reconciled_dispatch_state = 'indeterminate' then 'Durable operation state could not be reconciled'
        else dispatch.error_message
      end,
      completed_at = claim_now,
      updated_at = claim_now
    where dispatch.id = canceled_dispatch.id;
  end loop;

  return query
  with candidate as (
    select dispatch.id
    from app.agent_run_dispatches as dispatch
    where dispatch.desired_state = 'running'
      and (
        dispatch.state = 'queued'
        or (
          dispatch.state = 'running'
          and dispatch.lease_until <= claim_now
        )
      )
      and not exists (
        select 1
        from app.agent_run_dispatches as active
        where active.project_id = dispatch.project_id
          and active.state = 'running'
          and active.lease_until > claim_now
      )
      and pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended(dispatch.project_id::text, 683217441)
      )
    order by dispatch.created_at, dispatch.id
    for update of dispatch skip locked
    limit 1
  )
  update app.agent_run_dispatches as dispatch
  set
    state = 'running',
    generation = dispatch.generation + 1,
    lease_owner = claim_worker_id,
    lease_until = claim_lease_until,
    heartbeat_at = claim_now,
    attempt_count = dispatch.attempt_count + 1,
    error_code = null,
    error_message = null,
    completed_at = null,
    updated_at = claim_now
  from candidate
  where dispatch.id = candidate.id
  returning dispatch.*;
end;
$$;

revoke all on function app.claim_agent_run_dispatch(text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_agent_run_dispatch(text, timestamptz, timestamptz) to easy_dashboard_runtime;

comment on function app.claim_agent_run_dispatch(text, timestamptz, timestamptz) is
  'Reconciles expired control requests and claims at most one active writer per project with durable lease fencing.';
