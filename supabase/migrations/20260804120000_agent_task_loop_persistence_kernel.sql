create table app.agent_conversation_model_bindings (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  project_id uuid not null references app.projects(id) on delete cascade,
  conversation_id text not null check (char_length(conversation_id) between 1 and 200),
  provider text not null check (char_length(provider) between 1 and 80),
  model text not null check (char_length(model) between 1 and 160),
  profile_id text not null check (char_length(profile_id) between 1 and 160),
  config_digest text not null check (config_digest ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, conversation_id),
  unique (id, actor_id, project_id)
);

create table app.agent_task_runs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  project_id uuid not null references app.projects(id) on delete cascade,
  conversation_id text not null,
  task_id text not null,
  idempotency_key text not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'planning' check (status in ('planning','waiting_user','running','verifying','completed','blocked_material','paused','failed','canceled','rolling_back','rolled_back','rollback_blocked')),
  active_plan_version integer not null default 0 check (active_plan_version >= 0),
  current_transition_key text,
  model_binding_id uuid not null references app.agent_conversation_model_bindings(id) on delete restrict,
  provider text not null,
  model text not null,
  profile_id text not null,
  config_digest text not null check (config_digest ~ '^[a-f0-9]{64}$'),
  bounds_json jsonb not null check (jsonb_typeof(bounds_json) = 'object'),
  provider_turns integer not null default 0 check (provider_turns >= 0),
  executor_retries integer not null default 0 check (executor_retries >= 0),
  semantic_revisions integer not null default 0 check (semantic_revisions >= 0),
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  cost_micros integer not null default 0 check (cost_micros >= 0),
  task_start_document_revision integer not null check (task_start_document_revision >= 0),
  next_transition_generation integer not null default 1 check (next_transition_generation >= 1),
  next_event_sequence integer not null default 1 check (next_event_sequence >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, idempotency_key),
  unique (project_id, conversation_id, task_id),
  unique (id, actor_id, project_id),
  unique (project_id, id),
  foreign key (model_binding_id, actor_id, project_id)
    references app.agent_conversation_model_bindings(id, actor_id, project_id) on delete restrict
);
create index agent_task_runs_project_status_idx on app.agent_task_runs(project_id, status, updated_at);

create type app.agent_task_transition_kind as enum ('planning','step_action','observation','final_verification','rollback');

create table app.agent_task_plans (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references app.agent_task_runs(id) on delete cascade,
  version integer not null check (version > 0),
  summary text not null check (char_length(summary) between 1 and 2000),
  assumptions_json jsonb not null,
  verification_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (task_run_id, version)
);

create table app.agent_task_steps (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references app.agent_task_runs(id) on delete cascade,
  plan_version integer not null check (plan_version > 0),
  ordinal integer not null check (ordinal between 1 and 8),
  semantic_step_key text not null check (char_length(semantic_step_key) between 1 and 160),
  title text not null check (char_length(title) between 1 and 500),
  intent_json jsonb not null check (jsonb_typeof(intent_json) = 'object'),
  status text not null default 'pending' check (status in ('pending','running','verifying','passed','revising','failed','superseded')),
  last_observation_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_run_id, plan_version, ordinal),
  unique (task_run_id, plan_version, semantic_step_key),
  unique (id, task_run_id)
);
alter table app.agent_task_steps add constraint agent_task_steps_plan_fk
  foreign key (task_run_id, plan_version) references app.agent_task_plans(task_run_id, version) on delete cascade;
create index agent_task_steps_run_status_idx on app.agent_task_steps(task_run_id, status, ordinal);

