create table app.project_members (
  project_id uuid not null references app.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  primary key (project_id, user_id)
);

create index project_members_user_idx
  on app.project_members(user_id, project_id);

insert into app.project_members (project_id, user_id, role, created_by)
select id, owner_id, 'owner', owner_id
from app.projects
on conflict (project_id, user_id) do nothing;

alter table app.project_members enable row level security;
alter table app.project_members force row level security;

create or replace function app.current_project_member_role(target_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from app.project_members member
  where member.project_id = target_project_id
    and member.user_id = app.current_actor_id()
  limit 1
$$;

revoke all on function app.current_project_member_role(uuid) from public, anon, authenticated;
grant execute on function app.current_project_member_role(uuid) to easy_dashboard_runtime;

create function app.is_project_creator(target_project_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.projects project
    where project.id = target_project_id
      and project.owner_id = target_user_id
  )
$$;

revoke all on function app.is_project_creator(uuid, uuid) from public, anon, authenticated;
grant execute on function app.is_project_creator(uuid, uuid) to easy_dashboard_runtime;

create function app.reject_final_project_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and pg_trigger_depth() > 1
    and (
      not exists (
        select 1 from app.projects project where project.id = old.project_id
      )
      or (
        not exists (
          select 1 from auth.users actor where actor.id = old.user_id
        )
        and exists (
          select 1
          from app.projects project
          where project.id = old.project_id
            and project.owner_id = old.user_id
        )
      )
    )
  then
    return old;
  end if;

  if old.role <> 'owner' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(old.project_id::text || ':project-members', 0)
  );

  if not exists (
    select 1
    from app.project_members member
    where member.project_id = old.project_id
      and member.user_id <> old.user_id
      and member.role = 'owner'
  ) then
    raise exception 'cannot remove or demote the final project owner'
      using errcode = '23514', constraint = 'project_members_require_owner';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function app.reject_final_project_owner_removal() from public, anon, authenticated;

create trigger project_members_require_owner
before update of role or delete on app.project_members
for each row execute function app.reject_final_project_owner_removal();

create policy project_members_member_select on app.project_members
for select to easy_dashboard_runtime
using (app.current_project_member_role(project_id) is not null);

create policy project_members_owner_insert on app.project_members
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and (
    app.current_project_member_role(project_id) = 'owner'
    or (
      user_id = app.current_actor_id()
      and role = 'owner'
      and app.is_project_creator(project_id, app.current_actor_id())
    )
  )
);

create policy project_members_owner_update on app.project_members
for update to easy_dashboard_runtime
using (app.current_project_member_role(project_id) = 'owner')
with check (
  app.current_project_member_role(project_id) = 'owner'
  or (
    user_id = app.current_actor_id()
    and exists (
      select 1
      from app.project_members other_owner
      where other_owner.project_id = project_members.project_id
        and other_owner.user_id <> app.current_actor_id()
        and other_owner.role = 'owner'
    )
  )
);

create policy project_members_owner_delete on app.project_members
for delete to easy_dashboard_runtime
using (app.current_project_member_role(project_id) = 'owner');

grant select, insert, delete on app.project_members to easy_dashboard_runtime;
grant update(role) on app.project_members to easy_dashboard_runtime;

drop policy projects_owner_select on app.projects;
create policy projects_owner_select on app.projects
for select to easy_dashboard_runtime
using (
  app.current_project_member_role(id) is not null
  or (
    deleted_at is null
    and exists (
      select 1
      from app.project_publications publication
      where publication.project_id = projects.id
        and publication.slug = app.current_public_slug()
        and publication.is_published
    )
  )
);

drop policy projects_member_insert on app.projects;
create policy projects_member_insert on app.projects
for insert to easy_dashboard_runtime
with check (owner_id = app.current_actor_id());

drop policy projects_member_update on app.projects;
create policy projects_member_update on app.projects
for update to easy_dashboard_runtime
using (app.current_project_member_role(id) in ('owner', 'editor'))
with check (app.current_project_member_role(id) in ('owner', 'editor'));

drop policy projects_member_delete on app.projects;
create policy projects_member_delete on app.projects
for delete to easy_dashboard_runtime
using (app.current_project_member_role(id) in ('owner', 'editor'));

create or replace function app.can_access_project_for_user(
  target_project_id text,
  target_user_id uuid,
  require_edit boolean,
  include_deleted boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.projects project
    join app.project_members member on member.project_id = project.id
    where project.id::text = target_project_id
      and (include_deleted or project.deleted_at is null)
      and member.user_id = target_user_id
      and (not require_edit or member.role in ('owner', 'editor'))
  )
$$;

create or replace function app.can_upload_thumbnail_object(
  object_name text,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.project_thumbnail_artifacts artifact
    join app.projects project on project.id = artifact.project_id
    join app.project_members member on member.project_id = project.id
    where artifact.path = object_name
      and artifact.status = 'pending'
      and artifact.created_by = target_user_id
      and artifact.expires_at > now()
      and project.deleted_at is null
      and member.user_id = target_user_id
      and member.role in ('owner', 'editor')
  )
$$;

create or replace function app.can_delete_thumbnail_object(
  object_name text,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.project_thumbnail_artifacts artifact
    join app.projects project on project.id = artifact.project_id
    join app.project_members member on member.project_id = project.id
    where artifact.path = object_name
      and artifact.status = 'cleanup_pending'
      and member.user_id = target_user_id
      and member.role in ('owner', 'editor')
  )
$$;

create or replace function app.can_upload_agent_asset_object(object_name text)
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
      join app.project_members member on member.project_id = project.id
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
