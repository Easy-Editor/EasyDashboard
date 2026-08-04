alter table app.agent_spike_operations
  add column skill_trace jsonb,
  add constraint agent_spike_operations_skill_trace_check check (
    skill_trace is null
    or (
      jsonb_typeof(skill_trace) = 'object'
      and skill_trace ?& array['promptBundleId', 'promptBundleVersion', 'promptBundleHash', 'skills']
      and skill_trace - 'promptBundleId' - 'promptBundleVersion' - 'promptBundleHash' - 'skills' = '{}'::jsonb
      and jsonb_typeof(skill_trace -> 'promptBundleId') = 'string'
      and length(skill_trace ->> 'promptBundleId') between 1 and 120
      and (skill_trace ->> 'promptBundleId') ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      and jsonb_typeof(skill_trace -> 'promptBundleVersion') = 'string'
      and length(skill_trace ->> 'promptBundleVersion') between 1 and 64
      and (skill_trace ->> 'promptBundleVersion') ~ '^[A-Za-z0-9][A-Za-z0-9._+-]*$'
      and jsonb_typeof(skill_trace -> 'promptBundleHash') = 'string'
      and (skill_trace ->> 'promptBundleHash') ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(skill_trace -> 'skills') = 'array'
      and jsonb_array_length(skill_trace -> 'skills') <= 16
    )
  );

create or replace function app.guard_agent_spike_operation_update()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('committed', 'rejected_stale', 'failed_not_applied', 'indeterminate') then
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

comment on column app.agent_spike_operations.skill_trace is
  'Immutable bounded prompt bundle and Skill identifiers; never prompt bodies or credentials.';