create table app.agent_task_transitions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  project_id uuid not null references app.projects(id) on delete cascade,
  task_run_id uuid not null references app.agent_task_runs(id) on delete cascade,
  step_id uuid,
  kind app.agent_task_transition_kind not null,
  transition_key text not null check (char_length(transition_key) between 1 and 240),
  generation integer not null check (generation >= 1),
  status text not null default 'pending' check (status in ('pending','leased','completed','failed','canceled')),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_generation integer not null default 0 check (lease_generation >= 0),
  lease_token uuid,
  lease_until timestamptz,
  project_lease_generation integer,
  project_lease_token uuid,
  project_lease_worker_id text,
  heartbeat_at timestamptz,
  claim_attempts integer not null default 0 check (claim_attempts >= 0),
  operation_id text,
  step_attempt_id uuid,
  input_json jsonb not null default '{}'::jsonb check (jsonb_typeof(input_json) = 'object'),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  completion_digest text check (completion_digest is null or completion_digest ~ '^[a-f0-9]{64}$'),
  output_json jsonb,
  error_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (task_run_id, transition_key),
  unique (task_run_id, generation),
  unique (id, task_run_id),
  unique (id, actor_id, project_id),
  foreign key (task_run_id, actor_id, project_id)
    references app.agent_task_runs(id, actor_id, project_id) on delete cascade,
  foreign key (step_id, task_run_id) references app.agent_task_steps(id, task_run_id) on delete cascade,
  check ((status = 'leased' and lease_owner is not null and lease_token is not null and lease_until is not null) or (status <> 'leased')),
  check ((project_lease_generation is null and project_lease_token is null and project_lease_worker_id is null)
    or (project_lease_generation is not null and project_lease_token is not null and project_lease_worker_id is not null))
);
create index agent_task_transitions_claim_idx on app.agent_task_transitions(status, available_at, lease_until, created_at);
create unique index agent_task_transitions_one_leased_per_run_uidx on app.agent_task_transitions(task_run_id) where status = 'leased';

create table app.agent_task_step_attempts (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references app.agent_task_runs(id) on delete cascade,
  step_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  decision_kind text not null,
  transition_key text not null,
  transition_id uuid not null,
  provider_call_reference text,
  operation_id text,
  executor_retry_count integer not null default 0 check (executor_retry_count >= 0),
  semantic_revision_count integer not null default 0 check (semantic_revision_count >= 0),
  observation_json jsonb,
  terminal_classification text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (step_id, attempt_number),
  unique (transition_id),
  foreign key (step_id, task_run_id) references app.agent_task_steps(id, task_run_id) on delete cascade,
  foreign key (transition_id, task_run_id) references app.agent_task_transitions(id, task_run_id) on delete restrict
);
alter table app.agent_task_transitions add constraint agent_task_transitions_step_attempt_fk foreign key (step_attempt_id) references app.agent_task_step_attempts(id) on delete restrict;

create table app.agent_project_task_leases (
  project_id uuid primary key references app.projects(id) on delete cascade,
  task_run_id uuid not null,
  lease_generation integer not null check (lease_generation >= 1),
  lease_token uuid not null,
  lease_owner text not null,
  lease_until timestamptz not null,
  heartbeat_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, task_run_id) references app.agent_task_runs(project_id, id) on delete cascade
);

create table app.agent_task_events (
  task_run_id uuid not null references app.agent_task_runs(id) on delete cascade,
  seq integer not null check (seq > 0),
  event_key text not null,
  step_id uuid,
  type text not null check (type in ('plan_created','plan_revised','step_started','material_selected','change_prepared','change_committed','preview_checked','step_revising','fallback_selected','material_gap','waiting_user','step_passed','step_superseded','rollback_started','rollback_completed','rollback_blocked','task_failed','task_completed')),
  summary text not null check (char_length(summary) between 1 and 500),
  public_payload_json jsonb not null default '{}'::jsonb check (jsonb_typeof(public_payload_json) = 'object'),
  technical_payload_json jsonb not null default '{}'::jsonb check (jsonb_typeof(technical_payload_json) = 'object'),
  redaction_version integer not null default 1 check (redaction_version > 0),
  created_at timestamptz not null default now(),
  primary key (task_run_id, seq),
  unique (task_run_id, event_key),
  foreign key (step_id, task_run_id) references app.agent_task_steps(id, task_run_id) on delete cascade
);

create table app.agent_task_operational_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  actor_id uuid,
  project_id uuid references app.projects(id) on delete set null,
  task_run_id uuid references app.agent_task_runs(id) on delete cascade,
  transition_id uuid references app.agent_task_transitions(id) on delete set null,
  operation_id text,
  code text not null check (char_length(code) between 1 and 120),
  severity text not null check (severity in ('info','warning','error','critical')),
  details_json jsonb not null default '{}'::jsonb check (jsonb_typeof(details_json) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (project_id, task_run_id) references app.agent_task_runs(project_id, id) on delete cascade,
  foreign key (transition_id, task_run_id) references app.agent_task_transitions(id, task_run_id) on delete set null
);
create index agent_task_operational_events_task_idx on app.agent_task_operational_events(task_run_id, created_at);

alter table app.agent_provider_attempts
  add column task_transition_id uuid references app.agent_task_transitions(id) on delete cascade,
  add column transition_lease_generation integer,
  add column transition_lease_token uuid,
  add column transition_worker_id text,
  alter column dispatch_id drop not null,
  alter column dispatch_generation drop not null,
  alter column dispatch_worker_id drop not null;

