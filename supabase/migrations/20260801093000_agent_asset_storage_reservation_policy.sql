create or replace function app.can_upload_agent_asset_object(
  object_name text
)
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
      join app.projects project on project.id = asset.project_id
      join app.space_members member on member.space_id = project.space_id
      where asset.storage_path = object_name
        and asset.actor_id = (select auth.uid())
        and asset.status = 'uploading'
        and project.deleted_at is null
        and member.user_id = (select auth.uid())
        and member.role in ('owner', 'editor')
        and (
          select count(*)
          from app.agent_assets active_asset
          where active_asset.actor_id = asset.actor_id
            and active_asset.project_id = asset.project_id
            and active_asset.status in ('uploading', 'processing', 'ready')
        ) <= 200
        and (
          select coalesce(sum(active_asset.size), 0)
          from app.agent_assets active_asset
          where active_asset.actor_id = asset.actor_id
            and active_asset.project_id = asset.project_id
            and active_asset.status in ('uploading', 'processing', 'ready')
        ) <= 209715200
    )
$$;

revoke all on function app.can_upload_agent_asset_object(text)
  from public, anon, authenticated;
grant execute on function app.can_upload_agent_asset_object(text)
  to authenticated;

drop policy if exists easy_dashboard_agent_asset_insert on storage.objects;
create policy easy_dashboard_agent_asset_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'easy-dashboard-agent-assets'
  and app.can_upload_agent_asset_object(name)
);
