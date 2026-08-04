create table app.agent_screenshot_artifacts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references app.projects(id) on delete cascade,
  agent_operation_id uuid not null references app.agent_spike_operations(id) on delete cascade,
  operation_id text not null check (char_length(operation_id) between 1 and 160),
  candidate_sha256 text not null check (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  draft_version integer not null check (draft_version > 0),
  content_type text not null check (content_type = 'image/png'),
  size integer not null check (size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'failed')),
  storage_path text not null unique check (char_length(storage_path) between 1 and 512),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_screenshot_artifacts_actor_operation_unique unique (actor_id, agent_operation_id),
  constraint agent_screenshot_artifacts_completion_check check (
    (status = 'ready' and completed_at is not null)
    or (status <> 'ready' and completed_at is null)
  )
);

create index agent_screenshot_artifacts_project_created_idx
  on app.agent_screenshot_artifacts(project_id, created_at);

create function app.reject_agent_screenshot_artifact_identity_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.id,
    new.actor_id,
    new.project_id,
    new.agent_operation_id,
    new.operation_id,
    new.candidate_sha256,
    new.draft_version,
    new.content_type,
    new.size,
    new.sha256,
    new.storage_path,
    new.created_at
  ) is distinct from row(
    old.id,
    old.actor_id,
    old.project_id,
    old.agent_operation_id,
    old.operation_id,
    old.candidate_sha256,
    old.draft_version,
    old.content_type,
    old.size,
    old.sha256,
    old.storage_path,
    old.created_at
  ) then
    raise exception 'agent screenshot artifact identity is immutable' using errcode = '55000';
  end if;
  if old.status in ('ready', 'failed') and new.status <> old.status then
    raise exception 'agent screenshot artifact terminal status is immutable' using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function app.reject_agent_screenshot_artifact_identity_mutation()
  from public, anon, authenticated;
grant execute on function app.reject_agent_screenshot_artifact_identity_mutation()
  to easy_dashboard_runtime;

create trigger agent_screenshot_artifact_identity_immutable
before update on app.agent_screenshot_artifacts
for each row execute function app.reject_agent_screenshot_artifact_identity_mutation();

alter table app.agent_screenshot_artifacts enable row level security;
alter table app.agent_screenshot_artifacts force row level security;

create policy agent_screenshot_artifacts_actor_select
on app.agent_screenshot_artifacts
for select
to easy_dashboard_runtime
using (
  actor_id = app.current_actor_id()
  and exists (
    select 1
    from app.projects project
    join app.project_members member on member.project_id = project.id
    where project.id = agent_screenshot_artifacts.project_id
      and project.deleted_at is null
      and member.user_id = app.current_actor_id()
  )
);

create policy agent_screenshot_artifacts_actor_insert
on app.agent_screenshot_artifacts
for insert
to easy_dashboard_runtime
with check (
  actor_id = app.current_actor_id()
  and exists (
    select 1
    from app.agent_spike_operations operation
    join app.projects project on project.id = operation.project_id
    join app.project_members member on member.project_id = project.id
    where operation.id = agent_screenshot_artifacts.agent_operation_id
      and operation.actor_id = app.current_actor_id()
      and operation.project_id = agent_screenshot_artifacts.project_id
      and operation.operation_id = agent_screenshot_artifacts.operation_id
      and operation.candidate_digest = agent_screenshot_artifacts.candidate_sha256
      and agent_screenshot_artifacts.draft_version = coalesce(
        operation.committed_draft_version,
        operation.base_draft_version + 1
      )
      and operation.status in ('prepared', 'committed')
      and project.deleted_at is null
      and member.user_id = app.current_actor_id()
      and member.role in ('owner', 'editor')
  )
);

create policy agent_screenshot_artifacts_actor_update
on app.agent_screenshot_artifacts
for update
to easy_dashboard_runtime
using (
  actor_id = app.current_actor_id()
  and exists (
    select 1
    from app.projects project
    join app.project_members member on member.project_id = project.id
    where project.id = agent_screenshot_artifacts.project_id
      and project.deleted_at is null
      and member.user_id = app.current_actor_id()
      and member.role in ('owner', 'editor')
  )
)
with check (
  actor_id = app.current_actor_id()
  and content_type = 'image/png'
  and exists (
    select 1
    from app.agent_spike_operations operation
    where operation.id = agent_screenshot_artifacts.agent_operation_id
      and operation.actor_id = app.current_actor_id()
      and operation.project_id = agent_screenshot_artifacts.project_id
      and operation.operation_id = agent_screenshot_artifacts.operation_id
      and operation.candidate_digest = agent_screenshot_artifacts.candidate_sha256
      and agent_screenshot_artifacts.draft_version = coalesce(
        operation.committed_draft_version,
        operation.base_draft_version + 1
      )
  )
);

grant select, insert, update on app.agent_screenshot_artifacts to easy_dashboard_runtime;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'easy-dashboard-agent-screenshots',
  'easy-dashboard-agent-screenshots',
  false,
  10485760,
  array['image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function app.can_access_agent_screenshot_object(object_name text, required_status text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from app.agent_screenshot_artifacts artifact
      join app.agent_spike_operations operation on operation.id = artifact.agent_operation_id
      join app.projects project on project.id = artifact.project_id
      join app.project_members member on member.project_id = project.id
      where artifact.storage_path = object_name
        and artifact.actor_id = (select auth.uid())
        and operation.actor_id = artifact.actor_id
        and operation.project_id = artifact.project_id
        and operation.operation_id = artifact.operation_id
        and operation.candidate_digest = artifact.candidate_sha256
        and artifact.draft_version = coalesce(operation.committed_draft_version, operation.base_draft_version + 1)
        and (required_status is null or artifact.status = required_status)
        and project.deleted_at is null
        and member.user_id = (select auth.uid())
        and member.role in ('owner', 'editor')
    )
$$;

revoke all on function app.can_access_agent_screenshot_object(text, text)
  from public, anon, authenticated;
grant execute on function app.can_access_agent_screenshot_object(text, text)
  to authenticated;

create policy easy_dashboard_agent_screenshot_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'easy-dashboard-agent-screenshots'
  and app.can_access_agent_screenshot_object(name, 'uploading')
);

create policy easy_dashboard_agent_screenshot_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'easy-dashboard-agent-screenshots'
  and app.can_access_agent_screenshot_object(name)
);

create policy easy_dashboard_agent_screenshot_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'easy-dashboard-agent-screenshots'
  and app.can_access_agent_screenshot_object(name, 'failed')
);