alter table app.agent_provider_attempts add constraint agent_provider_attempts_transition_actor_project_fk
  foreign key (task_transition_id, actor_id, project_id)
  references app.agent_task_transitions(id, actor_id, project_id) on delete cascade;

alter table app.agent_provider_attempts drop constraint if exists agent_provider_attempts_dispatch_attempt_key;
drop index if exists app.agent_provider_attempts_dispatch_attempt_uidx;
create unique index agent_provider_attempts_dispatch_attempt_uidx on app.agent_provider_attempts(dispatch_id, attempt_no) where dispatch_id is not null;
create unique index agent_provider_attempts_transition_attempt_uidx on app.agent_provider_attempts(task_transition_id, attempt_no) where task_transition_id is not null;
create index agent_provider_attempts_transition_idx on app.agent_provider_attempts(task_transition_id, attempt_no) where task_transition_id is not null;

alter table app.agent_provider_attempts
  add constraint agent_provider_attempts_parent_fence_check check (
    (
      dispatch_id is not null and dispatch_generation is not null and dispatch_worker_id is not null
      and task_transition_id is null and transition_lease_generation is null and transition_lease_token is null and transition_worker_id is null
    ) or (
      dispatch_id is null and dispatch_generation is null and dispatch_worker_id is null
      and task_transition_id is not null and transition_lease_generation is not null and transition_lease_token is not null and transition_worker_id is not null
    )
  ) not valid;
alter table app.agent_provider_attempts validate constraint agent_provider_attempts_parent_fence_check;

create or replace function app.guard_agent_provider_attempt_update()
returns trigger language plpgsql as $$
begin
  if old.state in ('succeeded', 'failed_definite', 'outcome_unknown') then
    raise exception 'terminal agent provider attempts are immutable' using errcode = '55000';
  end if;
  if row(new.id,new.actor_id,new.project_id,new.dispatch_id,new.dispatch_generation,new.dispatch_worker_id,new.task_transition_id,new.transition_lease_generation,new.transition_lease_token,new.transition_worker_id,new.attempt_no,new.provider_request_key,new.request_body_digest,new.reservation_delta_micros,new.prepared_at,new.created_at)
     is distinct from
     row(old.id,old.actor_id,old.project_id,old.dispatch_id,old.dispatch_generation,old.dispatch_worker_id,old.task_transition_id,old.transition_lease_generation,old.transition_lease_token,old.transition_worker_id,old.attempt_no,old.provider_request_key,old.request_body_digest,old.reservation_delta_micros,old.prepared_at,old.created_at) then
    raise exception 'agent provider attempt bindings are immutable' using errcode = '55000';
  end if;
  if not ((old.state='prepared' and new.state in ('started','failed_definite')) or (old.state='started' and new.state in ('succeeded','failed_definite','outcome_unknown'))) then
    raise exception 'invalid agent provider attempt state transition: % -> %', old.state, new.state using errcode = '55000';
  end if;
  if old.started_at is not null and new.started_at is distinct from old.started_at then
    raise exception 'agent provider attempt start time is immutable' using errcode = '55000';
  end if;
  if new.updated_at < old.updated_at then raise exception 'agent provider attempt update time must be monotonic' using errcode = '55000'; end if;
  return new;
end;
$$;

create or replace function app.guard_agent_conversation_model_binding_update()
returns trigger language plpgsql as $$ begin
  if new is distinct from old then raise exception 'agent conversation model binding is immutable' using errcode = '55000'; end if;
  return new;
end; $$;
create trigger guard_agent_conversation_model_binding_update before update on app.agent_conversation_model_bindings for each row execute function app.guard_agent_conversation_model_binding_update();

create or replace function app.assert_agent_task_loop_downgrade_safe()
returns void language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if exists (select 1 from app.agent_task_runs where status not in ('completed','failed','canceled','rolled_back'))
    or exists (select 1 from app.agent_task_transitions where status in ('pending','leased'))
    or exists (select 1 from app.agent_provider_attempts where task_transition_id is not null and state in ('prepared','started')) then
    raise exception 'agent task loop downgrade blocked: nonterminal task-loop work remains' using errcode = '55000';
  end if;
end; $$;

