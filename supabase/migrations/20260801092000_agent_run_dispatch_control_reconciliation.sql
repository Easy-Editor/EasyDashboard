create or replace function app.claim_agent_run_dispatch(
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
  controlled_dispatch record;
  durable_operation_status text;
  reconciled_dispatch_state text;
begin
  if nullif(btrim(claim_worker_id), '') is null then
    raise exception 'claim worker id is required';
  end if;
  if claim_lease_until <= claim_now then
    raise exception 'claim lease must end after claim time';
  end if;

  for controlled_dispatch in
    select
      dispatch.id,
      dispatch.actor_id,
      dispatch.project_id,
      dispatch.operation_id,
      dispatch.desired_state
    from app.agent_run_dispatches as dispatch
    where dispatch.state = 'running'
      and dispatch.desired_state in ('paused', 'canceled')
      and dispatch.lease_until <= claim_now
    order by dispatch.created_at, dispatch.id
    for update of dispatch skip locked
  loop
    durable_operation_status := null;

    select operation.status
    into durable_operation_status
    from app.agent_spike_operations as operation
    where operation.actor_id = controlled_dispatch.actor_id
      and operation.project_id = controlled_dispatch.project_id
      and operation.operation_id = controlled_dispatch.operation_id
    for update of operation;

    if durable_operation_status in ('issued', 'prepared') then
      if controlled_dispatch.desired_state = 'canceled' then
        update app.agent_spike_operations as operation
        set
          status = 'failed_not_applied',
          outcome = pg_catalog.jsonb_build_object(
            'status', 'failed_not_applied',
            'reason', 'user_canceled'
          ),
          completed_at = claim_now,
          updated_at = claim_now
        where operation.actor_id = controlled_dispatch.actor_id
          and operation.project_id = controlled_dispatch.project_id
          and operation.operation_id = controlled_dispatch.operation_id
          and operation.status = durable_operation_status;

        reconciled_dispatch_state := 'canceled';
      else
        reconciled_dispatch_state := 'paused';
      end if;
    else
      reconciled_dispatch_state := case
        when durable_operation_status = 'committed' then 'succeeded'
        when durable_operation_status in ('rejected_stale', 'failed_not_applied') then 'failed'
        when durable_operation_status = 'indeterminate' then 'indeterminate'
        else 'indeterminate'
      end;
    end if;

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
      completed_at = case
        when reconciled_dispatch_state = 'paused' then null
        else claim_now
      end,
      updated_at = claim_now
    where dispatch.id = controlled_dispatch.id;
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
  'Reconciles expired control requests against durable operation state and claims at most one active writer per project with lease fencing.';
