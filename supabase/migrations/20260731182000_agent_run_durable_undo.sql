alter table app.agent_spike_operations
  add column rolled_back_at timestamptz,
  add column rollback_receipt jsonb,
  add constraint agent_spike_operations_durable_undo_check check (
    (rolled_back_at is null and rollback_receipt is null)
    or (status = 'committed' and rolled_back_at is not null and rollback_receipt is not null)
  );

create or replace function app.guard_agent_spike_operation_update()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('committed', 'rejected_stale', 'failed_not_applied', 'indeterminate') then
    if old.status = 'committed'
      and old.rolled_back_at is null
      and old.rollback_receipt is null
      and new.rolled_back_at is not null
      and new.rollback_receipt is not null
      and (to_jsonb(new) - 'rolled_back_at' - 'rollback_receipt' - 'updated_at')
        = (to_jsonb(old) - 'rolled_back_at' - 'rollback_receipt' - 'updated_at')
    then
      return new;
    end if;
    raise exception 'terminal agent spike operations are immutable';
  end if;

  if row(
    new.actor_id,
    new.project_id,
    new.task_id,
    new.stage_id,
    new.executor_id,
    new.operation_id,
    new.grant_jti,
    new.base_draft_version,
    new.input_digest,
    new.executor_input,
    new.issue_digest,
    new.skill_trace,
    new.compatibility,
    new.expires_at
  ) is distinct from row(
    old.actor_id,
    old.project_id,
    old.task_id,
    old.stage_id,
    old.executor_id,
    old.operation_id,
    old.grant_jti,
    old.base_draft_version,
    old.input_digest,
    old.executor_input,
    old.issue_digest,
    old.skill_trace,
    old.compatibility,
    old.expires_at
  ) then
    raise exception 'agent spike operation bindings are immutable';
  end if;

  if old.candidate_digest is not null and row(
    new.candidate_digest,
    new.prepared_digest,
    new.candidate_schema,
    new.host_receipt,
    new.evidence,
    new.prepared_at
  ) is distinct from row(
    old.candidate_digest,
    old.prepared_digest,
    old.candidate_schema,
    old.host_receipt,
    old.evidence,
    old.prepared_at
  ) then
    raise exception 'prepared agent spike candidate is immutable';
  end if;

  if not (
    new.status = old.status
    or (old.status = 'issued' and new.status in ('prepared', 'failed_not_applied', 'indeterminate'))
    or (
      old.status = 'prepared'
      and new.status in ('committed', 'rejected_stale', 'failed_not_applied', 'indeterminate')
    )
  ) then
    raise exception 'invalid agent spike operation status transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

comment on column app.agent_spike_operations.rolled_back_at is
  'Server-authoritative timestamp for an idempotently completed Agent undo.';
comment on column app.agent_spike_operations.rollback_receipt is
  'Durable public receipt returned by repeated undo requests and run recovery reads.';
