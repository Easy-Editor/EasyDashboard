import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260731182000_agent_run_durable_undo.sql', import.meta.url),
  'utf8',
)

describe('Agent run durable undo migration', () => {
  it('stores one server-authoritative undo timestamp and receipt', () => {
    expect(migration).toContain('add column rolled_back_at timestamptz')
    expect(migration).toContain('add column rollback_receipt jsonb')
    expect(migration).toContain("status = 'committed' and rolled_back_at is not null")
  })

  it('allows only the first undo metadata write on an otherwise immutable terminal operation', () => {
    expect(migration).toContain("old.status = 'committed'")
    expect(migration).toContain('old.rolled_back_at is null')
    expect(migration).toContain("to_jsonb(new) - 'rolled_back_at' - 'rollback_receipt' - 'updated_at'")
    expect(migration).toContain('new.skill_trace')
    expect(migration).toContain('terminal agent spike operations are immutable')
  })
})
