-- Only evidence emitted by a committed, digest-bound isolated executor may
-- satisfy the publish gate. Browser-uploaded thumbnails remain useful covers,
-- but are not a trusted renderer attestation.
drop policy if exists preview_runs_editor_insert on app.project_preview_runs;
create policy preview_runs_editor_insert on app.project_preview_runs
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and source = 'agent_executor'
  and app.current_project_member_role(project_id) in ('owner', 'editor')
  and exists (
    select 1
    from app.agent_spike_operations operation
    join app.project_publish_snapshots snapshot
      on snapshot.id = project_preview_runs.publish_snapshot_id
     and snapshot.project_id = project_preview_runs.project_id
    where operation.id = project_preview_runs.agent_operation_id
      and operation.actor_id = app.current_actor_id()
      and operation.project_id = project_preview_runs.project_id
      and operation.status = 'committed'
      and operation.candidate_digest = snapshot.document_sha256
      and operation.evidence = project_preview_runs.evidence
      and operation.compatibility ->> 'rendererVersion' = project_preview_runs.renderer_version
      and operation.compatibility ->> 'rendererSha256' = project_preview_runs.renderer_sha256
      and project_preview_runs.document_sha256 = snapshot.document_sha256
      and jsonb_typeof(project_preview_runs.evidence -> 'consoleErrors') = 'array'
      and jsonb_array_length(project_preview_runs.evidence -> 'consoleErrors') = 0
      and jsonb_typeof(project_preview_runs.evidence -> 'requestFailures') = 'array'
      and jsonb_array_length(project_preview_runs.evidence -> 'requestFailures') = 0
      and project_preview_runs.evidence #>> '{render,status}' = 'rendered'
      and project_preview_runs.evidence #>> '{render,screenshotSha256}' ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(project_preview_runs.evidence #> '{render,resourceErrors}') = 'array'
      and jsonb_array_length(project_preview_runs.evidence #> '{render,resourceErrors}') = 0
      and jsonb_typeof(project_preview_runs.evidence #> '{materials,missing}') = 'array'
      and jsonb_array_length(project_preview_runs.evidence #> '{materials,missing}') = 0
  )
);

drop policy if exists publish_approvals_owner_insert on app.project_publish_approvals;
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
      and preview.source = 'agent_executor'
  )
);

-- A shared project is a project-level aggregate. Editors may edit and trash it,
-- but only an Owner may irreversibly delete that aggregate.
drop policy if exists projects_member_delete on app.projects;
create policy projects_owner_delete on app.projects
for delete to easy_dashboard_runtime
using (app.current_project_member_role(id) = 'owner');

-- Prepare every collaborator-owned Agent asset for deletion without exposing
-- private attachment metadata through normal SELECT policies. The function
-- returns only exact Storage paths and is callable only by the Hono runtime.
create or replace function app.prepare_project_agent_asset_cleanup(
  target_project_id uuid,
  target_deleted_at timestamptz
)
returns table(storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_project_id::text || ':permanent-delete', 0));

  if not exists (
    select 1
    from app.projects project
    join app.project_members member on member.project_id = project.id
    where project.id = target_project_id
      and project.deleted_at = target_deleted_at
      and member.user_id = app.current_actor_id()
      and member.role = 'owner'
  ) then
    return;
  end if;

  update app.agent_assets asset
  set status = 'deleted',
      sha256 = null,
      extracted_text = null,
      model_input_status = null,
      model_input_bytes = null,
      model_input_content_type = null,
      model_input_sha256 = null,
      model_input_size = null,
      storage_cleanup_status = case
        when asset.status = 'deleted' and asset.storage_cleanup_status = 'completed' then 'completed'
        else 'pending'
      end,
      storage_cleanup_last_error = case
        when asset.status = 'deleted' and asset.storage_cleanup_status = 'completed' then null
        else asset.storage_cleanup_last_error
      end,
      storage_cleanup_completed_at = case
        when asset.status = 'deleted' and asset.storage_cleanup_status = 'completed'
          then asset.storage_cleanup_completed_at
        else null
      end,
      updated_at = clock_timestamp()
  where asset.project_id = target_project_id;

  return query
  select asset.storage_path
  from app.agent_assets asset
  where asset.project_id = target_project_id
    and asset.status = 'deleted'
    and asset.storage_cleanup_status = 'pending'
  order by asset.created_at, asset.id;
end
$$;

create or replace function app.finish_project_agent_asset_cleanup(
  target_project_id uuid,
  target_deleted_at timestamptz,
  deletion_succeeded boolean,
  failure_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_project_id::text || ':permanent-delete', 0));

  if not exists (
    select 1
    from app.projects project
    join app.project_members member on member.project_id = project.id
    where project.id = target_project_id
      and project.deleted_at = target_deleted_at
      and member.user_id = app.current_actor_id()
      and member.role = 'owner'
  ) then
    return false;
  end if;

  if deletion_succeeded then
    update app.agent_assets asset
    set storage_cleanup_status = 'completed',
        storage_cleanup_attempts = asset.storage_cleanup_attempts + 1,
        storage_cleanup_last_error = null,
        storage_cleanup_completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where asset.project_id = target_project_id
      and asset.status = 'deleted'
      and asset.storage_cleanup_status = 'pending';
  else
    update app.agent_assets asset
    set storage_cleanup_attempts = asset.storage_cleanup_attempts + 1,
        storage_cleanup_last_error = left(coalesce(nullif(failure_message, ''), 'storage-delete-failed'), 1000),
        updated_at = clock_timestamp()
    where asset.project_id = target_project_id
      and asset.status = 'deleted'
      and asset.storage_cleanup_status = 'pending';
  end if;

  return true;
end
$$;

revoke all on function app.prepare_project_agent_asset_cleanup(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app.finish_project_agent_asset_cleanup(uuid, timestamptz, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function app.prepare_project_agent_asset_cleanup(uuid, timestamptz)
  to easy_dashboard_runtime;
grant execute on function app.finish_project_agent_asset_cleanup(uuid, timestamptz, boolean, text)
  to easy_dashboard_runtime;

-- Supabase Storage evaluates policies as `authenticated`, not as the Hono DB
-- role. This narrow helper lets an Owner remove another collaborator's exact
-- object only after the project-level cleanup transaction tombstoned it.
create or replace function app.can_delete_agent_asset_object(object_name text)
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
      from app.agent_assets asset
      where asset.storage_path = object_name
        and asset.status = 'deleted'
        and asset.storage_cleanup_status = 'pending'
        and (
          asset.actor_id = (select auth.uid())
          or exists (
            select 1
            from app.project_members member
            where member.project_id = asset.project_id
              and member.user_id = (select auth.uid())
              and member.role = 'owner'
          )
        )
    )
$$;

revoke all on function app.can_delete_agent_asset_object(text)
  from public, anon, easy_dashboard_runtime, service_role;
grant execute on function app.can_delete_agent_asset_object(text)
  to authenticated;

drop policy if exists easy_dashboard_agent_asset_delete on storage.objects;
create policy easy_dashboard_agent_asset_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'easy-dashboard-agent-assets'
  and app.can_delete_agent_asset_object(name)
);
