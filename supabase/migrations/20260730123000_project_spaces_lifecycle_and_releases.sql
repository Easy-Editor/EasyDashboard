create table app.spaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal', 'team')),
  name text not null check (char_length(name) between 1 and 120),
  personal_owner_id uuid references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'personal' and personal_owner_id is not null and personal_owner_id = created_by)
    or (kind = 'team' and personal_owner_id is null)
  )
);

create unique index spaces_personal_owner_uidx
  on app.spaces(personal_owner_id)
  where personal_owner_id is not null;

create table app.space_members (
  space_id uuid not null references app.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

insert into app.spaces (kind, name, personal_owner_id, created_by)
select 'personal', 'Personal space', owner_id, owner_id
from app.projects
group by owner_id
on conflict (personal_owner_id) where personal_owner_id is not null do nothing;

insert into app.space_members (space_id, user_id, role)
select id, personal_owner_id, 'owner'
from app.spaces
where kind = 'personal'
on conflict (space_id, user_id) do nothing;

alter table app.projects
  add column space_id uuid references app.spaces(id) on delete restrict,
  add column cover_url text,
  add column page_count integer not null default 1 check (page_count > 0),
  add column canvas_width integer not null default 1920 check (canvas_width > 0),
  add column canvas_height integer not null default 1080 check (canvas_height > 0),
  add column start_page_id text,
  add column draft_saved_at timestamptz not null default now(),
  add column thumbnail_mode text not null default 'auto'
    check (thumbnail_mode in ('auto', 'custom')),
  add column thumbnail_status text not null default 'queued'
    check (thumbnail_status in ('queued', 'rendering', 'ready', 'failed')),
  add column thumbnail_path text,
  add column thumbnail_url text,
  add column thumbnail_draft_version integer
    check (thumbnail_draft_version is null or thumbnail_draft_version > 0),
  add column thumbnail_error_code text,
  add column thumbnail_requested_version integer
    check (thumbnail_requested_version is null or thumbnail_requested_version > 0),
  add column thumbnail_pending_path text,
  add column thumbnail_pending_content_type text
    check (
      thumbnail_pending_content_type is null
      or thumbnail_pending_content_type in ('image/webp', 'image/svg+xml')
    ),
  add column thumbnail_pending_size integer
    check (
      thumbnail_pending_size is null
      or thumbnail_pending_size between 1 and 10485760
    ),
  add column deleted_at timestamptz;

update app.projects project
set space_id = space.id
from app.spaces space
where space.personal_owner_id = project.owner_id
  and project.space_id is null;

alter table app.projects alter column space_id set not null;

update app.projects
set
  page_count = greatest(
    1,
    coalesce(
      jsonb_array_length(
        case
          when jsonb_typeof(draft_schema -> 'editorSchema' -> 'componentsTree') = 'array'
            then draft_schema -> 'editorSchema' -> 'componentsTree'
          when jsonb_typeof(draft_schema -> 'componentsTree') = 'array'
            then draft_schema -> 'componentsTree'
          else '[]'::jsonb
        end
      ),
      0
    )
  ),
  start_page_id = coalesce(
    draft_schema #>> '{presentation,startPageId}',
    draft_schema #>> '{editorSchema,componentsTree,0,meta,easyDashboard,pageId}',
    draft_schema #>> '{editorSchema,componentsTree,0,docId}',
    draft_schema #>> '{editorSchema,componentsTree,0,id}',
    draft_schema #>> '{componentsTree,0,meta,easyDashboard,pageId}',
    draft_schema #>> '{componentsTree,0,docId}',
    draft_schema #>> '{componentsTree,0,id}'
  ),
  canvas_width = coalesce(
    case
      when jsonb_typeof(draft_schema #> '{editorSchema,componentsTree,0,$dashboard,rect,width}') = 'number'
        then (draft_schema #>> '{editorSchema,componentsTree,0,$dashboard,rect,width}')::numeric::integer
      when jsonb_typeof(draft_schema #> '{componentsTree,0,$dashboard,rect,width}') = 'number'
        then (draft_schema #>> '{componentsTree,0,$dashboard,rect,width}')::numeric::integer
    end,
    1920
  ),
  canvas_height = coalesce(
    case
      when jsonb_typeof(draft_schema #> '{editorSchema,componentsTree,0,$dashboard,rect,height}') = 'number'
        then (draft_schema #>> '{editorSchema,componentsTree,0,$dashboard,rect,height}')::numeric::integer
      when jsonb_typeof(draft_schema #> '{componentsTree,0,$dashboard,rect,height}') = 'number'
        then (draft_schema #>> '{componentsTree,0,$dashboard,rect,height}')::numeric::integer
    end,
    1080
  ),
  draft_saved_at = updated_at;

create index projects_space_updated_idx on app.projects(space_id, updated_at desc);
create index projects_owner_deleted_updated_idx
  on app.projects(owner_id, deleted_at, updated_at desc);

create table app.project_thumbnail_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references app.projects(id) on delete set null,
  path text not null unique check (char_length(path) between 1 and 512),
  status text not null check (status in ('pending', 'current', 'cleanup_pending', 'deleted')),
  draft_version integer not null check (draft_version > 0),
  mode text not null check (mode in ('auto', 'custom')),
  source text not null check (source in ('renderer', 'blueprint', 'custom')),
  content_type text not null check (content_type in ('image/webp', 'image/svg+xml')),
  expected_size integer not null check (expected_size between 1 and 10485760),
  expires_at timestamptz not null,
  cleanup_attempts integer not null default 0 check (cleanup_attempts >= 0),
  next_cleanup_at timestamptz,
  cleanup_lease_token uuid,
  cleanup_lease_until timestamptz,
  last_error text,
  -- Keep the uploader UUID as historical attribution after auth-user removal.
  -- Cleanup must never lose its ledger row because a user was deleted.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (project_id is not null or status in ('cleanup_pending', 'deleted'))
);

create index project_thumbnail_artifacts_cleanup_idx
  on app.project_thumbnail_artifacts(project_id, status, next_cleanup_at);

create index project_thumbnail_artifacts_global_cleanup_idx
  on app.project_thumbnail_artifacts(
    status,
    next_cleanup_at,
    expires_at,
    cleanup_lease_until
  );

create function app.schedule_project_thumbnail_cleanup_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  delete_now timestamptz := clock_timestamp();
begin
  update app.project_thumbnail_artifacts artifact
  set
    status = 'cleanup_pending',
    next_cleanup_at = greatest(artifact.expires_at, delete_now),
    cleanup_lease_token = null,
    cleanup_lease_until = null,
    last_error = case
      when artifact.status = 'pending' then 'project-deleted-before-upload-complete'
      else 'project-deleted'
    end,
    updated_at = delete_now
  where artifact.project_id = old.id
    and artifact.status in ('pending', 'current');

  return old;
end
$$;

revoke all on function app.schedule_project_thumbnail_cleanup_on_delete()
  from public, anon, authenticated, easy_dashboard_runtime, service_role;

create trigger projects_schedule_thumbnail_cleanup_before_delete
before delete on app.projects
for each row execute function app.schedule_project_thumbnail_cleanup_on_delete();

create table app.project_favorites (
  project_id uuid not null references app.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Existing installations created this historical attribution column with an
-- auth.users RESTRICT foreign key. Drop only that FK so account deletion can
-- cascade through the user's projects while immutable revision UUID
-- attribution remains available for audit history.
alter table app.project_revisions
  drop constraint if exists project_revisions_created_by_fkey;

-- Existing installations used a restrictive publication -> revision FK.
-- Direct revision deletion is still rejected by the immutable trigger, while
-- the cascade lets project/account deletion remove the whole aggregate.
alter table app.project_publications
  drop constraint if exists project_publications_revision_id_project_id_fkey,
  drop constraint if exists project_publications_revision_project_fkey;
alter table app.project_publications
  add constraint project_publications_revision_project_fkey
  foreign key (revision_id, project_id)
  references app.project_revisions(id, project_id)
  on delete cascade;

create or replace function app.reject_revision_mutation()
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
  raise exception 'project revisions are immutable' using errcode = '55000';
end
$$;

alter table app.project_revisions
  add column kind text not null default 'publish'
  check (kind in ('auto', 'manual', 'pre_restore', 'publish')),
  add column label text check (label is null or char_length(label) between 1 and 120),
  add column source_draft_version integer not null default 1
  check (source_draft_version > 0);

alter table app.project_publications
  add column is_published boolean not null default true;

create table app.project_releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references app.projects(id) on delete cascade,
  release_number integer not null check (release_number > 0),
  revision_id uuid not null references app.project_revisions(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  -- Historical attribution intentionally survives auth-user removal.
  published_by uuid not null,
  published_at timestamptz not null default now(),
  unique (project_id, release_number),
  unique (revision_id)
);

insert into app.project_releases (
  project_id,
  release_number,
  revision_id,
  name,
  description,
  published_by,
  published_at
)
select
  revision.project_id,
  row_number() over (
    partition by revision.project_id
    order by revision.revision_number, revision.created_at, revision.id
  )::integer,
  revision.id,
  project.name,
  project.description,
  revision.created_by,
  revision.created_at
from app.project_revisions revision
join app.projects project on project.id = revision.project_id;

create index project_releases_project_published_idx
  on app.project_releases(project_id, published_at desc);

create function app.reject_release_mutation()
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
  raise exception 'project releases are immutable' using errcode = '55000';
end
$$;

revoke all on function app.reject_release_mutation() from public, anon, authenticated;
grant execute on function app.reject_release_mutation() to easy_dashboard_runtime;

create trigger project_releases_immutable
before update or delete on app.project_releases
for each row execute function app.reject_release_mutation();

alter table app.spaces enable row level security;
alter table app.spaces force row level security;
alter table app.space_members enable row level security;
alter table app.space_members force row level security;
alter table app.project_releases enable row level security;
alter table app.project_releases force row level security;
alter table app.project_thumbnail_artifacts enable row level security;
alter table app.project_thumbnail_artifacts force row level security;
alter table app.project_favorites enable row level security;
alter table app.project_favorites force row level security;

create policy spaces_member_select on app.spaces
for select to easy_dashboard_runtime
using (
  personal_owner_id = app.current_actor_id()
  or exists (
    select 1 from app.space_members member
    where member.space_id = spaces.id
      and member.user_id = app.current_actor_id()
  )
);

create policy spaces_personal_insert on app.spaces
for insert to easy_dashboard_runtime
with check (
  kind = 'personal'
  and personal_owner_id = app.current_actor_id()
  and created_by = app.current_actor_id()
);

create policy spaces_owner_update on app.spaces
for update to easy_dashboard_runtime
using (
  personal_owner_id = app.current_actor_id()
  or exists (
    select 1 from app.space_members member
    where member.space_id = spaces.id
      and member.user_id = app.current_actor_id()
      and member.role = 'owner'
  )
)
with check (
  personal_owner_id = app.current_actor_id()
  or exists (
    select 1 from app.space_members member
    where member.space_id = spaces.id
      and member.user_id = app.current_actor_id()
      and member.role = 'owner'
  )
);

create policy space_members_member_select on app.space_members
for select to easy_dashboard_runtime
using (user_id = app.current_actor_id());

create policy space_members_personal_owner_insert on app.space_members
for insert to easy_dashboard_runtime
with check (
  user_id = app.current_actor_id()
  and role = 'owner'
  and exists (
    select 1 from app.spaces space
    where space.id = space_members.space_id
      and space.kind = 'personal'
      and space.personal_owner_id = app.current_actor_id()
  )
);

create function app.current_project_member_role(target_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from app.projects project
  join app.space_members member on member.space_id = project.space_id
  where project.id = target_project_id
    and member.user_id = app.current_actor_id()
  limit 1
$$;

create function app.is_public_project_visible(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.projects project
    join app.project_publications publication on publication.project_id = project.id
    where project.id = target_project_id
      and project.deleted_at is null
      and publication.is_published
      and publication.slug = app.current_public_slug()
  )
$$;

revoke all on function app.current_project_member_role(uuid) from public, anon, authenticated;
revoke all on function app.is_public_project_visible(uuid) from public, anon, authenticated;
grant execute on function app.current_project_member_role(uuid) to easy_dashboard_runtime;
grant execute on function app.is_public_project_visible(uuid) to easy_dashboard_runtime;

drop policy projects_owner_select on app.projects;
create policy projects_owner_select on app.projects
for select to easy_dashboard_runtime
using (
  exists (
    select 1 from app.space_members member
    where member.space_id = projects.space_id
      and member.user_id = app.current_actor_id()
  )
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

drop policy projects_owner_insert on app.projects;
create policy projects_member_insert on app.projects
for insert to easy_dashboard_runtime
with check (
  owner_id = app.current_actor_id()
  and exists (
    select 1 from app.space_members member
    where member.space_id = projects.space_id
      and member.user_id = app.current_actor_id()
      and member.role in ('owner', 'editor')
  )
);

drop policy projects_owner_update on app.projects;
create policy projects_member_update on app.projects
for update to easy_dashboard_runtime
using (
  exists (
    select 1 from app.space_members member
    where member.space_id = projects.space_id
      and member.user_id = app.current_actor_id()
      and member.role in ('owner', 'editor')
  )
)
with check (
  exists (
    select 1 from app.space_members member
    where member.space_id = projects.space_id
      and member.user_id = app.current_actor_id()
      and member.role in ('owner', 'editor')
  )
);

drop policy projects_owner_delete on app.projects;
create policy projects_member_delete on app.projects
for delete to easy_dashboard_runtime
using (
  exists (
    select 1 from app.space_members member
    where member.space_id = projects.space_id
      and member.user_id = app.current_actor_id()
      and member.role in ('owner', 'editor')
  )
);

drop policy revisions_owner_or_published_select on app.project_revisions;
create policy revisions_owner_or_published_select on app.project_revisions
for select to easy_dashboard_runtime
using (
  app.current_project_member_role(project_id) is not null
  or exists (
    select 1
    from app.project_releases release
    where release.revision_id = project_revisions.id
      and app.is_public_project_visible(release.project_id)
  )
);

drop policy revisions_owner_insert on app.project_revisions;
create policy revisions_member_insert on app.project_revisions
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

drop policy publications_read on app.project_publications;
create policy publications_read on app.project_publications
for select to easy_dashboard_runtime
using (
  app.current_project_member_role(project_id) is not null
  or (slug = app.current_public_slug() and is_published)
);

drop policy publications_owner_insert on app.project_publications;
create policy publications_member_insert on app.project_publications
for insert to easy_dashboard_runtime
with check (
  app.current_project_member_role(project_id) in ('owner', 'editor')
);

drop policy publications_owner_update on app.project_publications;
create policy publications_member_update on app.project_publications
for update to easy_dashboard_runtime
using (
  app.current_project_member_role(project_id) in ('owner', 'editor')
)
with check (
  app.current_project_member_role(project_id) in ('owner', 'editor')
);

drop policy publications_owner_delete on app.project_publications;
create policy publications_member_delete on app.project_publications
for delete to easy_dashboard_runtime
using (
  app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy releases_owner_or_published_select on app.project_releases
for select to easy_dashboard_runtime
using (
  app.current_project_member_role(project_id) is not null
  or app.is_public_project_visible(project_id)
);

create policy releases_owner_insert on app.project_releases
for insert to easy_dashboard_runtime
with check (
  published_by = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy thumbnail_artifacts_member_select on app.project_thumbnail_artifacts
for select to easy_dashboard_runtime
using (app.current_project_member_role(project_id) is not null);

create policy thumbnail_artifacts_member_insert on app.project_thumbnail_artifacts
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and app.current_project_member_role(project_id) in ('owner', 'editor')
);

create policy thumbnail_artifacts_member_update on app.project_thumbnail_artifacts
for update to easy_dashboard_runtime
using (app.current_project_member_role(project_id) in ('owner', 'editor'))
with check (app.current_project_member_role(project_id) in ('owner', 'editor'));

create policy favorites_member_select on app.project_favorites
for select to easy_dashboard_runtime
using (
  user_id = app.current_actor_id()
  and app.current_project_member_role(project_id) is not null
);

create policy favorites_member_insert on app.project_favorites
for insert to easy_dashboard_runtime
with check (
  user_id = app.current_actor_id()
  and app.current_project_member_role(project_id) is not null
);

create policy favorites_owner_delete on app.project_favorites
for delete to easy_dashboard_runtime
using (user_id = app.current_actor_id());

grant select, insert, update on app.spaces to easy_dashboard_runtime;
grant select, insert on app.space_members to easy_dashboard_runtime;
grant select, insert on app.project_releases to easy_dashboard_runtime;
grant select, insert, update on app.project_thumbnail_artifacts to easy_dashboard_runtime;
grant select, insert, delete on app.project_favorites to easy_dashboard_runtime;

create function app.claim_thumbnail_cleanup(
  claim_token uuid,
  claim_limit integer default 50,
  lease_seconds integer default 120
)
returns table (
  artifact_id uuid,
  object_path text,
  signed_upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_now timestamptz := clock_timestamp();
begin
  if claim_token is null then
    raise exception 'claim token is required' using errcode = '22023';
  end if;
  if claim_limit < 1 or claim_limit > 100 then
    raise exception 'claim limit must be between 1 and 100' using errcode = '22023';
  end if;
  if lease_seconds < 30 or lease_seconds > 900 then
    raise exception 'lease seconds must be between 30 and 900' using errcode = '22023';
  end if;

  update app.project_thumbnail_artifacts artifact
  set
    status = 'cleanup_pending',
    next_cleanup_at = greatest(artifact.expires_at, claim_now),
    cleanup_lease_token = null,
    cleanup_lease_until = null,
    last_error = 'upload-expired',
    updated_at = claim_now
  where artifact.status = 'pending'
    and artifact.expires_at <= claim_now;

  update app.projects project
  set
    thumbnail_status = 'failed',
    thumbnail_error_code = 'upload-expired',
    thumbnail_pending_path = null,
    thumbnail_pending_content_type = null,
    thumbnail_pending_size = null,
    updated_at = claim_now
  where project.thumbnail_pending_path is not null
    and exists (
      select 1
      from app.project_thumbnail_artifacts artifact
      where artifact.project_id = project.id
        and artifact.path = project.thumbnail_pending_path
        and artifact.status = 'cleanup_pending'
        and artifact.last_error = 'upload-expired'
        and artifact.expires_at <= claim_now
    );

  return query
  with candidates as (
    select artifact.id
    from app.project_thumbnail_artifacts artifact
    where artifact.status = 'cleanup_pending'
      and artifact.expires_at <= claim_now
      and coalesce(artifact.next_cleanup_at, artifact.expires_at) <= claim_now
      and (
        artifact.cleanup_lease_until is null
        or artifact.cleanup_lease_until <= claim_now
      )
      and not exists (
        select 1
        from app.projects project
        where project.id = artifact.project_id
          and project.thumbnail_path = artifact.path
      )
    order by coalesce(artifact.next_cleanup_at, artifact.expires_at), artifact.created_at
    for update of artifact skip locked
    limit claim_limit
  )
  update app.project_thumbnail_artifacts artifact
  set
    cleanup_lease_token = claim_token,
    cleanup_lease_until = claim_now + make_interval(secs => lease_seconds),
    updated_at = claim_now
  from candidates
  where artifact.id = candidates.id
  returning artifact.id, artifact.path, artifact.expires_at;
end
$$;

create function app.finish_thumbnail_cleanup(
  target_artifact_id uuid,
  claim_token uuid,
  deletion_succeeded boolean,
  failure_message text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  finish_now timestamptz := clock_timestamp();
  updated_artifact_id uuid;
begin
  if target_artifact_id is null or claim_token is null then
    raise exception 'artifact id and claim token are required' using errcode = '22023';
  end if;

  if deletion_succeeded then
    update app.project_thumbnail_artifacts artifact
    set
      status = 'deleted',
      deleted_at = finish_now,
      next_cleanup_at = null,
      cleanup_lease_token = null,
      cleanup_lease_until = null,
      last_error = null,
      updated_at = finish_now
    where artifact.id = target_artifact_id
      and artifact.status = 'cleanup_pending'
      and artifact.cleanup_lease_token = claim_token
      and not exists (
        select 1
        from app.projects project
        where project.id = artifact.project_id
          and project.thumbnail_path = artifact.path
      )
    returning artifact.id into updated_artifact_id;

    if updated_artifact_id is not null then
      return 'deleted';
    end if;
    return 'stale';
  end if;

  update app.project_thumbnail_artifacts artifact
  set
    cleanup_attempts = artifact.cleanup_attempts + 1,
    next_cleanup_at = finish_now + make_interval(
      secs => least(
        21600,
        (300 * power(2, least(artifact.cleanup_attempts, 6)))::integer
      )
    ),
    cleanup_lease_token = null,
    cleanup_lease_until = null,
    last_error = left(coalesce(nullif(failure_message, ''), 'storage-delete-failed'), 500),
    updated_at = finish_now
  where artifact.id = target_artifact_id
    and artifact.status = 'cleanup_pending'
    and artifact.cleanup_lease_token = claim_token
  returning artifact.id into updated_artifact_id;

  if updated_artifact_id is not null then
    return 'retry';
  end if;
  return 'stale';
end
$$;

revoke all on function app.claim_thumbnail_cleanup(uuid, integer, integer)
  from public, anon, authenticated, easy_dashboard_runtime, service_role;
revoke all on function app.finish_thumbnail_cleanup(uuid, uuid, boolean, text)
  from public, anon, authenticated, easy_dashboard_runtime, service_role;

create function public.claim_thumbnail_cleanup(
  claim_token uuid,
  claim_limit integer default 50,
  lease_seconds integer default 120
)
returns table (
  artifact_id uuid,
  object_path text,
  signed_upload_expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select *
  from app.claim_thumbnail_cleanup(claim_token, claim_limit, lease_seconds)
$$;

create function public.finish_thumbnail_cleanup(
  target_artifact_id uuid,
  claim_token uuid,
  deletion_succeeded boolean,
  failure_message text default null
)
returns text
language sql
security definer
set search_path = ''
as $$
  select app.finish_thumbnail_cleanup(
    target_artifact_id,
    claim_token,
    deletion_succeeded,
    failure_message
  )
$$;

revoke all on function public.claim_thumbnail_cleanup(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.finish_thumbnail_cleanup(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_thumbnail_cleanup(uuid, integer, integer)
  to service_role;
grant execute on function public.finish_thumbnail_cleanup(uuid, uuid, boolean, text)
  to service_role;

create function app.can_access_project_for_user(
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
    join app.space_members member on member.space_id = project.space_id
    where project.id::text = target_project_id
      and (include_deleted or project.deleted_at is null)
      and member.user_id = target_user_id
      and (not require_edit or member.role in ('owner', 'editor'))
  )
$$;

revoke all on function app.can_access_project_for_user(text, uuid, boolean, boolean)
  from public, anon, authenticated;
grant usage on schema app to authenticated;
grant execute on function app.can_access_project_for_user(text, uuid, boolean, boolean)
  to authenticated;

create function app.can_upload_thumbnail_object(
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
    join app.space_members member on member.space_id = project.space_id
    where artifact.path = object_name
      and artifact.status = 'pending'
      and artifact.created_by = target_user_id
      and artifact.expires_at > now()
      and project.deleted_at is null
      and member.user_id = target_user_id
      and member.role in ('owner', 'editor')
  )
$$;

revoke all on function app.can_upload_thumbnail_object(text, uuid)
  from public, anon, authenticated;
grant execute on function app.can_upload_thumbnail_object(text, uuid)
  to authenticated;

create function app.can_delete_thumbnail_object(
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
    join app.space_members member on member.space_id = project.space_id
    where artifact.path = object_name
      and artifact.status = 'cleanup_pending'
      and member.user_id = target_user_id
      and member.role in ('owner', 'editor')
  )
$$;

revoke all on function app.can_delete_thumbnail_object(text, uuid)
  from public, anon, authenticated;
grant execute on function app.can_delete_thumbnail_object(text, uuid)
  to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'easy-dashboard-thumbnails',
  'easy-dashboard-thumbnails',
  false,
  10485760,
  array['image/webp', 'image/svg+xml']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy easy_dashboard_thumbnail_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'easy-dashboard-thumbnails'
  and app.can_upload_thumbnail_object(name, auth.uid())
);

create policy easy_dashboard_thumbnail_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'easy-dashboard-thumbnails'
  and app.can_access_project_for_user(
    (storage.foldername(name))[2],
    auth.uid(),
    false,
    true
  )
);

create policy easy_dashboard_thumbnail_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'easy-dashboard-thumbnails'
  and app.can_delete_thumbnail_object(name, auth.uid())
);
