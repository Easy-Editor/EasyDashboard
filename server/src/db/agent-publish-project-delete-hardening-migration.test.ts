import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260801105000_agent_publish_and_project_delete_hardening.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase()
const cleanupMigration = readFileSync(
  new URL('../../../supabase/migrations/20260801106000_agent_preview_operation_cleanup.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent publish and project deletion hardening migration', () => {
  it('accepts only digest-bound committed executor evidence at the database boundary', () => {
    expect(migration).toContain("source = 'agent_executor'")
    expect(migration).toContain("operation.status = 'committed'")
    expect(migration).toContain('operation.candidate_digest = snapshot.document_sha256')
    expect(migration).toContain('operation.evidence = project_preview_runs.evidence')
    expect(migration).toContain("operation.compatibility ->> 'rendererversion' = project_preview_runs.renderer_version")
    expect(migration).toContain("preview.source = 'agent_executor'")
    expect(migration).not.toMatch(
      /create policy publish_approvals_owner_insert[\s\S]*preview\.source\s+in\s*\([^)]*editor_renderer_artifact/,
    )
  })

  it('makes permanent project deletion Owner-only and preserves all member asset ledgers until cleanup settles', () => {
    expect(migration).toMatch(/create policy projects_owner_delete[\s\S]*current_project_member_role\(id\) = 'owner'/)
    expect(migration).toContain('prepare_project_agent_asset_cleanup')
    expect(migration).toContain('finish_project_agent_asset_cleanup')
    expect(migration).toContain("set status = 'deleted'")
    expect(migration).toContain('model_input_bytes = null')
    expect(migration).toContain("storage_cleanup_status = 'completed'")
    expect(migration).toContain('storage_cleanup_attempts = asset.storage_cleanup_attempts + 1')
  })

  it('lets an Owner delete only exact tombstoned pending Agent objects through Storage RLS', () => {
    expect(migration).toContain('can_delete_agent_asset_object')
    expect(migration).toContain("asset.status = 'deleted'")
    expect(migration).toContain("asset.storage_cleanup_status = 'pending'")
    expect(migration).toContain("member.role = 'owner'")
    expect(migration).toContain("bucket_id = 'easy-dashboard-agent-assets'")
  })

  it('cascades trusted preview evidence with its executor operation during project cleanup', () => {
    expect(cleanupMigration).toContain('project_preview_runs_agent_operation_id_fkey')
    expect(cleanupMigration).toContain('references app.agent_spike_operations(id)')
    expect(cleanupMigration).toContain('on delete cascade')
  })
})
