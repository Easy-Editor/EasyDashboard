alter table app.agent_run_costs
  add column turn_id text,
  add column decision_output jsonb,
  add column decision_usage jsonb,
  add column decision_trace jsonb;

update app.agent_run_costs
set turn_id = task_id
where turn_id is null;

alter table app.agent_run_costs
  alter column turn_id set not null,
  drop constraint if exists agent_run_costs_actor_id_project_id_task_id_key,
  add constraint agent_run_costs_actor_project_turn_key unique (actor_id, project_id, turn_id),
  add constraint agent_run_costs_decision_output_object_check
    check (decision_output is null or jsonb_typeof(decision_output) = 'object'),
  add constraint agent_run_costs_decision_usage_object_check
    check (decision_usage is null or jsonb_typeof(decision_usage) = 'object'),
  add constraint agent_run_costs_decision_trace_object_check
    check (decision_trace is null or jsonb_typeof(decision_trace) = 'object');

create index agent_run_costs_actor_project_task_idx
  on app.agent_run_costs (actor_id, project_id, task_id);

comment on column app.agent_run_costs.turn_id is
  'Stable idempotency identity for one user/assistant turn within an Agent task.';
comment on column app.agent_run_costs.decision_output is
  'Strictly validated planner decision output. Never store raw prompts, provider responses, hidden reasoning, or chain-of-thought.';
comment on column app.agent_run_costs.decision_usage is
  'Sanitized provider usage counters associated with the durable planner decision.';
comment on column app.agent_run_costs.decision_trace is
  'Sanitized public trace metadata associated with the durable planner decision.';
