create table app.agent_project_contexts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references app.projects(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  content text not null check (length(content) <= 20000),
  revision integer not null default 1 check (revision > 0),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  created_by uuid not null,
  confirmed_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_project_contexts_project_updated_idx
  on app.agent_project_contexts(project_id, updated_at desc)
  where deleted_at is null;

alter table app.agent_project_contexts enable row level security;
alter table app.agent_project_contexts force row level security;

create policy agent_project_contexts_member_select on app.agent_project_contexts
for select to easy_dashboard_runtime
using (app.current_project_member_role(project_id) is not null);

create policy agent_project_contexts_editor_insert on app.agent_project_contexts
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy agent_project_contexts_editor_update on app.agent_project_contexts
for update to easy_dashboard_runtime
using (app.current_project_member_role(project_id) in ('owner', 'editor'))
with check (app.current_project_member_role(project_id) in ('owner', 'editor'));

grant select, insert, update on app.agent_project_contexts to easy_dashboard_runtime;
