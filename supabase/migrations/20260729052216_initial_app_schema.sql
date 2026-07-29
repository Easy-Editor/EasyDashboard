create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'easy_dashboard_runtime') then
    create role easy_dashboard_runtime
      login noinherit;
  end if;

  if (
    exists (
      select 1
      from pg_roles
      where rolname = 'easy_dashboard_runtime'
        and (
          rolsuper
          or rolcreatedb
          or rolcreaterole
          or rolreplication
          or rolbypassrls
        )
    )
    or exists (
      select 1
      from pg_auth_members membership
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = 'easy_dashboard_runtime'
    )
  ) then
    raise exception 'easy_dashboard_runtime must not have elevated privileges or role memberships';
  end if;

  alter role easy_dashboard_runtime with
    login noinherit;
end
$$;

grant usage on schema app to easy_dashboard_runtime;

create function app.current_actor_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(current_setting('app.actor_id', true), '')::uuid
$$;

revoke all on function app.current_actor_id() from public, anon, authenticated;
grant execute on function app.current_actor_id() to easy_dashboard_runtime;

create function app.current_public_slug()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(current_setting('app.public_slug', true), '')
$$;

revoke all on function app.current_public_slug() from public, anon, authenticated;
grant execute on function app.current_public_slug() to easy_dashboard_runtime;

create table app.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  draft_schema jsonb not null check (jsonb_typeof(draft_schema) = 'object'),
  draft_version integer not null default 1 check (draft_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_updated_idx on app.projects(owner_id, updated_at desc);
alter table app.projects add constraint projects_id_owner_unique unique (id, owner_id);

create table app.project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references app.projects(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  schema jsonb not null check (jsonb_typeof(schema) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (project_id, revision_number),
  unique (id, project_id)
);

create index project_revisions_project_created_idx
  on app.project_revisions(project_id, created_at desc);

create table app.project_publications (
  project_id uuid primary key,
  owner_id uuid not null,
  slug text not null unique check (
    char_length(slug) between 3 and 80
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  revision_id uuid not null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (revision_id, project_id)
    references app.project_revisions(id, project_id)
    on delete restrict,
  foreign key (project_id, owner_id)
    references app.projects(id, owner_id)
    on delete cascade
);

create table app.templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  cover_url text,
  schema jsonb not null check (jsonb_typeof(schema) = 'object'),
  is_official boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function app.reject_revision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'project revisions are immutable' using errcode = '55000';
end
$$;

revoke all on function app.reject_revision_mutation() from public, anon, authenticated;
grant execute on function app.reject_revision_mutation() to easy_dashboard_runtime;

create trigger project_revisions_immutable
before update or delete on app.project_revisions
for each row execute function app.reject_revision_mutation();

alter table app.projects enable row level security;
alter table app.projects force row level security;
alter table app.project_revisions enable row level security;
alter table app.project_revisions force row level security;
alter table app.project_publications enable row level security;
alter table app.project_publications force row level security;
alter table app.templates enable row level security;
alter table app.templates force row level security;
alter table app.user_settings enable row level security;
alter table app.user_settings force row level security;

create policy projects_owner_select on app.projects
for select to easy_dashboard_runtime
using (
  owner_id = app.current_actor_id()
  or exists (
    select 1
    from app.project_publications publication
    where publication.project_id = projects.id
      and publication.slug = app.current_public_slug()
  )
);

create policy projects_owner_insert on app.projects
for insert to easy_dashboard_runtime
with check (owner_id = app.current_actor_id());

create policy projects_owner_update on app.projects
for update to easy_dashboard_runtime
using (owner_id = app.current_actor_id())
with check (owner_id = app.current_actor_id());

create policy projects_owner_delete on app.projects
for delete to easy_dashboard_runtime
using (owner_id = app.current_actor_id());

create policy revisions_owner_or_published_select on app.project_revisions
for select to easy_dashboard_runtime
using (
  exists (
    select 1 from app.projects project
    where project.id = project_revisions.project_id
      and project.owner_id = app.current_actor_id()
  )
  or exists (
    select 1
    from app.project_publications publication
    where publication.revision_id = project_revisions.id
      and publication.slug = app.current_public_slug()
  )
);

create policy revisions_owner_insert on app.project_revisions
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and exists (
    select 1 from app.projects project
    where project.id = project_revisions.project_id
      and project.owner_id = app.current_actor_id()
  )
);

create policy publications_read on app.project_publications
for select to easy_dashboard_runtime
using (
  owner_id = app.current_actor_id()
  or slug = app.current_public_slug()
);

create policy publications_owner_insert on app.project_publications
for insert to easy_dashboard_runtime
with check (
  owner_id = app.current_actor_id()
);

create policy publications_owner_update on app.project_publications
for update to easy_dashboard_runtime
using (
  owner_id = app.current_actor_id()
)
with check (
  owner_id = app.current_actor_id()
);

create policy publications_owner_delete on app.project_publications
for delete to easy_dashboard_runtime
using (
  owner_id = app.current_actor_id()
);

create policy templates_read on app.templates
for select to easy_dashboard_runtime
using (is_official);

create policy settings_owner_select on app.user_settings
for select to easy_dashboard_runtime
using (user_id = app.current_actor_id());

create policy settings_owner_insert on app.user_settings
for insert to easy_dashboard_runtime
with check (user_id = app.current_actor_id());

create policy settings_owner_update on app.user_settings
for update to easy_dashboard_runtime
using (user_id = app.current_actor_id())
with check (user_id = app.current_actor_id());

grant select, insert, update, delete on app.projects to easy_dashboard_runtime;
grant select, insert on app.project_revisions to easy_dashboard_runtime;
grant select, insert, update, delete on app.project_publications to easy_dashboard_runtime;
grant select on app.templates to easy_dashboard_runtime;
grant select, insert, update on app.user_settings to easy_dashboard_runtime;

alter default privileges in schema app revoke all on tables from public, anon, authenticated;
alter default privileges in schema app revoke all on functions from public, anon, authenticated;
