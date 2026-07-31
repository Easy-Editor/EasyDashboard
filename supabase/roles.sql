-- Local development and CI only.
-- Supabase CLI applies this file before migrations when starting/resetting the
-- local stack. Production deployments must provision a strong password
-- separately and must not run `supabase db push --include-roles`.

do $$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'easy_dashboard_runtime'
  ) then
    create role easy_dashboard_runtime;
  end if;

  alter role easy_dashboard_runtime with
    login
    noinherit
    password 'easy_dashboard_ci_local_only';
end
$$;
