import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801103000_agent_provider_attempt_evidence.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent provider attempt evidence migration', () => {
  it('stores nullable measured provider I/O duration', () => {
    expect(migration).toContain('add column duration_ms integer')
    expect(migration).toContain('check (duration_ms >= 0)')
    expect(migration).toContain('new.duration_ms')
    expect(migration).toContain('old.duration_ms')
    expect(migration).toContain('null when no provider i/o began or evidence was unavailable')
  })
})
