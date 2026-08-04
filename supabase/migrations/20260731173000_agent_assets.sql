create table app.agent_assets (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references app.projects(id) on delete cascade,
  conversation_id text,
  original_name text not null check (char_length(original_name) between 1 and 255),
  content_type text not null check (char_length(content_type) between 1 and 255),
  size integer not null check (size between 1 and 20971520),
  sha256 text,
  status text not null default 'uploading' check (status in ('uploading','processing','ready','failed','deleted')),
  storage_path text not null unique check (char_length(storage_path) between 1 and 512),
  extracted_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_assets_project_idx on app.agent_assets(project_id, created_at);
alter table app.agent_assets enable row level security;
alter table app.agent_assets force row level security;
create policy agent_assets_member_select on app.agent_assets for select to easy_dashboard_runtime
  using (app.current_project_member_role(project_id) is not null and actor_id = app.current_actor_id());
create policy agent_assets_member_insert on app.agent_assets for insert to easy_dashboard_runtime
  with check (actor_id = app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor'));
create policy agent_assets_member_update on app.agent_assets for update to easy_dashboard_runtime
  using (actor_id = app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor'))
  with check (actor_id = app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor'));
create policy agent_assets_member_delete on app.agent_assets for delete to easy_dashboard_runtime
  using (actor_id = app.current_actor_id() and app.current_project_member_role(project_id) in ('owner','editor'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('easy-dashboard-agent-assets', 'easy-dashboard-agent-assets', false, 20971520,
  array['image/png','image/jpeg','image/webp','image/svg+xml','application/pdf','text/plain','text/markdown','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy easy_dashboard_agent_asset_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'easy-dashboard-agent-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy easy_dashboard_agent_asset_select on storage.objects for select to authenticated
  using (bucket_id = 'easy-dashboard-agent-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy easy_dashboard_agent_asset_delete on storage.objects for delete to authenticated
  using (bucket_id = 'easy-dashboard-agent-assets' and (storage.foldername(name))[1] = auth.uid()::text);
