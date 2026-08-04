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
          and project_preview_runs.evidence = jsonb_build_object(
            'artifactId', artifact.id,
            'path', artifact.path,
            'size', artifact.expected_size,
            'draftVersion', artifact.draft_version,
            'documentSha256', snapshot.document_sha256
          )
      )
    )
  )
);
