import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801108000_invalidate_legacy_publish_evidence.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('legacy publish evidence invalidation migration', () => {
  it('removes unconsumed non-executor approvals before their preview evidence', () => {
    const approvalDelete = migration.indexOf('delete from app.project_publish_approvals')
    const previewDelete = migration.indexOf('delete from app.project_preview_runs')

    expect(approvalDelete).toBeGreaterThan(-1)
    expect(previewDelete).toBeGreaterThan(approvalDelete)
    expect(migration).toContain("preview.source <> 'agent_executor'")
    expect(migration).toContain('approval.consumed_at is null')
    expect(migration).toContain('approval.consumed_release_id is null')
  })

  it('preserves historical preview evidence already bound to a release', () => {
    expect(migration).toMatch(
      /not exists[\s\S]*approval\.consumed_at is not null[\s\S]*approval\.consumed_release_id is not null/,
    )
  })

  it('temporarily disables and then restores immutable audit triggers', () => {
    expect(migration).toContain('disable trigger project_publish_approvals_consume_once')
    expect(migration).toContain('disable trigger project_preview_runs_immutable')
    expect(migration).toContain('enable trigger project_preview_runs_immutable')
    expect(migration).toContain('enable trigger project_publish_approvals_consume_once')
  })
})