create function app.claim_agent_task_transition(
  claim_worker_id text,
  claim_now timestamptz,
  claim_lease_until timestamptz,
  claim_kinds app.agent_task_transition_kind[] default null
)
returns setof app.agent_task_transitions
language plpgsql security definer set search_path = pg_catalog, app as $$
declare claimed app.agent_task_transitions%rowtype;
begin
  if nullif(btrim(claim_worker_id), '') is null or claim_lease_until <= claim_now then return; end if;
  select transition.* into claimed
  from app.agent_task_transitions transition
  where transition.available_at <= claim_now
    and (claim_kinds is null or transition.kind = any(claim_kinds))
    and (transition.status = 'pending' or (transition.status = 'leased' and transition.lease_until <= claim_now))
    and exists (select 1 from app.agent_task_runs task where task.id=transition.task_run_id and task.status not in ('completed','failed','canceled','rolled_back'))
    and not exists (
      select 1 from app.agent_task_transitions earlier
      where earlier.task_run_id=transition.task_run_id and earlier.generation < transition.generation
        and earlier.status in ('pending','leased')
        and (claim_kinds is null or earlier.kind = any(claim_kinds))
    )
    and not exists (
      select 1 from app.agent_task_transitions active
      where active.task_run_id=transition.task_run_id and active.id<>transition.id and active.status='leased'
    )
    and not exists (select 1 from app.agent_provider_attempts attempt where attempt.task_transition_id = transition.id and attempt.state = 'started')
    and (
      transition.kind = 'planning'
      or (transition.kind in ('step_action','observation','final_verification','rollback') and exists (
        select 1 from app.agent_project_task_leases project_lease
        where project_lease.project_id = transition.project_id and project_lease.task_run_id = transition.task_run_id
          and project_lease.lease_owner = claim_worker_id and project_lease.lease_until > claim_now
      ))
    )
  order by transition.available_at, transition.created_at
  for update skip locked
  limit 1;
  if not found then return; end if;
  update app.agent_task_transitions transition set
    status='leased', lease_owner=claim_worker_id, lease_generation=transition.lease_generation+1,
    lease_token=gen_random_uuid(),
    lease_until=case when transition.kind='planning' then claim_lease_until else least(claim_lease_until, (
      select project_lease.lease_until from app.agent_project_task_leases project_lease
      where project_lease.project_id=transition.project_id and project_lease.task_run_id=transition.task_run_id
        and project_lease.lease_owner=claim_worker_id
    )) end,
    project_lease_generation=case when transition.kind='planning' then null else (
      select project_lease.lease_generation from app.agent_project_task_leases project_lease
      where project_lease.project_id=transition.project_id and project_lease.task_run_id=transition.task_run_id
        and project_lease.lease_owner=claim_worker_id
    ) end,
    project_lease_token=case when transition.kind='planning' then null else (
      select project_lease.lease_token from app.agent_project_task_leases project_lease
      where project_lease.project_id=transition.project_id and project_lease.task_run_id=transition.task_run_id
        and project_lease.lease_owner=claim_worker_id
    ) end,
    project_lease_worker_id=case when transition.kind='planning' then null else claim_worker_id end,
    heartbeat_at=claim_now,
    claim_attempts=transition.claim_attempts+1, updated_at=claim_now
  where transition.id=claimed.id returning transition.* into claimed;
  perform set_config('app.actor_id', claimed.actor_id::text, true);
  return next claimed;
end; $$;

create function app.acquire_next_agent_project_task_lease(
  requested_worker_id text,
  requested_now timestamptz,
  requested_lease_until timestamptz
)
returns setof app.agent_project_task_leases
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  candidate app.agent_task_transitions%rowtype;
  current_lease app.agent_project_task_leases%rowtype;
  acquired app.agent_project_task_leases%rowtype;
begin
  if nullif(btrim(requested_worker_id), '') is null or requested_lease_until <= requested_now then return; end if;

  for candidate in
    select transition.*
    from app.agent_task_transitions transition
    join app.agent_task_runs task on task.id = transition.task_run_id
    where transition.kind <> 'planning'
      and transition.status = 'pending'
      and transition.available_at <= requested_now
      and task.status not in ('completed','failed','canceled','rolled_back')
    order by transition.available_at, transition.created_at
    for update of transition skip locked
  loop
    -- Serialize lease acquisition for a project even when no lease row exists yet.
    perform pg_advisory_xact_lock(hashtextextended(candidate.project_id::text || ':agent-task-lease', 0));

    select * into current_lease
    from app.agent_project_task_leases
    where project_id = candidate.project_id
    for update skip locked;

    if found and current_lease.lease_until > requested_now and current_lease.lease_owner <> requested_worker_id then
      continue;
    end if;

    if found then
      update app.agent_project_task_leases
      set task_run_id = candidate.task_run_id,
          lease_generation = current_lease.lease_generation + 1,
          lease_token = gen_random_uuid(),
          lease_owner = requested_worker_id,
          lease_until = requested_lease_until,
          heartbeat_at = requested_now,
          updated_at = requested_now
      where project_id = candidate.project_id
      returning * into acquired;
    else
      insert into app.agent_project_task_leases(
        project_id, task_run_id, lease_generation, lease_token, lease_owner,
        lease_until, heartbeat_at, created_at, updated_at
      ) values (
        candidate.project_id, candidate.task_run_id, 1, gen_random_uuid(), requested_worker_id,
        requested_lease_until, requested_now, requested_now, requested_now
      ) returning * into acquired;
    end if;

    return next acquired;
    return;
  end loop;
