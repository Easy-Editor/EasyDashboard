import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260731183500_agent_platform_default_budget_backfill.sql', import.meta.url),
  ),
  'utf8',
)

describe('Agent platform default budget backfill migration', () => {
  it('moves only identifiable platform-default legacy costs onto the project payer', () => {
    expect(migration).toContain("profile = 'platform:default'")
    expect(migration).toContain("billing_scope = 'user'")
    expect(migration).toContain('payer_id = actor_id')
    expect(migration).toContain("billing_scope = 'project', payer_id = project_id")
  })
})
