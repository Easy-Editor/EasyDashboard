alter table app.agent_run_dispatches
  add column turn_id text,
  add column input_digest text,
  add column input_snapshot jsonb,
  add column phase text,
  add column frozen_provider text,
  add column frozen_model text,
  add column frozen_profile text,
  add column frozen_config_digest text,
  add column billing_scope text,
  add column payer_id uuid,
  add column task_limit_micros integer,
  add column project_limit_micros integer,
  add column warning_ratio numeric,
  add column provider_idempotency text,
  add constraint agent_run_dispatches_turn_id_check
    check (turn_id is null or char_length(turn_id) between 1 and 160),
  add constraint agent_run_dispatches_input_digest_check
    check (input_digest is null or input_digest ~ '^[a-f0-9]{64}$'),
  add constraint agent_run_dispatches_input_snapshot_check
    check (
      input_snapshot is null
      or (
        jsonb_typeof(input_snapshot) = 'object'
        and octet_length(input_snapshot::text) <= 262144
      )
    ),
  add constraint agent_run_dispatches_phase_check
    check (phase is null or phase in ('waiting_input', 'planning', 'executing', 'terminal')),
  add constraint agent_run_dispatches_frozen_config_check
    check (
      (frozen_provider is null and frozen_model is null and frozen_profile is null and frozen_config_digest is null)
      or (
        nullif(btrim(frozen_provider), '') is not null
        and nullif(btrim(frozen_model), '') is not null
        and nullif(btrim(frozen_profile), '') is not null
        and frozen_config_digest ~ '^[a-f0-9]{64}$'
      )
    ),
  add constraint agent_run_dispatches_billing_binding_check
    check (
      (billing_scope is null and payer_id is null)
      or (
        billing_scope in ('project', 'user')
        and (
          (billing_scope = 'project' and payer_id = project_id)
          or (billing_scope = 'user' and payer_id = actor_id)
        )
      )
    ),
  add constraint agent_run_dispatches_task_limit_check
    check (task_limit_micros is null or task_limit_micros >= 0),
  add constraint agent_run_dispatches_project_limit_check
    check (project_limit_micros is null or project_limit_micros >= 0),
  add constraint agent_run_dispatches_warning_ratio_check
    check (warning_ratio is null or warning_ratio between 0 and 1),
  add constraint agent_run_dispatches_provider_idempotency_check
    check (provider_idempotency is null or provider_idempotency in ('unsupported', 'stable')),
  add constraint agent_run_dispatches_attempt_parent_key unique (id, actor_id, project_id);

create unique index agent_run_dispatches_actor_project_turn_uidx
  on app.agent_run_dispatches(actor_id, project_id, turn_id)
  where turn_id is not null;

comment on column app.agent_run_dispatches.input_snapshot is
  'Bounded, sanitized turn input needed for durable recovery; never credentials or hidden reasoning.';
comment on column app.agent_run_dispatches.frozen_config_digest is
  'Digest of the provider/model/profile configuration frozen for this turn.';

create table app.agent_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references app.projects(id) on delete cascade,
  dispatch_id uuid not null,
  attempt_no integer not null check (attempt_no >= 1),
  provider_request_key text,
  request_body_digest text not null check (request_body_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'prepared'
    check (state in ('prepared', 'started', 'succeeded', 'failed_definite', 'outcome_unknown')),
  reservation_delta_micros integer not null default 0 check (reservation_delta_micros >= 0),
  cost_accuracy text
    check (cost_accuracy in ('actual', 'estimated', 'billing_indeterminate')),
  amount_micros integer check (amount_micros >= 0),
  minimum_micros integer check (minimum_micros >= 0),
  maximum_micros integer check (maximum_micros >= 0),
  prompt_tokens integer check (prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens >= 0),
  cached_tokens integer check (cached_tokens >= 0),
  upstream_request_id text,
  error_code text,
  error_message text,
  prepared_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_provider_attempts_dispatch_fk
    foreign key (dispatch_id, actor_id, project_id)
    references app.agent_run_dispatches(id, actor_id, project_id)
    on delete cascade,
  constraint agent_provider_attempts_dispatch_attempt_key unique (dispatch_id, attempt_no),
  constraint agent_provider_attempts_request_key_check
    check (
      provider_request_key is null
      or (
        char_length(provider_request_key) between 1 and 160
        and provider_request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      )
    ),
  constraint agent_provider_attempts_upstream_request_id_check
    check (
      upstream_request_id is null
      or (
        char_length(upstream_request_id) between 1 and 200
        and upstream_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
      )
    ),
  constraint agent_provider_attempts_error_code_check
    check (
      error_code is null
      or (
        char_length(error_code) between 1 and 120
        and error_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      )
    ),
  constraint agent_provider_attempts_error_message_check
    check (error_message is null or char_length(error_message) between 1 and 2000),
  constraint agent_provider_attempts_cost_range_check
    check (
      (amount_micros is null and minimum_micros is null and maximum_micros is null)
      or (
        amount_micros is not null
        and minimum_micros is not null
        and maximum_micros is not null
        and minimum_micros <= amount_micros
        and amount_micros <= maximum_micros
      )
    ),
  constraint agent_provider_attempts_actual_cost_check
    check (
      cost_accuracy is distinct from 'actual'
      or (minimum_micros = amount_micros and amount_micros = maximum_micros)
    ),
  constraint agent_provider_attempts_state_timestamps_check
    check (
      (state = 'prepared' and started_at is null and completed_at is null)
      or (state = 'started' and started_at is not null and completed_at is null)
      or (
        state = 'failed_definite'
        and completed_at is not null
        and (started_at is null or started_at <= completed_at)
      )
      or (
        state in ('succeeded', 'outcome_unknown')
        and started_at is not null
        and completed_at is not null
        and started_at <= completed_at
      )
    ),
  constraint agent_provider_attempts_unknown_accuracy_check
    check (state <> 'outcome_unknown' or cost_accuracy = 'billing_indeterminate')
);