end; $$;

create function app.reconcile_agent_task_transitions(reconcile_now timestamptz, reconcile_limit integer default 100)
returns setof app.agent_task_transitions
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  candidate app.agent_task_transitions%rowtype;
  event_seq integer;
  attempt_id uuid;
  attempt_state text;
  attempt_error_code text;
  attempt_cost integer;
  attempt_prompt_tokens integer;
  attempt_completion_tokens integer;
  accounting_required boolean;
  operational_event_exists boolean;
  inserted_count integer;
begin
  for candidate in
    select transition.* from app.agent_task_transitions transition
    where transition.status='leased' and transition.lease_until <= reconcile_now
    order by transition.lease_until for update skip locked limit greatest(1, least(reconcile_limit, 500))
  loop
    select attempt.id, attempt.state, attempt.error_code, attempt.reservation_delta_micros,
      coalesce(attempt.prompt_tokens, 0), coalesce(attempt.completion_tokens, 0)
    into attempt_id, attempt_state, attempt_error_code, attempt_cost, attempt_prompt_tokens, attempt_completion_tokens
    from app.agent_provider_attempts attempt
    where attempt.task_transition_id=candidate.id and attempt.state in ('started','outcome_unknown')
    order by attempt.attempt_no desc limit 1 for update;
    if found then
      select exists(
        select 1 from app.agent_task_operational_events operational
        where operational.dedupe_key='provider-outcome-unknown:'||candidate.id
      ) into operational_event_exists;
      accounting_required := not operational_event_exists and (
        attempt_state='started' or attempt_error_code in (
          'provider_outcome_unknown','transition_attempt_stale','transition_generation_reclaimed'
        )
      );
      select task.next_event_sequence into event_seq from app.agent_task_runs task where task.id=candidate.task_run_id for update;
      update app.agent_provider_attempts attempt set state = 'outcome_unknown', cost_accuracy='billing_indeterminate',
        amount_micros=attempt.reservation_delta_micros, minimum_micros=0, maximum_micros=attempt.reservation_delta_micros,
        error_code='transition_attempt_stale', completed_at=reconcile_now, updated_at=reconcile_now
      where attempt.id=attempt_id and attempt.state='started';
      update app.agent_task_transitions transition set status='failed', error_json='{"code":"provider_outcome_unknown"}'::jsonb,
        completed_at=reconcile_now, updated_at=reconcile_now where transition.id=candidate.id returning transition.* into candidate;
      insert into app.agent_task_events(task_run_id,seq,event_key,step_id,type,summary,public_payload_json,technical_payload_json,redaction_version,created_at)
      values(candidate.task_run_id,event_seq,'provider-outcome-unknown:'||candidate.id,candidate.step_id,'waiting_user',
        'Execution paused because the provider outcome is unknown.',
        '{"code":"provider_outcome_unknown","action":"review_before_resume"}'::jsonb,'{}'::jsonb,1,reconcile_now)
      on conflict (task_run_id,event_key) do nothing;
      get diagnostics inserted_count = row_count;
      update app.agent_task_runs task set status='paused', current_transition_key=null,
        provider_turns=task.provider_turns+(case when accounting_required then 1 else 0 end),
        prompt_tokens=task.prompt_tokens+(case when accounting_required then attempt_prompt_tokens else 0 end),
        completion_tokens=task.completion_tokens+(case when accounting_required then attempt_completion_tokens else 0 end),
        cost_micros=task.cost_micros+(case when accounting_required then attempt_cost else 0 end),
        next_event_sequence=task.next_event_sequence+inserted_count, updated_at=reconcile_now
      where task.id=candidate.task_run_id;
      update app.agent_project_task_leases project_lease set lease_until=reconcile_now,
        heartbeat_at=reconcile_now, updated_at=reconcile_now
      where project_lease.project_id=candidate.project_id and project_lease.task_run_id=candidate.task_run_id
        and project_lease.lease_generation=candidate.project_lease_generation
        and project_lease.lease_token=candidate.project_lease_token
        and project_lease.lease_owner=candidate.project_lease_worker_id;
      insert into app.agent_task_operational_events(dedupe_key,actor_id,project_id,task_run_id,transition_id,code,severity,details_json,created_at)
      values('provider-outcome-unknown:'||candidate.id,candidate.actor_id,candidate.project_id,candidate.task_run_id,
        candidate.id,'provider_outcome_unknown','critical','{}'::jsonb,reconcile_now)
      on conflict (dedupe_key) do nothing;
    else
      update app.agent_task_transitions transition set status='pending', lease_owner=null, lease_token=null, lease_until=null,
        heartbeat_at=null, available_at=reconcile_now, updated_at=reconcile_now where transition.id=candidate.id returning transition.* into candidate;
    end if;
    return next candidate;
  end loop;
