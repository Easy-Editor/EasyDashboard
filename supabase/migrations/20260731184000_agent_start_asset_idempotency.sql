alter table app.projects
  add column agent_start_idempotency_key text,
  add column agent_start_input_digest text;

alter table app.projects
  add constraint projects_agent_start_idempotency_pair_check
  check ((agent_start_idempotency_key is null) = (agent_start_input_digest is null));

create unique index projects_owner_agent_start_idempotency_uidx
  on app.projects(owner_id, agent_start_idempotency_key)
  where agent_start_idempotency_key is not null;

alter table app.agent_assets add column idempotency_key text;

update app.agent_assets
set idempotency_key = id::text
where idempotency_key is null;

alter table app.agent_assets alter column idempotency_key set not null;

create unique index agent_assets_actor_idempotency_uidx
  on app.agent_assets(actor_id, idempotency_key);
