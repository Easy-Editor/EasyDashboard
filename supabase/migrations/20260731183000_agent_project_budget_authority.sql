alter table app.projects
  add column agent_model_configuration jsonb;

create or replace function app.guard_project_agent_model_configuration()
returns trigger
language plpgsql
as $$
begin
  if new.agent_model_configuration is distinct from old.agent_model_configuration
    and old.owner_id <> app.current_actor_id()
  then
    raise exception 'only the project owner can change Agent model configuration';
  end if;
  return new;
end;
$$;

create trigger projects_guard_agent_model_configuration
before update of agent_model_configuration on app.projects
for each row execute function app.guard_project_agent_model_configuration();

alter table app.agent_run_costs
  add column billing_scope text,
  add column payer_id uuid;

update app.agent_run_costs
set billing_scope = 'user', payer_id = actor_id
where billing_scope is null or payer_id is null;

alter table app.agent_run_costs
  alter column billing_scope set not null,
  alter column payer_id set not null,
  add constraint agent_run_costs_billing_scope_check check (billing_scope in ('project', 'user')),
  add constraint agent_run_costs_payer_check check (
    (billing_scope = 'project' and payer_id = project_id)
    or (billing_scope = 'user' and payer_id = actor_id)
  );

create index agent_run_costs_payer_month_idx
  on app.agent_run_costs (billing_scope, payer_id, created_at);

drop policy agent_run_costs_actor on app.agent_run_costs;

create policy agent_run_costs_select on app.agent_run_costs
  for select to easy_dashboard_runtime
  using (
    (billing_scope = 'user' and actor_id = app.current_actor_id())
    or (
      billing_scope = 'project'
      and app.current_project_member_role(project_id) in ('owner', 'editor')
    )
  );

create policy agent_run_costs_insert on app.agent_run_costs
  for insert to easy_dashboard_runtime
  with check (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
    and (
      (billing_scope = 'project' and payer_id = project_id)
      or (billing_scope = 'user' and payer_id = actor_id)
    )
  );

create policy agent_run_costs_update on app.agent_run_costs
  for update to easy_dashboard_runtime
  using (actor_id = app.current_actor_id())
  with check (
    actor_id = app.current_actor_id()
    and app.current_project_member_role(project_id) in ('owner', 'editor')
    and (
      (billing_scope = 'project' and payer_id = project_id)
      or (billing_scope = 'user' and payer_id = actor_id)
    )
  );
