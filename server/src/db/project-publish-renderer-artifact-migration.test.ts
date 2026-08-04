import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260801098000_project_publish_renderer_artifact_evidence.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase()
const bindingMigration = readFileSync(
  new URL('../../../supabase/migrations/20260801099000_project_publish_renderer_evidence_binding.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('project publish renderer artifact evidence migration', () => {
  it('copies an exact current renderer WebP artifact binding into immutable preview evidence', () => {
    expect(migration).toContain("source = 'editor_renderer_artifact'")
    expect(migration).toContain("artifact.status = 'current'")
    expect(migration).toContain("artifact.source = 'renderer'")
    expect(migration).toContain("artifact.content_type = 'image/webp'")
    expect(migration).toContain('snapshot.draft_version = artifact.draft_version')
    expect(migration).toContain('snapshot.document_sha256 = project_preview_runs.document_sha256')
    expect(migration).toContain('artifact.path = project_preview_runs.artifact_path')
    expect(migration).toContain('artifact.expected_size = project_preview_runs.artifact_size')
    expect(bindingMigration).toContain('project_preview_runs.evidence = jsonb_build_object(')
    expect(bindingMigration).toContain("'documentsha256', snapshot.document_sha256")
  })

  it('does not retain a foreign key to the cleanup-managed artifact ledger', () => {
    expect(migration).not.toContain('project_preview_runs_thumbnail_artifact_fkey')
    expect(migration).not.toContain('project_thumbnail_artifacts_id_project_key')
  })

  it('allows approval only for agent or renderer-artifact evidence', () => {
    expect(migration).toContain("preview.source in ('agent_executor', 'editor_renderer_artifact')")
    expect(migration).not.toMatch(
      /create policy publish_approvals_owner_insert[\s\S]*preview\.source in \([^)]*owner_live_render_attestation/,
    )
  })
})
