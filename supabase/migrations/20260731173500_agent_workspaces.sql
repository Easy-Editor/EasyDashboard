create table app.agent_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid not null references app.projects(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, project_id)
);
create index agent_workspaces_project_updated_idx on app.agent_workspaces(project_id, updated_at);
alter table app.agent_workspaces enable row level security;
create policy agent_workspaces_runtime_select on app.agent_workspaces for select using (owner_id = nullif(current_setting('app.actor_id', true), '')::uuid);
create policy agent_workspaces_runtime_insert on app.agent_workspaces for insert with check (owner_id = nullif(current_setting('app.actor_id', true), '')::uuid);
create policy agent_workspaces_runtime_update on app.agent_workspaces for update using (owner_id = nullif(current_setting('app.actor_id', true), '')::uuid) with check (owner_id = nullif(current_setting('app.actor_id', true), '')::uuid);
grant select, insert, update on app.agent_workspaces to easy_dashboard_runtime;
