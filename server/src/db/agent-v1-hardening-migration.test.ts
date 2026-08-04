import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260731180500_agent_v1_hardening.sql', import.meta.url)),
  'utf8',
)

describe('Agent V1 hardening migration', () => {
  it('adds per-operation rollback restore points', () => {
    expect(migration).toContain("'publish', 'agent'")
    expect(migration).toContain('rollback_revision_id uuid')
    expect(migration).toContain('references app.project_revisions(id)')
    expect(migration).toContain("rollback_revision_id is null or status = 'committed'")
  })

  it('forces private workspace RLS through project membership', () => {
    expect(migration).toContain('alter table app.agent_workspaces force row level security')
    expect(migration).toContain('owner_id = app.current_actor_id()')
    expect(migration).toContain('app.current_project_member_role(project_id)')
    expect(migration).toContain("in ('owner', 'editor')")
  })
})
