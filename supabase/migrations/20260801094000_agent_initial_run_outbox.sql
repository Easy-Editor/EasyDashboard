alter table app.agent_run_dispatches
  add column kind text not null default 'run'
    check (kind in ('initial', 'run')),
  add column waiting_reason text
    check (waiting_reason in ('upload', 'user'));

create unique index agent_run_dispatches_initial_project_uidx
  on app.agent_run_dispatches(actor_id, project_id)
  where kind = 'initial';

comment on column app.agent_run_dispatches.kind is
  'Distinguishes the project-creation outbox entry from later conversational turns.';
comment on column app.agent_run_dispatches.waiting_reason is
  'Durable reason an outbox entry is paused before executor work can continue.';
