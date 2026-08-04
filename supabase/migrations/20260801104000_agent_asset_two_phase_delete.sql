alter table app.agent_assets
  add column storage_cleanup_status text,
  add column storage_cleanup_attempts integer not null default 0,
  add column storage_cleanup_last_error text,
  add column storage_cleanup_completed_at timestamptz;

update app.agent_assets
set storage_cleanup_status = 'completed',
    storage_cleanup_completed_at = coalesce(updated_at, now())
where status = 'deleted';

alter table app.agent_assets
  add constraint agent_assets_storage_cleanup_status_check
    check (storage_cleanup_status is null or storage_cleanup_status in ('pending', 'completed')),
  add constraint agent_assets_storage_cleanup_attempts_check
    check (storage_cleanup_attempts >= 0),
  add constraint agent_assets_storage_cleanup_lifecycle_check
    check (
      (
        status <> 'deleted'
        and storage_cleanup_status is null
        and storage_cleanup_attempts = 0
        and storage_cleanup_last_error is null
        and storage_cleanup_completed_at is null
      )
      or (
        status = 'deleted'
        and storage_cleanup_status = 'pending'
        and storage_cleanup_completed_at is null
      )
      or (
        status = 'deleted'
        and storage_cleanup_status = 'completed'
        and storage_cleanup_last_error is null
        and storage_cleanup_completed_at is not null
      )
    );

comment on column app.agent_assets.storage_cleanup_status is
  'Durable two-phase object cleanup state. Deleted rows remain pending until Storage removal is confirmed.';