create index agent_provider_attempts_dispatch_idx
  on app.agent_provider_attempts(dispatch_id, attempt_no);

create function app.guard_agent_provider_attempt_update()
returns trigger
language plpgsql
as $$
begin
  if old.state in ('succeeded', 'failed_definite', 'outcome_unknown') then
    raise exception 'terminal agent provider attempts are immutable' using errcode = '55000';
  end if;

  if row(
    new.id,
    new.actor_id,
    new.project_id,
    new.dispatch_id,
    new.attempt_no,
    new.provider_request_key,
    new.request_body_digest,
    new.reservation_delta_micros,
    new.prepared_at,
    new.created_at
  ) is distinct from row(
    old.id,
    old.actor_id,
    old.project_id,
    old.dispatch_id,
    old.attempt_no,
    old.provider_request_key,
    old.request_body_digest,
    old.reservation_delta_micros,
    old.prepared_at,
    old.created_at
  ) then
    raise exception 'agent provider attempt bindings are immutable' using errcode = '55000';
  end if;

  if not (
    (old.state = 'prepared' and new.state in ('started', 'failed_definite'))
    or (old.state = 'started' and new.state in ('succeeded', 'failed_definite', 'outcome_unknown'))
  ) then
    raise exception 'invalid agent provider attempt state transition: % -> %', old.state, new.state
      using errcode = '55000';
  end if;

  if old.state = 'prepared' and new.state = 'started' and row(
    new.cost_accuracy,
    new.amount_micros,
    new.minimum_micros,
    new.maximum_micros,
    new.prompt_tokens,
    new.completion_tokens,
    new.cached_tokens,
    new.upstream_request_id,
    new.error_code,
    new.error_message,
    new.completed_at
  ) is distinct from row(
    old.cost_accuracy,
    old.amount_micros,
    old.minimum_micros,
    old.maximum_micros,
    old.prompt_tokens,
    old.completion_tokens,
    old.cached_tokens,
    old.upstream_request_id,
    old.error_code,
    old.error_message,
    old.completed_at
  ) then
    raise exception 'provider attempt result is writable only on terminal transition' using errcode = '55000';
  end if;

  if old.started_at is not null and new.started_at is distinct from old.started_at then
    raise exception 'agent provider attempt start time is immutable' using errcode = '55000';
  end if;

  if old.state = 'started' and new.started_at is distinct from old.started_at then
    raise exception 'terminal provider attempt must preserve its start time' using errcode = '55000';
  end if;

  if new.updated_at < old.updated_at then
    raise exception 'agent provider attempt update time must be monotonic' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger guard_agent_provider_attempt_update
before update on app.agent_provider_attempts
for each row execute function app.guard_agent_provider_attempt_update();

revoke all on function app.guard_agent_provider_attempt_update()
  from public, anon, authenticated, service_role;
grant execute on function app.guard_agent_provider_attempt_update() to easy_dashboard_runtime;

alter table app.agent_provider_attempts enable row level security;
alter table app.agent_provider_attempts force row level security;

create policy agent_provider_attempts_member_select
  on app.agent_provider_attempts
  for select
  to easy_dashboard_runtime
  using (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
  );

create policy agent_provider_attempts_member_insert
  on app.agent_provider_attempts
  for insert
  to easy_dashboard_runtime
  with check (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
  );

create policy agent_provider_attempts_member_update
  on app.agent_provider_attempts
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

grant select, insert, update on app.agent_provider_attempts to easy_dashboard_runtime;

alter table app.agent_run_costs
  add column accuracy text
    check (accuracy in ('actual', 'estimated', 'billing_indeterminate'));

update app.agent_run_costs
set state = 'settled', accuracy = 'billing_indeterminate'
where state = 'billing_indeterminate';

update app.agent_run_costs
set accuracy = 'estimated'
where state = 'settled' and accuracy is null;

alter table app.agent_run_costs
  drop constraint if exists agent_run_costs_state_check,
  add constraint agent_run_costs_state_check
    check (state in ('reserved', 'settled', 'released')),
  add constraint agent_run_costs_accuracy_lifecycle_check
    check (
      (state = 'settled' and accuracy is not null)
      or (state in ('reserved', 'released') and accuracy is null)
    );

alter table app.agent_assets
  add column model_input_status text,
  add column model_input_bytes bytea,
  add column model_input_content_type text,
  add column model_input_sha256 text,
  add column model_input_size integer,
  add constraint agent_assets_model_input_status_check
    check (model_input_status is null or model_input_status in ('pending', 'ready', 'failed')),
  add constraint agent_assets_model_input_all_or_none_check
    check (
      (model_input_bytes is null and model_input_content_type is null and model_input_sha256 is null and model_input_size is null)
      or (
        model_input_bytes is not null
        and model_input_content_type in ('image/png', 'image/jpeg', 'image/webp')
        and model_input_sha256 ~ '^[a-f0-9]{64}$'
        and model_input_size between 1 and 4194304
        and octet_length(model_input_bytes) = model_input_size
      )
    ),
  add constraint agent_assets_model_input_ready_check
    check (
      model_input_status is distinct from 'ready'
      or model_input_bytes is not null
    );

comment on column app.agent_assets.model_input_bytes is
  'Validated model-ready image bytes kept on the actor-private asset row; maximum 4 MiB.';
