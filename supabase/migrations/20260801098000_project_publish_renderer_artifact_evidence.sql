alter table app.project_preview_runs
  add column thumbnail_artifact_id uuid,
  add column artifact_path text,
  add column artifact_size integer,
  add column artifact_draft_version integer;

alter table app.project_preview_runs
  drop constraint project_preview_runs_source_check,
  drop constraint project_preview_runs_source_operation_check,
  add constraint project_preview_runs_source_check check (
    source in ('agent_executor', 'owner_live_render_attestation', 'editor_renderer_artifact')
  ),
  add constraint project_preview_runs_source_evidence_check check (
    (
      source = 'agent_executor'
      and agent_operation_id is not null
      and thumbnail_artifact_id is null
      and artifact_path is null
      and artifact_size is null
      and artifact_draft_version is null
    )
    or (
      source = 'owner_live_render_attestation'
      and agent_operation_id is null
      and thumbnail_artifact_id is null
      and artifact_path is null
      and artifact_size is null
      and artifact_draft_version is null
    )
    or (
      source = 'editor_renderer_artifact'
      and agent_operation_id is null
      and thumbnail_artifact_id is not null
      and artifact_path is not null
      and artifact_size > 0
      and artifact_draft_version > 0
    )
  );

drop policy preview_runs_editor_insert on app.project_preview_runs;
create policy preview_runs_editor_insert on app.project_preview_runs
for insert to easy_dashboard_runtime
with check (
  created_by = app.current_actor_id()
  and (
    (source = 'agent_executor' and app.current_project_member_role(project_id) in ('owner', 'editor'))
    or (
      source = 'editor_renderer_artifact'
      and app.current_project_member_role(project_id) in ('owner', 'editor')
      and exists (
        select 1
        from app.project_thumbnail_artifacts artifact
        join app.project_publish_snapshots snapshot
          on snapshot.id = project_preview_runs.publish_snapshot_id
         and snapshot.project_id = project_preview_runs.project_id
        where artifact.id = project_preview_runs.thumbnail_artifact_id
          and artifact.project_id = project_preview_runs.project_id
          and artifact.status = 'current'
          and artifact.source = 'renderer'
          and artifact.content_type = 'image/webp'
          and artifact.path = project_preview_runs.artifact_path
          and artifact.expected_size = project_preview_runs.artifact_size
          and artifact.draft_version = project_preview_runs.artifact_draft_version
          and snapshot.draft_version = artifact.draft_version
          and snapshot.document_sha256 = project_preview_runs.document_sha256
      )
    )
  )
);

drop policy publish_approvals_owner_insert on app.project_publish_approvals;
create policy publish_approvals_owner_insert on app.project_publish_approvals
for insert to easy_dashboard_runtime
with check (
  approved_by = app.current_actor_id()
  and app.current_project_member_role(project_id) = 'owner'
  and exists (
    select 1
    from app.project_preview_runs preview
    where preview.id = preview_run_id
      and preview.publish_snapshot_id = project_publish_approvals.publish_snapshot_id
      and preview.project_id = project_publish_approvals.project_id
      and preview.status = 'verified'
      and preview.source in ('agent_executor', 'editor_renderer_artifact')
  )
);
