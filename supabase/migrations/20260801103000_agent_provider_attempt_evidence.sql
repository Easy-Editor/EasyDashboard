alter table app.agent_provider_attempts
  add column duration_ms integer
    check (duration_ms >= 0);

create or replace function app.guard_agent_provider_attempt_update()
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
    new.dispatch_generation,
    new.dispatch_worker_id,
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
    old.dispatch_generation,
    old.dispatch_worker_id,
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
    new.duration_ms,
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
    old.duration_ms,
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

comment on column app.agent_provider_attempts.duration_ms is
  'Measured provider network I/O duration; null when no provider I/O began or evidence was unavailable.';
