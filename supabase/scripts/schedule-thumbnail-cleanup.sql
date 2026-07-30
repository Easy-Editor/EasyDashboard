create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'easy_dashboard_project_url'
      and decrypted_secret is not null
  ) then
    raise exception 'Vault secret easy_dashboard_project_url is required';
  end if;
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'easy_dashboard_thumbnail_cleanup_cron_secret'
      and decrypted_secret is not null
  ) then
    raise exception 'Vault secret easy_dashboard_thumbnail_cleanup_cron_secret is required';
  end if;
end
$$;

select cron.schedule(
  'easy-dashboard-thumbnail-cleanup',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := rtrim(
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'easy_dashboard_project_url'
        ),
        '/'
      ) || '/functions/v1/thumbnail-cleanup',
      headers := jsonb_build_object(
        'Content-Type',
        'application/json',
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'easy_dashboard_thumbnail_cleanup_cron_secret'
        )
      ),
      body := jsonb_build_object('scheduled_at', now()),
      timeout_milliseconds := 60000
    ) as request_id;
  $$
);
