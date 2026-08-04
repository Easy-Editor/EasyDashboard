create table app.agent_spike_operations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  project_id uuid not null references app.projects(id) on delete cascade,
  task_id text not null check (length(task_id) between 1 and 160),
  stage_id text not null check (length(stage_id) between 1 and 160),
  executor_id text not null check (length(executor_id) between 1 and 160),
  operation_id text not null check (length(operation_id) between 1 and 160),
  grant_jti text not null unique check (length(grant_jti) between 1 and 160),
  base_draft_version integer not null check (base_draft_version >= 0),
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  executor_input jsonb not null,
  issue_digest text not null check (issue_digest ~ '^[0-9a-f]{64}$'),
  compatibility jsonb not null,
  expires_at timestamptz not null,
  status text not null default 'issued'
    check (status in ('issued', 'prepared', 'committed', 'rejected_stale', 'failed_not_applied', 'indeterminate')),
  candidate_digest text check (candidate_digest is null or candidate_digest ~ '^[0-9a-f]{64}$'),
  prepared_digest text check (prepared_digest is null or prepared_digest ~ '^[0-9a-f]{64}$'),
  candidate_schema jsonb,
  host_receipt jsonb,
  evidence jsonb,
  prepared_at timestamptz,
  committed_draft_version integer,
  outcome jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, operation_id),
  constraint agent_spike_operations_state_shape_check check (
    (
      status = 'issued'
      and prepared_digest is null
      and candidate_digest is null
      and candidate_schema is null
      and host_receipt is null
      and evidence is null
      and prepared_at is null
      and committed_draft_version is null
      and outcome is null
      and completed_at is null
    )
    or (
      status = 'prepared'
      and prepared_digest is not null
      and candidate_digest is not null
      and candidate_schema is not null
      and host_receipt is not null
      and evidence is not null
      and prepared_at is not null
      and committed_draft_version is null
      and outcome is null
      and completed_at is null
    )
    or (
      status = 'committed'
      and prepared_digest is not null
      and candidate_digest is not null
      and candidate_schema is not null
      and host_receipt is not null
      and evidence is not null
      and prepared_at is not null
      and committed_draft_version is not null
      and outcome is not null
      and completed_at is not null
    )
    or (
      status = 'rejected_stale'
      and prepared_digest is not null
      and candidate_digest is not null
      and candidate_schema is not null
      and host_receipt is not null
      and evidence is not null
      and prepared_at is not null
      and committed_draft_version is null
      and outcome is not null
      and completed_at is not null
    )
    or (
      status in ('failed_not_applied', 'indeterminate')
      and committed_draft_version is null
      and outcome is not null
      and completed_at is not null
      and (
        (
          prepared_digest is null
          and candidate_digest is null
          and candidate_schema is null
          and host_receipt is null
          and evidence is null
          and prepared_at is null
        )
        or (
          prepared_digest is not null
          and candidate_digest is not null
          and candidate_schema is not null
          and host_receipt is not null
          and evidence is not null
          and prepared_at is not null
        )
      )
    )
  )
);

create index agent_spike_operations_project_created_idx
  on app.agent_spike_operations(project_id, created_at desc);

create function app.guard_agent_spike_operation_update()
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

create trigger guard_agent_spike_operation_update
before update on app.agent_spike_operations
for each row execute function app.guard_agent_spike_operation_update();

revoke all on function app.guard_agent_spike_operation_update() from public, anon, authenticated;
grant execute on function app.guard_agent_spike_operation_update() to easy_dashboard_runtime;

alter table app.agent_spike_operations enable row level security;

create policy agent_spike_operations_editor_select on app.agent_spike_operations
for select to easy_dashboard_runtime
using (
  actor_id = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy agent_spike_operations_editor_insert on app.agent_spike_operations
for insert to easy_dashboard_runtime
with check (
  actor_id = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy agent_spike_operations_editor_update on app.agent_spike_operations
for update to easy_dashboard_runtime
using (
  actor_id = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
)
with check (
  actor_id = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

grant select, insert, update on app.agent_spike_operations to easy_dashboard_runtime;
