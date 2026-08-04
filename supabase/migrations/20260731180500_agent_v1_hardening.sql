alter table app.project_revisions
  drop constraint if exists project_revisions_kind_check;

alter table app.project_revisions
  add constraint project_revisions_kind_check
  check (kind in ('auto', 'manual', 'pre_restore', 'publish', 'agent'));

alter table app.agent_spike_operations
  add column rollback_revision_id uuid,
  add constraint agent_spike_operations_rollback_revision_fkey
    foreign key (rollback_revision_id)
    references app.project_revisions(id)
    on delete restrict,
  add constraint agent_spike_operations_rollback_state_check
    check (rollback_revision_id is null or status = 'committed');

create index agent_spike_operations_rollback_revision_idx
  on app.agent_spike_operations(rollback_revision_id)
  where rollback_revision_id is not null;

alter table app.agent_workspaces force row level security;

drop policy if exists agent_workspaces_runtime_select on app.agent_workspaces;
drop policy if exists agent_workspaces_runtime_insert on app.agent_workspaces;
drop policy if exists agent_workspaces_runtime_update on app.agent_workspaces;

create policy agent_workspaces_runtime_select on app.agent_workspaces
for select to easy_dashboard_runtime
using (
  owner_id = app.current_actor_id()
  and app.current_project_member_role(project_id) is not null
);

create policy agent_workspaces_runtime_insert on app.agent_workspaces
for insert to easy_dashboard_runtime
with check (
  owner_id = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy agent_workspaces_runtime_update on app.agent_workspaces
for update to easy_dashboard_runtime
using (
  owner_id = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
)
with check (
  owner_id = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);
