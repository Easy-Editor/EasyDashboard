import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801094000_agent_initial_run_outbox.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('initial Agent run outbox migration', () => {
  it('distinguishes one initial dispatch and persists why planning is paused', () => {
    expect(migration).toContain("add column kind text not null default 'run'")
    expect(migration).toContain("kind in ('initial', 'run')")
    expect(migration).toContain('add column waiting_reason text')
    expect(migration).toContain("waiting_reason in ('upload', 'user')")
    expect(migration).toContain('agent_run_dispatches_initial_project_uidx')
    expect(migration).toContain("where kind = 'initial'")
  })
})
