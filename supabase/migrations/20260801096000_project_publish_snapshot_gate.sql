create table app.project_publish_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references app.projects(id) on delete cascade,
  draft_version integer not null check (draft_version > 0),
  document jsonb not null,
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (project_id, draft_version),
  unique (id, project_id),
  unique (id, project_id, document_sha256)
);

create index project_publish_snapshots_project_created_idx
  on app.project_publish_snapshots(project_id, created_at desc);

create table app.project_preview_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  publish_snapshot_id uuid not null,
  source text not null check (source in ('agent_executor', 'owner_live_render_attestation')),
  status text not null check (status = 'verified'),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  renderer_version text not null check (char_length(renderer_version) between 1 and 160),
  renderer_sha256 text not null check (renderer_sha256 ~ '^[a-f0-9]{64}$'),
  evidence jsonb not null,
  agent_operation_id uuid references app.agent_spike_operations(id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint project_preview_runs_snapshot_fkey
    foreign key (publish_snapshot_id, project_id, document_sha256)
    references app.project_publish_snapshots(id, project_id, document_sha256)
    on delete cascade,
  constraint project_preview_runs_source_operation_check check (
    (source = 'agent_executor' and agent_operation_id is not null)
    or (source = 'owner_live_render_attestation' and agent_operation_id is null)
  ),
  unique (publish_snapshot_id),
  unique (id, publish_snapshot_id, project_id),
  unique (agent_operation_id)
);

create table app.project_publish_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  publish_snapshot_id uuid not null,
  preview_run_id uuid not null,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_release_id uuid,
  constraint project_publish_approvals_snapshot_fkey
    foreign key (publish_snapshot_id, project_id)
    references app.project_publish_snapshots(id, project_id)
    on delete cascade,
  constraint project_publish_approvals_preview_fkey
    foreign key (preview_run_id, publish_snapshot_id, project_id)
    references app.project_preview_runs(id, publish_snapshot_id, project_id)
    on delete cascade,
  constraint project_publish_approvals_consumed_check check (
    (consumed_at is null and consumed_release_id is null)
    or (consumed_at is not null and consumed_release_id is not null)
  ),
  unique (publish_snapshot_id)
);

alter table app.project_releases
  add column publish_snapshot_id uuid references app.project_publish_snapshots(id) on delete restrict;

create unique index project_releases_publish_snapshot_uidx
  on app.project_releases(publish_snapshot_id)
  where publish_snapshot_id is not null;

alter table app.project_publish_approvals
  add constraint project_publish_approvals_consumed_release_fkey
  foreign key (consumed_release_id) references app.project_releases(id) on delete cascade;

create function app.reject_publish_gate_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and pg_trigger_depth() > 1
    and not exists (
      select 1 from app.projects project where project.id = old.project_id
    )
  then
    return old;
  end if;
  raise exception 'publish snapshots and preview evidence are immutable' using errcode = '55000';
end
$$;

revoke all on function app.reject_publish_gate_mutation() from public, anon, authenticated;
grant execute on function app.reject_publish_gate_mutation() to easy_dashboard_runtime;

create trigger project_publish_snapshots_immutable
before update or delete on app.project_publish_snapshots
for each row execute function app.reject_publish_gate_mutation();

create trigger project_preview_runs_immutable
before update or delete on app.project_preview_runs
for each row execute function app.reject_publish_gate_mutation();

create function app.consume_publish_approval_once()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and pg_trigger_depth() > 1
    and not exists (
      select 1 from app.projects project where project.id = old.project_id
    )
  then
    return old;
  end if;

  if tg_op = 'UPDATE'
    and old.consumed_at is null
    and old.consumed_release_id is null
    and new.consumed_at is not null
    and new.consumed_release_id is not null
    and new.id = old.id
    and new.project_id = old.project_id
    and new.publish_snapshot_id = old.publish_snapshot_id
    and new.preview_run_id = old.preview_run_id
    and new.approved_by = old.approved_by
    and new.approved_at = old.approved_at
  then
    return new;
  end if;

  raise exception 'publish approvals may only be consumed once' using errcode = '55000';
