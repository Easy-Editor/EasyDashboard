-- Browser-renderer and owner-attestation previews are historical evidence only.
-- Remove every unconsumed legacy gate so it cannot occupy the snapshot's
-- unique preview/approval slots after publishing became executor-only.
alter table app.project_publish_approvals
disable trigger project_publish_approvals_consume_once;
alter table app.project_preview_runs
disable trigger project_preview_runs_immutable;

delete from app.project_publish_approvals approval
using app.project_preview_runs preview
where approval.preview_run_id = preview.id
  and preview.source <> 'agent_executor'
  and approval.consumed_at is null
  and approval.consumed_release_id is null;

delete from app.project_preview_runs preview
where preview.source <> 'agent_executor'
  and not exists (
    select 1
    from app.project_publish_approvals approval
    where approval.preview_run_id = preview.id
      and approval.consumed_at is not null
      and approval.consumed_release_id is not null
  );

alter table app.project_preview_runs
enable trigger project_preview_runs_immutable;
alter table app.project_publish_approvals
enable trigger project_publish_approvals_consume_once;
