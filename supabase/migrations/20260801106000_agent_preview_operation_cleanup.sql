-- A trusted preview is subordinate to its executor operation. Deleting a
-- project cascades through both tables; make the direct relationship cascade
-- as well so PostgreSQL cannot encounter an ordering-dependent FK failure.
alter table app.project_preview_runs
  drop constraint if exists project_preview_runs_agent_operation_id_fkey,
  add constraint project_preview_runs_agent_operation_id_fkey
    foreign key (agent_operation_id)
    references app.agent_spike_operations(id)
    on delete cascade;