end
$$;

revoke all on function app.consume_publish_approval_once() from public, anon, authenticated;
grant execute on function app.consume_publish_approval_once() to easy_dashboard_runtime;

create trigger project_publish_approvals_consume_once
before update or delete on app.project_publish_approvals
for each row execute function app.consume_publish_approval_once();

alter table app.project_publish_snapshots enable row level security;
alter table app.project_publish_snapshots force row level security;
alter table app.project_preview_runs enable row level security;
alter table app.project_preview_runs force row level security;
alter table app.project_publish_approvals enable row level security;
alter table app.project_publish_approvals force row level security;

create policy publish_snapshots_member_select on app.project_publish_snapshots
for select to easy_dashboard_runtime
using (app.current_project_member_role(project_id) is not null);

create policy publish_snapshots_editor_insert on app.project_publish_snapshots
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy preview_runs_member_select on app.project_preview_runs
for select to easy_dashboard_runtime
using (app.current_project_member_role(project_id) is not null);

create policy preview_runs_editor_insert on app.project_preview_runs
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and (
    (source = 'agent_executor' and app.current_project_member_role(project_id) in ('owner', 'editor'))
    or (source = 'owner_live_render_attestation' and app.current_project_member_role(project_id) = 'owner')
  )
  and exists (
    select 1
    from app.project_publish_snapshots snapshot
    where snapshot.id = publish_snapshot_id
      and snapshot.project_id = project_preview_runs.project_id
      and snapshot.document_sha256 = project_preview_runs.document_sha256
  )
);

create policy publish_approvals_member_select on app.project_publish_approvals
for select to easy_dashboard_runtime
using (app.current_project_member_role(project_id) is not null);

create policy publish_approvals_owner_insert on app.project_publish_approvals
for insert to easy_dashboard_runtime
with check (
  approved_by = app.current_actor_id()
  and app.current_project_member_role(project_id) = 'owner'
  and exists (
    select 1
    from app.project_preview_runs preview
    where preview.id = preview_run_id
      and preview.publish_snapshot_id = project_publish_approvals.publish_snapshot_id
      and preview.project_id = project_publish_approvals.project_id
      and preview.status = 'verified'
  )
);

create policy publish_approvals_owner_update on app.project_publish_approvals
for update to easy_dashboard_runtime
using (app.current_project_member_role(project_id) = 'owner')
with check (app.current_project_member_role(project_id) = 'owner');

drop policy revisions_member_insert on app.project_revisions;
create policy revisions_member_insert on app.project_revisions
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and (
    (kind = 'publish' and app.current_project_member_role(project_id) = 'owner')
    or (kind <> 'publish' and app.current_project_member_role(project_id) in ('owner', 'editor'))
  )
);

drop policy publications_member_insert on app.project_publications;
create policy publications_owner_insert on app.project_publications
for insert to easy_dashboard_runtime
with check (app.current_project_member_role(project_id) = 'owner');

drop policy publications_member_update on app.project_publications;
create policy publications_owner_update on app.project_publications
for update to easy_dashboard_runtime
using (app.current_project_member_role(project_id) = 'owner')
with check (app.current_project_member_role(project_id) = 'owner');

drop policy publications_member_delete on app.project_publications;
create policy publications_owner_delete on app.project_publications
for delete to easy_dashboard_runtime
using (app.current_project_member_role(project_id) = 'owner');

drop policy releases_owner_insert on app.project_releases;
create policy releases_owner_insert on app.project_releases
for insert to easy_dashboard_runtime
with check (
  published_by = app.current_actor_id()
  and app.current_project_member_role(project_id) = 'owner'
  and publish_snapshot_id is not null
);

grant select, insert on app.project_publish_snapshots to easy_dashboard_runtime;
grant select, insert on app.project_preview_runs to easy_dashboard_runtime;
grant select, insert on app.project_publish_approvals to easy_dashboard_runtime;
grant update(consumed_at, consumed_release_id) on app.project_publish_approvals to easy_dashboard_runtime;
