import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801100000_agent_provider_attempt_generation_fence.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent provider attempt generation fence migration', () => {
  it('backfills and requires the immutable dispatch lease generation and worker binding', () => {
    expect(migration).toContain('add column dispatch_generation integer')
    expect(migration).toContain('add column dispatch_worker_id text')
    expect(migration).toContain('dispatch_generation = dispatch.generation')
    expect(migration).toContain("dispatch_worker_id = coalesce(dispatch.lease_owner, 'legacy-reconciler')")
    expect(migration).toContain('alter column dispatch_generation set not null')
    expect(migration).toContain('alter column dispatch_worker_id set not null')
    expect(migration).toContain('new.dispatch_generation')
    expect(migration).toContain('old.dispatch_generation')
    expect(migration).toContain('new.dispatch_worker_id')
    expect(migration).toContain('old.dispatch_worker_id')
  })
})
