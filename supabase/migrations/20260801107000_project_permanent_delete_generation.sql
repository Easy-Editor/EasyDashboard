alter table app.projects
add column permanent_delete_token uuid,
add column permanent_delete_started_at timestamptz,
add constraint projects_permanent_delete_state_check check (
  (
    permanent_delete_token is null
    and permanent_delete_started_at is null
  )
  or (
    permanent_delete_token is not null
    and permanent_delete_started_at is not null
    and deleted_at is not null
  )
);

revoke all on function app.prepare_project_agent_asset_cleanup(uuid, timestamptz)
  from public, anon, authenticated, service_role, easy_dashboard_runtime;
revoke all on function app.finish_project_agent_asset_cleanup(uuid, timestamptz, boolean, text)
  from public, anon, authenticated, service_role, easy_dashboard_runtime;
drop function app.prepare_project_agent_asset_cleanup(uuid, timestamptz);
drop function app.finish_project_agent_asset_cleanup(uuid, timestamptz, boolean, text);

-- Claim a durable generation before any object is removed. The project-level
-- state check makes restoring deleted_at impossible while this token exists,
-- including for direct runtime SQL that bypasses the repository method.
create function app.prepare_project_agent_asset_cleanup(
  target_project_id uuid,
  target_deleted_at timestamptz,
  target_delete_token uuid
)
returns table(storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion_claimed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_project_id::text || ':permanent-delete', 0));

  if target_delete_token is null then
    return;
  end if;

  update app.projects project
  set permanent_delete_token = coalesce(project.permanent_delete_token, target_delete_token),
      permanent_delete_started_at = coalesce(project.permanent_delete_started_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where project.id = target_project_id
    and project.deleted_at = target_deleted_at
    and (
      project.permanent_delete_token is null
      or project.permanent_delete_token = target_delete_token
    )
    and exists (
      select 1
      from app.project_members member
      where member.project_id = project.id
        and member.user_id = app.current_actor_id()
        and member.role = 'owner'
    )
  returning true into deletion_claimed;

  if not coalesce(deletion_claimed, false) then
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

create function app.finish_project_agent_asset_cleanup(
  target_project_id uuid,
  target_deleted_at timestamptz,
  target_delete_token uuid,
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

  if target_delete_token is null or not exists (
    select 1
    from app.projects project
    join app.project_members member on member.project_id = project.id
    where project.id = target_project_id
      and project.deleted_at = target_deleted_at
      and project.permanent_delete_token = target_delete_token
      and project.permanent_delete_started_at is not null
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

revoke all on function app.prepare_project_agent_asset_cleanup(uuid, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app.finish_project_agent_asset_cleanup(uuid, timestamptz, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function app.prepare_project_agent_asset_cleanup(uuid, timestamptz, uuid)
  to easy_dashboard_runtime;
grant execute on function app.finish_project_agent_asset_cleanup(uuid, timestamptz, uuid, boolean, text)
  to easy_dashboard_runtime;