end; $$;

alter table app.agent_conversation_model_bindings enable row level security;
alter table app.agent_conversation_model_bindings force row level security;
alter table app.agent_task_runs enable row level security;
alter table app.agent_task_runs force row level security;
alter table app.agent_task_plans enable row level security;
alter table app.agent_task_plans force row level security;
alter table app.agent_task_steps enable row level security;
alter table app.agent_task_steps force row level security;
alter table app.agent_task_step_attempts enable row level security;
alter table app.agent_task_step_attempts force row level security;
alter table app.agent_project_task_leases enable row level security;
alter table app.agent_project_task_leases force row level security;
alter table app.agent_task_transitions enable row level security;
alter table app.agent_task_transitions force row level security;
alter table app.agent_task_events enable row level security;
alter table app.agent_task_events force row level security;
alter table app.agent_task_operational_events enable row level security;
alter table app.agent_task_operational_events force row level security;

create policy agent_task_runs_member_all on app.agent_task_runs for all using (actor_id=app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor')) with check (actor_id=app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor'));
create policy agent_conversation_model_bindings_member_all on app.agent_conversation_model_bindings for all using (actor_id=app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor')) with check (actor_id=app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor'));
create policy agent_task_plans_member_all on app.agent_task_plans for all using (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id())) with check (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id()));
create policy agent_task_steps_member_all on app.agent_task_steps for all using (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id())) with check (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id()));
create policy agent_task_step_attempts_member_all on app.agent_task_step_attempts for all using (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id())) with check (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id()));
create policy agent_project_task_leases_member_all on app.agent_project_task_leases for all using (app.current_project_member_role(project_id) in ('owner','editor')) with check (app.current_project_member_role(project_id) in ('owner','editor'));
create policy agent_task_transitions_member_all on app.agent_task_transitions for all using (actor_id=app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor')) with check (actor_id=app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor'));
create policy agent_task_events_member_all on app.agent_task_events for all using (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id())) with check (exists(select 1 from app.agent_task_runs r where r.id=task_run_id and r.actor_id=app.current_actor_id()));
create policy agent_task_operational_events_member_all on app.agent_task_operational_events for all using (actor_id=app.current_actor_id()) with check (actor_id=app.current_actor_id());

grant select, insert on app.agent_conversation_model_bindings to easy_dashboard_runtime;
grant select, insert, update on app.agent_task_runs, app.agent_task_plans, app.agent_task_steps, app.agent_task_step_attempts, app.agent_project_task_leases, app.agent_task_transitions, app.agent_task_events to easy_dashboard_runtime;
grant select, insert on app.agent_task_operational_events to easy_dashboard_runtime;
grant execute on function app.assert_agent_task_loop_downgrade_safe() to easy_dashboard_runtime;
grant execute on function app.claim_agent_task_transition(text,timestamptz,timestamptz,app.agent_task_transition_kind[]) to easy_dashboard_runtime;
grant execute on function app.acquire_next_agent_project_task_lease(text,timestamptz,timestamptz) to easy_dashboard_runtime;
grant execute on function app.reconcile_agent_task_transitions(timestamptz,integer) to easy_dashboard_runtime;

comment on function app.assert_agent_task_loop_downgrade_safe() is 'Supported binary rollback preflight; raises while transition-owned provider attempts are nonterminal.';
